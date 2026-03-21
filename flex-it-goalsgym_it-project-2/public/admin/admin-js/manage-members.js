const SERVER_URL = 'http://localhost:8080';
let debounceTimeout;

// Use a Map to cleanly store and retrieve loaded members for modals without stringifying JSON into HTML
const allMembersMap = new Map();
let selectedMemberForRenewal = null;

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
  return window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
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

  const url =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
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
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// ------------------------------
// Utility functions
// ------------------------------
function formatDate(date) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(date).toLocaleDateString('en-US', options);
}

function storeMembers(members) {
    members.forEach(m => allMembersMap.set(m.memberId, m));
}

// ------------------------------
// Tab elements
// ------------------------------
const tabActive = document.getElementById('tabActive');
const tabInactive = document.getElementById('tabInactive');
const memberListSection = document.getElementById('memberListSection');
const inactiveListSection = document.getElementById('inactiveListSection');
const editMemberSection = document.getElementById('editMemberSection'); // FIX: Added reference

if (tabActive) {
  tabActive.addEventListener('click', () => {
    tabActive.classList.add('active');
    if (tabInactive) tabInactive.classList.remove('active');
    if (memberListSection) memberListSection.classList.add('active');
    if (inactiveListSection) inactiveListSection.classList.remove('active');
    if (editMemberSection) editMemberSection.classList.remove('active'); // FIX: Hide edit form
    loadMembersStrict('active'); 
  });
}

if (tabInactive) {
  tabInactive.addEventListener('click', async () => {
    tabInactive.classList.add('active');
    if (tabActive) tabActive.classList.remove('active');
    if (inactiveListSection) inactiveListSection.classList.add('active');
    if (memberListSection) memberListSection.classList.remove('active');
    if (editMemberSection) editMemberSection.classList.remove('active'); // FIX: Hide edit form
    await loadMembersStrict('inactive'); 
  });
}

// ------------------------------
// Page init
// ------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const ok = requireAuth('admin', '../login.html');
  if (!ok) return;

  setupSidebarAndSession();
  setupModals();
  setupRenewalForm();
  await checkServerConnection();
  await loadMembersStrict('active'); 
  setupSearchListener();

  const statusFilter = document.getElementById('status_filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      const currentTab = tabActive?.classList.contains('active') ? 'active' : 'inactive';
      loadMembersStrict(currentTab);
    });
  }
});

