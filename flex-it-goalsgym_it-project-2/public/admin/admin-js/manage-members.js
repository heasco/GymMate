// --- Theme Init & Real-Time Sync ---
function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.classList.add('light-mode');
        document.body.classList.add('light-mode');
    } else {
        document.documentElement.classList.remove('light-mode');
        document.body.classList.remove('light-mode');
    }
}

// 1. Apply immediately when the dashboard loads
applyTheme(localStorage.getItem('admin_theme'));

// 2. Listen for changes
window.addEventListener('storage', (e) => {
    if (e.key === 'admin_theme') applyTheme(e.newValue);
});


const SERVER_URL = 'http://localhost:8080';
let debounceTimeout;
const allMembersMap = new Map();
let selectedMemberForRenewal = null;
let activeProducts = []; 

// Pagination State
let currentPage = 1;
let pageSize = 25;

// --- Admin Auth Boilerplate ---
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const ADMIN_KEYS = { token: 'admin_token', authUser: 'admin_authUser', role: 'admin_role', logoutEvent: 'adminLogoutEvent' };

const AdminStore = {
  set(token, userPayload) {
    try {
      const authUser = { ...(userPayload || {}), timestamp: Date.now(), role: 'admin', token };
      localStorage.setItem(ADMIN_KEYS.token, token); localStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser)); localStorage.setItem(ADMIN_KEYS.role, 'admin');
      sessionStorage.setItem(ADMIN_KEYS.token, token); sessionStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser)); sessionStorage.setItem(ADMIN_KEYS.role, 'admin');
    } catch (e) { console.error(e); }
  },
  getToken() { return sessionStorage.getItem(ADMIN_KEYS.token) || localStorage.getItem(ADMIN_KEYS.token) || null; },
  getAuthUser() {
    const raw = sessionStorage.getItem(ADMIN_KEYS.authUser) || localStorage.getItem(ADMIN_KEYS.authUser);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  },
  hasSession() {
    return ((localStorage.getItem(ADMIN_KEYS.token) || sessionStorage.getItem(ADMIN_KEYS.token)) &&
            ((localStorage.getItem(ADMIN_KEYS.role) || sessionStorage.getItem(ADMIN_KEYS.role)) === 'admin'));
  },
  clear() {
    localStorage.removeItem(ADMIN_KEYS.token); localStorage.removeItem(ADMIN_KEYS.authUser); localStorage.removeItem(ADMIN_KEYS.role);
    sessionStorage.removeItem(ADMIN_KEYS.token); sessionStorage.removeItem(ADMIN_KEYS.authUser); sessionStorage.removeItem(ADMIN_KEYS.role);
  },
};

function adminLogout(reason, loginPath = '../login.html') {
  AdminStore.clear();
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = loginPath;
}

function ensureAdminAuthOrLogout(loginPath) {
  try {
    if (!AdminStore.hasSession()) { adminLogout('missing admin session', loginPath); return false; }
    const authUser = AdminStore.getAuthUser();
    if (!authUser || authUser.role !== 'admin') { adminLogout('invalid authUser', loginPath); return false; }
    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);
    return true;
  } catch (e) { return false; }
}

function requireAuth(expectedRole, loginPath) { return ensureAdminAuthOrLogout(loginPath); }

