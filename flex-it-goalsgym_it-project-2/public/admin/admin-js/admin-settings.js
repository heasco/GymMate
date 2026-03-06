const SERVER_URL = 'http://localhost:8080';
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const ADMIN_KEYS = {
  token: 'admin_token',
  authUser: 'admin_authUser',
  role: 'admin_role',
  logoutEvent: 'adminLogoutEvent',
};

const AdminStore = {
  set(token, userPayload) {
    try {
      const authUser = { ...userPayload, timestamp: Date.now(), role: 'admin', token };
      localStorage.setItem(ADMIN_KEYS.token, token);
      localStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser));
      localStorage.setItem(ADMIN_KEYS.role, 'admin');
      sessionStorage.setItem(ADMIN_KEYS.token, token);
      sessionStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser));
      sessionStorage.setItem(ADMIN_KEYS.role, 'admin');
    } catch (e) { console.error(e); }
  },
  getToken() { return sessionStorage.getItem(ADMIN_KEYS.token) || localStorage.getItem(ADMIN_KEYS.token) || null; },
  getAuthUser() {
    const raw = sessionStorage.getItem(ADMIN_KEYS.authUser) || localStorage.getItem(ADMIN_KEYS.authUser);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  },
  hasSession() {
    return (localStorage.getItem(ADMIN_KEYS.token) || sessionStorage.getItem(ADMIN_KEYS.token));
  },
  clear() {
    localStorage.removeItem(ADMIN_KEYS.token); localStorage.removeItem(ADMIN_KEYS.authUser); localStorage.removeItem(ADMIN_KEYS.role);
    sessionStorage.removeItem(ADMIN_KEYS.token); sessionStorage.removeItem(ADMIN_KEYS.authUser); sessionStorage.removeItem(ADMIN_KEYS.role);
  },
};

function bootstrapAdminFromGenericIfNeeded() {
  try {
    if (AdminStore.hasSession()) return;
    const genToken = localStorage.getItem('token');
    const genRole = localStorage.getItem('role');
    const genAuthRaw = localStorage.getItem('authUser');
    if (!genToken || !genRole || genRole.toLowerCase() !== 'admin' || !genAuthRaw) return;
    AdminStore.set(genToken, JSON.parse(genAuthRaw));
  } catch (e) {}
}

function clearLocalAuth() {
  AdminStore.clear();
  try {
    const genericRole = localStorage.getItem('role') || sessionStorage.getItem('role');
    if (genericRole && genericRole.toLowerCase() === 'admin') {
      localStorage.removeItem('token'); localStorage.removeItem('authUser'); localStorage.removeItem('role');
      sessionStorage.removeItem('token'); sessionStorage.removeItem('authUser'); sessionStorage.removeItem('role');
    }
  } catch (e) {}
}

function getApiBase() { return SERVER_URL; }

function adminLogout(reason, loginPath = '../login.html') {
  clearLocalAuth();
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = loginPath;
}

function ensureAdminAuthOrLogout(loginPath) {
  try {
    if (!AdminStore.hasSession()) bootstrapAdminFromGenericIfNeeded();
    if (!AdminStore.hasSession()) { adminLogout('missing session', loginPath); return false; }
    
    const authUser = AdminStore.getAuthUser();
    if (!authUser || authUser.role !== 'admin') { adminLogout('invalid authUser', loginPath); return false; }
    
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) { adminLogout('session expired', loginPath); return false; }
    
    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);
    return true;
  } catch (e) {
    adminLogout('exception', loginPath);
    return false;
  }
}

async function apiFetch(endpoint, options = {}) {
  if (!ensureAdminAuthOrLogout('../login.html')) return null;
  const token = AdminStore.getToken();
  const url = `${getApiBase()}${endpoint}`;
  
  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    adminLogout('401 from server');
    return null;
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API error: ${response.status}`);
  }
  return response.json();
}

// ------------------------------
// Page init
// ------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    if (!ensureAdminAuthOrLogout('../login.html')) return;

    setupSidebarAndSession();
    initThemeSettings();
    await loadProfileSettings();
    setupForms();
});

// Sidebar Setup
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
    logoutBtn.addEventListener('click', async () => await adminLogout('manual admin logout button'));
  }
}

// ------------------------------
// Features Logic
// ------------------------------
function initThemeSettings() {
    const themeToggleSwitch = document.getElementById('themeToggleSwitch');
    const savedTheme = localStorage.getItem('goals_admin_theme') || 'dark';

    // Set initial state
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        themeToggleSwitch.checked = true;
    }

    // Handle toggle
    themeToggleSwitch.addEventListener('change', function() {
        if (this.checked) {
            document.body.classList.add('light-theme');
            localStorage.setItem('goals_admin_theme', 'light');
        } else {
            document.body.classList.remove('light-theme');
            localStorage.setItem('goals_admin_theme', 'dark');
        }
    });
}

async function loadProfileSettings() {
    try {
        const res = await apiFetch('/api/admins/me');
        if (res && res.success) {
            document.getElementById('adminName').value = res.data.name || '';
            document.getElementById('adminEmail').value = res.data.email || '';
        }
    } catch (err) {
        showFeedback('Error loading profile data.', 'error');
    }
}

function setupForms() {
    // Save Profile Form
    document.getElementById('profileForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('saveProfileBtn');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        const name = document.getElementById('adminName').value;
        const email = document.getElementById('adminEmail').value;

        try {
            const res = await apiFetch('/api/admins/me', {
                method: 'PUT',
                body: JSON.stringify({ name, email })
            });

            if (res && res.success) {
                showFeedback('Profile updated successfully.', 'success');
                // Update Sidebar Name
                document.getElementById('adminFullName').textContent = name;
                
                // Update LocalStorage Session Name
                const user = AdminStore.getAuthUser();
                user.name = name;
                AdminStore.set(AdminStore.getToken(), user);
            }
        } catch (err) {
            showFeedback(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save Profile';
        }
    });

    // Add New Admin Form
    document.getElementById('addAdminForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('addAdminBtn');
        btn.disabled = true;
        btn.textContent = 'Creating...';

        const payload = {
            name: document.getElementById('newAdminName').value,
            username: document.getElementById('newAdminUsername').value,
            email: document.getElementById('newAdminEmail').value,
            password: document.getElementById('newAdminPassword').value,
            role: document.getElementById('newAdminRole').value
        };

        try {
            const res = await apiFetch('/api/admins', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (res && res.success) {
                showFeedback('New Admin created successfully!', 'success');
                document.getElementById('addAdminForm').reset();
            }
        } catch (err) {
            showFeedback(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Create Admin Account';
        }
    });
}

function showFeedback(message, type) {
    const fb = document.getElementById('settingsFeedback');
    fb.textContent = message;
    fb.className = `feedback-msg ${type}`;
    fb.style.display = 'block';
    setTimeout(() => fb.style.display = 'none', 5000);
}