// --------------------------------------
// Server & session configuration
// --------------------------------------
const SERVER_URL = 'http://localhost:8080';
const TRAINER_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const TRAINER_IDLE_WARNING_MS = 15 * 60 * 1000;        // 15 minutes

let trainerId = null;
let originalData = {};

// Trainer-scoped storage keys (avoid admin/member interference)
const TRAINER_KEYS = {
  token: 'trainer_token',
  authUser: 'trainer_authUser',
  role: 'trainer_role',
  logoutEvent: 'trainerLogoutEvent',
};

// Idle tracking (trainer only)
let trainerLastActivity = Date.now();
let trainerIdleWarningShown = false;

// --------------------------------------
// Trainer storage helpers (namespaced)
// --------------------------------------
const TrainerStore = {
  set(token, userPayload) {
    try {
      const authUser = {
        ...(userPayload || {}),
        timestamp: Date.now(),
        role: 'trainer',
        token,
      };

      // Prefer localStorage for cross-tab; mirror to sessionStorage
      localStorage.setItem(TRAINER_KEYS.token, token);
      localStorage.setItem(TRAINER_KEYS.authUser, JSON.stringify(authUser));
      localStorage.setItem(TRAINER_KEYS.role, 'trainer');

      sessionStorage.setItem(TRAINER_KEYS.token, token);
      sessionStorage.setItem(TRAINER_KEYS.authUser, JSON.stringify(authUser));
      sessionStorage.setItem(TRAINER_KEYS.role, 'trainer');
    } catch (e) {
      console.error('[TrainerStore.set] failed:', e);
    }
  },

  getToken() {
    return (
      sessionStorage.getItem(TRAINER_KEYS.token) ||
      localStorage.getItem(TRAINER_KEYS.token) ||
      null
    );
  },

  getAuthUser() {
    const raw =
      sessionStorage.getItem(TRAINER_KEYS.authUser) ||
      localStorage.getItem(TRAINER_KEYS.authUser);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[TrainerStore.getAuthUser] parse error:', e);
      return null;
    }
  },

  getRole() {
    return (
      sessionStorage.getItem(TRAINER_KEYS.role) ||
      localStorage.getItem(TRAINER_KEYS.role) ||
      null
    );
  },

  hasSession() {
    const token =
      localStorage.getItem(TRAINER_KEYS.token) ||
      sessionStorage.getItem(TRAINER_KEYS.token);
    const authUser =
      localStorage.getItem(TRAINER_KEYS.authUser) ||
      sessionStorage.getItem(TRAINER_KEYS.authUser);
    const role =
      localStorage.getItem(TRAINER_KEYS.role) ||
      sessionStorage.getItem(TRAINER_KEYS.role);
    return !!token && !!authUser && role === 'trainer';
  },

  clear() {
    localStorage.removeItem(TRAINER_KEYS.token);
    localStorage.removeItem(TRAINER_KEYS.authUser);
    localStorage.removeItem(TRAINER_KEYS.role);

    sessionStorage.removeItem(TRAINER_KEYS.token);
    sessionStorage.removeItem(TRAINER_KEYS.authUser);
    sessionStorage.removeItem(TRAINER_KEYS.role);
  },
};

// --------------------------------------
// Backward‑compatible bootstrap
// Copy valid trainer session from generic keys into trainer_* once
// --------------------------------------
function bootstrapTrainerFromGenericIfNeeded() {
  try {
    if (TrainerStore.hasSession()) return;

    const genToken =
      localStorage.getItem('token') || sessionStorage.getItem('token');
    const genRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');
    const genAuthRaw =
      localStorage.getItem('authUser') || sessionStorage.getItem('authUser');

    if (!genToken || !genRole || genRole !== 'trainer' || !genAuthRaw) return;

    const genAuth = JSON.parse(genAuthRaw);
    TrainerStore.set(genToken, genAuth);
  } catch (e) {
    console.error('[bootstrapTrainerFromGenericIfNeeded] failed:', e);
  }
}

// --------------------------------------
// Idle helpers
// --------------------------------------
function markTrainerActivity() {
  trainerLastActivity = Date.now();
  trainerIdleWarningShown = false;
}

