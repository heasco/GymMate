const SERVER_URL = 'http://localhost:8080';

let trainersLookup = {};
let classesData = [];
let trainersOptionsHTML = '';
let searchTimeout = null;

// --------------------------------------
// Admin session configuration
// --------------------------------------
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Admin-scoped storage keys to avoid cross-role interference
const ADMIN_KEYS = {
  token: 'admin_token',
  authUser: 'admin_authUser',
  role: 'admin_role',
  logoutEvent: 'adminLogoutEvent',
};

// --------------------------------------
// Admin storage helpers (namespaced)
// --------------------------------------
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

// --------------------------------------
// Backward‑compatible bootstrap
// Copy valid admin session from generic keys into admin_* once
// --------------------------------------
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

// ------------------------------
// Shared auth helpers (admin only)
// ------------------------------
function clearLocalAuth() {
  // Clear admin_* keys
  AdminStore.clear();

  // Also clear legacy generic keys if they currently represent an admin session.
  // This prevents login.js from auto-redirecting back into admin after logout.
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

function adminLogout(reason, loginPath = '../admin-login.html') {
  console.log('[Admin Logout]:', reason || 'no reason');
  clearLocalAuth();
  // Notify admin tabs only
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = loginPath;
}

// Centralized admin auth check
function ensureAdminAuthOrLogout(loginPath) {
  try {
    // Populate admin_* from generic admin keys if needed
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

    // Refresh timestamp on successful check
    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);

    // Cross-tab logout sync for admin only
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

/**
 * Require a valid auth session for this page.
 * - expectedRole: 'admin' | 'member' | 'trainer'
 * - loginPath: relative path to the corresponding login page
 *
 * For this admin module we delegate to ensureAdminAuthOrLogout,
 * keeping the signature unchanged at the call site.
 */
function requireAuth(expectedRole, loginPath) {
  return ensureAdminAuthOrLogout(loginPath);
}

// Global cross‑tab admin logout sync (admin_* only)
window.addEventListener('storage', (event) => {
  if (event.key === ADMIN_KEYS.logoutEvent) {
    adminLogout('adminLogoutEvent from another tab (global)', '../admin-login.html');
  }
});

// ------------------------------
// Utility for authenticated API calls
// ------------------------------
async function apiFetch(endpoint, options = {}) {
  const ok = ensureAdminAuthOrLogout('../admin-login.html');
  if (!ok) return;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();

  if (!token || !authUser) {
    adminLogout('missing token/authUser in admin apiFetch', '../admin-login.html');
    return;
  }

  // Basic timestamp check (same as requireAuth)
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in apiFetch', '../admin-login.html');
      return;
    }
    // Refresh timestamp on successful API use
    authUser.timestamp = Date.now();
    AdminStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to refresh authUser in apiFetch:', e);
    adminLogout('invalid authUser JSON in apiFetch', '../admin-login.html');
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
    // Session invalid/expired OR logged in from another browser:
    // clear admin, broadcast admin logout, and redirect.
    clearLocalAuth();
    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    window.location.href = '../admin-login.html';
    return;
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// ------------------------------
// Page init
// ------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const ok = requireAuth('admin', '../admin-login.html');
  if (!ok) return;

  setupSidebarAndSession();
  await checkServerConnection();
  await loadTrainers();
  await loadClasses();
  setupEventListeners();
  updateScheduleFilterUI();
});

// ------------------------------
// Sidebar + session handling
// ------------------------------
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  // Security: Check timestamp + clear on invalid
  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in setupSidebarAndSession', '../admin-login.html');
      return;
    }
  } catch (e) {
    adminLogout('invalid authUser JSON in setupSidebarAndSession', '../admin-login.html');
    return;
  }

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () =>
      sidebar.classList.toggle('collapsed')
    );
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
        window.location.href = '../admin-login.html';
      }
    });
  }

  // Mobile sidebar click outside
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