async function apiFetch(endpoint, options = {}) {
  if (!ensureAdminAuthOrLogout('../login.html')) return;
  const token = AdminStore.getToken();
  const url = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? `${SERVER_URL}${endpoint}` : endpoint;
  const headers = { ...options.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) { adminLogout(); return; }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// ------------------------------
// Utility functions
// ------------------------------
function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function storeMembers(members) { members.forEach(m => allMembersMap.set(m.memberId, m)); }

async function fetchActiveProducts() {
    try {
      const result = await apiFetch('/api/products?status=active');
      activeProducts = result.data || [];
    } catch (error) { console.error('Failed to load products:', error); }
}

function getCurrentTab() {
  const tabActive = document.getElementById('tabActive');
  return tabActive?.classList.contains('active') ? 'active' : 'inactive';
}

// ------------------------------
// Initialization & Tab Elements
// ------------------------------
const tabActive = document.getElementById('tabActive');
const tabInactive = document.getElementById('tabInactive');
const memberListSection = document.getElementById('memberListSection');
const inactiveListSection = document.getElementById('inactiveListSection');
const editMemberSection = document.getElementById('editMemberSection'); 

if (tabActive) {
  tabActive.addEventListener('click', () => {
    tabActive.classList.add('active');
    if (tabInactive) tabInactive.classList.remove('active');
    if (memberListSection) memberListSection.classList.add('active');
    if (inactiveListSection) inactiveListSection.classList.remove('active');
    if (editMemberSection) editMemberSection.classList.remove('active'); 
    
    currentPage = 1; // Reset to page 1 on switch
    loadMembersStrict('active'); 
  });
}

if (tabInactive) {
  tabInactive.addEventListener('click', async () => {
    tabInactive.classList.add('active');
    if (tabActive) tabActive.classList.remove('active');
    if (inactiveListSection) inactiveListSection.classList.add('active');
    if (memberListSection) memberListSection.classList.remove('active');
    if (editMemberSection) editMemberSection.classList.remove('active'); 
    
    currentPage = 1; // Reset to page 1 on switch
    await loadMembersStrict('inactive'); 
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth('admin', '../login.html')) return;
  setupSidebarAndSession();
  setupModals();
  await fetchActiveProducts(); 
  setupRenewalForm();
  await checkServerConnection();
  
  setupPagination();
  setupSearchListener();

  const statusFilter = document.getElementById('status_filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      currentPage = 1; // Reset to page 1 on filter
      loadMembersStrict(getCurrentTab());
    });
  }

  await loadMembersStrict('active'); 
});

function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');
  const adminNameEl = document.getElementById('adminFullName');
  
  if (adminNameEl) {
    const authUser = AdminStore.getAuthUser();
    adminNameEl.textContent = authUser?.name ? authUser.name : 'Admin';
  }
  if (menuToggle && sidebar) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  if (logoutBtn) logoutBtn.addEventListener('click', adminLogout);
}

async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  if (!statusElement) return;
  try {
    const result = await apiFetch('/health');
    if (result) {
      statusElement.textContent = 'Connected to server successfully';
      statusElement.className = 'server-status server-connected';
    } else throw new Error('Health check failed');
  } catch (error) {
    statusElement.textContent = 'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
  }
}

// ------------------------------
// Search + debounce
// ------------------------------
function setupSearchListener() {
  const searchInput = document.getElementById('member_search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      currentPage = 1; // Reset to page 1 on new search
      loadMembersStrict(getCurrentTab());
    }, 400));
  }
}

function debounce(func, wait) {
  return function (...args) {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ------------------------------
// Pagination Logic
// ------------------------------
function setupPagination() {
  const pageSizeSelect = document.getElementById('pageSize');
  const prevPageBtn = document.getElementById('prevPage');
  const nextPageBtn = document.getElementById('nextPage');

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
      pageSize = parseInt(e.target.value, 10);
      currentPage = 1;
      loadMembersStrict(getCurrentTab());
    });
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadMembersStrict(getCurrentTab());
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      currentPage++;
      loadMembersStrict(getCurrentTab());
    });
  }
}

function updatePaginationUI(pagination) {
  const prevPageBtn = document.getElementById('prevPage');
  const nextPageBtn = document.getElementById('nextPage');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!pagination) return;
  const { page, pages, total } = pagination;
  const totalPages = pages > 0 ? pages : 1;
  
  if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages} (${total} total)`;
  if (prevPageBtn) prevPageBtn.disabled = page <= 1;
  if (nextPageBtn) nextPageBtn.disabled = page >= totalPages;
}

// ------------------------------
// Member Loading & Display
// ------------------------------
async function loadMembersStrict(status) {
  const tbody = status === 'active' ? document.getElementById('memberListBody') : document.getElementById('inactiveListBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="text-align:center;">Loading...</td></tr>`;
  
  const query = document.getElementById('member_search')?.value.trim();
  
  let url = `/api/members?status=${status}&page=${currentPage}&limit=${pageSize}`;
  if (query) {
    url += `&search=${encodeURIComponent(query)}`;
  }

  try {
    const result = await apiFetch(url);
    const data = Array.isArray(result.data) ? result.data : [];
    storeMembers(data);
    
    if (data.length > 0) {
      status === 'active' ? displayMembersActive(data) : displayMembersInactive(data);
    } else {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No ${status} members found</td></tr>`;
    }
    
    updatePaginationUI(result.pagination);
  } catch (error) {
    console.error("Error loading members:", error);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Error loading members</td></tr>`;
  }
}