function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in setupSidebarAndSession', '../login.html');
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
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const token = getToken();
      try {
        if (token) {
          const logoutUrl = `${getApiBase()}/api/logout`;
          await fetch(logoutUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
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

async function searchMembersStrict() {
  const query = document.getElementById('member_search')?.value.trim();
  const suggestions = document.getElementById('autocompleteSuggestions');
  const memberListBody = document.getElementById('memberListBody');
  const errorMessage = document.getElementById('errorMessage');

  if (suggestions) {
    suggestions.innerHTML = '';
    suggestions.style.display = 'none';
  }

  const currentTab = tabActive?.classList.contains('active') ? 'active' : 'inactive';

  if (!query || query.length < 2) {
    await loadMembersStrict(currentTab);
    return;
  }

  try {
    const result = await apiFetch(`/api/members/search?query=${encodeURIComponent(query)}`);

    if (!result.success) {
      throw new Error(result.error || 'Search failed');
    }

    const data = Array.isArray(result.data) ? result.data.filter((m) => (m.status || 'active') === currentTab) : [];
    storeMembers(data);

    if (data.length > 0) {
      if (suggestions) {
        suggestions.style.display = 'block';
        data.forEach((member) => {
          const suggestion = document.createElement('div');
          suggestion.className = 'autocomplete-suggestion';
          suggestion.textContent = `${member.name} (${member.memberId})`;
          suggestion.onclick = () => selectMember(member.memberId, member.name);
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
        memberListBody.innerHTML = '<tr><td colspan="7">No members found</td></tr>';
      } else {
        const tbody = document.getElementById('inactiveListBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7">No members found</td></tr>';
      }
    }
  } catch (error) {
    console.error('Error searching members:', error);
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
  
  const memberListBody = document.getElementById('memberListBody');
  const errorMessage = document.getElementById('errorMessage');

  if (memberListBody) memberListBody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';

  try {
    const result = await apiFetch('/api/members?status=active');
    if (!result.success) throw new Error(result.error || 'Load failed');

    const data = Array.isArray(result.data) ? result.data.filter((m) => (m.status || 'active') === 'active') : [];
    storeMembers(data);

    if (data.length > 0) {
      displayMembersActive(data);
    } else if (memberListBody) {
      memberListBody.innerHTML = '<tr><td colspan="7">No members found</td></tr>';
    }
  } catch (error) {
    console.error('Error loading members:', error);
    if (memberListBody) memberListBody.innerHTML = '<tr><td colspan="7">Error loading members</td></tr>';
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

  const filtered = members.filter((m) => (m.status || 'active') === 'active');

  filtered.forEach((member) => {
    // Only display memberships that are currently active
    const activeMemberships = (member.memberships || []).filter(m => m.status === 'active');
    
    let membershipsText = 'None';
    if (activeMemberships.length > 0) {
      membershipsText = activeMemberships.map((m) => {
        const durationLabel = m.type === 'combative' ? `${m.remainingSessions || m.duration} sessions` : `${m.duration} months`;
        return `${m.type} (${m.status}, ${durationLabel}, ends ${new Date(m.endDate).toLocaleDateString()})`;
      }).join(', ');
    }
      
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${member.memberId}</td>
      <td>${member.name}</td>
      <td>${member.phone || '-'}</td>
      <td>${member.email || '-'}</td>
      <td>${membershipsText}</td>
      <td>${member.status}</td>
      <td>
        <div class="action-buttons">
          <button class="view-button" onclick="openViewDetailsModal('${member.memberId}')">View</button>
          <button class="action-button" onclick="editMemberById('${member.memberId}')">Edit</button>
          <button class="archive-button" onclick="confirmArchive('${member.memberId}')">Archive</button>
        </div>
      </td>
    `;
    memberListBody.appendChild(row);
  });

  if (filtered.length === 0) {
    memberListBody.innerHTML = '<tr><td colspan="7">No members found</td></tr>';
  }
}

async function loadInactiveMembers() {
  const tbody = document.getElementById('inactiveListBody');
  const errorMessage = document.getElementById('errorMessage');

  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';

  try {
    const result = await apiFetch('/api/members?status=inactive');
    if (!result.success) throw new Error(result.error || 'Load failed');

    const data = Array.isArray(result.data) ? result.data.filter((m) => (m.status || 'active') === 'inactive') : [];
    storeMembers(data);

    tbody.innerHTML = '';
    if (data.length > 0) {
      displayMembersInactive(data);
    } else {
      tbody.innerHTML = '<tr><td colspan="7">No inactive members</td></tr>';
    }
  } catch (error) {
    console.error('Error loading inactive members:', error);
    tbody.innerHTML = '<tr><td colspan="7">Error loading inactive members</td></tr>';
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

  const filtered = members.filter((m) => (m.status || 'active') === 'inactive');

  filtered.forEach((member) => {
    let membershipsText = 'None';
    
    // Sort memberships to find the most recent one (the last one they had)
    if (member.memberships && member.memberships.length > 0) {
      const latestMembership = [...member.memberships].sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0];
      const durationLabel = latestMembership.type === 'combative' ? `${latestMembership.remainingSessions || latestMembership.duration} sessions` : `${latestMembership.duration} months`;
      const isExpired = new Date(latestMembership.endDate) < new Date();
      const verb = isExpired ? 'ended' : 'ends';
      
      membershipsText = `${latestMembership.type} (${latestMembership.status}, ${durationLabel}, ${verb} ${new Date(latestMembership.endDate).toLocaleDateString()})`;
    }

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${member.memberId}</td>
      <td>${member.name}</td>
      <td>${member.phone || '-'}</td>
      <td>${member.email || '-'}</td>
      <td>${membershipsText}</td>
      <td>${member.status}</td>
      <td>
        <div class="action-buttons">
          <button class="view-button" onclick="openViewDetailsModal('${member.memberId}')">View</button>
          <button class="action-button" onclick="openRenewalModal('${member.memberId}')">Activate</button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No inactive members</td></tr>';
  }
}

// ------------------------------
// Modals & Action Flows
// ------------------------------

function openViewDetailsModal(memberId) {
    const member = allMembersMap.get(memberId);
    if (!member) return;

    const modal = document.getElementById('viewDetailsModal');
    const body = document.getElementById('viewDetailsBody');

    // Format dates safely
    const dob = member.dob ? new Date(member.dob).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
    const joinDate = member.joinDate ? new Date(member.joinDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';

    // Safely handle emergency contact
    const ec = member.emergencyContact || {};
    const ecName = ec.name || 'Not provided';
    const ecPhone = ec.phone || 'Not provided';
    const ecRel = ec.relation || 'Not provided';

    body.innerHTML = `
        <div class="details-grid">
            <div class="detail-group">
                <h4>Full Name</h4>
                <p>${member.name}</p>
            </div>
            <div class="detail-group">
                <h4>Member ID</h4>
                <p>${member.memberId}</p>
            </div>
            <div class="detail-group">
                <h4>Email</h4>
                <p>${member.email || 'Not provided'}</p>
            </div>
            <div class="detail-group">
                <h4>Phone</h4>
                <p>${member.phone || 'Not provided'}</p>
            </div>
            <div class="detail-group">
                <h4>Gender</h4>
                <p>${member.gender || 'Not specified'}</p>
            </div>
            <div class="detail-group">
                <h4>Date of Birth</h4>
                <p>${dob}</p>
            </div>
            <div class="detail-group full-width">
                <h4>Address</h4>
                <p>${member.address || 'Not provided'}</p>
            </div>
            <div class="detail-group full-width warning-accent">
                <h4 style="color: #ffbe18;">Emergency Contact</h4>
                <p>${ecName} (${ecRel}) <br> <span style="color: #ccc; font-size: 0.95rem;">${ecPhone}</span></p>
            </div>
            <div class="detail-group">
                <h4>Join Date</h4>
                <p>${joinDate}</p>
            </div>
            <div class="detail-group">
                <h4>Face Enrolled</h4>
                <p>${member.faceEnrolled ? '<span class="status-active">Yes</span>' : '<span class="status-inactive">No</span>'}</p>
            </div>
        </div>
    `;

    modal.style.display = 'flex';
}

function setupModals() {
    const archiveModal = document.getElementById('archiveConfirmModal');
    const closeArchiveBtn = document.getElementById('closeArchiveModalBtn');
    const cancelArchiveBtn = document.getElementById('cancelArchiveBtn');
    const confirmArchiveBtn = document.getElementById('confirmArchiveBtn');

    if(closeArchiveBtn) closeArchiveBtn.addEventListener('click', () => archiveModal.style.display = 'none');
    if(cancelArchiveBtn) cancelArchiveBtn.addEventListener('click', () => archiveModal.style.display = 'none');
    
    if(confirmArchiveBtn) {
        confirmArchiveBtn.addEventListener('click', async () => {
            const memberId = confirmArchiveBtn.getAttribute('data-id');
            await archiveMember(memberId, 'inactive');
            archiveModal.style.display = 'none';
        });
    }

    const renewalModal = document.getElementById('renewalModal');
    const closeRenewalBtn = document.getElementById('closeRenewalBtn');
    if(closeRenewalBtn) closeRenewalBtn.addEventListener('click', () => renewalModal.style.display = 'none');

    // NEW: View Details Modal
    const viewDetailsModal = document.getElementById('viewDetailsModal');
    const closeViewDetailsBtn = document.getElementById('closeViewDetailsBtn');
    if(closeViewDetailsBtn) closeViewDetailsBtn.addEventListener('click', () => viewDetailsModal.style.display = 'none');

    window.addEventListener('click', (e) => {
        if (e.target === archiveModal) archiveModal.style.display = 'none';
        if (e.target === renewalModal) renewalModal.style.display = 'none';
        if (e.target === viewDetailsModal) viewDetailsModal.style.display = 'none';
    });
}

function confirmArchive(memberId) {
    const archiveModal = document.getElementById('archiveConfirmModal');
    const confirmBtn = document.getElementById('confirmArchiveBtn');
    if (confirmBtn) confirmBtn.setAttribute('data-id', memberId);
    if (archiveModal) archiveModal.style.display = 'flex';
}

async function archiveMember(memberId, status) {
  const successMessage = document.getElementById('successMessage');
  const errorMessage = document.getElementById('errorMessage');

  try {
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
      await loadMembersStrict('active'); 
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
// Renewal & Activation Flow
// ------------------------------
function openRenewalModal(memberId) {
    const member = allMembersMap.get(memberId);
    if (!member) return;
    
    selectedMemberForRenewal = member;
    const modal = document.getElementById('renewalModal');
    const memberInfoCard = document.getElementById('memberInfoCard');
    const renewalForm = document.getElementById('renewalForm');
    
    // Reset Form
    if (renewalForm) renewalForm.reset();
    document.getElementById('renewMonthlyDetails').style.display = 'none';
    document.getElementById('renewCombativeDetails').style.display = 'none';
    document.getElementById('renewalInfoBox').style.display = 'none';
    
    const today = new Date();
    const renewalDateInput = document.getElementById('renewalDate');
    if (renewalDateInput) renewalDateInput.valueAsDate = today;

    // Populate member card
    let membershipHTML = '';
    if (member.memberships && member.memberships.length > 0) {
        membershipHTML = member.memberships.map((m) => {
            const endDate = new Date(m.endDate);
            const isExpired = endDate < new Date();
            return `
            <div class="membership-item ${isExpired ? 'expired' : m.status}">
                <span class="membership-type">${m.type.toUpperCase()}</span>
                <span class="membership-status">${m.status}</span>
                <span class="membership-date">Expires: ${formatDate(endDate)}</span>
            </div>`;
        }).join('');
    } else {
        membershipHTML = '<p style="color: #ccc; margin-top: 10px;">No existing memberships found.</p>';
    }

    if (memberInfoCard) {
        memberInfoCard.innerHTML = `
            <h4><i class="fas fa-user-circle"></i> ${member.name}</h4>
            <p><strong>Member ID:</strong> ${member.memberId}</p>
            <p><strong>Status:</strong> <span class="status-badge status-${member.status}">${member.status}</span></p>
            <div style="margin-top: 10px;">
                <strong>Current Memberships:</strong>
                ${membershipHTML}
            </div>
        `;
    }

    if (modal) modal.style.display = 'flex';
}

function setupRenewalForm() {
  const renewMonthly = document.getElementById('renewMonthly');
  const renewCombative = document.getElementById('renewCombative');
  
  if (renewMonthly) {
    renewMonthly.addEventListener('change', function () {
      document.getElementById('renewMonthlyDetails').style.display = this.checked ? 'block' : 'none';
      updateRenewalInfo();
    });
  }
  if (renewCombative) {
    renewCombative.addEventListener('change', function () {
      document.getElementById('renewCombativeDetails').style.display = this.checked ? 'block' : 'none';
      updateRenewalInfo();
    });
  }

  const renewalDate = document.getElementById('renewalDate');
  const renewMonthlyDuration = document.getElementById('renewMonthlyDuration');
  const renewCombativeSessions = document.getElementById('renewCombativeSessions');
  if (renewalDate) renewalDate.addEventListener('change', updateRenewalInfo);
  if (renewMonthlyDuration) renewMonthlyDuration.addEventListener('input', updateRenewalInfo);
  if (renewCombativeSessions) renewCombativeSessions.addEventListener('input', updateRenewalInfo);

  const renewalForm = document.getElementById('renewalForm');
  if (renewalForm) {
    renewalForm.addEventListener('submit', handleRenewal);
  }
}

function updateRenewalInfo() {
  if (!selectedMemberForRenewal) return;

  const renewalDateInput = document.getElementById('renewalDate');
  if (!renewalDateInput?.value) return;

  const renewalDate = new Date(renewalDateInput.value);
  const monthlyChecked = document.getElementById('renewMonthly').checked;
  const combativeChecked = document.getElementById('renewCombative').checked;
  const infoBox = document.getElementById('renewalInfoBox');

  if (!monthlyChecked && !combativeChecked) {
    if (infoBox) infoBox.style.display = 'none';
    return;
  }

  let infoHTML = '<strong><i class="fas fa-info-circle"></i> Renewal Summary:</strong><br><br>';

  if (monthlyChecked) {
    const duration = parseInt(document.getElementById('renewMonthlyDuration').value) || 1;
    const currentMembership = selectedMemberForRenewal.memberships?.find(m => m.type === 'monthly');
    const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, duration, 'monthly');

    infoHTML += `
      <div style="margin-bottom: 10px;">
        <strong>Monthly Membership:</strong><br>
        <span style="color: #ccc; font-size: 0.9rem;">Start Date: ${formatDate(renewalDate)}</span><br>
        <span style="color: #ccc; font-size: 0.9rem;">End Date: ${formatDate(endDate)}</span><br>
        <span style="color: #ccc; font-size: 0.9rem;">Duration: ${duration} month(s)</span>
      </div>
    `;
  }

  if (combativeChecked) {
    const sessions = parseInt(document.getElementById('renewCombativeSessions').value) || 12;
    const currentMembership = selectedMemberForRenewal.memberships?.find(m => m.type === 'combative');
    const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, 1, 'combative');

    infoHTML += `
      <div>
        <strong>Combative Membership:</strong><br>
        <span style="color: #ccc; font-size: 0.9rem;">Start Date: ${formatDate(renewalDate)}</span><br>
        <span style="color: #ccc; font-size: 0.9rem;">End Date: ${formatDate(endDate)}</span><br>
        <span style="color: #ccc; font-size: 0.9rem;">Sessions: ${sessions}</span>
      </div>
    `;
  }

  if (infoBox) {
    infoBox.innerHTML = infoHTML;
    infoBox.style.display = 'block';
  }
}

function calculateNewEndDate(renewalDate, currentEndDateStr, durationMonths, membershipType) {
  const renewal = new Date(renewalDate);
  const currentEnd = currentEndDateStr ? new Date(currentEndDateStr) : null;

  if (membershipType === 'combative' && currentEnd) {
    const twoMonthsAgo = new Date(renewal);
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    if (currentEnd < twoMonthsAgo) {
      const newEnd = new Date(renewal);
      newEnd.setMonth(newEnd.getMonth() + durationMonths);
      return newEnd;
    }
  }

  if (currentEnd && renewal < currentEnd) {
    const newEnd = new Date(currentEnd);
    newEnd.setMonth(newEnd.getMonth() + durationMonths);
    return newEnd;
  } else {
    const newEnd = new Date(renewal);
    newEnd.setMonth(newEnd.getMonth() + durationMonths);
    return newEnd;
  }
}
//Renews membership / activate archived member
async function handleRenewal(e) {
  e.preventDefault();

  if (!selectedMemberForRenewal) return;

  const monthlyChecked = document.getElementById('renewMonthly').checked;
  const combativeChecked = document.getElementById('renewCombative').checked;

  if (!monthlyChecked && !combativeChecked) {
    alert('Please select at least one membership type to renew');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn?.innerHTML;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
  }

  try {
    const renewalDate = new Date(document.getElementById('renewalDate').value);
    const updatedMemberships = [];

    // Keep non-selected existing memberships so we don't accidentally delete them
    if (selectedMemberForRenewal.memberships) {
      selectedMemberForRenewal.memberships.forEach((m) => {
        if (m.type === 'monthly' && !monthlyChecked) {
          updatedMemberships.push(m);
        } else if (m.type === 'combative' && !combativeChecked) {
          updatedMemberships.push(m);
        }
      });
    }

    if (monthlyChecked) {
      const duration = parseInt(document.getElementById('renewMonthlyDuration').value) || 1;
      const currentMembership = selectedMemberForRenewal.memberships?.find(m => m.type === 'monthly');
      const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, duration, 'monthly');

      updatedMemberships.push({
        type: 'monthly',
        duration: duration,
        startDate: renewalDate.toISOString(),
        endDate: endDate.toISOString(),
        status: 'active',
      });
    }

    if (combativeChecked) {
      const duration = parseInt(document.getElementById('renewCombativeDuration').value) || 1;
      const currentMembership = selectedMemberForRenewal.memberships?.find(m => m.type === 'combative');
      const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, duration, 'combative');

      updatedMemberships.push({
        type: 'combative',
        duration: duration,
        remainingSessions: duration * 12,
        startDate: renewalDate.toISOString(),
        endDate: endDate.toISOString(),
        status: 'active',
      });
    }

    // Call the renew endpoint
    const result = await apiFetch(`/api/members/${selectedMemberForRenewal._id}/renew`, {
      method: 'PUT',
      body: JSON.stringify({
        memberships: updatedMemberships,
        status: 'active', // Important: This switches them out of the inactive list
      }),
    });

    if (result.success) {
      const successMessage = document.getElementById('successMessage');
      if (successMessage) {
          successMessage.textContent = 'Member successfully activated and renewed!';
          successMessage.style.display = 'block';
          setTimeout(() => successMessage.style.display = 'none', 5000);
      }
      
      document.getElementById('renewalModal').style.display = 'none';
      await loadMembersStrict('inactive'); // Refresh list to show they moved
    } else {
      throw new Error(result.error || 'Failed to renew membership');
    }
  } catch (error) {
    const errorMessage = document.getElementById('errorMessage');
    if (errorMessage) {
        errorMessage.textContent = 'Error: ' + error.message;
        errorMessage.style.display = 'block';
        setTimeout(() => errorMessage.style.display = 'none', 5000);
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  }
}
// ------------------------------
// Edit member flow (UPDATED)
// ------------------------------
function editMemberById(memberId) {
    const member = allMembersMap.get(memberId);
    if (!member) return;
    
    const memberListSection = document.getElementById('memberListSection');
    const editMemberSection = document.getElementById('editMemberSection');
    if (memberListSection) memberListSection.classList.remove('active');
    if (editMemberSection) editMemberSection.classList.add('active');

    document.getElementById('edit_member_id').value = member.memberId;
    document.getElementById('edit_name').value = member.name;
    
    // Clean up placeholders like '-' from the database so they don't trigger backend 400 validation errors
    document.getElementById('edit_phone').value = (member.phone && member.phone !== '-') ? member.phone : '';
    document.getElementById('edit_email').value = (member.email && member.email !== '-') ? member.email : '';

    const membershipsContainer = document.getElementById('membershipsContainer');
    if (!membershipsContainer) return;
    membershipsContainer.innerHTML = '';

    // Find ONLY active memberships to edit
    const activeMemberships = (member.memberships || []).filter(m => m.status === 'active');

    if (activeMemberships.length > 0) {
      activeMemberships.forEach((membership) => {
        // We need the original index to update the correct item in the main array later
        const originalIndex = member.memberships.indexOf(membership);
        createActiveMembershipEditField(membership, originalIndex);
      });
    } else {
      membershipsContainer.innerHTML = '<p style="color: #ccc; font-style: italic;">No active memberships to edit.</p>';
    }
}

// New function to create fixed edit fields for active memberships only
function createActiveMembershipEditField(membership, index) {
  const membershipsContainer = document.getElementById('membershipsContainer');
  if (!membershipsContainer) return;

  const membershipDiv = document.createElement('div');
  membershipDiv.className = 'membership-container active-edit-container';
  // Store original index in a data attribute for submission logic
  membershipDiv.dataset.originalIndex = index;

  const startDateValue = membership.startDate ? new Date(membership.startDate).toISOString().split('T')[0] : '';
  const startDateDisplayValue = startDateValue ? formatDate(startDateValue) : ''; // Format for the dummy text box
  const durationValue = membership.duration || 1; // Default to existing duration or 1

  membershipDiv.innerHTML = `
    <h4>Editing Active Membership (${membership.type.toUpperCase()})</h4>
    
    <div class="form-group">
      <label for="membership_type_${index}">Membership Type:</label>
      <select id="membership_type_${index}" class="edit-type-select" required>
        <option value="monthly" ${membership.type === 'monthly' ? 'selected' : ''}>Monthly</option>
        <option value="combative" ${membership.type === 'combative' ? 'selected' : ''}>Combative</option>
      </select>
    </div>

    <div class="form-group">
      <label>Start Date:</label>
      <div style="position: relative; display: flex; align-items: center; width: 100%; border-radius: 4px;">
        <input type="text" id="membership_start_date_display_${index}" value="${startDateDisplayValue}" readonly placeholder="Select start date" required
               style="width: 100%; background: #000305; color: #ffffff; padding: 1rem 3rem 1rem 1.2rem; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; font-family: 'Poppins', sans-serif; font-size: 1rem; box-sizing: border-box; cursor: pointer;"
               onclick="try { document.getElementById('membership_start_date_${index}').showPicker(); } catch(e) {}">
               
        <i class="fas fa-calendar-alt" style="position: absolute; right: 1.2rem; color: #ebebeb; z-index: 5; font-size: 1.1rem; pointer-events: none;"></i>
        
        <input type="date" id="membership_start_date_${index}" class="edit-start-date" value="${startDateValue}" required
               style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; opacity: 0; z-index: 10; cursor: pointer; box-sizing: border-box; margin: 0; padding: 0;"
               onclick="try { this.showPicker(); } catch(e) {}">
      </div>
    </div>

    <div class="form-group">
      <label for="membership_duration_${index}">Duration (months):</label>
      <input type="number" id="membership_duration_${index}" class="edit-duration" value="${durationValue}" min="1" required>
    </div>

    <div class="form-group" style="background: rgba(255, 51, 51, 0.1); padding: 12px; border-left: 3px solid #ff3333; border-radius: 4px; margin-top: 15px;">
      <strong style="color: #ccc;"><i class="fas fa-calendar-check"></i> Expected End Date: </strong> 
      <span id="membership_end_date_display_${index}" style="color: #fff; font-weight: bold; font-size: 1.05rem;"></span>
    </div>

     <input type="hidden" id="original_type_${index}" value="${membership.type}">
  `;
  membershipsContainer.appendChild(membershipDiv);

  const typeSelect = membershipDiv.querySelector('.edit-type-select');
  const startDateInput = membershipDiv.querySelector('.edit-start-date');
  const displayInput = membershipDiv.querySelector(`#membership_start_date_display_${index}`);
  const durationInput = membershipDiv.querySelector('.edit-duration');
  const endDateDisplay = membershipDiv.querySelector(`#membership_end_date_display_${index}`);

  // --- Expected End Date Math ---
  function updateEndDate() {
     const start = new Date(startDateInput.value);
     if (isNaN(start.getTime())) {
         endDateDisplay.textContent = 'Invalid Date';
         return;
     }
     const dur = parseInt(durationInput.value) || 1;
     
     // Add duration (months) to start date
     const end = new Date(start);
     end.setMonth(end.getMonth() + dur);
     
     endDateDisplay.textContent = end.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // Update text box and End Date whenever calendar selection changes
  startDateInput.addEventListener('change', () => {
      if (startDateInput.value) {
          displayInput.value = formatDate(startDateInput.value);
      } else {
          displayInput.value = '';
      }
      updateEndDate(); // Triggers Expected End Date instantly
  });

  // Handle immediate input triggers for compatible browsers
  startDateInput.addEventListener('input', () => {
      if (startDateInput.value) {
          displayInput.value = formatDate(startDateInput.value);
          updateEndDate();
      }
  });

  typeSelect.addEventListener('change', updateEndDate);
  durationInput.addEventListener('input', updateEndDate);
  
  // Initial calculation on load
  updateEndDate();
}

// ------------------------------
// Edit form submit (UPDATED)
// ------------------------------
const editForm = document.getElementById('editMemberForm');
if (editForm) {
  editForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    
    const memberIdStr = document.getElementById('edit_member_id').value;
    const originalMember = allMembersMap.get(memberIdStr);
    if(!originalMember) {
        alert("Error finding member data.");
        return;
    }

    const name = document.getElementById('edit_name').value.trim();
    const phone = document.getElementById('edit_phone').value.trim();
    const email = document.getElementById('edit_email').value.trim().toLowerCase();

    // Deep clone memberships to prevent mutating cached frontend data
    let updatedMemberships = JSON.parse(JSON.stringify(originalMember.memberships || []));
    let hasInvalidDate = false;

    // Iterate over the active edit fields within the container
    document.querySelectorAll('.active-edit-container').forEach((container) => {
      const index = parseInt(container.dataset.originalIndex);
      const newType = container.querySelector('.edit-type-select').value;
      const newStartDate = container.querySelector('.edit-start-date').value;
      const newDuration = parseInt(container.querySelector('.edit-duration').value) || 1;
      const originalType = container.querySelector(`#original_type_${index}`).value;

      if (!newStartDate) {
          hasInvalidDate = true;
      }

      if (updatedMemberships[index] && newStartDate) {
          // Update fields
          updatedMemberships[index].type = newType;
          updatedMemberships[index].startDate = new Date(newStartDate).toISOString();
          updatedMemberships[index].duration = newDuration;

          // Calculate end date based on duration
          const end = new Date(newStartDate);
          end.setMonth(end.getMonth() + newDuration);
          updatedMemberships[index].endDate = end.toISOString();

          // Map sessions if switching from monthly to combative
          if (originalType === 'monthly' && newType === 'combative') {
              updatedMemberships[index].remainingSessions = newDuration * 12;
          } else if (newType === 'monthly') {
              updatedMemberships[index].remainingSessions = 0;
          }
      }
    });

    if (hasInvalidDate) {
        const errorMessage = document.getElementById('errorMessage');
        if (errorMessage) {
            errorMessage.textContent = 'Please select a valid start date for all memberships.';
            errorMessage.style.display = 'block';
            setTimeout(() => (errorMessage.style.display = 'none'), 5000);
        }
        return;
    }

    const updateData = { 
        name,
        phone,
        email,
        memberships: updatedMemberships 
    };

    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');

    try {
      // Manual fetch call instead of apiFetch to accurately catch and display specific 400 validation errors
      const token = AdminStore.getToken();
      const response = await fetch(`${getApiBase()}/api/members/${originalMember._id}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        if (successMessage) {
          successMessage.textContent = result.message || 'Member updated successfully!';
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
        errorMessage.textContent = 'Validation Error: ' + error.message;
        errorMessage.style.display = 'block';
        setTimeout(() => (errorMessage.style.display = 'none'), 6000);
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