// ------------------------------
// Event listeners
// ------------------------------
function setupEventListeners() {
  const classSearch = document.getElementById('classSearch');
  const scheduleType = document.getElementById('scheduleType');
  const filterClassDate = document.getElementById('filterClassDate');
  const modalOkBtn = document.getElementById('modalOkBtn');

  if (classSearch) classSearch.addEventListener('input', filterAll);
  if (scheduleType) scheduleType.addEventListener('change', function () {
    updateScheduleFilterUI();
    filterAll();
  });
  if (filterClassDate) filterClassDate.addEventListener('input', filterAll);
  document.querySelectorAll('.filterDow').forEach(cb => {
    cb.addEventListener('change', filterAll);
  });
  if (modalOkBtn) {
    modalOkBtn.addEventListener('click', function () {
      const updateSuccessPane = document.getElementById('updateSuccessPane');
      if (updateSuccessPane) updateSuccessPane.style.display = 'none';
    });
  }
}

function updateScheduleFilterUI() {
  const scheduleType = document.getElementById('scheduleType');
  const filterDateGrp = document.getElementById('filterDateGrp');
  const filterDowGrp = document.getElementById('filterDowGrp');
  if (!scheduleType || !filterDateGrp || !filterDowGrp) return;
  const type = scheduleType.value;
  filterDateGrp.style.display = type === 'one-time' ? 'block' : 'none';
  filterDowGrp.style.display = (type === 'weekly' || type === 'monthly') ? 'block' : 'none';
}

// ------------------------------
// Health check
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

// ------------------------------
// Load trainers/classes
// ------------------------------
async function loadTrainers() {
  try {
    const result = await apiFetch('/api/trainers');

    if (!result.success || !Array.isArray(result.data)) {
      throw new Error(result.error || 'Load failed');
    }

    trainersLookup = {};
    trainersOptionsHTML = result.data.map(tr =>
      `<option value="${tr.trainer_id}">${tr.name}</option>`
    ).join('');
    result.data.forEach(tr => {
      trainersLookup[tr.trainer_id] = {
        name: tr.name || 'Unknown',
        specialization: tr.specialization || ''
      };
    });
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
    const result = await apiFetch('/api/classes');

    if (!result.success || !Array.isArray(result.data)) {
      throw new Error(result.error || 'Load failed');
    }

    classesData = result.data;
    renderClasses(classesData);
  } catch (error) {
    console.error('Error loading classes:', error);
    classesList.innerHTML = '<p class="error">Error loading classes</p>';
    showMessage('Failed to load classes', 'error');
  } finally {
    loading.style.display = 'none';
  }
}

// ------------------------------
// Filtering
// ------------------------------
function filterAll() {
  const loading = document.getElementById('classesLoading');
  if (loading) loading.style.display = 'none';

  const classSearch = document.getElementById('classSearch');
  const scheduleType = document.getElementById('scheduleType');
  const filterClassDate = document.getElementById('filterClassDate');
  if (!classSearch || !scheduleType || !filterClassDate) return;

  const search = classSearch.value.trim().toLowerCase();
  const type = scheduleType.value;
  const date = filterClassDate.value;
  const days = Array.from(document.querySelectorAll('.filterDow:checked')).map(cb => cb.value);

  let filtered = classesData.filter(cls => {
    let match = true;
    const trainer = trainersLookup[cls.trainer_id] || { name: '' };

    // Search filter
    if (search) {
      match = (
        (cls.class_name && cls.class_name.toLowerCase().includes(search)) ||
        (cls.schedule && cls.schedule.toLowerCase().includes(search)) ||
        (trainer.name && trainer.name.toLowerCase().includes(search))
      );
    }

    // Schedule type filter
    if (type === 'one-time' && !/^One-time/i.test(cls.schedule || '')) match = false;
    if (type === 'weekly' && !/^Weekly/i.test(cls.schedule || '')) match = false;
    if (type === 'monthly' && !/^Monthly/i.test(cls.schedule || '')) match = false;

    // Date filter for one-time classes
    if (type === 'one-time' && date) {
      const m = cls.schedule && cls.schedule.match(/^One-time\s+(\d{4}-\d{2}-\d{2})/);
      if (!m || m[1] !== date) match = false;
    }

    // Days of week filter for weekly/monthly classes
    if ((type === 'weekly' || type === 'monthly') && days.length > 0) {
      const m = cls.schedule && cls.schedule.match(/(?:Weekly|Monthly)\s+([A-Za-z,\s]+),/i);
      if (!m) match = false;
      else {
        const schedDays = m[1].split(',').map(d => d.trim());
        if (!days.every(day => schedDays.includes(day))) match = false;
      }
    }

    return match;
  });

  renderClasses(filtered);
}

