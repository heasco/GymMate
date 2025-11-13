// Utility for authenticated API calls (adds security header for /api/ routes)
async function apiFetch(endpoint, options = {}) {
  const token = sessionStorage.getItem('token');
  if (!token) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html';
    return;
  }

  const url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? `${SERVER_URL}${endpoint}`
    : endpoint;

  const headers = { 
    ...options.headers, 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json' // Default for this file's JSON calls
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html';
    return;
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

const SERVER_URL = 'http://localhost:8080';
let trainersMap = new Map();
let classesData = [];
let searchTimeout = null;

document.addEventListener('DOMContentLoaded', async () => {
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  if (!token || role !== 'admin') {
    window.location.href = '../admin-login.html';
    return;
  }
  const authUser = JSON.parse(sessionStorage.getItem('authUser') || '{}');
  if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html';
    return;
  }

  setupSidebarAndSession();
  await checkServerConnection();
  await loadTrainers();
  await loadClasses();
  setupEventListeners();
});

function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
      window.location.href = '../admin-login.html';
    });
  }

  // Mobile sidebar click outside
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar && menuToggle && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
      sidebar.classList.remove('collapsed');
    }
  });

  // Overflow handling on collapse (mobile)
  if (sidebar) {
    sidebar.addEventListener('transitionend', () => {
      if (window.innerWidth <= 768 && sidebar.classList.contains('collapsed')) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = 'auto';
      }
    });
  }
}

function setupEventListeners() {
  const classSearch = document.getElementById('classSearch');
  if (classSearch) {
    classSearch.addEventListener('input', function (e) {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim().toLowerCase();
      searchTimeout = setTimeout(() => {
        filterClasses(query);
      }, 300);
    });
  }
}

async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  if (!statusElement) return;
  try {
    // Secure health check (apiFetch handles auth, but /health can bypass in backend)
    const result = await apiFetch('/health');
    statusElement.textContent = 'Connected to server successfully';
    statusElement.className = 'server-status server-connected';
  } catch (error) {
    statusElement.textContent = 'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
    console.error('Server connection error:', error);
  }
}

async function loadTrainers() {
  try {
    // Secure GET with apiFetch
    const result = await apiFetch('/api/trainers');

    if (!result.success) {
      throw new Error(result.error || 'Load failed');
    }

    if (result.data) {
      result.data.forEach(trainer => {
        trainersMap.set(trainer.trainer_id, {
          name: trainer.name,
          specialization: trainer.specialization
        });
      });
    }
  } catch (error) {
    console.error('Error loading trainers:', error);
    showMessage('Failed to load trainers', 'error');
  }
}

async function loadClasses() {
  const classesList = document.getElementById('classesList');
  const loading = document.getElementById('classesLoading');
  if (!classesList || !loading) return;

  try {
    // Secure GET with apiFetch
    const result = await apiFetch('/api/classes');

    if (!result.success) {
      throw new Error(result.error || 'Load failed');
    }

    if (result.data && result.data.length > 0) {
      classesData = result.data;
      renderClasses(classesData);
    } else {
      classesList.innerHTML = '<p class="no-data">No classes available</p>';
    }
  } catch (error) {
    console.error('Error loading classes:', error);
    classesList.innerHTML = '<p class="error">Error loading classes</p>';
    showMessage('Failed to load classes', 'error');
  } finally {
    loading.style.display = 'none';
  }
}

