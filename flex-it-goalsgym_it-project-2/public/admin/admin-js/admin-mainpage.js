// public/admin/admin-js/admin-mainpage.js

// --- Theme Init & Real-Time Sync ---
function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }
}

// 1. Apply immediately when the dashboard loads
applyTheme(localStorage.getItem('admin_theme'));

// 2. Listen for changes (If you change it in Settings on another tab, the Dashboard updates instantly)
window.addEventListener('storage', (e) => {
    if (e.key === 'admin_theme') applyTheme(e.newValue);
});

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
    if (token) {
      const logoutUrl = `${getApiBase()}/api/logout`;
      await fetch(logoutUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[adminLogout] server call failed:', e);
  } finally {
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
      console.error('[adminLogout] failed to clear generic admin keys:', e);
    }

    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    window.location.href = '../login.html';
  }
}

// --------------------------------------
// Auth check used on load and inside apiFetch
// --------------------------------------
function ensureAdminAuthOrLogout() {
  try {
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

    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);
    return true;
  } catch (e) {
    console.error('[ensureAdminAuthOrLogout] failed:', e);
    adminLogout('exception in ensureAdminAuthOrLogout');
    return false;
  }
}

window.addEventListener('storage', (event) => {
  if (event.key === ADMIN_KEYS.logoutEvent) {
    adminLogout('adminLogoutEvent from another tab');
  }
});

function setupAdminIdleWatcher() {
  setInterval(() => {
    const authUser = AdminStore.getAuthUser();
    if (!authUser) return;

    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      console.log('Admin session exceeded 2 hours, logging out (idle watcher).');
      adminLogout('admin session max age exceeded in idle watcher');
    }
  }, 30000);
}

// --------------------------------------
// Utility for authenticated API calls
// --------------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  const ok = ensureAdminAuthOrLogout();
  if (!ok) return;

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
  bootstrapAdminFromGenericIfNeeded();

  const ok = ensureAdminAuthOrLogout();
  if (!ok) return;

  if (document.getElementById('statTotalMembers')) {
    loadDashboardStats();
  }
  setupSidebarAndSession();
});

// --------------------------------------
// Dashboard Stats & Recent Activity
// --------------------------------------
async function loadDashboardStats() {
  try {
    // 1. Total Members
    const memResp = await apiFetch('/api/members');
    const memJson = memResp || {};
    const totalMembers = Array.isArray(memJson.data) ? memJson.data.length : (memJson.count || 0);
    document.getElementById('statTotalMembers').textContent = totalMembers;

    // 2. Active Members
    const activeMemResp = await apiFetch('/api/members?status=active');
    const activeMemJson = activeMemResp || {};
    const activeMembers = Array.isArray(activeMemJson.data) ? activeMemJson.data.length : (activeMemJson.count || 0);
    document.getElementById('statActiveMembers').textContent = activeMembers;

    // 3. Expired Memberships
    const expiredResp = await apiFetch('/api/logs/expired');
    const expiredJson = expiredResp || {};
    const expiredCount = Array.isArray(expiredJson.data) ? expiredJson.data.length : 0;
    document.getElementById('statExpiredMemberships').textContent = expiredCount;

    // 4. Attendance Today & Recent Activity
    const attResp = await apiFetch('/api/attendance/today');
    const attJson = attResp || {};
    
    if (attJson.success && attJson.data) {
      // Top stats
      document.getElementById('statCheckinsToday').textContent = attJson.data.totalCheckins || 0;
      document.getElementById('statInGymNow').textContent = attJson.data.currentlyInGym || 0;

      // Populate Recent Activity Table
      const tableBody = document.getElementById('recentActivityTableBody');
      const statusText = document.getElementById('dashboardStatus');
      
      if (tableBody) {
        tableBody.innerHTML = '';
        const activities = attJson.data.recentActivity || [];
        
        activities.forEach(act => {
          const tr = document.createElement('tr');
          const timeStr = new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          
          // Re-using CSS classes from the server status for visual flair
          const badgeClass = act.type === 'check-in' ? 'server-connected' : 'server-disconnected';
          const typeFormatted = act.type.replace('-', ' ').toUpperCase();
          const areaFormatted = act.attendedType ? act.attendedType.charAt(0).toUpperCase() + act.attendedType.slice(1) : 'Gym';
          
          tr.innerHTML = `
            <td><strong>${act.memberName}</strong></td>
            <td><span class="${badgeClass}" style="padding: 0.3rem 0.6rem; border-radius: 4px; font-size: 0.8rem;">${typeFormatted}</span></td>
            <td>${areaFormatted}</td>
            <td>${timeStr}</td>
          `;
          tableBody.appendChild(tr);
        });

        if (statusText) {
          statusText.textContent = activities.length ? '' : 'No recent activity recorded today.';
          statusText.style.display = activities.length ? 'none' : 'block';
        }
      }
    } else {
      document.getElementById('statCheckinsToday').textContent = '?';
      document.getElementById('statInGymNow').textContent = '?';
    }

    // Auto-refresh every 8 seconds
    setTimeout(loadDashboardStats, 8000);
  } catch (err) {
    console.error('Dashboard stats error:', err);
    document.getElementById('statTotalMembers').textContent = '?';
    document.getElementById('statActiveMembers').textContent = '?';
    document.getElementById('statExpiredMemberships').textContent = '?';
    document.getElementById('statCheckinsToday').textContent = '?';
    document.getElementById('statInGymNow').textContent = '?';
    
    const statusText = document.getElementById('dashboardStatus');
    if (statusText) statusText.textContent = 'Failed to load activity logs.';
    
    // Retry automatically
    setTimeout(loadDashboardStats, 10000);
  }
}

// --------------------------------------
// Sidebar + session handling
// --------------------------------------
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

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

  const adminNameEl = document.getElementById('adminFullName');
  if (adminNameEl) {
    const authUser = AdminStore.getAuthUser();
    if (authUser?.name) {
      adminNameEl.textContent = authUser.name;
    } else {
      adminNameEl.textContent = 'Admin';
    }
  }

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
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