const SERVER_URL = 'http://localhost:8080';
let debounceTimeout;

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
  return window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
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

    // Cross-tab logout: listen for adminLogoutEvent
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

  const url =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
      ? `${SERVER_URL}${endpoint}`
      : endpoint;

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json', // Default for this file's JSON calls
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
  setupTrainerSearch();
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
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
        }
      } catch (e) {
        console.error('Logout error:', e);
      } finally {
        clearLocalAuth();
        // Notify admin tabs in this browser
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
// Server health check
// ------------------------------
async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  if (!statusElement) return;

  try {
    // Secure health check (apiFetch handles auth; /health may ignore auth on backend)
    const result = await apiFetch('/health');
    if (result) {
      statusElement.textContent = 'Connected to server successfully';
      statusElement.className = 'server-status server-connected';
    } else {
      throw new Error('Health check failed');
    }
  } catch (error) {
    statusElement.textContent =
      'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
    console.error('Server connection error:', error);
  }
}

// ------------------------------
// Trainer search + list
// ------------------------------
function setupTrainerSearch() {
  const searchInput = document.getElementById('trainerSearch');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(searchTrainers, 300));
  }
}

function debounce(func, wait) {
  return function (...args) {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => func.apply(this, args), wait);
  };
}

async function searchTrainers() {
  const query = document.getElementById('trainerSearch')?.value.trim();
  const suggestions = document.getElementById('trainerSuggestions');
  const trainerListBody = document.getElementById('trainerListBody');

  if (suggestions) {
    suggestions.innerHTML = '';
    suggestions.style.display = 'none';
  }

  if (!query || query.length < 2) {
    await loadTrainers();
    return;
  }

  try {
    // Secure search with apiFetch (GET, returns {success: true, data: [...]})
    const result = await apiFetch(
      `/api/trainers/search?query=${encodeURIComponent(query)}`
    );

    if (!result.success) {
      throw new Error(result.error || 'Search failed');
    }

    if (result.data && result.data.length > 0) {
      if (suggestions) {
        suggestions.style.display = 'block';
        result.data.forEach((trainer) => {
          const suggestion = document.createElement('div');
          suggestion.className = 'autocomplete-suggestion';
          suggestion.textContent = `${trainer.name} (${trainer.trainer_id})`;
          suggestion.onclick = () =>
            selectTrainer(trainer.trainer_id, trainer.name);
          suggestions.appendChild(suggestion);
        });
      }
      displayTrainers(result.data);
    } else {
      if (trainerListBody) {
        trainerListBody.innerHTML =
          '<tr><td colspan="6">No trainers found</td></tr>';
      }
    }
  } catch (error) {
    console.error('Error searching trainers:', error);
    if (trainerListBody) {
      trainerListBody.innerHTML =
        '<tr><td colspan="6">Error loading trainers</td></tr>';
    }
    showMessage('Network error: ' + error.message, 'error');
  }
}

function selectTrainer(trainerId, trainerName) {
  const searchInput = document.getElementById('trainerSearch');
  const suggestions = document.getElementById('trainerSuggestions');
  if (searchInput) searchInput.value = trainerName;
  if (suggestions) suggestions.style.display = 'none';
  loadTrainers(trainerId);
}

async function loadTrainers(filterTrainerId = null) {
  const trainerListBody = document.getElementById('trainerListBody');
  if (!trainerListBody) return;

  let endpoint = '/api/trainers';
  if (filterTrainerId) {
    endpoint = `/api/trainers/search?query=${encodeURIComponent(
      filterTrainerId
    )}`;
  }

  try {
    // Secure GET with apiFetch
    const result = await apiFetch(endpoint);

    if (!result.success) {
      throw new Error(result.error || 'Load failed');
    }

    trainerListBody.innerHTML = '';

    if (result.data && result.data.length > 0) {
      displayTrainers(result.data);
    } else {
      trainerListBody.innerHTML =
        '<tr><td colspan="6">No trainers found</td></tr>';
    }
  } catch (error) {
    console.error('Error loading trainers:', error);
    trainerListBody.innerHTML =
      '<tr><td colspan="6">Error loading trainers</td></tr>';
    showMessage('Network error: ' + error.message, 'error');
  }
}

function displayTrainers(trainers) {
  const trainerListBody = document.getElementById('trainerListBody');
  if (!trainerListBody) return;
  trainerListBody.innerHTML = '';

  trainers.forEach((trainer) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${trainer.trainer_id}</td>
      <td>${trainer.name}</td>
      <td>${trainer.email}</td>
      <td>${trainer.specialization}</td>
      <td>
        <span class="availability-badge ${
          trainer.is_available
            ? 'availability-available'
            : 'availability-unavailable'
        }">
          ${trainer.is_available ? 'Available' : 'Unavailable'}
        </span>
      </td>
      <td>
        <button class="action-button" onclick='editTrainer(${JSON.stringify(
          trainer
        )})'>Edit</button>
      </td>
    `;
    trainerListBody.appendChild(row);
  });
}

// ------------------------------
// Edit trainer
// ------------------------------
function editTrainer(trainer) {
  const trainerListSection = document.getElementById('trainerListSection');
  const editTrainerSection = document.getElementById('editTrainerSection');
  if (trainerListSection) trainerListSection.classList.remove('active');
  if (editTrainerSection) editTrainerSection.classList.add('active');

  document.getElementById('editTrainerId').value = trainer.trainer_id;
  document.getElementById('editName').value = trainer.name;
  document.getElementById('editEmail').value = trainer.email;
  document.getElementById('editSpecialization').value = trainer.specialization;
  document.getElementById('editAvailability').value = trainer.is_available;
}

function showTrainerList() {
  const editTrainerSection = document.getElementById('editTrainerSection');
  const trainerListSection = document.getElementById('trainerListSection');
  const trainerSearch = document.getElementById('trainerSearch');
  const trainerSuggestions = document.getElementById('trainerSuggestions');
  if (editTrainerSection) editTrainerSection.classList.remove('active');
  if (trainerListSection) trainerListSection.classList.add('active');
  if (trainerSearch) trainerSearch.value = '';
  if (trainerSuggestions) trainerSuggestions.style.display = 'none';
  loadTrainers();
}

// ------------------------------
// Edit trainer form submit
// ------------------------------
const editTrainerForm = document.getElementById('editTrainerForm');
if (editTrainerForm) {
  editTrainerForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const trainerId = document.getElementById('editTrainerId').value;
    const name = document.getElementById('editName').value.trim();
    const email = document
      .getElementById('editEmail')
      .value.trim()
      .toLowerCase();
    const specialization = document
      .getElementById('editSpecialization')
      .value.trim();
    const is_available =
      document.getElementById('editAvailability').value === 'true';

    const updateData = { name, email, specialization, is_available };

    try {
      // Secure PUT with apiFetch
      const result = await apiFetch(`/api/trainers/${trainerId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData),
      });

      if (result.success) {
        showMessage(
          result.message || 'Trainer updated successfully',
          'success'
        );
        showTrainerList();
        loadTrainers();
      } else {
        throw new Error(result.error || 'Failed to update trainer');
      }
    } catch (error) {
      console.error('Error updating trainer:', error);
      showMessage('Network error: ' + error.message, 'error');
    }
  });
}

// ------------------------------
// Message helpers
// ------------------------------
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