function renderClasses(classes) {
  const classesList = document.getElementById('classesList');
  if (!classesList) return;
  classesList.innerHTML = '';

  if (classes.length === 0) {
    classesList.innerHTML = '<p class="no-data">No classes found</p>';
    return;
  }

  classes.forEach(cls => {
    const trainer = trainersMap.get(cls.trainer_id) || { name: 'Unknown', specialization: 'N/A' };
    const details = document.createElement('details');
    const classIdentifier = cls.class_id || cls._id;

    details.innerHTML = `
      <summary>
        <strong>${cls.class_name}</strong> - ${cls.schedule} - Trainer: ${trainer.name} - Enrollment: ${cls.current_enrollment || 0}/${cls.capacity}
      </summary>
      <div class="class-details">
        <div class="trainer-info">
          <h3>Trainer Details</h3>
          <p><strong>Name:</strong> ${trainer.name}</p>
          <p><strong>Specialization:</strong> ${trainer.specialization}</p>
        </div>

        <h3>Enrolled Members</h3>

        <div class="enrollment-filters">
          <label for="date-${classIdentifier}">Filter by date:</label>
          <input type="date" id="date-${classIdentifier}">
          <button id="btn-date-${classIdentifier}" class="btn-filter">Show</button>
          <button id="btn-next3-${classIdentifier}" class="btn-next3">Show Next 3 Sessions</button>
        </div>

        <div id="members-${classIdentifier}" class="loading">Select a date or show next 3 sessions...</div>

        <div class="feedback-section">
          <h3>Class Feedback</h3>
          <div id="feedback-${classIdentifier}"></div>
        </div>
      </div>
    `;

    details.addEventListener('toggle', () => {
      if (details.open) {
        loadNextThreeSessions(classIdentifier);
        loadClassFeedback(classIdentifier);
      }
    });

    // Handle button clicks within this class
    details.addEventListener('click', async (e) => {
      if (e.target.id === `btn-date-${classIdentifier}`) {
        const dateInput = document.getElementById(`date-${classIdentifier}`);
        const value = dateInput.value;
        if (!value) {
          renderMembersEmpty(`members-${classIdentifier}`, 'Please select a date.');
          return;
        }
        await loadEnrolledMembersByDate(classIdentifier, value);
      }

      if (e.target.id === `btn-next3-${classIdentifier}`) {
        await loadNextThreeSessions(classIdentifier);
      }
    });

    classesList.appendChild(details);
  });
}

function filterClasses(query) {
  const filtered = classesData.filter(cls => {
    const trainer = trainersMap.get(cls.trainer_id) || { name: '' };
    return (
      cls.class_name.toLowerCase().includes(query) ||
      String(cls.schedule || '').toLowerCase().includes(query) ||
      trainer.name.toLowerCase().includes(query)
    );
  });
  renderClasses(filtered);
}

// Enrollment functions
function renderMembersEmpty(targetId, message) {
  const membersDiv = document.getElementById(targetId);
  if (!membersDiv) return;
  membersDiv.innerHTML = `<p class="no-data">${message}</p>`;
}

function groupEnrollmentsByDate(enrollments) {
  const map = new Map();
  enrollments.forEach(e => {
    const key = new Date(e.session_date).toDateString();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  });
  map.forEach(list => list.sort((a, b) => (a.member_name || '').localeCompare(b.member_name || '')));
  return map;
}

function renderEnrollments(targetId, enrollments, heading = null) {
  const membersDiv = document.getElementById(targetId);
  if (!membersDiv) return;

  if (!enrollments || enrollments.length === 0) {
    membersDiv.innerHTML = '<p class="no-data">No enrolled members found</p>';
    return;
  }

  const grouped = groupEnrollmentsByDate(enrollments);
  let html = '';
  if (heading) {
    html += `<h4>${heading}</h4>`;
  }

  grouped.forEach((list, dateKey) => {
    html += `<div class="session-group">
                <div class="session-date">${dateKey}</div>
                <ul class="members-list">`;
    list.forEach(en => {
      html += `<li>
                ${en.member_name || 'Unknown'} (${en.member_id})
                <span class="session-time">${en.session_time || ''}</span>
                <span class="badge ${en.attendance_status}">${(en.attendance_status || 'scheduled').toUpperCase()}</span>
              </li>`;
    });
    html += `</ul></div>`;
  });

  membersDiv.innerHTML = html;
}

async function fetchClassEnrollments(classIdentifier) {
  try {
    // Secure GET with apiFetch
    const result = await apiFetch(`/api/enrollments/class/${encodeURIComponent(classIdentifier)}`);

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    return result.data || [];
  } catch (error) {
    throw error;
  }
}

async function loadEnrolledMembersByDate(classIdentifier, yyyyMMdd) {
  const targetId = `members-${classIdentifier}`;
  const membersDiv = document.getElementById(targetId);
  if (!membersDiv) return;
  membersDiv.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const all = await fetchClassEnrollments(classIdentifier);
    const target = new Date(yyyyMMdd);
    const filtered = all.filter(e => {
      const d = new Date(e.session_date);
      return d.getFullYear() === target.getFullYear() &&
        d.getMonth() === target.getMonth() &&
        d.getDate() === target.getDate();
    });
    renderEnrollments(targetId, filtered, `Enrolled on ${new Date(yyyyMMdd).toLocaleDateString()}`);
  } catch (err) {
    membersDiv.innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
}

