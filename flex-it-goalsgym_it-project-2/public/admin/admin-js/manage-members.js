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
    // Populate admin_* from generic keys if needed
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
 * For this admin module we just delegate to ensureAdminAuthOrLogout,
 * but keep the signature unchanged at the call site.
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
    // clear admin, broadcast admin logout to other tabs, and redirect.
    clearLocalAuth();
    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    window.location.href = '../admin-login.html';
    return;
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// ------------------------------
// Tab elements
// ------------------------------
const tabActive = document.getElementById('tabActive');
const tabInactive = document.getElementById('tabInactive');
const memberListSection = document.getElementById('memberListSection');
const inactiveListSection = document.getElementById('inactiveListSection');

// Toggle tabs
if (tabActive) {
  tabActive.addEventListener('click', () => {
    tabActive.classList.add('active');
    if (tabInactive) tabInactive.classList.remove('active');
    if (memberListSection) memberListSection.classList.add('active');
    if (inactiveListSection) inactiveListSection.classList.remove('active');
    loadMembersStrict('active'); // strict active only
  });
}
if (tabInactive) {
  tabInactive.addEventListener('click', async () => {
    tabInactive.classList.add('active');
    if (tabActive) tabActive.classList.remove('active');
    if (inactiveListSection) inactiveListSection.classList.add('active');
    if (memberListSection) memberListSection.classList.remove('active');
    await loadMembersStrict('inactive'); // strict inactive only
  });
}

// ------------------------------
// Page init
// ------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const ok = requireAuth('admin', '../admin-login.html');
  if (!ok) return;

  setupSidebarAndSession();
  await checkServerConnection();
  await loadMembersStrict('active'); // default to active-only on first load
  setupSearchListener();

  const statusFilter = document.getElementById('status_filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      // When on Active tab, enforce active-only unless user explicitly changes filter to something else
      const currentTab = tabActive?.classList.contains('active')
        ? 'active'
        : 'inactive';
      if (currentTab === 'active') {
        loadMembersStrict('active');
      } else {
        loadMembersStrict('inactive');
      }
    });
  }
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
    // Secure health check (apiFetch handles auth, but /health can bypass in backend)
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
// Search + debounce
// ------------------------------
function setupSearchListener() {
  const searchInput = document.getElementById('member_search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(searchMembersStrict, 300));
  }
}

