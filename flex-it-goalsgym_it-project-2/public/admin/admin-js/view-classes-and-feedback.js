const SERVER_URL = 'http://localhost:8080';

let trainersMap = new Map();
let classesData = []; // Store full payload for filtering
let searchTimeout = null;
let currentViewMode = 'active'; // Default view

// --------------------------------------
// Admin session configuration
// --------------------------------------
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

const ADMIN_KEYS = {
  token: 'admin_token',
  authUser: 'admin_authUser',
  role: 'admin_role',
  logoutEvent: 'adminLogoutEvent',
};

const AdminStore = {
  set(token, userPayload) {
    try {
      const authUser = {
        ...(userPayload || {}),
        timestamp: Date.now(),
        role: 'admin',
        token,
      };

      localStorage.setItem(ADMIN_KEYS.token, token);
      localStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser));
      localStorage.setItem(ADMIN_KEYS.role, 'admin');

      sessionStorage.setItem(ADMIN_KEYS.token, token);
      sessionStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser));
      sessionStorage.setItem(ADMIN_KEYS.role, 'admin');
    } catch (e) {
      console.error('[AdminStore.set] failed:', e);
    }
  },

  getToken() {
    return (
      sessionStorage.getItem(ADMIN_KEYS.token) ||
      localStorage.getItem(ADMIN_KEYS.token) ||
      null
    );
  },

  getAuthUser() {
    const raw =
      sessionStorage.getItem(ADMIN_KEYS.authUser) ||
      localStorage.getItem(ADMIN_KEYS.authUser);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[AdminStore.getAuthUser] parse error:', e);
      return null;
    }
  },

  hasSession() {
    return (
      (localStorage.getItem(ADMIN_KEYS.token) ||
        sessionStorage.getItem(ADMIN_KEYS.token)) &&
      (localStorage.getItem(ADMIN_KEYS.authUser) ||
        sessionStorage.getItem(ADMIN_KEYS.authUser)) &&
      ((localStorage.getItem(ADMIN_KEYS.role) ||
        sessionStorage.getItem(ADMIN_KEYS.role)) === 'admin')
    );
  },

  clear() {
    localStorage.removeItem(ADMIN_KEYS.token);
    localStorage.removeItem(ADMIN_KEYS.authUser);
    localStorage.removeItem(ADMIN_KEYS.role);

    sessionStorage.removeItem(ADMIN_KEYS.token);
    sessionStorage.removeItem(ADMIN_KEYS.authUser);
    sessionStorage.removeItem(ADMIN_KEYS.role);
  },
};

function bootstrapAdminFromGenericIfNeeded() {
  try {
    if (AdminStore.hasSession()) return;

    const genToken = localStorage.getItem('token');
    const genRole = localStorage.getItem('role');
    const genAuthRaw = localStorage.getItem('authUser');

    if (!genToken || !genRole || genRole !== 'admin' || !genAuthRaw) return;

    const genAuth = JSON.parse(genAuthRaw);
    AdminStore.set(genToken, genAuth);
  } catch (e) {
    console.error('[bootstrapAdminFromGenericIfNeeded] failed:', e);
  }
}

function clearLocalAuth() {
  AdminStore.clear();

  try {
    const genericRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');

    if (genericRole === 'admin') {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');

      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
    }
  } catch (e) {
    console.error('[clearLocalAuth] failed to clear generic admin keys:', e);
  }
}