function displayMembersActive(members) {
  const tbody = document.getElementById('memberListBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const filtered = members.filter((m) => (m.status || 'active') === 'active');
  filtered.forEach((member) => {
    const activeMemberships = (member.memberships || []).filter(m => m.status === 'active');
    let membershipsText = activeMemberships.length > 0 ? activeMemberships.map((m) => {
        const durationLabel = ['combative', 'dance'].includes(m.type) ? `${m.remainingSessions || m.duration} sessions` : `${m.duration} months`;
        return `${m.type} (${m.status}, ${durationLabel}, ends ${new Date(m.endDate).toLocaleDateString()})`;
    }).join(', ') : 'None';
      
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${member.memberId}</td><td>${member.name}</td><td>${member.phone || '-'}</td>
      <td>${member.email || '-'}</td><td>${membershipsText}</td>
      <td><span class="status-badge status-${member.status}">${member.status}</span></td>
      <td>
        <div class="action-buttons">
          <button class="view-button" onclick="openViewDetailsModal('${member.memberId}')">View</button>
          <button class="action-button" onclick="editMemberById('${member.memberId}')">Edit</button>
          <button class="archive-button" onclick="confirmArchive('${member.memberId}')">Archive</button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function displayMembersInactive(members) {
  const tbody = document.getElementById('inactiveListBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  members.forEach((member) => {
    let membershipsText = 'None';
    if (member.memberships && member.memberships.length > 0) {
      const m = [...member.memberships].sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0];
      const durationLabel = ['combative', 'dance'].includes(m.type) ? `${m.remainingSessions || m.duration} sessions` : `${m.duration} months`;
      const verb = new Date(m.endDate) < new Date() ? 'ended' : 'ends';
      membershipsText = `${m.type} (${m.status}, ${durationLabel}, ${verb} ${new Date(m.endDate).toLocaleDateString()})`;
    }
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${member.memberId}</td><td>${member.name}</td><td>${member.phone || '-'}</td>
      <td>${member.email || '-'}</td><td>${membershipsText}</td>
      <td><span class="status-badge status-${member.status}">${member.status}</span></td>
      <td>
        <div class="action-buttons">
          <button class="view-button" onclick="openViewDetailsModal('${member.memberId}')">View</button>
          <button class="action-button" onclick="openRenewalModal('${member.memberId}')">Activate</button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ------------------------------
// Modals & Details
// ------------------------------
function openViewDetailsModal(memberId) {
    const member = allMembersMap.get(memberId);
    if (!member) return;
    const dob = member.dob ? new Date(member.dob).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
    const joinDate = member.joinDate ? new Date(member.joinDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
    const ec = member.emergencyContact || {};

    document.getElementById('viewDetailsBody').innerHTML = `
        <div class="details-grid">
            <div class="detail-group"><h4>Full Name</h4><p>${member.name}</p></div>
            <div class="detail-group"><h4>Member ID</h4><p>${member.memberId}</p></div>
            <div class="detail-group"><h4>Email</h4><p>${member.email || 'Not provided'}</p></div>
            <div class="detail-group"><h4>Phone</h4><p>${member.phone || 'Not provided'}</p></div>
            <div class="detail-group"><h4>Gender</h4><p>${member.gender || 'Not specified'}</p></div>
            <div class="detail-group"><h4>Date of Birth</h4><p>${dob}</p></div>
            <div class="detail-group full-width"><h4>Address</h4><p>${member.address || 'Not provided'}</p></div>
            <div class="detail-group full-width warning-accent"><h4 style="color: #ffbe18;">Emergency Contact</h4>
                <p>${ec.name || 'N/A'} (${ec.relation || 'N/A'}) <br> <span style="color: #ccc; font-size: 0.95rem;">${ec.phone || 'N/A'}</span></p></div>
            <div class="detail-group"><h4>Join Date</h4><p>${joinDate}</p></div>
            <div class="detail-group"><h4>Face Enrolled</h4><p>${member.faceEnrolled ? '<span class="status-active">Yes</span>' : '<span class="status-inactive">No</span>'}</p></div>
        </div>
    `;
    document.getElementById('viewDetailsModal').style.display = 'flex';
}

function setupModals() {
    const am = document.getElementById('archiveConfirmModal');
    if(document.getElementById('closeArchiveModalBtn')) document.getElementById('closeArchiveModalBtn').addEventListener('click', () => am.style.display = 'none');
    if(document.getElementById('cancelArchiveBtn')) document.getElementById('cancelArchiveBtn').addEventListener('click', () => am.style.display = 'none');
    if(document.getElementById('confirmArchiveBtn')) {
        document.getElementById('confirmArchiveBtn').addEventListener('click', async (e) => {
            await archiveMember(e.target.getAttribute('data-id'), 'inactive');
            am.style.display = 'none';
        });
    }

    const rm = document.getElementById('renewalModal');
    if(document.getElementById('closeRenewalBtn')) document.getElementById('closeRenewalBtn').addEventListener('click', () => rm.style.display = 'none');

    const vm = document.getElementById('viewDetailsModal');
    if(document.getElementById('closeViewDetailsBtn')) document.getElementById('closeViewDetailsBtn').addEventListener('click', () => vm.style.display = 'none');

    window.addEventListener('click', (e) => {
        if (e.target === am) am.style.display = 'none';
        if (e.target === rm) rm.style.display = 'none';
        if (e.target === vm) vm.style.display = 'none';
    });
}

function confirmArchive(memberId) {
    document.getElementById('confirmArchiveBtn').setAttribute('data-id', memberId);
    document.getElementById('archiveConfirmModal').style.display = 'flex';
}

async function archiveMember(memberId, status) {
  try {
    const result = await apiFetch(`/api/members/${memberId}/archive`, { method: 'PATCH', body: JSON.stringify({ status }) });
    if (result.success) {
      const sm = document.getElementById('successMessage');
      if (sm) { sm.textContent = result.message; sm.style.display = 'block'; setTimeout(() => sm.style.display = 'none', 5000); }
      await loadMembersStrict(getCurrentTab()); 
    }
  } catch (error) {}
}

// ------------------------------
// Renewal Flow (Product + Payment)
// ------------------------------
function openRenewalModal(memberId) {
    const member = allMembersMap.get(memberId);
    if (!member) return;
    
    selectedMemberForRenewal = member;
    if (document.getElementById('renewalForm')) document.getElementById('renewalForm').reset();
    document.getElementById('renewMonthlyDetails').style.display = 'none';
    document.getElementById('renewCombativeDetails').style.display = 'none';
    if(document.getElementById('renewDanceDetails')) document.getElementById('renewDanceDetails').style.display = 'none';
    document.getElementById('renewalProductGroup').style.display = 'none';
    document.getElementById('renewalInfoBox').style.display = 'none';
    
    if (document.getElementById('renewalDate')) document.getElementById('renewalDate').valueAsDate = new Date();

    let membershipHTML = member.memberships && member.memberships.length > 0 ? member.memberships.map((m) => {
            const expired = new Date(m.endDate) < new Date();
            return `<div class="membership-item ${expired ? 'expired' : m.status}">
                <span class="membership-type">${m.type.toUpperCase()}</span><span class="membership-status">${m.status}</span>
                <span class="membership-date">Expires: ${formatDate(m.endDate)}</span></div>`;
        }).join('') : '<p style="color: #ccc;">No existing memberships.</p>';

    const card = document.getElementById('memberInfoCard');
    if (card) {
        card.innerHTML = `<h4><i class="fas fa-user-circle"></i> ${member.name}</h4><p><strong>Member ID:</strong> ${member.memberId}</p>
            <p><strong>Status:</strong> <span class="status-badge status-${member.status}">${member.status}</span></p>
            <div style="margin-top: 10px;"><strong>Current Memberships:</strong>${membershipHTML}</div>`;
    }
    document.getElementById('renewalModal').style.display = 'flex';
}

function setupRenewalForm() {
  const renewMonthly = document.getElementById('renewMonthly');
  const renewCombative = document.getElementById('renewCombative');
  const renewDance = document.getElementById('renewDance');
  
  function toggleRenewDetails() {
    document.getElementById('renewMonthlyDetails').style.display = renewMonthly?.checked ? 'block' : 'none';
    document.getElementById('renewCombativeDetails').style.display = renewCombative?.checked ? 'block' : 'none';
    if(document.getElementById('renewDanceDetails')) document.getElementById('renewDanceDetails').style.display = renewDance?.checked ? 'block' : 'none';
    
    const productGroup = document.getElementById('renewalProductGroup');
    const productSelect = document.getElementById('renewalProductSelect');
    
    if (!renewMonthly?.checked && !renewCombative?.checked && !renewDance?.checked) {
        if (productGroup) productGroup.style.display = 'none';
    } else {
        if (productGroup) productGroup.style.display = 'block';
        if (productSelect) {
            productSelect.innerHTML = '<option value="" disabled selected>Select a product...</option>';
            const validTypes = [];
            if (renewMonthly?.checked) validTypes.push('monthly');
            if (renewCombative?.checked) validTypes.push('combative');
            if (renewDance?.checked) validTypes.push('dance');
            
            const filtered = activeProducts.filter(p => validTypes.includes(p.membership_type));
            if (filtered.length === 0) productSelect.innerHTML = '<option value="" disabled>No products available</option>';
            
            filtered.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p._id; opt.dataset.price = p.price; opt.dataset.name = p.product_name;
                opt.textContent = `${p.product_name} - ₱${p.price.toLocaleString()}`;
                productSelect.appendChild(opt);
            });
        }
    }
    updateRenewalInfo();
  }

  if (renewMonthly) renewMonthly.addEventListener('change', toggleRenewDetails);
  if (renewCombative) renewCombative.addEventListener('change', toggleRenewDetails);
  if (renewDance) renewDance.addEventListener('change', toggleRenewDetails);

  if (document.getElementById('renewalDate')) document.getElementById('renewalDate').addEventListener('change', updateRenewalInfo);
  if (document.getElementById('renewMonthlyDuration')) document.getElementById('renewMonthlyDuration').addEventListener('input', updateRenewalInfo);
  if (document.getElementById('renewCombativeSessions')) document.getElementById('renewCombativeSessions').addEventListener('input', updateRenewalInfo);
  if (document.getElementById('renewDanceSessions')) document.getElementById('renewDanceSessions').addEventListener('input', updateRenewalInfo);

  const renewalForm = document.getElementById('renewalForm');
  if (renewalForm) renewalForm.addEventListener('submit', validateAndShowRenewalPaymentModal);
  setupRenewalPaymentModal();
}

function setupRenewalPaymentModal() {
    const modal = document.getElementById('renewalPaymentModal');
    const closeBtn = document.getElementById('closeRenewalPaymentModalBtn');
    const statusSelect = document.getElementById('renewalPaymentStatusSelect');
    const methodGroup = document.getElementById('renewalPaymentMethodGroup');
    const confirmBtn = document.getElementById('confirmRenewalPaymentBtn');

    if (closeBtn) closeBtn.addEventListener('click', () => { if(modal) modal.style.display = 'none'; });
    if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
            if (methodGroup) methodGroup.style.display = e.target.value === 'paid' ? 'block' : 'none';
        });
    }
    if (confirmBtn) confirmBtn.addEventListener('click', executeRenewalSave);
}

function updateRenewalInfo() {
  if (!selectedMemberForRenewal || !document.getElementById('renewalDate')?.value) return;
  const renewalDate = new Date(document.getElementById('renewalDate').value);
  const monthlyChecked = document.getElementById('renewMonthly').checked;
  const combativeChecked = document.getElementById('renewCombative').checked;
  const danceChecked = document.getElementById('renewDance')?.checked;
  const infoBox = document.getElementById('renewalInfoBox');

  if (!monthlyChecked && !combativeChecked && !danceChecked) { if (infoBox) infoBox.style.display = 'none'; return; }
  let infoHTML = '<strong><i class="fas fa-info-circle"></i> Renewal Summary:</strong><br><br>';

  if (monthlyChecked) {
    const duration = parseInt(document.getElementById('renewMonthlyDuration').value) || 1;
    const currentMembership = selectedMemberForRenewal.memberships?.find(m => m.type === 'monthly');
    const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, duration, 'monthly');
    infoHTML += `<div style="margin-bottom: 10px;"><strong>Monthly Membership:</strong><br><span style="color: #ccc;">Start: ${formatDate(renewalDate)}</span><br><span style="color: #ccc;">End: ${formatDate(endDate)}</span></div>`;
  }
  if (combativeChecked) {
    const sessions = parseInt(document.getElementById('renewCombativeSessions').value) || 12;
    const durationM = Math.ceil(sessions / 12);
    const currentMembership = selectedMemberForRenewal.memberships?.find(m => m.type === 'combative');
    const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, durationM, 'combative');
    infoHTML += `<div><strong>Combative Membership:</strong><br><span style="color: #ccc;">Start: ${formatDate(renewalDate)}</span><br><span style="color: #ccc;">End: ${formatDate(endDate)}</span><br><span style="color: #ccc;">Sessions: ${sessions}</span></div>`;
  }
  if (danceChecked) {
    const sessions = parseInt(document.getElementById('renewDanceSessions').value) || 12;
    const durationM = Math.ceil(sessions / 12);
    const currentMembership = selectedMemberForRenewal.memberships?.find(m => m.type === 'dance');
    const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, durationM, 'dance');
    infoHTML += `<div style="margin-top: 10px;"><strong>Dance Class:</strong><br><span style="color: #ccc;">Start: ${formatDate(renewalDate)}</span><br><span style="color: #ccc;">End: ${formatDate(endDate)}</span><br><span style="color: #ccc;">Sessions: ${sessions}</span></div>`;
  }
  if (infoBox) { infoBox.innerHTML = infoHTML; infoBox.style.display = 'block'; }
}