function debounce(func, wait) {
  return function (...args) {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Strict search that filters results by current tab's status
async function searchMembersStrict() {
  const query = document.getElementById('member_search')?.value.trim();
  const suggestions = document.getElementById('autocompleteSuggestions');
  const memberListBody = document.getElementById('memberListBody');
  const errorMessage = document.getElementById('errorMessage');

  if (suggestions) {
    suggestions.innerHTML = '';
    suggestions.style.display = 'none';
  }

  const currentTab = tabActive?.classList.contains('active')
    ? 'active'
    : 'inactive';

  if (!query || query.length < 2) {
    await loadMembersStrict(currentTab);
    return;
  }

  try {
    // Secure search with apiFetch (GET, returns {success: true, data: [...]})
    const result = await apiFetch(
      `/api/members/search?query=${encodeURIComponent(query)}`
    );

    if (!result.success) {
      throw new Error(result.error || 'Search failed');
    }

    // Apply strict status filter client-side to search results
    const data = Array.isArray(result.data)
      ? result.data.filter((m) => (m.status || 'active') === currentTab)
      : [];

    if (data.length > 0) {
      if (suggestions) {
        suggestions.style.display = 'block';
        data.forEach((member) => {
          const suggestion = document.createElement('div');
          suggestion.className = 'autocomplete-suggestion';
          suggestion.textContent = `${member.name} (${member.memberId})`;
          suggestion.onclick = () =>
            selectMember(member.memberId, member.name);
          suggestions.appendChild(suggestion);
        });
      }

      if (currentTab === 'active') {
        displayMembersActive(data);
      } else {
        displayMembersInactive(data);
      }
    } else {
      if (currentTab === 'active' && memberListBody) {
        memberListBody.innerHTML =
          '<tr><td colspan="7">No members found</td></tr>';
      } else {
        const tbody = document.getElementById('inactiveListBody');
        if (tbody) {
          tbody.innerHTML =
            '<tr><td colspan="7">No members found</td></tr>';
        }
      }
    }
  } catch (error) {
    console.error('Error searching members:', error);
    if (currentTab === 'active' && memberListBody) {
      memberListBody.innerHTML =
        '<tr><td colspan="7">Error loading members</td></tr>';
    } else {
      const tbody = document.getElementById('inactiveListBody');
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="7">Error loading members</td></tr>';
      }
    }
    if (errorMessage) {
      errorMessage.textContent = 'Network error: ' + error.message;
      errorMessage.style.display = 'block';
      setTimeout(() => (errorMessage.style.display = 'none'), 5000);
    }
  }
}

function selectMember(memberId, memberName) {
  const searchInput = document.getElementById('member_search');
  const suggestions = document.getElementById('autocompleteSuggestions');
  if (searchInput) searchInput.value = memberName;
  if (suggestions) suggestions.style.display = 'none';
  // Narrow search by ID while respecting strict status
  searchMembersStrict();
}

// ------------------------------
// Strict loader by status tab
// ------------------------------
async function loadMembersStrict(strictStatus) {
  if (strictStatus === 'inactive') {
    await loadInactiveMembers();
    return;
  }
  // active tab
  const memberListBody = document.getElementById('memberListBody');
  const errorMessage = document.getElementById('errorMessage');

  if (memberListBody) {
    memberListBody.innerHTML =
      '<tr><td colspan="7">Loading...</td></tr>';
  }

  try {
    // Secure GET with apiFetch (?status=active, but filter strictly)
    const result = await apiFetch('/api/members?status=active');

    if (!result.success) {
      throw new Error(result.error || 'Load failed');
    }

    const data = Array.isArray(result.data)
      ? result.data.filter((m) => (m.status || 'active') === 'active')
      : [];
    if (data.length > 0) {
      displayMembersActive(data);
    } else if (memberListBody) {
      memberListBody.innerHTML =
        '<tr><td colspan="7">No members found</td></tr>';
    }
  } catch (error) {
    console.error('Error loading members:', error);
    if (memberListBody) {
      memberListBody.innerHTML =
        '<tr><td colspan="7">Error loading members</td></tr>';
    }
    if (errorMessage) {
      errorMessage.textContent = 'Network error: ' + error.message;
      errorMessage.style.display = 'block';
      setTimeout(() => (errorMessage.style.display = 'none'), 5000);
    }
  }
}

function displayMembersActive(members) {
  const memberListBody = document.getElementById('memberListBody');
  if (!memberListBody) return;
  memberListBody.innerHTML = '';

  // Enforce strict active-only rendering
  const filtered = members.filter(
    (m) => (m.status || 'active') === 'active'
  );

  filtered.forEach((member) => {
    const memberships = (member.memberships || [])
      .map((m) => {
        const durationLabel =
          m.type === 'combative'
            ? `${m.remainingSessions || m.duration} sessions`
            : `${m.duration} months`;
        return `${m.type} (${m.status}, ${durationLabel}, ends ${new Date(
          m.endDate
        ).toLocaleDateString()})`;
      })
      .join(', ');
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${member.memberId}</td>
      <td>${member.name}</td>
      <td>${member.phone || '-'}</td>
      <td>${member.email || '-'}</td>
      <td>${memberships || 'None'}</td>
      <td>${member.status}</td>
      <td>
        <button class="action-button" onclick='editMember(${JSON.stringify(
          member
        )})'>Edit</button>
        <button class="archive-button" onclick="archiveMember('${
          member.memberId
        }', 'inactive')">Archive</button>
      </td>
    `;
    memberListBody.appendChild(row);
  });

  if (filtered.length === 0) {
    memberListBody.innerHTML =
      '<tr><td colspan="7">No members found</td></tr>';
  }
}

// ------------------------------
// Inactive list handling (strict)
// ------------------------------
async function loadInactiveMembers() {
  const tbody = document.getElementById('inactiveListBody');
  const errorMessage = document.getElementById('errorMessage');

  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';

  try {
    // Secure GET with apiFetch (?status=inactive)
    const result = await apiFetch('/api/members?status=inactive');

    if (!result.success) {
      throw new Error(result.error || 'Load failed');
    }

    const data = Array.isArray(result.data)
      ? result.data.filter((m) => (m.status || 'active') === 'inactive')
      : [];

    tbody.innerHTML = '';
    if (data.length > 0) {
      displayMembersInactive(data);
    } else {
      tbody.innerHTML =
        '<tr><td colspan="7">No inactive members</td></tr>';
    }
  } catch (error) {
    console.error('Error loading inactive members:', error);
    tbody.innerHTML =
      '<tr><td colspan="7">Error loading inactive members</td></tr>';
    if (errorMessage) {
      errorMessage.textContent = 'Network error: ' + error.message;
      errorMessage.style.display = 'block';
      setTimeout(() => (errorMessage.style.display = 'none'), 5000);
    }
  }
}

function displayMembersInactive(members) {
  const tbody = document.getElementById('inactiveListBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Enforce strict inactive-only rendering
  const filtered = members.filter(
    (m) => (m.status || 'active') === 'inactive'
  );

  filtered.forEach((member) => {
    const memberships = (member.memberships || [])
      .map((m) => {
        const durationLabel =
          m.type === 'combative'
            ? `${m.remainingSessions || m.duration} sessions`
            : `${m.duration} months`;
        return `${m.type} (${m.status}, ${durationLabel}, ends ${new Date(
          m.endDate
        ).toLocaleDateString()})`;
      })
      .join(', ');

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${member.memberId}</td>
      <td>${member.name}</td>
      <td>${member.phone || '-'}</td>
      <td>${member.email || '-'}</td>
      <td>${memberships || 'None'}</td>
      <td>${member.status}</td>
      <td>
        <button class="action-button" onclick="setStatus('${
          member.memberId
        }', 'active')">Activate</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7">No inactive members</td></tr>';
  }
}

// ------------------------------
// Status / archive actions
// ------------------------------
async function setStatus(memberId, status) {
  const successMessage = document.getElementById('successMessage');
  const errorMessage = document.getElementById('errorMessage');
  try {
    // Secure PATCH with apiFetch
    const result = await apiFetch(`/api/members/${memberId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });

    if (result.success) {
      if (successMessage) {
        successMessage.textContent = result.message || 'Status updated';
        successMessage.style.display = 'block';
        setTimeout(() => (successMessage.style.display = 'none'), 4000);
      }
      // Refresh the current tab strictly
      const currentTab = tabActive?.classList.contains('active')
        ? 'active'
        : 'inactive';
      await loadMembersStrict(currentTab);
    } else {
      throw new Error(result.error || 'Failed to update status');
    }
  } catch (error) {
    console.error('Error updating status:', error);
    if (errorMessage) {
      errorMessage.textContent = 'Network error: ' + error.message;
      errorMessage.style.display = 'block';
      setTimeout(() => (errorMessage.style.display = 'none'), 5000);
    }
  }
}