function getApiBase() {
  return (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? SERVER_URL
    : '';
}

function getToken() {
  return AdminStore.getToken();
}

function adminLogout(reason, loginPath = '../login.html') {
  console.log('[Admin Logout]:', reason || 'no reason');
  clearLocalAuth();
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = loginPath;
}

function ensureAdminAuthOrLogout(loginPath) {
  try {
    if (!AdminStore.hasSession()) {
      bootstrapAdminFromGenericIfNeeded();
    }

    if (!AdminStore.hasSession()) {
      adminLogout('missing admin session', loginPath);
      return false;
    }

    const authUser = AdminStore.getAuthUser();
    if (!authUser || authUser.role !== 'admin') {
      adminLogout('invalid or non-admin authUser', loginPath);
      return false;
    }

    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded', loginPath);
      return false;
    }

    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);

    window.addEventListener('storage', (event) => {
      if (event.key === ADMIN_KEYS.logoutEvent) {
        adminLogout('adminLogoutEvent from another tab', loginPath);
      }
    });

    return true;
  } catch (e) {
    console.error('Auth check failed:', e);
    adminLogout('exception in ensureAdminAuthOrLogout', loginPath);
    return false;
  }
}

function requireAuth(expectedRole, loginPath) {
  return ensureAdminAuthOrLogout(loginPath);
}

window.addEventListener('storage', (event) => {
  if (event.key === ADMIN_KEYS.logoutEvent) {
    adminLogout('adminLogoutEvent from another tab (global)', '../login.html');
  }
});

async function apiFetch(endpoint, options = {}) {
  const ok = ensureAdminAuthOrLogout('../login.html');
  if (!ok) return;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();

  if (!token || !authUser) {
    adminLogout('missing token/authUser in admin apiFetch', '../login.html');
    return;
  }

  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in apiFetch', '../login.html');
      return;
    }
    authUser.timestamp = Date.now();
    AdminStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to refresh authUser in apiFetch:', e);
    adminLogout('invalid authUser JSON in apiFetch', '../login.html');
    return;
  }

  const url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? `${SERVER_URL}${endpoint}`
    : endpoint;

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    clearLocalAuth();
    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    window.location.href = '../login.html';
    return;
  }
  
  if (!response.ok) {
    try {
        const errBody = await response.json();
        throw new Error(errBody.error || `API error: ${response.status}`);
    } catch(e) {
        throw new Error(`API error: ${response.status}`);
    }
  }
  return response.json();
}

// ------------------------------
// Page Initialization
// ------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const ok = requireAuth('admin', '../login.html');
  if (!ok) return;

  setupSidebarAndSession();
  setupEventListeners();
  await checkServerConnection();
  await loadTrainers();
  await loadClasses();
});

// ------------------------------
// Session / Sidebar UI
// ------------------------------
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in setupSidebarAndSession', '../login.html');
      return;
    }
  } catch (e) {
    adminLogout('invalid authUser JSON in setupSidebarAndSession', '../login.html');
    return;
  }

  const adminNameEl = document.getElementById('adminFullName');
  if (adminNameEl) {
    const authUser = AdminStore.getAuthUser();
    adminNameEl.textContent = authUser?.name ? authUser.name : 'Admin';
  }

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const token = getToken();
      try {
        if (token) {
          const logoutUrl = `${getApiBase()}/api/logout`;
          await fetch(logoutUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      } catch (e) {
        console.error('Logout error:', e);
      } finally {
        clearLocalAuth();
        localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
        window.location.href = '../login.html';
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (
      window.innerWidth <= 768 &&
      sidebar &&
      menuToggle &&
      !sidebar.contains(e.target) &&
      !menuToggle.contains(e.target)
    ) {
      sidebar.classList.remove('collapsed');
    }
  });

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
    classSearch.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        filterClasses(e.target.value);
      }, 300);
    });
  }

  // Toggle Switches
  const viewActiveBtn = document.getElementById('viewActiveBtn');
  const viewArchivedBtn = document.getElementById('viewArchivedBtn');
  const listTitleHeader = document.getElementById('listTitleHeader');

  if (viewActiveBtn && viewArchivedBtn) {
      viewActiveBtn.addEventListener('click', () => {
          currentViewMode = 'active';
          viewActiveBtn.classList.add('active');
          viewArchivedBtn.classList.remove('active');
          if(listTitleHeader) listTitleHeader.textContent = "Active Classes List";
          filterClasses(document.getElementById('classSearch').value);
      });

      viewArchivedBtn.addEventListener('click', () => {
          currentViewMode = 'archived';
          viewArchivedBtn.classList.add('active');
          viewActiveBtn.classList.remove('active');
          if(listTitleHeader) listTitleHeader.textContent = "Archived Classes List";
          filterClasses(document.getElementById('classSearch').value);
      });
  }
}