function calculateNewEndDate(renewalDate, currentEndDateStr, durationMonths, membershipType) {
  const renewal = new Date(renewalDate);
  const currentEnd = currentEndDateStr ? new Date(currentEndDateStr) : null;
  if (['combative', 'dance'].includes(membershipType) && currentEnd) {
    const twoMonthsAgo = new Date(renewal); twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    if (currentEnd < twoMonthsAgo) { const newEnd = new Date(renewal); newEnd.setMonth(newEnd.getMonth() + durationMonths); return newEnd; }
  }
  if (currentEnd && renewal < currentEnd) { const newEnd = new Date(currentEnd); newEnd.setMonth(newEnd.getMonth() + durationMonths); return newEnd; } 
  else { const newEnd = new Date(renewal); newEnd.setMonth(newEnd.getMonth() + durationMonths); return newEnd; }
}

function validateAndShowRenewalPaymentModal(e) {
    e.preventDefault();
    if (!selectedMemberForRenewal) return showMessage('Please select a member first', 'error');
    
    const monthlyChecked = document.getElementById('renewMonthly').checked;
    const combativeChecked = document.getElementById('renewCombative').checked;
    const danceChecked = document.getElementById('renewDance')?.checked;
    if (!monthlyChecked && !combativeChecked && !danceChecked) return showMessage('Please select a membership type to renew', 'error');

    const productSelect = document.getElementById('renewalProductSelect');
    if (!productSelect || !productSelect.value) return showMessage('Please select a Product/Plan', 'error');

    const selectedOpt = productSelect.options[productSelect.selectedIndex];
    const price = parseFloat(selectedOpt.dataset.price);

    const summaryText = document.getElementById('renewalPaymentSummaryText');
    if(summaryText) {
        summaryText.innerHTML = `
            <strong>Member:</strong> ${selectedMemberForRenewal.name} <br>
            <strong>Product:</strong> ${selectedOpt.dataset.name} <br>
            <strong>Amount Due:</strong> <span style="color:#23d160; font-size: 1.2rem; font-weight:bold;">₱${price.toLocaleString()}</span>
        `;
    }

    document.getElementById('renewalPaymentStatusSelect').value = 'paid';
    document.getElementById('renewalPaymentMethodGroup').style.display = 'block';
    document.getElementById('renewalPaymentMethodSelect').value = 'cash';

    const modal = document.getElementById('renewalPaymentModal');
    if(modal) modal.style.display = 'flex';
}

