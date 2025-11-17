// public/admin/admin-js/admin-mainpage.js

// --------------------------------------
// Server & session configuration
// --------------------------------------
const SERVER_URL = 'http://localhost:8080'; // unchanged route base
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours (hard cap only)

// Admin-scoped storage keys to avoid cross-role interference
const ADMIN_KEYS = {
  token: 'admin_token',
  authUser: 'admin_authUser',
  role: 'admin_role',
  loginEvent: 'adminLoginEvent',
  logoutEvent: 'adminLogoutEvent',
};

// --------------------------------------
// Admin storage helpers (namespaced)
// --------------------------------------
const AdminStore = {
  // Prefer localStorage for cross-tab persistence; mirror to sessionStorage for convenience
  set(token, userPayload) {
    try {
      const authUser = {
        ...userPayload,
        // maintain/refresh timestamp for page activity checks
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
// Copies a valid admin session from generic keys into admin_*,
// so admin stays logged in across tabs without affecting other roles.
// --------------------------------------
function bootstrapAdminFromGenericIfNeeded() {
  try {
    if (AdminStore.hasSession()) return;

    const genToken = localStorage.getItem('token');
    const genRole = localStorage.getItem('role');
    const genAuthRaw = localStorage.getItem('authUser');

    if (!genToken || !genRole || genRole !== 'admin' || !genAuthRaw) return;

    const genAuth = JSON.parse(genAuthRaw);
    // If generic keys indeed hold an admin session, copy them to admin_*.
    AdminStore.set(genToken, genAuth);
  } catch (e) {
    console.error('[bootstrapAdminFromGenericIfNeeded] failed:', e);
  }
}

// --------------------------------------
// URL helper
// --------------------------------------
function getApiBase() {
  return window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
    ? SERVER_URL
    : '';
}

// --------------------------------------
// Centralized logout (admin-scoped)
// --------------------------------------
async function adminLogout(reason) {
  try {
    console.log('[Admin Logout]:', reason || 'no reason');
    const token = AdminStore.getToken();
    // Best effort server logout; keep route unchanged
    if (token) {
      const logoutUrl = `${getApiBase()}/api/logout`;
      await fetch(logoutUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {
        // ignore network error on logout
      });
    }
  } catch (e) {
    console.error('[adminLogout] server call failed:', e);
  } finally {
    // Clear admin-scoped keys
    AdminStore.clear();

    // Also clear old generic keys if they currently represent an admin session.
    // This prevents login.js from auto-redirecting you back into admin after logout.
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
      console.error('[adminLogout] failed to clear generic admin keys:', e);
    }

    // Notify only admin tabs in this browser
    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    // Redirect to the same login page as before
    window.location.href = '../admin-login.html';
  }
}


// --------------------------------------
// Auth check used on load and inside apiFetch
// --------------------------------------
function ensureAdminAuthOrLogout() {
  try {
    // If admin_* keys are missing, try bootstrapping once from generic admin login
    if (!AdminStore.hasSession()) {
      bootstrapAdminFromGenericIfNeeded();
    }

    if (!AdminStore.hasSession()) {
      adminLogout('missing admin session');
      return false;
    }

    const authUser = AdminStore.getAuthUser();
    if (!authUser || authUser.role !== 'admin') {
      adminLogout('invalid or non-admin authUser');
      return false;
    }

    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded');
      return false;
    }

    // Refresh timestamp on activity/auth check
    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);
    return true;
  } catch (e) {
    console.error('[ensureAdminAuthOrLogout] failed:', e);
    adminLogout('exception in ensureAdminAuthOrLogout');
    return false;
  }
}

// --------------------------------------
// Cross‑tab admin‑only logout sync
// --------------------------------------
window.addEventListener('storage', (event) => {
  if (event.key === ADMIN_KEYS.logoutEvent) {
    // Another admin tab logged out
    adminLogout('adminLogoutEvent from another tab');
  }
});

// --------------------------------------
// Idle watcher (admin)
// Removed the 15‑minute “stay logged in?” prompt for admin.
// Only enforce the hard 2‑hour cap for security.
// --------------------------------------
function setupAdminIdleWatcher() {
  // Periodic check for the hard cap only
  setInterval(() => {
    const authUser = AdminStore.getAuthUser();
    if (!authUser) return;

    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      console.log('Admin session exceeded 2 hours, logging out (idle watcher).');
      adminLogout('admin session max age exceeded in idle watcher');
    }
  }, 30000); // 30s cadence
}

