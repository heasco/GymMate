// public/admin/admin-js/admin-mainpage.js

const SERVER_URL = 'http://localhost:8080';

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

    if (!genToken || !genRole || genRole.toLowerCase() !== 'admin' || !genAuthRaw) return;

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

    if (genericRole && genericRole.toLowerCase() === 'admin') {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');

      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
    }
  } catch (e) {
    console.error('[clearLocalAuth] failed:', e);
  }
}

function getApiBase() {
  return SERVER_URL; 
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
  if (!ok) return null;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();

  if (!token || !authUser) {
    adminLogout('missing token/authUser in admin apiFetch', '../login.html');
    return null;
  }

  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in apiFetch', '../login.html');
      return null;
    }
    authUser.timestamp = Date.now();
    AdminStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to refresh authUser in apiFetch:', e);
    adminLogout('invalid authUser JSON in apiFetch', '../login.html');
    return null;
  }

  const url = `${getApiBase()}${endpoint}`;

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
    return null;
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}


// ------------------------------
// Page init
// ------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const ok = requireAuth('admin', '../login.html');
  if (!ok) return;

  // --- THEME TOGGLE LOGIC ---
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const savedTheme = localStorage.getItem('goals_admin_theme') || 'dark';

  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    if (themeToggleBtn) themeToggleBtn.textContent = '🌙 Dark Mode';
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('light-theme');
      if (document.body.classList.contains('light-theme')) {
        localStorage.setItem('goals_admin_theme', 'light');
        themeToggleBtn.textContent = '🌙 Dark Mode';
      } else {
        localStorage.setItem('goals_admin_theme', 'dark');
        themeToggleBtn.textContent = '☀️ Light Mode';
      }
    });
  }
  // ---------------------------

  setupSidebarAndSession();
  await loadDashboardStats();
  await loadClassSchedules();
});

// ------------------------------
// Sidebar / Logout Setup
// ------------------------------
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  const adminNameEl = document.getElementById('adminFullName');
  if (adminNameEl) {
    const authUser = AdminStore.getAuthUser();
    adminNameEl.textContent = authUser?.name || 'Admin';
  }

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const token = getToken();
      try {
        if (token) {
          await fetch(`${getApiBase()}/api/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
        }
      } catch (e) {
        console.error('Logout error:', e);
      } finally {
        adminLogout('manual admin logout button', '../login.html');
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar && menuToggle && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
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
// Dashboard Stats
// ------------------------------
async function loadDashboardStats() {
  try {
    const memRes = await apiFetch('/api/members');
    if (memRes && memRes.success) {
      document.getElementById('statTotalMembers').textContent = memRes.count || 0;
    } else {
      document.getElementById('statTotalMembers').textContent = '0';
    }

    const trRes = await apiFetch('/api/trainers/search');
    if (trRes && trRes.success) {
      document.getElementById('statTotalTrainers').textContent = trRes.data ? trRes.data.length : 0;
    } else {
      document.getElementById('statTotalTrainers').textContent = '0';
    }

    const todayRes = await apiFetch('/api/attendance/today');
    if (todayRes && todayRes.success) {
      document.getElementById('statAttendanceToday').textContent = todayRes.data.totalCheckins || 0;
      document.getElementById('statInGymNow').textContent = todayRes.data.currentlyInGym || 0;
    } else {
      document.getElementById('statAttendanceToday').textContent = '0';
      document.getElementById('statInGymNow').textContent = '0';
    }
  } catch (err) {
    console.error('Error loading stats:', err);
    document.getElementById('statTotalMembers').textContent = 'Err';
    document.getElementById('statTotalTrainers').textContent = 'Err';
    document.getElementById('statAttendanceToday').textContent = 'Err';
    document.getElementById('statInGymNow').textContent = 'Err';
  }
}

// ------------------------------
// Class Schedules - FIXED DATA PARSING
// ------------------------------
async function loadClassSchedules() {
  const statusEl = document.getElementById('dashboardStatus');
  const tableBody = document.getElementById('scheduleTableBody');

  try {
    const res = await apiFetch('/api/classes');
    if (!res || !res.success) throw new Error(res?.error || 'Failed to fetch classes');

    const classes = res.data || [];
    if (classes.length === 0) {
      statusEl.textContent = 'No classes currently scheduled.';
      statusEl.className = 'server-status server-connected';
      tableBody.innerHTML = '';
      return;
    }

    // Filter out archived classes based on your status schema
    const activeClasses = classes.filter(cls => {
      return cls.status === 'active';
    });

    tableBody.innerHTML = '';

    activeClasses.forEach(cls => {
      const tr = document.createElement('tr');
      
      const nameTd = document.createElement('td');
      nameTd.textContent = cls.class_name || 'N/A';

      // Reads trainer_name directly from your schema
      const trainerTd = document.createElement('td');
      trainerTd.textContent = cls.trainer_name || cls.trainer_id || 'Unassigned';

      // Reads raw schedule string directly from your schema
      const scheduleTd = document.createElement('td');
      scheduleTd.textContent = cls.schedule || 'No schedule set';

      // Reads capacity and current_enrollment from your schema
      const attendanceTd = document.createElement('td');
      const cap = cls.capacity || 0;
      const enrolled = cls.current_enrollment || 0;
      attendanceTd.textContent = `${enrolled} / ${cap}`;

      tr.appendChild(nameTd);
      tr.appendChild(trainerTd);
      tr.appendChild(scheduleTd);
      tr.appendChild(attendanceTd);

      tableBody.appendChild(tr);
    });

    statusEl.style.display = 'none';

  } catch (err) {
    console.error('Error loading schedules:', err);
    statusEl.textContent = 'Error loading schedules.';
    statusEl.className = 'server-status server-disconnected';
  }
}