async function executeRenewalSave() {
    const btn = document.getElementById('confirmRenewalPaymentBtn');
    if(btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...'; }

    const isPaid = document.getElementById('renewalPaymentStatusSelect').value === 'paid';
    const paymentMethod = isPaid ? document.getElementById('renewalPaymentMethodSelect').value : 'cash'; 
    const productSelect = document.getElementById('renewalProductSelect');
    const selectedOpt = productSelect.options[productSelect.selectedIndex];

    try {
        const renewalDate = new Date(document.getElementById('renewalDate').value);
        const updatedMemberships = [];
        const monthlyChecked = document.getElementById('renewMonthly').checked;
        const combativeChecked = document.getElementById('renewCombative').checked;
        const danceChecked = document.getElementById('renewDance')?.checked;

        if (selectedMemberForRenewal.memberships) {
            selectedMemberForRenewal.memberships.forEach((m) => {
                if (m.type === 'monthly' && !monthlyChecked) updatedMemberships.push(m);
                else if (m.type === 'combative' && !combativeChecked) updatedMemberships.push(m);
                else if (m.type === 'dance' && !danceChecked) updatedMemberships.push(m);
            });
        }

        if (monthlyChecked) {
            const duration = parseInt(document.getElementById('renewMonthlyDuration').value) || 1;
            const cm = selectedMemberForRenewal.memberships?.find(m => m.type === 'monthly');
            const endDate = calculateNewEndDate(renewalDate, cm?.endDate, duration, 'monthly');
            updatedMemberships.push({
                type: 'monthly', duration: duration, startDate: renewalDate.toISOString(),
                endDate: endDate.toISOString(), status: 'active', paymentStatus: isPaid ? 'paid' : 'unpaid'
            });
        }

        if (combativeChecked) {
            const sessions = parseInt(document.getElementById('renewCombativeSessions').value) || 12;
            const duration = Math.ceil(sessions / 12);
            const cm = selectedMemberForRenewal.memberships?.find(m => m.type === 'combative');
            const endDate = calculateNewEndDate(renewalDate, cm?.endDate, duration, 'combative');
            updatedMemberships.push({
                type: 'combative', duration: duration, remainingSessions: sessions,
                startDate: renewalDate.toISOString(), endDate: endDate.toISOString(),
                status: 'active', paymentStatus: isPaid ? 'paid' : 'unpaid'
            });
        }

        if (danceChecked) {
            const sessions = parseInt(document.getElementById('renewDanceSessions').value) || 12;
            const duration = Math.ceil(sessions / 12);
            const cm = selectedMemberForRenewal.memberships?.find(m => m.type === 'dance');
            const endDate = calculateNewEndDate(renewalDate, cm?.endDate, duration, 'dance');
            updatedMemberships.push({
                type: 'dance', duration: duration, remainingSessions: sessions,
                startDate: renewalDate.toISOString(), endDate: endDate.toISOString(),
                status: 'active', paymentStatus: isPaid ? 'paid' : 'unpaid'
            });
        }

        const result = await apiFetch(`/api/members/${selectedMemberForRenewal._id}/renew`, {
            method: 'PUT',
            body: JSON.stringify({ memberships: updatedMemberships, status: 'active' }),
        });
        if (!result.success) throw new Error(result.error || 'Failed to renew membership');

        const txPayload = {
            member_id: selectedMemberForRenewal.memberId,
            amount: parseFloat(selectedOpt.dataset.price),
            payment_method: paymentMethod,
            status: isPaid ? 'paid' : 'unpaid',
            payment_date: renewalDate.toISOString(),
            description: `Renewed Plan: ${selectedOpt.dataset.name}`
        };
        const txResult = await apiFetch('/api/transactions', { method: 'POST', body: JSON.stringify(txPayload) });
        if (!txResult.success) throw new Error('Renewed successfully, but failed to log transaction.');

        const sm = document.getElementById('successMessage');
        if (sm) { sm.textContent = 'Member activated, renewed, and transaction logged!'; sm.style.display = 'block'; setTimeout(() => sm.style.display = 'none', 5000); }
        
        document.getElementById('renewalPaymentModal').style.display = 'none';
        document.getElementById('renewalModal').style.display = 'none';
        
        // Reload list directly
        await loadMembersStrict(getCurrentTab());

    } catch (error) {
        const em = document.getElementById('errorMessage');
        if (em) { em.textContent = 'Error: ' + error.message; em.style.display = 'block'; setTimeout(() => em.style.display = 'none', 5000); }
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Confirm & Renew'; }
        document.getElementById('renewalPaymentModal').style.display = 'none';
    }
}

// ------------------------------
// Edit member flow
// ------------------------------
function editMemberById(memberId) {
    const member = allMembersMap.get(memberId);
    if (!member) return;
    
    if (document.getElementById('memberListSection')) document.getElementById('memberListSection').classList.remove('active');
    if (document.getElementById('editMemberSection')) document.getElementById('editMemberSection').classList.add('active');

    document.getElementById('edit_member_id').value = member.memberId;
    document.getElementById('edit_name').value = member.name;
    document.getElementById('edit_phone').value = (member.phone && member.phone !== '-') ? member.phone : '';
    document.getElementById('edit_email').value = (member.email && member.email !== '-') ? member.email : '';

    const mc = document.getElementById('membershipsContainer');
    if (!mc) return; mc.innerHTML = '';
    const activeMemberships = (member.memberships || []).filter(m => m.status === 'active');

    if (activeMemberships.length > 0) {
      activeMemberships.forEach((membership) => createActiveMembershipEditField(membership, member.memberships.indexOf(membership)));
    } else {
      mc.innerHTML = '<p style="color: #ccc; font-style: italic;">No active memberships to edit.</p>';
    }
}

function createActiveMembershipEditField(membership, index) {
  const mc = document.getElementById('membershipsContainer');
  if (!mc) return;
  const div = document.createElement('div');
  div.className = 'membership-container active-edit-container';
  div.dataset.originalIndex = index;
  const sdValue = membership.startDate ? new Date(membership.startDate).toISOString().split('T')[0] : '';
  const durValue = membership.duration || 1; 

  div.innerHTML = `
    <h4>Editing Active Membership (${membership.type.toUpperCase()})</h4>
    <div class="form-group">
      <label>Membership Type:</label>
      <select id="membership_type_${index}" class="edit-type-select" required>
        <option value="monthly" ${membership.type === 'monthly' ? 'selected' : ''}>Monthly</option>
        <option value="combative" ${membership.type === 'combative' ? 'selected' : ''}>Combative</option>
        <option value="dance" ${membership.type === 'dance' ? 'selected' : ''}>Dance</option>
      </select>
    </div>
    <div class="form-group">
      <label>Start Date:</label>
      <input type="date" class="edit-start-date" value="${sdValue}" required style="width: 100%; padding: 1rem; background: #000; color: #fff; border: 1px solid #333;">
    </div>
    <div class="form-group">
      <label>Duration (months):</label>
      <input type="number" class="edit-duration" value="${durValue}" min="1" required style="width: 100%; padding: 1rem; background: #000; color: #fff; border: 1px solid #333;">
    </div>
    <div class="form-group" style="background: rgba(255, 51, 51, 0.1); padding: 12px; border-left: 3px solid #ff3333; margin-top: 15px;">
      <strong style="color: #ccc;">Expected End Date: </strong> <span id="membership_end_date_display_${index}" style="color: #fff;"></span>
    </div>
    <input type="hidden" id="original_type_${index}" value="${membership.type}">
  `;
  mc.appendChild(div);

  const startInput = div.querySelector('.edit-start-date');
  const durInput = div.querySelector('.edit-duration');
  const endDisplay = div.querySelector(`#membership_end_date_display_${index}`);

  function updateEnd() {
     const start = new Date(startInput.value);
     if (isNaN(start.getTime())) return;
     const end = new Date(start); end.setMonth(end.getMonth() + (parseInt(durInput.value) || 1));
     endDisplay.textContent = end.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  startInput.addEventListener('change', updateEnd);
  durInput.addEventListener('input', updateEnd);
  updateEnd();
}

if (document.getElementById('editMemberForm')) {
  document.getElementById('editMemberForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const id = document.getElementById('edit_member_id').value;
    const member = allMembersMap.get(id);
    let updatedMemberships = JSON.parse(JSON.stringify(member.memberships || []));
    
    document.querySelectorAll('.active-edit-container').forEach((c) => {
      const idx = parseInt(c.dataset.originalIndex);
      const nt = c.querySelector('.edit-type-select').value;
      const nd = parseInt(c.querySelector('.edit-duration').value) || 1;
      const ns = c.querySelector('.edit-start-date').value;
      if (updatedMemberships[idx] && ns) {
          updatedMemberships[idx].type = nt; updatedMemberships[idx].startDate = new Date(ns).toISOString(); updatedMemberships[idx].duration = nd;
          const end = new Date(ns); end.setMonth(end.getMonth() + nd); updatedMemberships[idx].endDate = end.toISOString();
          if (c.querySelector(`#original_type_${idx}`).value === 'monthly' && ['combative', 'dance'].includes(nt)) updatedMemberships[idx].remainingSessions = nd * 12;
          else if (nt === 'monthly') updatedMemberships[idx].remainingSessions = 0;
      }
    });

    const body = JSON.stringify({
        name: document.getElementById('edit_name').value.trim(),
        phone: document.getElementById('edit_phone').value.trim(),
        email: document.getElementById('edit_email').value.trim().toLowerCase(),
        memberships: updatedMemberships 
    });

    try {
      // Changed to window.location based endpoint logic to match apiFetch logic
      const url = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? `${SERVER_URL}/api/members/${member._id}` : `/api/members/${member._id}`;
      const res = await fetch(url, {
        method: 'PUT', headers: { 'Authorization': `Bearer ${AdminStore.getToken()}`, 'Content-Type': 'application/json' }, body
      });
      const data = await res.json();
      if (res.ok && data.success) { showMemberList(); loadMembersStrict('active'); }
    } catch (e) { console.error(e); }
  });
}

function showMemberList() {
  if (document.getElementById('editMemberSection')) document.getElementById('editMemberSection').classList.remove('active');
  if (document.getElementById('memberListSection')) document.getElementById('memberListSection').classList.add('active');
  loadMembersStrict('active');
}