// --------------------------------------
// Server & session configuration
// --------------------------------------
const SERVER_URL = 'http://localhost:8080';
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Admin-scoped storage keys to avoid cross-role interference
const ADMIN_KEYS = {
  token: 'admin_token',
  authUser: 'admin_authUser',
  role: 'admin_role',
  logoutEvent: 'adminLogoutEvent',
};

// Idle tracking (admin only) – kept for possible future use, but no 15-min prompt
let adminLastActivity = Date.now();

// --------------------------------------
// Admin storage helpers (namespaced)
// --------------------------------------
const AdminStore = {
  set(token, userPayload) {
    try {
      const authUser = {
        ...userPayload,
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

// --------------------------------------
// Shared auth helpers
// --------------------------------------
function clearAdminAuth() {
  // Clear admin-scoped keys
  AdminStore.clear();

  // Also clear legacy generic keys if they currently represent an admin session.
  // This avoids login.js auto-redirecting back into admin after logout.
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
    console.error('[clearAdminAuth] failed to clear generic admin keys:', e);
  }
}


function getApiBase() {
  return window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
    ? SERVER_URL
    : '';
}

function getToken() {
  return AdminStore.getToken();
}

async function logout(reason) {
  console.log('[Admin Logout]:', reason || 'no reason');

  // Do NOT touch member/trainer keys; only admin_* keys are cleared
  clearAdminAuth();

  // Notify admin tabs in this browser only
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());

  window.location.href = '../login.html';
}

// Centralized auth check
function ensureAdminAuthOrLogout() {
  try {
    // Make sure we have admin_* populated (from generic admin login if needed)
    if (!AdminStore.hasSession()) {
      bootstrapAdminFromGenericIfNeeded();
    }

    if (!AdminStore.hasSession()) {
      logout('missing admin session');
      return false;
    }

    const authUser = AdminStore.getAuthUser();
    if (!authUser || authUser.role !== 'admin') {
      logout('invalid or non-admin authUser');
      return false;
    }

    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      logout('admin session max age exceeded');
      return false;
    }

    // Refresh timestamp on successful check
    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);
    return true;
  } catch (e) {
    console.error('[ensureAdminAuthOrLogout] failed:', e);
    logout('exception in ensureAdminAuthOrLogout');
    return false;
  }
}

/**
 * Require a valid auth session for this page.
 * - expectedRole: 'admin' | 'member' | 'trainer'
 * - loginPath: relative path to the corresponding login page
 *
 * For this admin module we just delegate to ensureAdminAuthOrLogout,
 * keeping the original signature so the call site stays unchanged.
 */
function requireAuth(expectedRole, loginPath) {
  try {
    return ensureAdminAuthOrLogout();
  } catch (e) {
    console.error('Auth check failed in requireAuth:', e);
    logout('exception in requireAuth');
    return false;
  }
}

// Cross‑tab admin logout sync
window.addEventListener('storage', (event) => {
  if (event.key === ADMIN_KEYS.logoutEvent) {
    logout('adminLogoutEvent from another tab');
  }
});

// --------------------------------------
// Idle helpers (admin)
// No 15‑minute warning anymore; only 2‑hour hard cap.
// --------------------------------------
function markAdminActivity() {
  adminLastActivity = Date.now();
}

function setupAdminIdleWatcher() {
  // Keep these events for potential extensions; they no longer drive a 15-min prompt
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, markAdminActivity, { passive: true });
  });

  // Check every 30 seconds for 2‑hour cap only
  setInterval(() => {
    const authUser = AdminStore.getAuthUser();
    const token = AdminStore.getToken();
    if (!token || !authUser) return;

    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      console.log('Admin session exceeded 2 hours, logging out (idle watcher).');
      logout('admin session max age exceeded in idle watcher');
      return;
    }
  }, 30000);
}

// --------------------------------------
// Utility for authenticated API calls (with timeout)
// --------------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  // Centralized auth guard
  const ok = ensureAdminAuthOrLogout();
  if (!ok) return;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();
  if (!token || !authUser) {
    logout('missing token/authUser in admin apiFetch');
    return;
  }

  // Build URL: support full URLs or relative /api routes
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

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      console.log('401/403 from admin apiFetch - logging out');
      logout('401/403 from admin apiFetch');
      return;
    }

    if (!response.ok) throw new Error(`API error: ${response.status}`);
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
// Page init
// --------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  setupAdminIdleWatcher();
  markAdminActivity();

  // Bootstrap from generic admin keys if needed and then verify
  bootstrapAdminFromGenericIfNeeded();
  const ok = requireAuth('admin', '../login.html');
  if (!ok) return;

  setupSidebarAndSession();
  loadDashboardData();
  setupEventListeners();
});

