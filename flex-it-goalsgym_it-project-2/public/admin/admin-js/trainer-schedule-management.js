const SERVER_URL = 'http://localhost:8080';

let trainersLookup = {};
let classesData = []; // Full list of classes fetched on load
let trainersOptionsHTML = '';
let searchTimeout = null;

// Keep track of the currently edited class form
let currentEditContext = {
    form: null,
    classId: null,
    mongoId: null,
    originalSchedule: null,
    originalTrainerId: null
};

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
// Page init
// ------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const ok = requireAuth('admin', '../login.html');
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

  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout(
        'admin session max age exceeded in setupSidebarAndSession',
        '../login.html'
      );
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

// ------------------------------
// Event listeners & Modals
// ------------------------------
function setupEventListeners() {
    const classSearch = document.getElementById('classSearch');
    const scheduleType = document.getElementById('scheduleType');
    const filterClassDate = document.getElementById('filterClassDate');
    
    // Action buttons inside modals
    const modalOkBtn = document.getElementById('modalOkBtn');
    const cancelConflictBtn = document.getElementById('cancelConflictBtn');
    const deleteClassBtn = document.getElementById('deleteClassBtn');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

    // X close buttons on modals
    const closeConflictBtn = document.getElementById('closeConflictModalBtn');
    const closeDeleteBtn = document.getElementById('closeDeleteModalBtn');
    const closeSuccessBtn = document.getElementById('closeSuccessModalBtn');

    if (classSearch) classSearch.addEventListener('input', filterAll);
    if (scheduleType) scheduleType.addEventListener('change', function () {
        updateScheduleFilterUI();
        filterAll();
    });
    if (filterClassDate) filterClassDate.addEventListener('input', filterAll);
    document.querySelectorAll('.filterDow').forEach(cb => {
        cb.addEventListener('change', filterAll);
    });

    // Close logic for Modals
    if (modalOkBtn) modalOkBtn.addEventListener('click', () => document.getElementById('updateSuccessPane').style.display = 'none');
    if (cancelConflictBtn) cancelConflictBtn.addEventListener('click', () => document.getElementById('conflictModal').style.display = 'none');
    if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', () => document.getElementById('deleteConfirmModal').style.display = 'none');
    
    // Close on X
    if (closeConflictBtn) closeConflictBtn.addEventListener('click', () => document.getElementById('conflictModal').style.display = 'none');
    if (closeDeleteBtn) closeDeleteBtn.addEventListener('click', () => document.getElementById('deleteConfirmModal').style.display = 'none');
    if (closeSuccessBtn) closeSuccessBtn.addEventListener('click', () => document.getElementById('updateSuccessPane').style.display = 'none');

    // Close Modals when clicking outside of them
    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('conflictModal')) document.getElementById('conflictModal').style.display = 'none';
        if (e.target === document.getElementById('deleteConfirmModal')) document.getElementById('deleteConfirmModal').style.display = 'none';
        if (e.target === document.getElementById('updateSuccessPane')) document.getElementById('updateSuccessPane').style.display = 'none';
    });

    if (deleteClassBtn) {
        deleteClassBtn.addEventListener('click', () => {
            document.getElementById('conflictModal').style.display = 'none';
            document.getElementById('deleteConfirmModal').style.display = 'flex';
        });
    }
    
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', handleDeleteClass);
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

    classesData = result.data; // Store full payload for frontend conflict checking
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

    if (search) {
      match = (
        (cls.class_name && cls.class_name.toLowerCase().includes(search)) ||
        (cls.schedule && cls.schedule.toLowerCase().includes(search)) ||
        (trainer.name && trainer.name.toLowerCase().includes(search))
      );
    }

    if (type === 'one-time' && !/^One-time/i.test(cls.schedule || '')) match = false;
    if (type === 'weekly' && !/^Weekly/i.test(cls.schedule || '')) match = false;
    if (type === 'monthly' && !/^Monthly/i.test(cls.schedule || '')) match = false;

    if (type === 'one-time' && date) {
      const m = cls.schedule && cls.schedule.match(/^One-time\s+(\d{4}-\d{2}-\d{2})/);
      if (!m || m[1] !== date) match = false;
    }

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
    const mongoId = cls._id;

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
          <button class="edit-btn" data-cid="${cid}" data-mongoid="${mongoId}">Edit Schedule</button>
        </div>
        <div class="edit-form"></div>
      </div>
    `;
    classesList.appendChild(details);
  });

  classesList.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const cid = btn.getAttribute('data-cid');
      const mongoId = btn.getAttribute('data-mongoid');
      
      const editFormDiv = btn.closest('.class-details').querySelector('.edit-form');
      if (!editFormDiv) return;
      editFormDiv.style.display = 'block';

      const classObj = classesData.find(c => (c.class_id === cid || c._id === cid));
      if (!classObj) return;
      let trainerOptions = Object.entries(trainersLookup)
        .map(([id, t]) => `<option value="${id}" ${id === classObj.trainer_id ? 'selected' : ''}>${t.name}</option>`)
        .join('');

      let schedType = '', schedDate = '', schedStart = '', schedEnd = '', weeklyDayArr = [];

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
      
      currentEditContext = {
          form: form,
          classId: cid,
          mongoId: mongoId,
          originalSchedule: classObj.schedule,
          originalTrainerId: classObj.trainer_id
      };

      const showCorrect = () => {
        const editOneTime = form.querySelector('.edit-one-time');
        const editWeekly = form.querySelector('.edit-weekly');
        if (editOneTime) editOneTime.style.display = form.scheduleType.value === 'one-time' ? 'block' : 'none';
        if (editWeekly) editWeekly.style.display = form.scheduleType.value === 'weekly' ? 'block' : 'none';
      };
      if (form.scheduleType) form.scheduleType.addEventListener('change', showCorrect);

      const cancelEdit = form.querySelector('.cancel-edit');
      if (cancelEdit) cancelEdit.addEventListener('click', () => {
        editFormDiv.style.display = 'none';
      });

      form.addEventListener('submit', handleUpdateSubmit);
    });
  });
}

// ------------------------------
// Client-Side Conflict Checking
// ------------------------------
function parseTimeString(t) {
    if (!t) return 0;
    const parts = t.trim().split(/\s+/);
    let time = parts[0];
    let modifier = parts[1] || '';
    let [hours, minutes] = time.split(':');
    hours = parseInt(hours, 10);
    minutes = parseInt(minutes, 10);
    
    if (modifier.toUpperCase().startsWith('AM') && hours === 12) hours = 0;
    if (modifier.toUpperCase().startsWith('PM') && hours < 12) hours += 12;
    
    return hours * 60 + minutes; // returns minutes from midnight
}

function checkScheduleConflict(trainer_id, newType, newDate, newDays, newStartStr, newEndStr, excludeClassId) {
    const newStart = parseTimeString(newStartStr);
    const newEnd = parseTimeString(newEndStr);
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let newDayOfWeek = '';
    
    if (newType === 'one-time' && newDate) {
        const [y, m, d] = newDate.split('-');
        const dateObj = new Date(y, m - 1, d); // Prevents timezone shifts
        newDayOfWeek = daysOfWeek[dateObj.getDay()];
    }

    for (const cls of classesData) {
        const cid = cls.class_id || cls._id;
        if (cid === excludeClassId) continue;
        if (cls.trainer_id !== trainer_id) continue;

        let extType = '';
        let extDate = '';
        let extDays = [];
        let extStartStr = '';
        let extEndStr = '';

        if (/^One-time/.test(cls.schedule)) {
            extType = 'one-time';
            const match = cls.schedule.match(/^One-time\s+(\d{4}-\d{2}-\d{2}),\s*(.+?)\s*-\s*(.+)$/);
            if (match) {
                extDate = match[1];
                extStartStr = match[2];
                extEndStr = match[3];
            }
        } else if (/^Weekly/.test(cls.schedule)) {
            extType = 'weekly';
            const match = cls.schedule.match(/^Weekly\s+([A-Za-z,\s]+),\s*(.+?)\s*-\s*(.+)$/i);
            if (match) {
                extDays = match[1].split(',').map(d => d.trim());
                extStartStr = match[2];
                extEndStr = match[3];
            }
        }

        if (!extStartStr || !extEndStr) continue;

        const extStart = parseTimeString(extStartStr);
        const extEnd = parseTimeString(extEndStr);

        // Check time overlap
        if (Math.max(newStart, extStart) < Math.min(newEnd, extEnd)) {
            let dayOverlap = false;

            if (newType === 'one-time' && extType === 'one-time') {
                if (newDate === extDate) dayOverlap = true;
            } else if (newType === 'one-time' && extType === 'weekly') {
                if (extDays.includes(newDayOfWeek)) dayOverlap = true;
            } else if (newType === 'weekly' && extType === 'one-time') {
                const [y, m, d] = extDate.split('-');
                const extDateObj = new Date(y, m - 1, d);
                const extDayOfWeek = daysOfWeek[extDateObj.getDay()];
                if (newDays.includes(extDayOfWeek)) dayOverlap = true;
            } else if (newType === 'weekly' && extType === 'weekly') {
                if (newDays.some(d => extDays.includes(d))) dayOverlap = true;
            }

            if (dayOverlap) {
                return cls; // Conflict found
            }
        }
    }
    return null; // No conflict
}

async function handleUpdateSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const editStatus = form.querySelector('.edit-status');
    
    const classId = currentEditContext.classId;
    const trainer_id = form.trainer_id.value;
    const scheduleType = form.scheduleType.value;
    
    let schedule = '';
    let days = [];
    let startTime = '';
    let endTime = '';
    let date = '';

    if (!scheduleType) {
        showMessage('Please select a schedule type', 'error');
        return;
    }

    if (scheduleType === 'one-time') {
        date = form.one_date.value;
        startTime = form.one_start.value;
        endTime = form.one_end.value;
        if (!date || !startTime || !endTime) {
             showMessage('Please fill all one-time schedule fields', 'error');
             return;
        }
        schedule = `One-time ${date}, ${timeFormat(startTime)} - ${timeFormat(endTime)}`;
    } else if (scheduleType === 'weekly') {
        days = Array.from(form.querySelectorAll('input[name="weekly_days"]:checked')).map(d => d.value);
        startTime = form.weekly_start.value;
        endTime = form.weekly_end.value;
        if (days.length === 0 || !startTime || !endTime) {
             showMessage('Please fill all weekly schedule fields', 'error');
             return;
        }
        schedule = `Weekly ${days.join(', ')}, ${timeFormat(startTime)} - ${timeFormat(endTime)}`;
    }

    // If nothing changed, skip check and go straight to update
    if (schedule === currentEditContext.originalSchedule && trainer_id === currentEditContext.originalTrainerId) {
        await proceedWithUpdate(classId, trainer_id, schedule);
        return;
    }
    
    // Perform frontend conflict check
    const conflictingClass = checkScheduleConflict(
        trainer_id, 
        scheduleType, 
        date, 
        days, 
        timeFormat(startTime), 
        timeFormat(endTime), 
        classId
    );

    if (conflictingClass) {
        showConflictModal(conflictingClass);
    } else {
        await proceedWithUpdate(classId, trainer_id, schedule);
    }
}

async function proceedWithUpdate(classId, trainer_id, schedule) {
    const form = currentEditContext.form;
    const editStatus = form.querySelector('.edit-status');
    if (editStatus) editStatus.textContent = 'Updating...';

    try {
        const result = await apiFetch(`/api/classes/${classId}`, {
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
            
            document.getElementById('updateSuccessPane').style.display = 'flex';
            
            await loadClasses(); // Refresh class list
            const editFormDiv = form.closest('.edit-form');
            if(editFormDiv) editFormDiv.style.display = 'none';
        } else {
            if (editStatus) editStatus.textContent = ''; // Clear text
            showMessage(result.error || 'Update failed', 'error');
        }
    } catch (error) {
        console.error('Error updating class:', error);
        if (editStatus) editStatus.textContent = ''; // Clear text
        showMessage(`Unable to update schedule. Please try again.`, 'error');
    }
}

function showConflictModal(conflictingClass) {
    const conflictModal = document.getElementById('conflictModal');
    const conflictDetails = document.getElementById('conflictDetails');
    const deleteClassBtn = document.getElementById('deleteClassBtn');

    if (conflictDetails) {
        conflictDetails.innerHTML = `
            <div class="view-row"><strong>Class Name:</strong> <span style="color: #fff;">${conflictingClass.class_name}</span></div>
            <div class="view-row"><strong>Schedule:</strong> <span style="color: #fff;">${conflictingClass.schedule}</span></div>
            <div class="view-row"><strong>Enrolled Students:</strong> <span style="color: #fff;">${conflictingClass.current_enrollment || 0} / ${conflictingClass.capacity || 'Unlimited'}</span></div>
        `;
    }
    
    if(deleteClassBtn) {
        // Needs the Mongo _id to correctly delete
        deleteClassBtn.setAttribute('data-cid', conflictingClass._id);
    }
    
    if (conflictModal) {
        conflictModal.style.display = 'flex';
    }
}

async function handleDeleteClass() {
    const deleteClassBtn = document.getElementById('deleteClassBtn');
    if (!deleteClassBtn) return;
    
    const classId = deleteClassBtn.getAttribute('data-cid');
    if (!classId) return;

    try {
        const result = await apiFetch(`/api/classes/${classId}`, {
            method: 'DELETE'
        });
        
        if (result.success) {
            showMessage('Conflicting class deleted successfully. Now updating new schedule...', 'success');
            document.getElementById('deleteConfirmModal').style.display = 'none';
            await loadClasses(); 
            
            // Automatically re-attempt the original update
            if(currentEditContext.form) {
                const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
                currentEditContext.form.dispatchEvent(submitEvent);
            }

        } else {
            showMessage(result.error || 'Failed to delete class', 'error');
        }
    } catch (error) {
        console.error('Error deleting class:', error);
        showMessage(`Deletion failed. Please try again.`, 'error');
    }
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