// ------------------------------
// Initial Data Loading
// ------------------------------
async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  if (!statusElement) return;

  try {
    const result = await apiFetch('/health');
    if (result) {
      statusElement.textContent = 'Connected to server successfully';
      statusElement.className = 'server-status server-connected';
    } else {
      throw new Error('Health check failed');
    }
  } catch (error) {
    statusElement.textContent = 'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
    console.error('Server connection error:', error);
  }
}

async function loadTrainers() {
  try {
    const result = await apiFetch('/api/trainers');
    if (result.success && Array.isArray(result.data)) {
      result.data.forEach((trainer) => {
        trainersMap.set(trainer.trainer_id, trainer);
      });
    }
  } catch (error) {
    console.error('Error loading trainers:', error);
    showMessage('Error loading trainers. Trainer details may be incomplete.', 'error');
  }
}

async function loadClasses() {
  const classesList = document.getElementById('classesList');
  const loading = document.getElementById('classesLoading');
  if (!classesList || !loading) return;

  try {
    const result = await apiFetch('/api/classes');
    if (!result.success || !Array.isArray(result.data)) {
      throw new Error(result.error || 'Failed to fetch classes');
    }

    classesData = result.data;
    filterClasses(''); // Initial render
  } catch (error) {
    console.error('Error loading classes:', error);
    classesList.innerHTML = `<p class="error">Error loading classes: ${error.message}</p>`;
    showMessage('Failed to load classes', 'error');
  } finally {
    loading.style.display = 'none';
  }
}

// ------------------------------
// Filtering & Rendering
// ------------------------------
function filterClasses(searchTerm) {
  const term = (searchTerm || '').toLowerCase().trim();
  
  const filtered = classesData.filter((cls) => {
    // 1. Filter by Status Toggle
    const clsStatus = cls.status || 'active';
    if (clsStatus !== currentViewMode) return false;

    // 2. Filter by Search Term
    if (!term) return true;
    
    const trainerName = cls.trainer_name?.toLowerCase() || '';
    let trainerInfo = trainersMap.get(cls.trainer_id);
    let mappedTrainerName = trainerInfo ? trainerInfo.name.toLowerCase() : '';

    return (
      (cls.class_name && cls.class_name.toLowerCase().includes(term)) ||
      trainerName.includes(term) ||
      mappedTrainerName.includes(term) ||
      (cls.schedule && cls.schedule.toLowerCase().includes(term))
    );
  });

  renderClasses(filtered);
}

function renderClasses(classesToRender) {
  const classesList = document.getElementById('classesList');
  if (!classesList) return;

  classesList.innerHTML = '';

  if (classesToRender.length === 0) {
    classesList.innerHTML = '<p class="no-data">No classes found matching your criteria</p>';
    return;
  }

  classesToRender.forEach((cls) => {
    const trainer = trainersMap.get(cls.trainer_id) || {
      name: cls.trainer_name || 'Unknown',
      specialization: 'N/A',
    };

    const details = document.createElement('details');
    details.innerHTML = `
      <summary>
        <strong>${cls.class_name}</strong> | 
        Schedule: ${cls.schedule} | 
        Trainer: ${trainer.name} | 
        Enrollment: ${cls.current_enrollment || 0}/${cls.capacity}
      </summary>
      <div class="class-details">
        <div class="trainer-info">
          <h4>Trainer Details</h4>
          <p><strong>Name:</strong> ${trainer.name}</p>
          <p><strong>Specialization:</strong> ${trainer.specialization}</p>
        </div>
        
        <div class="members-info">
          <h4>Enrolled Members</h4>
          <ul class="members-list" id="members-${cls.class_id}">
            <li>Loading members...</li>
          </ul>
        </div>

        <div class="feedback-info">
          <h4>Class Feedback</h4>
          <div id="feedback-${cls.class_id}">
            <p>Loading feedback...</p>
          </div>
        </div>
      </div>
    `;

    details.addEventListener('toggle', function (e) {
      if (e.target.open) {
        // We need either custom class_id or _id for the API calls
        const idToFetch = cls.class_id || cls._id;
        loadClassMembers(idToFetch, `members-${cls.class_id}`);
        loadClassFeedback(idToFetch, `feedback-${cls.class_id}`);
      }
    });

    classesList.appendChild(details);
  });
}