// --------------------------------------
// Sidebar + session handling
// --------------------------------------
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  // Extra safety: timestamp check via AdminStore
  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;

    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      logout('admin session max age exceeded in setupSidebarAndSession');
      return;
    }
  } catch (e) {
    console.error('Auth parse failed in setupSidebarAndSession:', e);
    logout('invalid authUser JSON in setupSidebarAndSession');
    return;
  }

  // Display admin full name in sidebar
  const adminNameEl = document.getElementById('adminFullName');
  if (adminNameEl) {
    const authUser = AdminStore.getAuthUser();
    adminNameEl.textContent = authUser?.name ? authUser.name : 'Admin';
  }

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      if (typeof markAdminActivity === 'function') markAdminActivity();
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
        logout('manual admin logout button');
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


// --------------------------------------
// Event listeners
// --------------------------------------
function setupEventListeners() {
  const launchBtn = document.getElementById('launchAttendanceBtn');
  const refreshBtn = document.getElementById('refreshBtn');

  if (launchBtn) {
    launchBtn.addEventListener('click', () => {
      markAdminActivity();
      // Open attendance system in new window
      const width = 1400;
      const height = 900;
      const left = (screen.width - width) / 2;
      const top = (screen.height - height) / 2;

      window.open(
        '../attendance-admin/attendance-admin-mainpage.html',
        'AttendanceSystem',
        `width=${width},height=${height},top=${top},left=${left},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes`
      );
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      markAdminActivity();
      loadDashboardData();
    });
  }

  // Auto-refresh every 30 seconds
  setInterval(() => {
    loadDashboardData();
  }, 30000);
}

// --------------------------------------
// Dashboard data
// --------------------------------------
async function loadDashboardData() {
  try {
    const result = await apiFetch('/api/attendance/today');

    if (result && result.success !== false) {
      updateDashboard(result.data);
    } else {
      console.error('API returned failure');
    }
  } catch (error) {
    console.error('Error loading dashboard data:', error);
  }
}

function updateDashboard(data) {
  const todayCheckinsEl = document.getElementById('todayCheckins');
  const currentlyInGymEl = document.getElementById('currentlyInGym');
  const lastCheckinEl = document.getElementById('lastCheckin');

  if (todayCheckinsEl) todayCheckinsEl.textContent = data.totalCheckins || 0;
  if (currentlyInGymEl) currentlyInGymEl.textContent = data.currentlyInGym || 0;

  if (data.lastCheckin) {
    const time = new Date(data.lastCheckin.timestamp);
    if (lastCheckinEl) {
      lastCheckinEl.textContent = time.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  } else if (lastCheckinEl) {
    lastCheckinEl.textContent = 'No activity yet';
  }

  displayRecentActivity(data.recentActivity || []);
}

function displayRecentActivity(activities) {
  const activityList = document.getElementById('activityList');
  if (!activityList) return;

  if (activities.length === 0) {
    activityList.innerHTML =
      '<div class="no-activity">No recent activity today</div>';
    return;
  }

  activityList.innerHTML = activities
    .slice(0, 10)
    .map((activity) => {
      const time = new Date(activity.timestamp);
      const timeStr = time.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

      const typeClass =
        activity.type === 'check-in' ? 'check-in' : 'check-out';
      const icon =
        activity.type === 'check-in' ? 'fa-sign-in-alt' : 'fa-sign-out-alt';

      return `
        <div class="activity-item ${typeClass}">
          <div class="activity-icon">
            <i class="fas ${icon}"></i>
          </div>
          <div class="activity-details">
            <div class="activity-name">${activity.memberName}</div>
            <div class="activity-time">${timeStr}</div>
          </div>
          <div class="activity-badge ${typeClass}">
            ${activity.type === 'check-in' ? 'IN' : 'OUT'}
          </div>
        </div>
      `;
    })
    .join('');
}