async function archiveMember(memberId, status) {
  const successMessage = document.getElementById('successMessage');
  const errorMessage = document.getElementById('errorMessage');

  try {
    // Secure PATCH with apiFetch
    const result = await apiFetch(`/api/members/${memberId}/archive`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });

    if (result.success) {
      if (successMessage) {
        successMessage.textContent = result.message;
        successMessage.style.display = 'block';
        setTimeout(() => (successMessage.style.display = 'none'), 5000);
      }
      await loadMembersStrict('active'); // stay strict on active tab after archive
    } else {
      throw new Error(result.error || 'Failed to archive member');
    }
  } catch (error) {
    console.error('Error archiving member:', error);
    if (errorMessage) {
      errorMessage.textContent = 'Network error: ' + error.message;
      errorMessage.style.display = 'block';
      setTimeout(() => (errorMessage.style.display = 'none'), 5000);
    }
  }
}

// ------------------------------
// Edit member flow
// ------------------------------
function editMember(member) {
  const memberListSection = document.getElementById('memberListSection');
  const editMemberSection = document.getElementById('editMemberSection');
  if (memberListSection) memberListSection.classList.remove('active');
  if (editMemberSection) editMemberSection.classList.add('active');

  document.getElementById('edit_member_id').value = member.memberId;
  document.getElementById('edit_name').value = member.name;
  document.getElementById('edit_phone').value = member.phone || '';
  document.getElementById('edit_email').value = member.email || '';

  const membershipsContainer = document.getElementById('membershipsContainer');
  if (!membershipsContainer) return;
  membershipsContainer.innerHTML = '';

  if (member.memberships && member.memberships.length > 0) {
    member.memberships.forEach((membership, index) => {
      addMembershipField(membership, index);
    });
  } else {
    addMembershipField();
  }
}