// --------------------------------------
// Utility for authenticated API calls
// --------------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  // Centralized auth check for this call
  const ok = ensureAdminAuthOrLogout();
  if (!ok) return;

  // Support full URLs or relative /api routes, keep routes unchanged
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    if (!endpoint.startsWith('/api/')) {
      endpoint = '/api' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    }
    url =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
        ? `${SERVER_URL}${endpoint}`
        : endpoint;
  }

  const token = AdminStore.getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      console.log('401/403 from admin apiFetch - logging out');
      adminLogout('401/403 from admin apiFetch');
      return;
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`API timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// --------------------------------------
// Auth check on page load
// --------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  setupAdminIdleWatcher();

  // One-time bootstrap from generic admin keys if needed, then verify
  bootstrapAdminFromGenericIfNeeded();

  const ok = ensureAdminAuthOrLogout();
  if (!ok) return;

  // Load page data
  loadDashboardStats();
  loadTodayClassSchedules();
  setupSidebarAndSession();
});

// --------------------------------------
// Dashboard stats (existing logic preserved)
// --------------------------------------
async function loadDashboardStats() {
  try {
    // --- Member count ---
    const memResp = await apiFetch('/api/members');
    const memJson = memResp || {};
    if (Array.isArray(memJson.data)) {
      document.getElementById('statTotalMembers').textContent =
        memJson.data.length;
    } else if (typeof memJson.count === 'number') {
      document.getElementById('statTotalMembers').textContent = memJson.count;
    } else {
      document.getElementById('statTotalMembers').textContent = 0;
    }

    // Trainer count
    const trainerResp = await apiFetch('/api/trainers');
    const trainerJson = trainerResp || {};
    document.getElementById('statTotalTrainers').textContent =
      trainerJson.count || (trainerJson.data && trainerJson.data.length) || 0;

    // Classes and attendance today
    const classResp = await apiFetch('/api/classes');
    const classJson = classResp || {};
    let classesToday = 0,
      totalAttendance = 0;

    const today = new Date();
    for (const cls of classJson.data || []) {
      const enrollResp = await apiFetch(`/api/classes/${cls.class_id}/enrollments`);
      const enrollJson = enrollResp || {};
      const todayAttendance =
        (enrollJson.data &&
          enrollJson.data.filter((e) => {
            if (!e.session_date) return false;
            const eDate = new Date(e.session_date);
            return (
              eDate.getFullYear() === today.getFullYear() &&
              eDate.getMonth() === today.getMonth() &&
              eDate.getDate() === today.getDate()
            );
          }).length) || 0;

      if (todayAttendance > 0) classesToday++;
      totalAttendance += todayAttendance;
    }

    document.getElementById('statClassesToday').textContent = classesToday;
    document.getElementById('statAttendanceToday').textContent =
      totalAttendance;

    // In Gym Right Now
    const logsResp = await apiFetch('/api/attendance/logs/today');
    const logsJson = logsResp || {};
    if (logsJson.success && Array.isArray(logsJson.logs)) {
      const latestEvent = {};
      for (const log of logsJson.logs) {
        const mId = log.memberId && (log.memberId._id || log.memberId);
        if (!mId) continue;
        if (
          !latestEvent[mId] ||
          new Date(log.timestamp).getTime() >
            new Date(latestEvent[mId].timestamp).getTime()
        ) {
          latestEvent[mId] = log;
        }
      }
      const inGymCount = Object.values(latestEvent).filter(
        (ev) => ev.logType === 'login'
      ).length;
      document.getElementById('statInGymNow').textContent = inGymCount;
    } else {
      document.getElementById('statInGymNow').textContent = '?';
    }

    // Auto-refresh every 5 seconds
    setTimeout(loadDashboardStats, 5000);
  } catch (err) {
    console.error('Dashboard stats error:', err);
    document.getElementById('statTotalMembers').textContent =
      document.getElementById('statTotalTrainers').textContent =
      document.getElementById('statClassesToday').textContent =
      document.getElementById('statAttendanceToday').textContent =
      document.getElementById('statInGymNow').textContent =
        '?';
  }
}

// --------------------------------------
// Today class schedules (existing logic preserved)
// --------------------------------------
async function loadTodayClassSchedules() {
  const status = document.getElementById('dashboardStatus');
  const tableBody = document.getElementById('scheduleTableBody');
  if (tableBody) tableBody.innerHTML = '';

  try {
    const today = new Date();
    const yyyyMMdd = today.toISOString().split('T')[0];

    const classesResp = await apiFetch('/api/classes');
    const classJson = classesResp || {};
    if (!classJson.success) throw new Error('Failed to fetch classes');
    const allClasses = classJson.data || [];

    const trainersResp = await apiFetch('/api/trainers');
    const trainerJson = trainersResp || {};
    const trainersMap = (trainerJson.data || []).reduce((map, t) => {
      map[t.trainer_id] = t.name;
      return map;
    }, {});

    let shown = 0;
    for (const cls of allClasses) {
      const enrollResp = await apiFetch(
        `/api/classes/${cls.class_id}/enrollments`
      );
      const enrollJson = enrollResp || {};
      let todayAttendance = 0;
      const todayDate = new Date(yyyyMMdd);

      if (enrollJson.data && enrollJson.data.length > 0) {
        todayAttendance = enrollJson.data.filter((e) => {
          if (!e.session_date) return false;
          const eDate = new Date(e.session_date);
          return (
            eDate.getFullYear() === todayDate.getFullYear() &&
            eDate.getMonth() === todayDate.getMonth() &&
            eDate.getDate() === todayDate.getDate()
          );
        }).length;
      }

      if (todayAttendance === 0 && enrollJson.data) {
        todayAttendance = enrollJson.data.filter((e) => e.status === 'active')
          .length;
      }

      if (tableBody) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${cls.class_name || ''}</td>
          <td>${trainersMap[cls.trainer_id] || 'Unknown'}</td>
          <td>${cls.schedule || ''}</td>
          <td style="text-align:center"><b>${todayAttendance}</b></td>
        `;
        tableBody.appendChild(tr);
        shown++;
      }
    }

    if (status) {
      status.textContent = shown ? '' : 'No classes scheduled for today.';
    }
  } catch (err) {
    console.error('Schedule load error:', err);
    if (status) {
      status.textContent = `Failed to load schedule/attendance. ${err.message || err}`;
    }
  }
}

// --------------------------------------
// Sidebar + session handling (existing logic preserved)
// --------------------------------------
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  // Extra safety re-check timestamp
  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in setupSidebarAndSession');
      return;
    }
  } catch (e) {
    console.error('Auth parse failed in setupSidebarAndSession:', e);
    adminLogout('invalid authUser JSON in setupSidebarAndSession');
    return;
  }

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      // No special idle logic; admin prompt removed by request
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await adminLogout('manual admin logout button');
    });
  }

  document.addEventListener('click', (e) => {
    if (
      window.innerWidth <= 768 &&
      sidebar &&
      !sidebar.contains(e.target) &&
      menuToggle &&
      !menuToggle.contains(e.target)
    ) {
      sidebar.classList.remove('collapsed');
    }
  });

  if (sidebar) {
    sidebar.addEventListener('transitionend', () => {
      if (window.innerWidth <= 768) {
        if (sidebar.classList.contains('collapsed')) {
          document.body.style.overflow = 'hidden';
        } else {
          document.body.style.overflow = 'auto';
        }
      }
    });
  }
}
