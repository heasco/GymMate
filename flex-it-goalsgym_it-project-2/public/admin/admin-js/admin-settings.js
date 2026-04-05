const SERVER_URL = 'http://localhost:8080';

// --- Theme Init & Instant Setup ---
function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }
}
// Run immediately on load
applyTheme(localStorage.getItem('admin_theme'));

// --- Admin Auth Boilerplate ---
const ADMIN_KEYS = { token: 'admin_token', authUser: 'admin_authUser', role: 'admin_role', logoutEvent: 'adminLogoutEvent' };
const AdminStore = {
  getToken() { return sessionStorage.getItem(ADMIN_KEYS.token) || localStorage.getItem(ADMIN_KEYS.token) || null; },
  getAuthUser() {
    const raw = sessionStorage.getItem(ADMIN_KEYS.authUser) || localStorage.getItem(ADMIN_KEYS.authUser);
    return raw ? JSON.parse(raw) : null;
  },
  setAuthUser(userPayload) {
    const raw = JSON.stringify(userPayload);
    if (localStorage.getItem(ADMIN_KEYS.authUser)) localStorage.setItem(ADMIN_KEYS.authUser, raw);
    if (sessionStorage.getItem(ADMIN_KEYS.authUser)) sessionStorage.setItem(ADMIN_KEYS.authUser, raw);
  },
  hasSession() {
    return (localStorage.getItem(ADMIN_KEYS.token) || sessionStorage.getItem(ADMIN_KEYS.token)) &&
           (localStorage.getItem(ADMIN_KEYS.role) || sessionStorage.getItem(ADMIN_KEYS.role)) === 'admin';
  },
  clear() {
    localStorage.removeItem(ADMIN_KEYS.token); localStorage.removeItem(ADMIN_KEYS.authUser); localStorage.removeItem(ADMIN_KEYS.role);
    sessionStorage.removeItem(ADMIN_KEYS.token); sessionStorage.removeItem(ADMIN_KEYS.authUser); sessionStorage.removeItem(ADMIN_KEYS.role);
  }
};

function adminLogout() {
  AdminStore.clear();
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = '../login.html';
}

async function apiFetch(endpoint, options = {}) {
  if (!AdminStore.hasSession()) { adminLogout(); return; }
  const token = AdminStore.getToken();
  const url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? `${SERVER_URL}${endpoint}` : endpoint;
  const headers = { ...options.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) { adminLogout(); return; }
  
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || `API error: ${response.status}`);
  return data;
}

// --- Setup ---
document.addEventListener('DOMContentLoaded', async () => {
  if (!AdminStore.hasSession()) { adminLogout(); return; }
  
  setupSidebar();
  populateCurrentSettings();

  const settingsForm = document.getElementById('adminSettingsForm');
  if (settingsForm) {
      settingsForm.addEventListener('submit', handleSaveSettings);
  }

  const updatePasswordBtn = document.getElementById('updatePasswordBtn');
  if(updatePasswordBtn) {
      updatePasswordBtn.addEventListener('click', handlePasswordUpdate);
  }

  // LIVE PREVIEW & INSTANT LOCAL SAVE
  document.getElementById('themeToggle').addEventListener('change', (e) => {
      const themeString = e.target.checked ? 'light' : 'dark';
      // Instantly save to local storage so it persists if you switch pages right away
      localStorage.setItem('admin_theme', themeString); 
      applyTheme(themeString);
  });
});

function setupSidebar() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');
  
  const authUser = AdminStore.getAuthUser();
  document.getElementById('adminFullName').textContent = authUser?.name || 'Admin';

  if (menuToggle && sidebar) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  if (logoutBtn) logoutBtn.addEventListener('click', adminLogout);
}

function showMessage(msg, type = 'success') {
  const el = type === 'success' ? document.getElementById('successMessage') : document.getElementById('errorMessage');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}

// --- Load Data ---
function populateCurrentSettings() {
    const authUser = AdminStore.getAuthUser();
    if (!authUser) return;

    document.getElementById('adminName').value = authUser.name || '';
    document.getElementById('adminUsername').value = authUser.username || '';
    
    const localTheme = localStorage.getItem('admin_theme');
    const isLightMode = localTheme === 'light';
    
    document.getElementById('themeToggle').checked = isLightMode;
    applyTheme(localTheme);

    document.getElementById('twoFactorToggle').checked = authUser.twoFactorEnabled || false;
}

// --- Save Preferences to Backend ---
async function handleSaveSettings(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    submitBtn.disabled = true;

    const newName = document.getElementById('adminName').value.trim();
    const isTwoFactor = document.getElementById('twoFactorToggle').checked;
    const isLightMode = document.getElementById('themeToggle').checked;
    const themeString = isLightMode ? 'light' : 'dark';

    try {
        await apiFetch('/api/admin/settings', {
            method: 'PUT',
            body: JSON.stringify({
                name: newName,
                twoFactorEnabled: isTwoFactor,
                theme: themeString
            })
        });

        // Ensure AuthUser matches
        const authUser = AdminStore.getAuthUser();
        authUser.name = newName;
        authUser.twoFactorEnabled = isTwoFactor;
        authUser.theme = themeString;
        AdminStore.setAuthUser(authUser);

        document.getElementById('adminFullName').textContent = newName;
        showMessage('Settings saved successfully!', 'success');

    } catch (error) {
        showMessage('Error saving settings: ' + error.message, 'error');
    } finally {
        submitBtn.innerHTML = 'Save Preferences';
        submitBtn.disabled = false;
    }
}

// --- Update Password ---
async function handlePasswordUpdate() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if(!currentPassword || !newPassword || !confirmPassword) {
        return showMessage('Please fill out all password fields.', 'error');
    }

    if(newPassword !== confirmPassword) {
        return showMessage('New passwords do not match.', 'error');
    }

    if(newPassword.length < 6) {
        return showMessage('New password must be at least 6 characters long.', 'error');
    }

    const btn = document.getElementById('updatePasswordBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    btn.disabled = true;

    try {
        await apiFetch('/api/admin/password', {
            method: 'PUT',
            body: JSON.stringify({ currentPassword, newPassword })
        });
        
        showMessage('Password updated successfully!', 'success');
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
    } catch (error) {
        showMessage('Error updating password: ' + error.message, 'error');
    } finally {
        btn.innerHTML = 'Update Password';
        btn.disabled = false;
    }
}