function addMembershipField(
  membership = null,
  index = document.getElementById('membershipsContainer').children.length
) {
  const membershipsContainer = document.getElementById('membershipsContainer');
  if (!membershipsContainer) return;
  const membershipDiv = document.createElement('div');
  membershipDiv.className = 'membership-container';
  const durationLabel =
    membership && membership.type === 'combative' ? 'Sessions' : 'Months';
  membershipDiv.innerHTML = `
    <h4>Membership ${index + 1}</h4>
    <div class="form-group">
      <label for="membership_type_${index}">Type:</label>
      <select id="membership_type_${index}" name="memberships[${index}][type]" required onchange="updateDurationLabel(${index})">
        <option value="monthly" ${
          membership && membership.type === 'monthly' ? 'selected' : ''
        }>Monthly</option>
        <option value="combative" ${
          membership && membership.type === 'combative' ? 'selected' : ''
        }>Combative</option>
      </select>
    </div>
    <div class="form-group">
      <label for="membership_duration_${index}">${durationLabel}:</label>
      <input type="number" id="membership_duration_${index}" name="memberships[${index}][duration]" value="${
        membership ? membership.remainingSessions || membership.duration : ''
      }" min="1" required>
    </div>
    <div class="form-group">
      <label for="membership_start_date_${index}">Start Date:</label>
      <input type="date" id="membership_start_date_${index}" name="memberships[${index}][startDate]" value="${
        membership
          ? new Date(membership.startDate).toISOString().split('T')[0]
          : ''
      }">
    </div>
    <div class="form-group">
      <label for="membership_status_${index}">Status:</label>
      <select id="membership_status_${index}" name="memberships[${index}][status]">
        <option value="active" ${
          membership && membership.status === 'active' ? 'selected' : ''
        }>Active</option>
        <option value="inactive" ${
          membership && membership.status === 'inactive' ? 'selected' : ''
        }>Inactive</option>
        <option value="suspended" ${
          membership && membership.status === 'suspended' ? 'selected' : ''
        }>Suspended</option>
        <option value="expired" ${
          membership && membership.status === 'expired' ? 'selected' : ''
        }>Expired</option>
      </select>
    </div>
    <button type="button" class="archive-button" onclick="this.parentElement.remove()">Remove Membership</button>
  `;
  membershipsContainer.appendChild(membershipDiv);
}

function updateDurationLabel(index) {
  const typeSelect = document.getElementById(`membership_type_${index}`);
  const durationLabel =
    document.getElementById(`membership_duration_${index}`)
      .previousElementSibling;
  if (typeSelect && durationLabel) {
    durationLabel.textContent =
      typeSelect.value === 'combative' ? 'Sessions:' : 'Months:';
  }
}

// ------------------------------
// Edit form submit
// ------------------------------
const editForm = document.getElementById('editMemberForm');
if (editForm) {
  editForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const memberId = formData.get('member_id');
    const name = formData.get('name').trim();
    const phone = formData.get('phone').trim();
    const email = formData.get('email').trim().toLowerCase();
    const memberships = [];

    document
      .querySelectorAll('.membership-container')
      .forEach((container, index) => {
        const type = document.getElementById(
          `membership_type_${index}`
        )?.value;
        const duration = parseInt(
          document.getElementById(`membership_duration_${index}`).value,
          10
        );
        const startDate = document.getElementById(
          `membership_start_date_${index}`
        )?.value;
        const status = document.getElementById(
          `membership_status_${index}`
        )?.value;

        if (type && duration) {
          const membership = { type, duration, status };
          if (startDate) membership.startDate = startDate;
          memberships.push(membership);
        }
      });

    const updateData = { name };
    if (phone) updateData.phone = phone;
    if (email) updateData.email = email;
    if (memberships.length > 0) updateData.memberships = memberships;

    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');

    try {
      // Secure PUT with apiFetch
      const result = await apiFetch(`/api/members/${memberId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData),
      });

      if (result.success) {
        if (successMessage) {
          successMessage.textContent = result.message;
          successMessage.style.display = 'block';
          setTimeout(() => (successMessage.style.display = 'none'), 5000);
        }
        showMemberList();
        loadMembersStrict('active');
      } else {
        throw new Error(result.error || 'Failed to update member');
      }
    } catch (error) {
      console.error('Error updating member:', error);
      if (errorMessage) {
        errorMessage.textContent = 'Network error: ' + error.message;
        errorMessage.style.display = 'block';
        setTimeout(() => (errorMessage.style.display = 'none'), 5000);
      }
    }
  });
}

// ------------------------------
// Back to list
// ------------------------------
function showMemberList() {
  const editMemberSection = document.getElementById('editMemberSection');
  const memberListSection = document.getElementById('memberListSection');
  const memberSearch = document.getElementById('member_search');
  const autocompleteSuggestions = document.getElementById(
    'autocompleteSuggestions'
  );
  if (editMemberSection) editMemberSection.classList.remove('active');
  if (memberListSection) memberListSection.classList.add('active');
  if (memberSearch) memberSearch.value = '';
  if (autocompleteSuggestions)
    autocompleteSuggestions.style.display = 'none';
  loadMembersStrict('active');
}