// Idle banner at top
function showTrainerIdleBanner() {
  let banner = document.getElementById('trainerIdleBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'trainerIdleBanner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      background: linear-gradient(135deg, #111, #333);
      color: #f5f5f5;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-radius: 0 0 8px 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      font-size: 0.95rem;
    `;

    const textSpan = document.createElement('span');
    textSpan.textContent =
      "You've been idle for 15 minutes. Stay logged in or logout?";

    const stayBtn = document.createElement('button');
    stayBtn.textContent = 'Stay Logged In';
    stayBtn.style.cssText = `
      padding: 6px 12px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      background: #28a745;
      color: #fff;
      font-weight: 600;
    `;

    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Logout';
    logoutBtn.style.cssText = `
      padding: 6px 12px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      background: #dc3545;
      color: #fff;
      font-weight: 600;
    `;

    stayBtn.addEventListener('click', () => {
      const token = TrainerStore.getToken();
      const authUser = TrainerStore.getAuthUser();
      if (token && authUser) {
        authUser.timestamp = Date.now();
        TrainerStore.set(token, authUser);
      }
      markTrainerActivity();
      trainerIdleWarningShown = true;
      hideTrainerIdleBanner();
    });

    logoutBtn.addEventListener('click', () => {
      trainerLogout('trainer chose logout after idle warning (profile)');
    });

    banner.appendChild(textSpan);
    banner.appendChild(stayBtn);
    banner.appendChild(logoutBtn);
    document.body.appendChild(banner);
  } else {
    banner.style.display = 'flex';
  }
}

function hideTrainerIdleBanner() {
  const banner = document.getElementById('trainerIdleBanner');
  if (banner) banner.style.display = 'none';
}

function setupTrainerIdleWatcher() {
  // Treat these as activity
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, markTrainerActivity, { passive: true });
  });

  // Check every 30 seconds
  setInterval(() => {
    bootstrapTrainerFromGenericIfNeeded();

    const token = TrainerStore.getToken();
    const role = TrainerStore.getRole();
    const authUser = TrainerStore.getAuthUser();

    if (!token || !authUser || role !== 'trainer') return;

    const ts = authUser.timestamp || 0;

    // Hard 2-hour session cap
    if (!ts || Date.now() - ts > TRAINER_SESSION_MAX_AGE_MS) {
      console.log('Trainer session exceeded 2 hours, logging out (idle watcher).');
      trainerLogout('trainer session max age exceeded in idle watcher');
      return;
    }

    const now = Date.now();
    const idleFor = now - trainerLastActivity;

    if (!trainerIdleWarningShown && idleFor >= TRAINER_IDLE_WARNING_MS) {
      console.log(
        "Trainer idle for 15 minutes. Showing idle banner (profile)."
      );
      trainerIdleWarningShown = true;
      showTrainerIdleBanner();
    }
  }, 30000);
}

// --------------------------------------
// Centralized trainer logout (scoped)
// --------------------------------------
function trainerLogout(reason) {
  console.log('[Trainer Logout]:', reason || 'no reason');

  // Clear trainer_* keys
  TrainerStore.clear();

  // Also clear legacy generic keys if they currently represent a trainer session
  try {
    const genericRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');

    if (genericRole === 'trainer') {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');

      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
    }
  } catch (e) {
    console.error('[trainerLogout] failed to clear generic trainer keys:', e);
  }

  // Notify other trainer tabs in this browser
  localStorage.setItem(TRAINER_KEYS.logoutEvent, Date.now().toString());

  window.location.href = '../trainer-login.html';
}

// Keep old name for compatibility
function logout(reason) {
  trainerLogout(reason);
}

// Cross‑tab trainer logout sync
window.addEventListener('storage', (event) => {
  if (event.key === TRAINER_KEYS.logoutEvent) {
    console.log('[Trainer Logout] profile page sees logout from another tab');
    TrainerStore.clear();
    window.location.href = '../trainer-login.html';
  }
});

// --------------------------------------
// Utility for authenticated API calls
// (adds JWT header, handles full URLs, timeout, 2h check)
// --------------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log('apiFetch called for:', endpoint, 'method:', options.method || 'GET'); // DEBUG

  bootstrapTrainerFromGenericIfNeeded();

  const token = TrainerStore.getToken();
  const authUser = TrainerStore.getAuthUser();
  const role = TrainerStore.getRole();

  if (!token || !authUser || role !== 'trainer') {
    console.log(
      'Missing token/authUser/role in trainer-profile apiFetch - logging out'
    ); // DEBUG
    trainerLogout('missing token/authUser/role in trainer-profile apiFetch');
    return;
  }

  // 2-hour session max check + update timestamp
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > TRAINER_SESSION_MAX_AGE_MS) {
      console.log('Trainer session max age exceeded in trainer-profile apiFetch');
      trainerLogout('trainer session max age exceeded in trainer-profile apiFetch');
      return;
    }
    // Bump timestamp to extend active session
    authUser.timestamp = Date.now();
    TrainerStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to parse authUser in trainer-profile apiFetch:', e);
    trainerLogout('invalid authUser JSON in trainer-profile apiFetch');
    return;
  }

  // Build URL: support full URLs or relative /api routes
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    if (!endpoint.startsWith('/api/')) {
      endpoint = '/api' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    }
    url = `${SERVER_URL}${endpoint}`;
  }

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json', // Default for JSON calls
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      console.log(
        '401/403 Unauthorized - logging out from trainer-profile apiFetch'
      ); // DEBUG
      trainerLogout('401/403 from trainer-profile apiFetch');
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
// INITIAL AUTH CHECK - Token + Role + Timestamp
// --------------------------------------
(function checkAuth() {
  console.log('Auth check starting for trainer-profile'); // DEBUG

  bootstrapTrainerFromGenericIfNeeded();

  const authUser = TrainerStore.getAuthUser();
  const token = TrainerStore.getToken();
  const role = TrainerStore.getRole();

  console.log('Auth details:', {
    authUser: authUser
      ? authUser.username || authUser.email || authUser.name
      : null,
    token: !!token,
    role,
  });

  if (
    !authUser ||
    !token ||
    role !== 'trainer' ||
    Date.now() - (authUser.timestamp || 0) > TRAINER_SESSION_MAX_AGE_MS
  ) {
    console.log('Initial trainer-profile auth failed - logging out'); // DEBUG
    trainerLogout('initial trainer-profile auth failed');
    return;
  }

  console.log(
    'Trainer authenticated:',
    authUser.username || authUser.email || authUser.name,
    'Role:',
    role
  );
})();

const API_URL = SERVER_URL;

// --------------------------------------
// DOM Ready
// --------------------------------------
document.addEventListener('DOMContentLoaded', async function () {
  setupTrainerIdleWatcher();
  markTrainerActivity();

  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  bootstrapTrainerFromGenericIfNeeded();
  let authUser = TrainerStore.getAuthUser();
  const token = TrainerStore.getToken();
  const role = TrainerStore.getRole();

  // DEBUG: Log the raw authUser to diagnose structure
  console.log('=== TRAINER PROFILE AUTH DEBUG ===');
  console.log('AuthUser from TrainerStore:', authUser);
  if (authUser) {
    console.log('authUser keys:', Object.keys(authUser));
    console.log('authUser.role:', authUser.role);
    console.log('authUser.timestamp:', authUser.timestamp);
    console.log('authUser.user exists?', !!authUser.user);
    if (authUser.user) console.log('authUser.user keys:', Object.keys(authUser.user));
  }

  // Support both wrapped (authUser.user) and flattened structures
  const user = authUser?.user || authUser;
  const timestamp = authUser?.timestamp || 0;

  // Extra safety auth check (2h max)
  if (!authUser || !user || role !== 'trainer' || !token ||
      Date.now() - timestamp > TRAINER_SESSION_MAX_AGE_MS) {
    console.log(
      'Auth check failed in trainer-profile DOMContentLoaded - logging out'
    );
    trainerLogout('trainer-profile auth failed in DOMContentLoaded');
    return;
  }

  // Refresh timestamp on page load via TrainerStore
  TrainerStore.set(token, authUser);

  console.log('Auth check passed! Using user:', user);
  console.log(
    'Extracted trainer ID:',
    user.trainer_id || user.trainerid || user.trainerId || user.id || user._id
  );

  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      if (sidebar) sidebar.classList.toggle('collapsed');
      markTrainerActivity();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      trainerLogout('manual trainer-profile logout button');
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

  // GET TRAINER ID from extracted user with multiple fallbacks
  trainerId =
    user.trainer_id || user.trainerid || user.trainerId || user.id || user._id;

  if (!trainerId) {
    showMessage('Error: Unable to identify trainer', 'error');
    console.error('Auth user object:', authUser);
    return;
  }

  console.log('✅ Trainer ID:', trainerId);

  // LOAD PROFILE DATA
  await loadProfile();

  // FORM SUBMISSION
  const formEl = document.getElementById('profileForm');
  if (formEl) {
    formEl.addEventListener('submit', handleSubmit);
  }
});

// --------------------------------------
// LOAD TRAINER PROFILE (uses apiFetch)
// --------------------------------------
async function loadProfile() {
  try {
    console.log('🔍 Fetching trainer profile for ID:', trainerId);

    const data = await apiFetch(`/api/trainers/${encodeURIComponent(trainerId)}`);
    if (!data) return; // apiFetch may have logged out

    console.log('📦 API Response:', data);

    const trainer = data.data;
    if (!trainer) {
      throw new Error('Trainer data not found');
    }

    // Store original data
    originalData = {
      username: trainer.username || '',
      email: trainer.email || '',
      phone: trainer.phone || '',
    };

    // POPULATE FORM with current values
    document.getElementById('username').value = originalData.username;
    document.getElementById('email').value = originalData.email;
    document.getElementById('phone').value = originalData.phone;

    // Remove placeholder text
    document.getElementById('username').placeholder = 'Enter username';
    document.getElementById('email').placeholder = 'your.email@example.com';

    console.log('✅ Profile loaded successfully:', originalData);
  } catch (err) {
    console.error('❌ Error loading profile:', err);
    showMessage(`Failed to load profile: ${err.message}`, 'error');
  }
}

// --------------------------------------
// HANDLE FORM SUBMISSION (uses apiFetch)
// --------------------------------------
async function handleSubmit(event) {
  event.preventDefault();
  markTrainerActivity();

  const username = document.getElementById('username').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  // VALIDATE PASSWORD CHANGE (if any password field is filled)
  if (currentPassword || newPassword || confirmPassword) {
    if (!currentPassword) {
      showMessage('Current password is required to change password.', 'error');
      return;
    }
    if (!newPassword) {
      showMessage('New password is required.', 'error');
      return;
    }
    if (!confirmPassword) {
      showMessage('Please confirm your new password.', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showMessage('New password and confirmation do not match.', 'error');
      return;
    }
    if (newPassword.length < 6) {
      showMessage('New password must be at least 6 characters long.', 'error');
      return;
    }
  }

  // CHECK IF ANY BASIC CHANGES WERE MADE
  const hasBasicChanges =
    username !== originalData.username ||
    email !== originalData.email ||
    phone !== originalData.phone;

  if (!hasBasicChanges && !newPassword) {
    showMessage('No changes to save', 'error');
    return;
  }

  try {
    showMessage('Updating profile...', 'info');

    // BUILD PAYLOAD
    const payload = {
      trainer_id: trainerId,
      username,
      email,
      phone,
    };

    if (currentPassword && newPassword) {
      payload.currentPassword = currentPassword;
      payload.newPassword = newPassword;
    }

    console.log('📤 Sending update:', payload);

    const result = await apiFetch('/api/trainers/update-profile', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!result) return; // apiFetch may have logged out

    console.log('📥 Update response:', result);

    if (result.error) {
      throw new Error(result.error || 'Failed to update profile');
    }

    showMessage('✓ Profile updated successfully!', 'success');

    // Update TrainerStore + generic authUser for compatibility
    bootstrapTrainerFromGenericIfNeeded();
    const token = TrainerStore.getToken();
    let storedAuthUser = TrainerStore.getAuthUser();
    if (token && storedAuthUser) {
      const updatedUser = storedAuthUser.user || storedAuthUser;
      updatedUser.username = username;
      updatedUser.email = email;
      updatedUser.phone = phone;

      if (storedAuthUser.user) {
        storedAuthUser.user = updatedUser;
      } else {
        Object.assign(storedAuthUser, updatedUser);
      }

      storedAuthUser.timestamp = Date.now();
      TrainerStore.set(token, storedAuthUser);

      // Also mirror back to generic authUser if login.js still reads it
      try {
        localStorage.setItem('authUser', JSON.stringify(storedAuthUser));
        sessionStorage.setItem('authUser', JSON.stringify(storedAuthUser));
      } catch (e) {
        console.error('[Update] Failed to update generic authUser:', e);
      }
    }

    // Clear ALL password fields
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';

    // Reload profile after 1 second
    setTimeout(() => {
      loadProfile();
    }, 1000);
  } catch (err) {
    console.error('❌ Error updating profile:', err);
    showMessage(`Error: ${err.message}`, 'error');
  }
}

// --------------------------------------
// RESET FORM
// --------------------------------------
function resetForm() {
  document.getElementById('username').value = originalData.username;
  document.getElementById('email').value = originalData.email;
  document.getElementById('phone').value = originalData.phone;
  document.getElementById('currentPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
  showMessage('Form reset to original values', 'success');
}

// --------------------------------------
// SHOW MESSAGE
// --------------------------------------
function showMessage(message, type) {
  const statusDiv = document.getElementById('profileStatus');
  if (!statusDiv) return;
  statusDiv.textContent = message;
  statusDiv.className = `profile-status ${type}`;
  statusDiv.style.display = 'block';

  // Auto-hide after 5 seconds (except for info messages)
  setTimeout(() => {
    if (type !== 'info') {
      statusDiv.style.display = 'none';
    }
  }, 5000);
}