function getNextNDistinctSessionDates(enrollments, n = 3) {
  const today = new Date();
  const future = enrollments
    .filter(e => new Date(e.session_date) >= new Date(today.toDateString()))
    .sort((a, b) => new Date(a.session_date) - new Date(b.session_date));

  const dates = [];
  const seen = new Set();
  for (const e of future) {
    const key = new Date(e.session_date).toDateString();
    if (!seen.has(key)) {
      seen.add(key);
      dates.push(key);
    }
    if (dates.length === n) break;
  }
  return dates;
}

async function loadNextThreeSessions(classIdentifier) {
  const targetId = `members-${classIdentifier}`;
  const membersDiv = document.getElementById(targetId);
  if (!membersDiv) return;
  membersDiv.innerHTML = '<div class="loading">Loading next sessions...</div>';

  try {
    const all = await fetchClassEnrollments(classIdentifier);
    const nextDates = getNextNDistinctSessionDates(all, 3);

    if (nextDates.length === 0) {
      renderMembersEmpty(targetId, 'No upcoming sessions found.');
      return;
    }

    const dateSet = new Set(nextDates);
    const filtered = all.filter(e => dateSet.has(new Date(e.session_date).toDateString()));
    renderEnrollments(targetId, filtered, `Next ${nextDates.length} session day(s)`);
  } catch (err) {
    membersDiv.innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
}

// Feedback functions
async function loadClassFeedback(classIdentifier) {
  const feedbackDiv = document.getElementById(`feedback-${classIdentifier}`);
  if (!feedbackDiv) return;
  feedbackDiv.innerHTML = '<div class="loading">Loading feedback...</div>';

  try {
    // Secure GET with apiFetch
    const result = await apiFetch(`/api/classes/${classIdentifier}/feedback`);

    if (!result.success) {
      throw new Error(result.error || 'Failed to load feedback');
    }

    const feedbacks = result.data || [];

    if (feedbacks.length === 0) {
      feedbackDiv.innerHTML = '<p class="no-data">No feedback yet</p>';
      return;
    }

    const avgRating = (feedbacks.reduce((sum, fb) => sum + fb.rating, 0) / feedbacks.length).toFixed(2);
    let html = `<div class="feedback-summary">
                  <strong>Average Rating:</strong> ${avgRating} / 5 (${feedbacks.length} reviews)
                </div>
                <ul class="feedback-list">`;

    feedbacks.forEach(fb => {
      html += `<li class="feedback-item">
                <div class="feedback-header">
                  <strong>Rating: ${fb.rating}/5</strong>
                  <span class="feedback-date">${new Date(fb.date_submitted).toLocaleDateString()}</span>
                </div>
                <div class="feedback-comment">${fb.comment || "(No comment)"}</div>
                <div class="feedback-member">Member: ${fb.member_id}</div>
                <button class="delete-feedback-btn" data-id="${fb.feedback_id}">Delete</button>
              </li>`;
    });
    html += "</ul>";
    feedbackDiv.innerHTML = html;

    // Add delete event listeners
    feedbackDiv.querySelectorAll('.delete-feedback-btn').forEach(btn => {
      btn.addEventListener('click', async function () {
        const id = btn.getAttribute('data-id');
        if (!confirm('Are you sure you want to delete this feedback?')) return;

        try {
          // Secure DELETE with apiFetch
          const delResult = await apiFetch(`/api/feedbacks/${id}`, { method: 'DELETE' });

          if (delResult.success) {
            btn.closest('.feedback-item').remove();
            showMessage('Feedback deleted successfully', 'success');
          } else {
            throw new Error(delResult.error || 'Delete failed');
          }
        } catch (error) {
          showMessage('Failed to delete feedback: ' + error.message, 'error');
        }
      });
    });
  } catch (error) {
    feedbackDiv.innerHTML = `<p class="error">Error loading feedback: ${error.message}</p>`;
  }
}

function showMessage(message, type) {
  const messageEl = type === 'success' ?
    document.getElementById('successMessage') :
    document.getElementById('errorMessage');

  if (messageEl) {
    messageEl.textContent = message;
    messageEl.style.display = 'block';
    setTimeout(() => {
      messageEl.style.display = 'none';
    }, 5000);
  }
}