// ------------------------------
// Render classes + edit schedule
// ------------------------------
function renderClasses(classes) {
  const classesList = document.getElementById('classesList');
  if (!classesList) return;
  classesList.innerHTML = '';

  if (!classes.length) {
    classesList.innerHTML = '<p class="no-data">No classes found</p>';
    return;
  }

  const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  classes.forEach(cls => {
    const trainer = trainersLookup[cls.trainer_id] || { name: 'Unknown', specialization: 'N/A' };
    const cid = cls.class_id || cls._id;

    const details = document.createElement('details');
    details.innerHTML = `
      <summary>
        <strong>${cls.class_name}</strong> | Schedule: ${cls.schedule} | Trainer: ${trainer.name} | Enrollment: ${cls.current_enrollment || 0}/${cls.capacity}
      </summary>
      <div class="class-details">
        <div class="trainer-info">
          <h4>Trainer Details</h4>
          <p><strong>Name:</strong> ${trainer.name}</p>
          <p><strong>Specialization:</strong> ${trainer.specialization}</p>
        </div>
        <div class="edit-btn-row">
          <button class="edit-btn" data-cid="${cid}">Edit Schedule</button>
        </div>
        <div class="edit-form"></div>
      </div>
    `;
    classesList.appendChild(details);
  });

  // Add edit event listeners
  classesList.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const cid = btn.getAttribute('data-cid');
      const editFormDiv = btn.closest('.class-details').querySelector('.edit-form');
      if (!editFormDiv) return;
      editFormDiv.style.display = 'block';

      const classObj = classesData.find(c => (c.class_id === cid || c._id === cid));
      if (!classObj) return;
      let trainerOptions = Object.entries(trainersLookup)
        .map(([id, t]) => `<option value="${id}" ${id === classObj.trainer_id ? 'selected' : ''}>${t.name}</option>`)
        .join('');

      let schedType = '', schedDate = '', schedStart = '', schedEnd = '', weeklyDayArr = [];

      // Parse schedule
      if (/^One-time/.test(classObj.schedule)) {
        schedType = 'one-time';
        const m = classObj.schedule.match(/^One-time\s+(\d{4}-\d{2}-\d{2}),\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/);
        if (m) {
          schedDate = m[1];
          schedStart = to24h(m[2]);
          schedEnd = to24h(m[3]);
        }
      }

      if (/^Weekly/.test(classObj.schedule)) {
        schedType = 'weekly';
        const m = classObj.schedule.match(/^Weekly\s+([A-Za-z,\s]+),\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (m) {
          weeklyDayArr = m[1].split(',').map(v => v.trim());
          schedStart = to24h(m[2]);
          schedEnd = to24h(m[3]);
        }
      }

      const weekChecks = weekDays.map(day =>
        `<label><input type="checkbox" name="weekly_days" value="${day}" ${weeklyDayArr.includes(day) ? 'checked' : ''}> ${day}</label>`
      ).join('');

      editFormDiv.innerHTML = `
        <form class="actual-edit-form">
          <div class="form-group">
            <label>Trainer:</label>
            <select name="trainer_id">${trainerOptions}</select>
          </div>

          <div class="form-group">
            <label>Schedule Type:</label>
            <select name="scheduleType">
              <option value="">Select</option>
              <option value="one-time" ${schedType === 'one-time' ? 'selected' : ''}>One-time</option>
              <option value="weekly" ${schedType === 'weekly' ? 'selected' : ''}>Weekly</option>
            </select>
          </div>

          <div class="edit-one-time" style="display:${schedType === 'one-time' ? 'block' : 'none'}">
            <div class="form-group">
              <label>Date:</label>
              <input type="date" name="one_date" value="${schedDate}">
            </div>
            <div class="form-group">
              <label>Start Time:</label>
              <input type="time" name="one_start" value="${schedStart}">
            </div>
            <div class="form-group">
              <label>End Time:</label>
              <input type="time" name="one_end" value="${schedEnd}">
            </div>
          </div>

          <div class="edit-weekly" style="display:${schedType === 'weekly' ? 'block' : 'none'}">
            <div class="form-group">
              <label>Days of Week:</label>
              <div class="checkbox-group">${weekChecks}</div>
            </div>
            <div class="form-group">
              <label>Start Time:</label>
              <input type="time" name="weekly_start" value="${schedStart}">
            </div>
            <div class="form-group">
              <label>End Time:</label>
              <input type="time" name="weekly_end" value="${schedEnd}">
            </div>
          </div>

          <div class="edit-actions">
            <button type="submit" class="action-button">Update Schedule</button>
            <button type="button" class="cancel-edit">Cancel</button>
          </div>
          <div class="edit-status"></div>
        </form>
      `;

      const form = editFormDiv.querySelector('.actual-edit-form');
      if (!form) return;

      // Show/hide schedule type sections
      const showCorrect = () => {
        const editOneTime = form.querySelector('.edit-one-time');
        const editWeekly = form.querySelector('.edit-weekly');
        if (editOneTime) editOneTime.style.display = form.scheduleType.value === 'one-time' ? 'block' : 'none';
        if (editWeekly) editWeekly.style.display = form.scheduleType.value === 'weekly' ? 'block' : 'none';
      };
      if (form.scheduleType) form.scheduleType.addEventListener('change', showCorrect);

      // Cancel button
      const cancelEdit = form.querySelector('.cancel-edit');
      if (cancelEdit) cancelEdit.addEventListener('click', () => {
        editFormDiv.style.display = 'none';
      });

      // Form submission
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editStatus = form.querySelector('.edit-status');
        if (editStatus) editStatus.textContent = 'Updating...';

        const trainer_id = form.trainer_id.value;
        const scheduleType = form.scheduleType.value;
        let schedule = classObj.schedule;

        if (scheduleType === 'one-time') {
          schedule = 'One-time ' + form.one_date.value + ', ' +
            timeFormat(form.one_start.value) + ' - ' + timeFormat(form.one_end.value);
        } else if (scheduleType === 'weekly') {
          const dayVals = Array.from(form.querySelectorAll('input[name="weekly_days"]:checked'))
            .map(d => d.value).join(', ');
          schedule = 'Weekly ' + dayVals + ', ' +
            timeFormat(form.weekly_start.value) + ' - ' + timeFormat(form.weekly_end.value);
        }

        try {
          const result = await apiFetch(`/api/classes/${cid}`, {
            method: 'PUT',
            body: JSON.stringify({ trainer_id, schedule })
          });

          if (result.success) {
            const updateEmailMsg = document.getElementById('updateEmailMsg');
            if (updateEmailMsg) {
              updateEmailMsg.textContent =
                (result.emailNotice && result.emailNotice.length)
                  ? result.emailNotice.join(' ') + ' Changes have been saved.'
                  : 'Trainer notified through email and class updates have been saved.';
            }
            const updateSuccessPane = document.getElementById('updateSuccessPane');
            if (updateSuccessPane) updateSuccessPane.style.display = 'flex';

            await loadClasses(); // Refresh class list
            editFormDiv.style.display = 'none';
            showMessage('Schedule updated successfully', 'success');
          } else {
            if (editStatus) editStatus.textContent = result.error || 'Update failed';
            showMessage(result.error || 'Update failed', 'error');
          }
        } catch (error) {
          console.error('Error updating class:', error);
          if (editStatus) editStatus.textContent = 'Network error';
          showMessage('Network error: ' + error.message, 'error');
        }
      });
    });
  });
}

// ------------------------------
// Utilities
// ------------------------------
function to24h(s) {
  if (!s) return '';
  let [hm, ampm] = s.split(/ /);
  if (!ampm) return hm;
  let [h, m] = hm.split(':');
  h = +h;
  if (ampm.toUpperCase().startsWith('P') && h < 12) h += 12;
  if (ampm.toUpperCase().startsWith('A') && h == 12) h = 0;
  return `${(h + '').padStart(2, '0')}:${m}`;
}

function timeFormat(str) {
  if (!str) return '';
  let [h, m] = str.split(':');
  h = +h;
  return (h % 12 || 12) + ':' + m + ' ' + (h >= 12 ? 'PM' : 'AM');
}

function showMessage(message, type) {
  const messageEl = type === 'success'
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