// ------------------------------
// Fetch Details (Members/Feedback)
// ------------------------------
async function loadClassMembers(classId, elementId) {
  const membersList = document.getElementById(elementId);
  if (!membersList) return;

  try {
    const result = await apiFetch(`/api/classes/${classId}/enrolled-members`);
    if (!result.success) throw new Error(result.error || 'Failed to load members');

    const members = result.data || [];
    if (members.length === 0) {
      membersList.innerHTML = '<li>No members currently enrolled</li>';
      return;
    }

    let html = '';
    members.forEach((m) => {
      const date = new Date(m.enrollment_date).toLocaleDateString();
      html += `
        <li>
          <span>${m.member_name} (${m.member_id})</span>
          <span class="enrollment-date">Enrolled: ${date}</span>
        </li>
      `;
    });
    membersList.innerHTML = html;
  } catch (error) {
    membersList.innerHTML = `<li class="error">Error loading members: ${error.message}</li>`;
  }
}

async function loadClassFeedback(classId, elementId) {
  const feedbackDiv = document.getElementById(elementId);
  if (!feedbackDiv) return;

  try {
    const result = await apiFetch(`/api/classes/${classId}/feedback`);
    if (!result.success) throw new Error(result.error || 'Failed to load feedback');

    const feedback = result.data || [];
    if (feedback.length === 0) {
      feedbackDiv.innerHTML = '<p class="no-data">No feedback submitted yet</p>';
      return;
    }

    let html = '<ul class="feedback-list">';
    feedback.forEach((f) => {
      const date = new Date(f.date_submitted).toLocaleDateString();
      const stars = '★'.repeat(f.rating) + '☆'.repeat(5 - f.rating);
      
      html += `
        <li class="feedback-item">
          <div class="feedback-header">
            <span class="feedback-rating" title="${f.rating}/5 Stars">${stars}</span>
            <span class="feedback-date">${date}</span>
          </div>
          <p class="feedback-comment">"${f.comment || 'No comment provided'}"</p>
          <div class="feedback-member">From: Member ID ${f.member_id}</div>
          <button class="delete-feedback-btn" data-id="${f._id}">Delete Feedback</button>
        </li>
      `;
    });
    html += '</ul>';
    feedbackDiv.innerHTML = html;

    // Add delete event listeners
    feedbackDiv.querySelectorAll('.delete-feedback-btn').forEach((btn) => {
      btn.addEventListener('click', async function () {
        const id = btn.getAttribute('data-id');
        if (!confirm('Are you sure you want to delete this feedback?')) return;

        try {
          const delResult = await apiFetch(`/api/feedbacks/${id}`, {
            method: 'DELETE',
          });

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
  const messageEl =
    type === 'success'
      ? document.getElementById('successMessage')
      : document.getElementById('errorMessage');

  if (messageEl) {
    messageEl.textContent = message;
    messageEl.style.display = 'block';
    setTimeout(() => {
      messageEl.style.display = 'none';
    }, 5000);
  }
}