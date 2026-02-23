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

if (tabActive) {
  tabActive.addEventListener('click', () => {
    tabActive.classList.add('active');
    if (tabInactive) tabInactive.classList.remove('active');
    if (memberListSection) memberListSection.classList.add('active');
    if (inactiveListSection) inactiveListSection.classList.remove('active');
    loadMembersStrict('active'); 
  });
}
if (tabInactive) {
  tabInactive.addEventListener('click', async () => {
    tabInactive.classList.add('active');
    if (tabActive) tabActive.classList.remove('active');
    if (inactiveListSection) inactiveListSection.classList.add('active');
    if (memberListSection) memberListSection.classList.remove('active');
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
    const memberships = (member.memberships || [])
      .map((m) => {
        const durationLabel = m.type === 'combative' ? `${m.remainingSessions || m.duration} sessions` : `${m.duration} months`;
        return `${m.type} (${m.status}, ${durationLabel}, ends ${new Date(m.endDate).toLocaleDateString()})`;
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
        <button class="action-button" onclick="editMemberById('${member.memberId}')">Edit</button>
        <button class="archive-button" onclick="confirmArchive('${member.memberId}')">Archive</button>
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
    const memberships = (member.memberships || [])
      .map((m) => {
        const durationLabel = m.type === 'combative' ? `${m.remainingSessions || m.duration} sessions` : `${m.duration} months`;
        return `${m.type} (${m.status}, ${durationLabel}, ends ${new Date(m.endDate).toLocaleDateString()})`;
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
        <button class="action-button" onclick="openRenewalModal('${member.memberId}')">Activate</button>
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

    window.addEventListener('click', (e) => {
        if (e.target === archiveModal) archiveModal.style.display = 'none';
        if (e.target === renewalModal) renewalModal.style.display = 'none';
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

    // Keep non-selected existing memberships
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
      const sessions = parseInt(document.getElementById('renewCombativeSessions').value) || 12;
      const currentMembership = selectedMemberForRenewal.memberships?.find(m => m.type === 'combative');
      const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, 1, 'combative');

      updatedMemberships.push({
        type: 'combative',
        duration: sessions,
        remainingSessions: sessions,
        startDate: renewalDate.toISOString(),
        endDate: endDate.toISOString(),
        status: 'active',
      });
    }

    // Call the same update endpoint used in add-member
    const result = await apiFetch(`/api/members/${selectedMemberForRenewal._id}`, {
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
      await loadMembersStrict('inactive'); // Refresh list
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
// Edit member flow
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