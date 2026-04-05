// ========================================
// ADD & VIEW TRANSACTIONS - Admin
// ========================================

const SERVER_URL = 'http://localhost:8080';

let selectedMember = null;
let searchTimeout = null;
let currentEditTx = null;
let availableProductsForTx = []; 

// Pagination State
let viewCurrentPage = 1;
let viewPageSize = 25;
let salesCurrentPage = 1;
let salesPageSize = 25;

// --------------------------------------
// Admin session configuration
// --------------------------------------
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
      const authUser = { ...(userPayload || {}), timestamp: Date.now(), role: 'admin', token };
      localStorage.setItem(ADMIN_KEYS.token, token);
      localStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser));
      localStorage.setItem(ADMIN_KEYS.role, 'admin');
      sessionStorage.setItem(ADMIN_KEYS.token, token);
      sessionStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser));
      sessionStorage.setItem(ADMIN_KEYS.role, 'admin');
    } catch (e) { console.error('[AdminStore.set] failed:', e); }
  },
  getToken() { return sessionStorage.getItem(ADMIN_KEYS.token) || localStorage.getItem(ADMIN_KEYS.token) || null; },
  getAuthUser() {
    const raw = sessionStorage.getItem(ADMIN_KEYS.authUser) || localStorage.getItem(ADMIN_KEYS.authUser);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  },
  hasSession() {
    return ((localStorage.getItem(ADMIN_KEYS.token) || sessionStorage.getItem(ADMIN_KEYS.token)) &&
      (localStorage.getItem(ADMIN_KEYS.authUser) || sessionStorage.getItem(ADMIN_KEYS.authUser)) &&
      ((localStorage.getItem(ADMIN_KEYS.role) || sessionStorage.getItem(ADMIN_KEYS.role)) === 'admin'));
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
    if (!genToken || !genRole || genRole !== 'admin' || !genAuthRaw) return;
    AdminStore.set(genToken, JSON.parse(genAuthRaw));
  } catch (e) {}
}

function clearLocalAuth() {
  AdminStore.clear();
  try {
    const genericRole = localStorage.getItem('role') || sessionStorage.getItem('role');
    if (genericRole === 'admin') {
      localStorage.removeItem('token'); localStorage.removeItem('authUser'); localStorage.removeItem('role');
      sessionStorage.removeItem('token'); sessionStorage.removeItem('authUser'); sessionStorage.removeItem('role');
    }
  } catch (e) {}
}

function getApiBase() {
  return (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? SERVER_URL : '';
}

function getToken() { return AdminStore.getToken(); }

function adminLogout(reason, loginPath = '../login.html') {
  clearLocalAuth();
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = loginPath;
}

function ensureAdminAuthOrLogout(loginPath) {
  try {
    if (!AdminStore.hasSession()) bootstrapAdminFromGenericIfNeeded();
    if (!AdminStore.hasSession()) { adminLogout('missing admin session', loginPath); return false; }
    const authUser = AdminStore.getAuthUser();
    if (!authUser || authUser.role !== 'admin') { adminLogout('invalid or non-admin authUser', loginPath); return false; }
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) { adminLogout('admin session max age exceeded', loginPath); return false; }
    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);

    window.addEventListener('storage', (event) => {
      if (event.key === ADMIN_KEYS.logoutEvent) adminLogout('adminLogoutEvent from another tab', loginPath);
    });
    return true;
  } catch (e) {
    adminLogout('exception in ensureAdminAuthOrLogout', loginPath);
    return false;
  }
}

function requireAuth(expectedRole, loginPath) { return ensureAdminAuthOrLogout(loginPath); }

window.addEventListener('storage', (event) => {
  if (event.key === ADMIN_KEYS.logoutEvent) adminLogout('adminLogoutEvent from another tab (global)', '../login.html');
});

async function apiFetch(endpoint, options = {}) {
  const ok = ensureAdminAuthOrLogout('../login.html');
  if (!ok) return;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();

  if (!token || !authUser) { adminLogout('missing token/authUser in admin apiFetch', '../login.html'); return; }

  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) { adminLogout('admin session max age exceeded in apiFetch', '../login.html'); return; }
    authUser.timestamp = Date.now();
    AdminStore.set(token, authUser);
  } catch (e) {
    adminLogout('invalid authUser JSON in apiFetch', '../login.html'); return;
  }

  const url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? `${SERVER_URL}${endpoint}` : endpoint;
  const headers = { ...options.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    clearLocalAuth();
    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    window.location.href = '../login.html';
    return;
  }

  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ---------- DOM Ready ----------
document.addEventListener('DOMContentLoaded', async () => {
  const ok = requireAuth('admin', '../login.html');
  if (!ok) return;

  setupLayoutChrome();
  await checkServerConnection();
  await loadProductsForTransactions();
  setupAddSectionEventListeners();
  setupViewSectionEventListeners();
  setupSalesSectionEventListeners();
  setupPaginationControls();
  setupTabToggle();
  setupEditPanelEvents();

  initMiniCalendar('paymentDate', 'paymentDateIcon', 'paymentDatePopup');
  initMiniCalendar('txStartDate', 'txStartDateIcon', 'txStartDatePopup');
  initMiniCalendar('txEndDate', 'txEndDateIcon', 'txEndDatePopup');
  initMiniCalendar('salesStartDate', 'salesStartDateIcon', 'salesStartDatePopup');
  initMiniCalendar('salesEndDate', 'salesEndDateIcon', 'salesEndDatePopup');
  initMiniCalendar('editDate', 'editDateIcon', 'editDatePopup');

  loadLatestTransactions();
});

function $(id) { return document.getElementById(id); }

function setupLayoutChrome() {
  const menuToggle = $('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = $('logoutBtn');

  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded', '../login.html'); return;
    }
  } catch (e) { adminLogout('invalid authUser JSON', '../login.html'); return; }

  const adminNameEl = document.getElementById('adminFullName');
  if (adminNameEl) {
    const authUser = AdminStore.getAuthUser();
    adminNameEl.textContent = authUser?.name ? authUser.name : 'Admin';
  }

  if (menuToggle && sidebar) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const token = getToken();
      try {
        if (token) await fetch(`${getApiBase()}/api/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch (e) {} finally { adminLogout('user manually logged out', '../login.html'); }
    });
  }

  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar && menuToggle && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
      sidebar.classList.remove('collapsed');
    }
  });
}

async function checkServerConnection() {
  const statusElement = $('serverStatus');
  if (!statusElement) return;
  try {
    const result = await apiFetch('/health');
    if (result) {
      statusElement.textContent = 'Connected to server successfully';
      statusElement.className = 'server-status server-connected';
    } else throw new Error('Server not OK');
  } catch (error) {
    statusElement.textContent = 'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
  }
}

async function loadProductsForTransactions() {
  try {
     const res = await apiFetch('/api/products?status=active');
     availableProductsForTx = res.data || [];
     populateTransactionCategories();
  } catch(e) {}
}

function populateTransactionCategories() {
    const txTypeSelect = $('transactionType');
    if(!txTypeSelect) return;
    const standardTypes = ['monthly', 'combative', 'dance', 'walk-in', 'others', 'Custom'];
    const uniqueCategories = [...new Set(availableProductsForTx.map(p => p.membership_type))].filter(c => c && !standardTypes.includes(c));
    let html = `
      <option value="">-- Select Category --</option>
      <option value="monthly">Gym Membership (Monthly)</option>
      <option value="combative">Combative Class</option>
      <option value="dance">Dance Class</option>
      <option value="walk-in">Walk-in Session</option>
    `;
    uniqueCategories.forEach(cat => { html += `<option value="${cat}">${cat}</option>`; });
    html += `<option value="Custom">Custom / Others</option>`;
    
    const currentVal = txTypeSelect.value;
    txTypeSelect.innerHTML = html;
    if (txTypeSelect.querySelector(`option[value="${currentVal}"]`)) txTypeSelect.value = currentVal;
}

function setupTabToggle() {
  const tabAdd = $('tabAdd'), tabView = $('tabView'), tabSales = $('tabSales');
  const addSection = $('addSection'), viewSection = $('viewSection'), salesSection = $('salesSection');
  if (!tabAdd || !tabView || !tabSales) return;

  function resetTabs() {
    [tabAdd, tabView, tabSales].forEach(t => t.classList.remove('active'));
    [addSection, viewSection, salesSection].forEach(s => s.classList.add('hidden'));
  }

  tabAdd.addEventListener('click', () => { resetTabs(); tabAdd.classList.add('active'); addSection.classList.remove('hidden'); });
  tabView.addEventListener('click', () => { resetTabs(); tabView.classList.add('active'); viewSection.classList.remove('hidden'); reloadViewTransactions(); });
  tabSales.addEventListener('click', () => { resetTabs(); tabSales.classList.add('active'); salesSection.classList.remove('hidden'); loadSalesData(); });
}

// =======================================
// ADD TRANSACTION SECTION
// =======================================
function setupAddSectionEventListeners() {
  const memberRadios = document.querySelectorAll('input[name="memberType"]');
  const regGroup = $('registeredMemberGroup');
  const walkinGroup = $('walkinMemberGroup');
  const guestNameInput = $('guestName');

  memberRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'walkin') {
        regGroup.classList.add('hidden'); walkinGroup.classList.remove('hidden'); $('memberSearch').value = '';
        if ($('selectedMemberInfo')) $('selectedMemberInfo').classList.add('hidden');
        const val = guestNameInput.value.trim();
        selectedMember = val ? { memberId: `Walk-in: ${val}`, name: val, isWalkIn: true } : null;
      } else {
        walkinGroup.classList.add('hidden'); regGroup.classList.remove('hidden');
        guestNameInput.value = ''; selectedMember = null;
      }
      checkFormCompletion();
    });
  });

  if (guestNameInput) {
    guestNameInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      selectedMember = val ? { memberId: `Walk-in: ${val}`, name: val, isWalkIn: true } : null;
      checkFormCompletion();
    });
  }

  const memberSearch = $('memberSearch');
  if (memberSearch) {
    memberSearch.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      if (query.length < 2) { hideSearchResults(); return; }
      const searchLoading = $('searchLoading');
      if (searchLoading) searchLoading.classList.remove('hidden');
      searchTimeout = setTimeout(async () => { await searchMembers(query); }, 300);
    });
  }

  const txTypeSelect = $('transactionType');
  if (txTypeSelect) {
    txTypeSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      const specifyGroup = $('specifyTypeGroup'), productGroup = $('productSelectGroup'), productSelect = $('productSelect');
      specifyGroup.classList.add('hidden'); productGroup.classList.add('hidden');
      $('specifyType').value = ''; productSelect.innerHTML = '<option value="">-- Select Package --</option>';

      if (val === 'Custom') { specifyGroup.classList.remove('hidden'); checkFormCompletion(); } 
      else if (val) {
        productGroup.classList.remove('hidden');
        const filtered = availableProductsForTx.filter(p => p.membership_type === val);
        if(filtered.length === 0) productSelect.innerHTML += '<option value="" disabled>No products available</option>';
        else {
           filtered.forEach(p => {
             const opt = document.createElement('option');
             opt.value = p._id; opt.dataset.price = p.price; opt.dataset.name = p.product_name;
             opt.textContent = `${p.product_name} - ₱${p.price.toLocaleString()}`;
             productSelect.appendChild(opt);
           });
        }
        checkFormCompletion();
      } else { checkFormCompletion(); }
    });
  }

  const productSelect = $('productSelect');
  if (productSelect) {
    productSelect.addEventListener('change', (e) => {
      const selectedOpt = e.target.options[e.target.selectedIndex];
      $('amount').value = (selectedOpt && selectedOpt.value) ? selectedOpt.dataset.price : '';
      checkFormCompletion();
    });
  }

  const formInputs = document.querySelectorAll('#transactionForm input, #transactionForm select, #transactionForm textarea');
  formInputs.forEach((input) => input.addEventListener('input', checkFormCompletion));

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#memberSearch') && !e.target.closest('#searchResults')) hideSearchResults();
  });

  const submitBtn = $('submitTransactionBtn');
  if (submitBtn) submitBtn.addEventListener('click', submitTransaction);
}

async function searchMembers(query) {
  const resultsDiv = $('searchResults');
  const searchLoading = $('searchLoading');
  if (!resultsDiv || !searchLoading) return;
  try {
    const result = await apiFetch(`/api/members/search?query=${encodeURIComponent(query)}`);
    searchLoading.classList.add('hidden');
    if (!result.success || !result.data || result.data.length === 0) {
      resultsDiv.innerHTML = '<div class="member-result">No members found.</div>';
      resultsDiv.classList.remove('hidden'); return;
    }
    resultsDiv.innerHTML = result.data.map(m => `
        <div class="member-result" data-member-id="${m.memberId}">
          <strong>${m.name}</strong><br><small>Member ID: ${m.memberId}</small>
        </div>
      `).join('');
    resultsDiv.classList.remove('hidden');
    resultsDiv.querySelectorAll('.member-result').forEach((el) =>
      el.addEventListener('click', () => handleMemberSelect(el.getAttribute('data-member-id'), result.data))
    );
  } catch (error) {
    searchLoading.classList.add('hidden');
    resultsDiv.innerHTML = '<div class="member-result">Error searching members.</div>';
    resultsDiv.classList.remove('hidden');
  }
}

function hideSearchResults() {
  const resultsDiv = $('searchResults');
  if (resultsDiv) { resultsDiv.classList.add('hidden'); resultsDiv.innerHTML = ''; }
}

function handleMemberSelect(memberId, list) {
  const member = (list || []).find((m) => m.memberId === memberId);
  selectedMember = member || null;
  const infoDiv = $('selectedMemberInfo');
  if (infoDiv && selectedMember) {
    infoDiv.classList.remove('hidden');
    infoDiv.innerHTML = `<h3>${selectedMember.name}</h3><p><strong>Member ID:</strong> ${selectedMember.memberId}</p><p><strong>Status:</strong> ${selectedMember.status || 'N/A'}</p>`;
  }
  const memberSearch = $('memberSearch');
  if (memberSearch && selectedMember) memberSearch.value = `${selectedMember.name} (${selectedMember.memberId})`;
  hideSearchResults();
  checkFormCompletion();
}

function checkFormCompletion() {
  const amount = $('amount'), method = $('paymentMethod'), status = $('status'), date = $('paymentDate');
  const txType = $('transactionType'), specifyType = $('specifyType'), productSelect = $('productSelect');
  let complete = selectedMember && amount && method && date && status && txType &&
    Number(amount.value) >= 0 && method.value && status.value && date.value && txType.value;
  if (complete && txType.value === 'Custom' && !specifyType.value.trim()) complete = false;
  if (complete && txType.value !== 'Custom' && !productSelect.value) complete = false;
  const btn = $('submitTransactionBtn');
  if (btn) btn.disabled = !complete;
  updateConfirmationSummary();
}

function updateConfirmationSummary() {
  const summaryDiv = $('confirmationSummary');
  if (!summaryDiv) return;
  if (!selectedMember) { summaryDiv.textContent = 'Please select a member and enter details first.'; return; }

  const amount = $('amount')?.value || ''; const method = $('paymentMethod')?.value || '';
  const status = $('status')?.value || 'paid'; const date = $('paymentDate')?.value || '';
  const txTypeSelect = $('transactionType'); const txType = txTypeSelect?.value || '';
  const specifyType = $('specifyType')?.value || ''; const desc = $('description')?.value || '';

  let finalType = txTypeSelect.options[txTypeSelect.selectedIndex]?.text || txType;
  if (txType === 'Custom') finalType = specifyType;
  else if (txType) {
      const prodOpt = $('productSelect').options[$('productSelect').selectedIndex];
      finalType = prodOpt && prodOpt.dataset && prodOpt.dataset.name ? prodOpt.dataset.name : finalType;
  }

  summaryDiv.innerHTML = `
    <p><strong>Member:</strong> ${selectedMember.name} ${selectedMember.isWalkIn ? '(Walk-in)' : `(${selectedMember.memberId})`}</p>
    <p><strong>Amount:</strong> ₱${amount || '0.00'}</p>
    <p><strong>Payment Method:</strong> ${method || '—'}</p>
    <p><strong>Status:</strong> ${status}</p>
    <p><strong>Payment Date:</strong> ${date || '—'}</p>
    <p><strong>Transaction Type:</strong> ${finalType || '—'}</p>
    <p><strong>Notes:</strong> ${desc || '—'}</p>
  `;
}

async function submitTransaction() {
  if (!selectedMember) return;
  const btn = $('submitTransactionBtn'), resultBox = $('transactionResult'), resultMsg = $('resultMessage');
  if (btn) btn.disabled = true;
  if (resultBox) { resultBox.className = ''; resultBox.classList.add('hidden'); }
  if (resultMsg) { resultMsg.className = ''; resultMsg.classList.add('hidden'); }

  const txTypeSelect = $('transactionType'), txType = txTypeSelect.value, specifyType = $('specifyType').value.trim();
  let finalDesc = txTypeSelect.options[txTypeSelect.selectedIndex]?.text || txType;
  if (txType === 'Custom') finalDesc = specifyType;
  else if (txType) {
      const prodOpt = $('productSelect').options[$('productSelect').selectedIndex];
      finalDesc = prodOpt && prodOpt.dataset && prodOpt.dataset.name ? prodOpt.dataset.name : finalDesc;
  }
  const notes = ($('description').value || '').trim();
  if (notes) finalDesc += ` - ${notes}`;

  const payload = {
    member_id: selectedMember.memberId, amount: Number($('amount').value),
    payment_method: $('paymentMethod').value, status: $('status').value,
    payment_date: $('paymentDate').value, description: finalDesc,
  };

  try {
    const res = await apiFetch('/api/transactions', { method: 'POST', body: JSON.stringify(payload) });
    if (!res || res.success === false) throw new Error(res?.error || 'Failed to add transaction.');

    if (resultMsg) { resultMsg.textContent = res.message || 'Transaction added successfully.'; resultMsg.className = 'success'; resultMsg.classList.remove('hidden'); }
    if (resultBox) {
      resultBox.className = 'success'; resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <p><strong>Transaction ID:</strong> ${res.data.transaction_id}</p>
        <p><strong>Member:</strong> ${selectedMember.name} ${selectedMember.isWalkIn ? '(Walk-in)' : `(${selectedMember.memberId})`}</p>
        <p><strong>Amount:</strong> ₱${res.data.amount.toFixed(2)}</p>
        <p><strong>Payment Method:</strong> ${res.data.payment_method}</p>
        <p><strong>Status:</strong> ${res.data.status}</p>
        <p><strong>Payment Date:</strong> ${new Date(res.data.payment_date).toLocaleDateString()}</p>
        <p><strong>Description:</strong> ${res.data.description || '—'}</p>
      `;
    }

    const form = document.getElementById('transactionForm');
    if (form) {
        form.querySelectorAll('input, select, textarea').forEach(element => { sessionStorage.removeItem(`${window.location.pathname}-${element.id || element.name}`); });
        form.reset(); $('specifyTypeGroup')?.classList.add('hidden'); $('productSelectGroup')?.classList.add('hidden');
    }

    const registeredRadio = document.querySelector('input[name="memberType"][value="registered"]');
    if (registeredRadio) registeredRadio.checked = true;
    $('registeredMemberGroup').classList.remove('hidden'); $('walkinMemberGroup').classList.add('hidden');
    $('guestName').value = ''; $('memberSearch').value = ''; selectedMember = null;
    const selectedMemberInfo = document.getElementById('selectedMemberInfo');
    if (selectedMemberInfo) selectedMemberInfo.classList.add('hidden');
    
    checkFormCompletion(); updateConfirmationSummary(); reloadViewTransactions();
  } catch (error) {
    if (resultMsg) { resultMsg.textContent = error.message || 'Failed to add transaction.'; resultMsg.className = 'error'; resultMsg.classList.remove('hidden'); }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// =======================================
// PAGINATION SETUP
// =======================================
function setupPaginationControls() {
  const vps = $('viewPageSize'), vpp = $('viewPrevPage'), vnp = $('viewNextPage');
  if (vps) { vps.addEventListener('change', (e) => { viewPageSize = parseInt(e.target.value, 10); viewCurrentPage = 1; reloadViewTransactions(); }); }
  if (vpp) { vpp.addEventListener('click', () => { if (viewCurrentPage > 1) { viewCurrentPage--; reloadViewTransactions(); } }); }
  if (vnp) { vnp.addEventListener('click', () => { viewCurrentPage++; reloadViewTransactions(); }); }

  const sps = $('salesPageSize'), spp = $('salesPrevPage'), snp = $('salesNextPage');
  if (sps) { sps.addEventListener('change', (e) => { salesPageSize = parseInt(e.target.value, 10); salesCurrentPage = 1; loadSalesData(); }); }
  if (spp) { spp.addEventListener('click', () => { if (salesCurrentPage > 1) { salesCurrentPage--; loadSalesData(); } }); }
  if (snp) { snp.addEventListener('click', () => { salesCurrentPage++; loadSalesData(); }); }
}

function updateViewPaginationUI(pagination) {
  const prevBtn = $('viewPrevPage'), nextBtn = $('viewNextPage'), info = $('viewPageInfo');
  if (!pagination) return;
  const { page, pages, total } = pagination;
  const totalPages = pages > 0 ? pages : 1;
  if (info) info.textContent = `Page ${page} of ${totalPages} (${total} total)`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= totalPages;
}

function updateSalesPaginationUI(pagination) {
  const prevBtn = $('salesPrevPage'), nextBtn = $('salesNextPage'), info = $('salesPageInfo');
  if (!pagination) return;
  const { page, pages, total } = pagination;
  const totalPages = pages > 0 ? pages : 1;
  if (info) info.textContent = `Page ${page} of ${totalPages} (${total} total)`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= totalPages;
}

// =======================================
// DATE FILTER LOGIC HELPER
// =======================================
function handleDateDependencies(startInputId, startIconId, endInputId, endIconId) {
  const startIn = $(startInputId), endIn = $(endInputId), endIcon = $(endIconId);
  if (!startIn || !endIn || !endIcon) return;
  startIn.addEventListener('change', () => {
    if (startIn.value) { endIn.disabled = false; endIcon.disabled = false; } 
    else { endIn.value = ''; endIn.disabled = true; endIcon.disabled = true; }
  });
}

// =======================================
// VIEW TRANSACTIONS SECTION
// =======================================
function reloadViewTransactions() {
  if ($('txSearch').value.trim()) searchTransactions($('txSearch').value.trim());
  else if ($('txStartDate').value) filterViewTransactionsByRange();
  else loadLatestTransactions();
}

function setupViewSectionEventListeners() {
  const searchInput = $('txSearch'), searchBtn = $('txSearchBtn'), resetBtn = $('txResetBtn'), statusFilter = $('txStatusFilter');
  const startDateInput = $('txStartDate'), endDateInput = $('txEndDate');
  handleDateDependencies('txStartDate', 'txStartDateIcon', 'txEndDate', 'txEndDateIcon');

  if (startDateInput) startDateInput.addEventListener('change', () => { viewCurrentPage = 1; reloadViewTransactions(); });
  if (endDateInput) endDateInput.addEventListener('change', () => { viewCurrentPage = 1; reloadViewTransactions(); });

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      viewCurrentPage = 1;
      reloadViewTransactions();
    });
  }

  if (searchInput) searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') { viewCurrentPage = 1; reloadViewTransactions(); } });

  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      viewCurrentPage = 1;
      reloadViewTransactions();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (startDateInput) startDateInput.value = '';
      if (endDateInput) { endDateInput.value = ''; endDateInput.disabled = true; $('txEndDateIcon').disabled = true; }
      if (statusFilter) statusFilter.value = 'all';
      $('txViewError')?.classList.add('hidden'); $('txEmpty')?.classList.add('hidden');
      viewCurrentPage = 1;
      loadLatestTransactions();
    });
  }
}

function formatPeso(amount) {
  const n = Number(amount || 0);
  return n.toLocaleString('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
}

function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
}

function renderTxTable(list) {
  const body = $('txTableBody'), empty = $('txEmpty');
  if (!body) return;
  body.innerHTML = '';
  
  if (!list || list.length === 0) {
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  list.forEach((tx) => {
    const tr = document.createElement('tr');
    const txStatus = tx.status || 'paid';
    
    tr.dataset.txId = tx.transaction_id || '';
    tr.dataset.txMemberName = tx.member_name || 'Unknown';
    tr.dataset.txMemberId = tx.member_id || '';
    tr.dataset.txAmount = tx.amount != null ? String(tx.amount) : '';
    tr.dataset.txMethod = tx.payment_method || '';
    tr.dataset.txDate = tx.payment_date || tx.createdAt || '';
    tr.dataset.txDesc = tx.description || '';
    tr.dataset.txStatus = txStatus;

    tr.innerHTML = `
      <td>${formatDate(tx.payment_date || tx.createdAt)}</td>
      <td>${tx.transaction_id || '—'}</td>
      <td>${tx.member_name || 'Unknown'}<br><small>${tx.member_id.startsWith('Walk-in:') ? 'Guest' : tx.member_id}</small></td>
      <td>${(tx.payment_method || '').toUpperCase()}</td>
      <td class="center-align"><span class="status-badge status-${txStatus}">${txStatus}</span></td>
      <td class="right-align">${Number(tx.amount || 0).toFixed(2)}</td>
      <td>${tx.description || '—'}</td>
      <td class="center-align">
        <div class="tx-actions">
          <button type="button" class="tx-action-btn edit" data-tx-id="${tx.transaction_id}">Edit</button>
          <button type="button" class="tx-action-btn delete" data-tx-id="${tx.transaction_id}">Delete</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll('.tx-action-btn.edit').forEach((btn) => btn.addEventListener('click', () => openEditPanel(btn.getAttribute('data-tx-id'))));
  body.querySelectorAll('.tx-action-btn.delete').forEach((btn) => btn.addEventListener('click', () => handleDeleteTransaction(btn.getAttribute('data-tx-id'))));
}

async function loadLatestTransactions() {
  const status = $('txViewStatus'), errorBox = $('txViewError');
  const statusFilterVal = $('txStatusFilter')?.value || 'all';
  if (status) { status.textContent = 'Loading latest transactions...'; status.classList.remove('hidden'); }
  if (errorBox) { errorBox.classList.add('hidden'); errorBox.textContent = ''; }

  try {
    const res = await apiFetch(`/api/transactions?page=${viewCurrentPage}&limit=${viewPageSize}&status=${statusFilterVal}`);
    if (!res || res.success === false) throw new Error(res?.error || 'Failed to load transactions.');
    renderTxTable(res.data || []);
    updateViewPaginationUI(res.pagination);
  } catch (error) {
    if (errorBox) { errorBox.textContent = error.message; errorBox.classList.remove('hidden'); }
  } finally {
    if (status) status.classList.add('hidden');
  }
}

async function searchTransactions(query) {
  const status = $('txViewStatus'), errorBox = $('txViewError');
  const statusFilterVal = $('txStatusFilter')?.value || 'all';
  if (status) { status.textContent = 'Searching transactions...'; status.classList.remove('hidden'); }
  if (errorBox) { errorBox.classList.add('hidden'); errorBox.textContent = ''; }

  try {
    const res = await apiFetch(`/api/transactions/search?q=${encodeURIComponent(query)}&page=${viewCurrentPage}&limit=${viewPageSize}&status=${statusFilterVal}`);
    if (!res || res.success === false) throw new Error(res?.error || 'Failed to search transactions.');
    renderTxTable(res.data || []);
    updateViewPaginationUI(res.pagination);
  } catch (error) {
    if (errorBox) { errorBox.textContent = error.message; errorBox.classList.remove('hidden'); }
  } finally {
    if (status) status.classList.add('hidden');
  }
}

async function filterViewTransactionsByRange() {
  const status = $('txViewStatus'), errorBox = $('txViewError');
  const start = $('txStartDate').value, end = $('txEndDate').value;
  const statusFilterVal = $('txStatusFilter')?.value || 'all';

  if (!start) { loadLatestTransactions(); return; }

  if (status) { status.textContent = 'Filtering by date...'; status.classList.remove('hidden'); }
  if (errorBox) { errorBox.classList.add('hidden'); errorBox.textContent = ''; }

  try {
    let url = `/api/transactions/range?startDate=${encodeURIComponent(start)}&page=${viewCurrentPage}&limit=${viewPageSize}&status=${statusFilterVal}`;
    if (end) url += `&endDate=${encodeURIComponent(end)}`;

    const res = await apiFetch(url);
    if (!res || res.success === false) throw new Error(res?.error || 'Failed to filter transactions.');
    renderTxTable(res.data || []);
    updateViewPaginationUI(res.pagination);
  } catch (error) {
    if (errorBox) { errorBox.textContent = error.message; errorBox.classList.remove('hidden'); }
  } finally {
    if (status) status.classList.add('hidden');
  }
}

async function handleDeleteTransaction(txId) {
  if (!txId) return;
  const confirmDelete = window.confirm(`Are you sure you want to delete transaction ${txId}?`);
  if (!confirmDelete) return;

  try {
    const res = await apiFetch(`/api/transactions/${encodeURIComponent(txId)}`, { method: 'DELETE' });
    if (!res || res.success === false) throw new Error(res?.error || 'Failed to delete transaction.');
    alert('Transaction deleted successfully.');
    
    if ($('tabSales').classList.contains('active')) loadSalesData();
    else reloadViewTransactions();
  } catch (e) {
    alert(e.message || 'Failed to delete transaction.');
  }
}

// =======================================
// TOTAL SALES SECTION
// =======================================
function setupSalesSectionEventListeners() {
  const searchBtn = $('salesSearchBtn'), resetBtn = $('salesResetBtn');
  handleDateDependencies('salesStartDate', 'salesStartDateIcon', 'salesEndDate', 'salesEndDateIcon');

  if (searchBtn) {
    searchBtn.addEventListener('click', () => { salesCurrentPage = 1; loadSalesData(); });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      $('salesStartDate').value = '';
      const endIn = $('salesEndDate'); endIn.value = ''; endIn.disabled = true; $('salesEndDateIcon').disabled = true;
      $('salesViewError')?.classList.add('hidden'); $('salesEmpty')?.classList.add('hidden');
      salesCurrentPage = 1;
      loadSalesData();
    });
  }
}

async function loadSalesData() {
  const status = $('salesViewStatus'), errorBox = $('salesViewError');
  const start = $('salesStartDate').value, end = $('salesEndDate').value;

  if (status) { status.classList.remove('hidden'); }
  if (errorBox) { errorBox.classList.add('hidden'); errorBox.textContent = ''; }

  try {
    let url = `/api/transactions/range?status=paid&page=${salesCurrentPage}&limit=${salesPageSize}`;
    if (start) {
      url += `&startDate=${encodeURIComponent(start)}`;
      if (end) url += `&endDate=${encodeURIComponent(end)}`;
    }

    const res = await apiFetch(url);
    if (!res || res.success === false) throw new Error(res?.error || 'Failed to load sales data.');
    
    renderSalesTable(res.data || [], res.totalRevenue || 0);
    updateSalesPaginationUI(res.pagination);
  } catch (error) {
    if (errorBox) { errorBox.textContent = error.message; errorBox.classList.remove('hidden'); }
  } finally {
    if (status) status.classList.add('hidden');
  }
}

function renderSalesTable(list, totalRevenue) {
  const body = $('salesTableBody'), empty = $('salesEmpty'), totalValStr = $('salesTotalVal');
  if (!body) return;
  body.innerHTML = '';

  if (totalValStr) {
    totalValStr.textContent = formatPeso(totalRevenue);
  }

  if (!list || list.length === 0) {
    if (empty) empty.classList.remove('hidden');
    return;
  }
  
  if (empty) empty.classList.add('hidden');

  list.forEach((tx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(tx.payment_date || tx.createdAt)}</td>
      <td>${tx.transaction_id || '—'}</td>
      <td>${tx.member_name || 'Unknown'}<br><small>${tx.member_id.startsWith('Walk-in:') ? 'Guest' : tx.member_id}</small></td>
      <td>${tx.description || '—'}</td>
      <td class="center-align">${(tx.payment_method || '').toUpperCase()}</td>
      <td class="right-align" style="font-weight:600; color:var(--accent);">${Number(tx.amount || 0).toFixed(2)}</td>
    `;
    body.appendChild(tr);
  });
}

// =======================================
// EDIT PANEL LOGIC
// =======================================
function setupEditPanelEvents() {
  const overlay = $('editTxOverlay'), closeBtn = $('editTxCloseBtn'), cancelBtn = $('editTxCancelBtn'), form = $('editTxForm');
  if (!overlay) return;
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.preventDefault(); hideEditPanel(); });
  if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.preventDefault(); hideEditPanel(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hideEditPanel(); });
  if (form) form.addEventListener('submit', handleEditSubmit);
}

function showEditPanel() {
  const overlay = $('editTxOverlay');
  if (!overlay) return;
  overlay.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function hideEditPanel() {
  const overlay = $('editTxOverlay'), msg = $('editTxMessage');
  currentEditTx = null;
  if (overlay) overlay.classList.remove('is-open');
  if (msg) { msg.className = 'hidden'; msg.textContent = ''; }
  document.body.style.overflow = '';
}

function openEditPanel(txId) {
  if (!txId) return;
  const body = $('txTableBody');
  if (!body) return;
  const row = [...body.querySelectorAll('tr')].find((tr) => tr.querySelector('.tx-action-btn.edit') && tr.querySelector('.tx-action-btn.edit').dataset.txId === txId);
  if (!row) return;
  currentEditTx = txId;
  fillEditFormFromRow(row);
  showEditPanel();
}

function fillEditFormFromRow(row) {
  const txId = row.querySelector('.tx-action-btn.edit')?.dataset.txId || '';
  const memberCell = row.children[2], methodCell = row.children[3], amountCell = row.children[5], descCell = row.children[6];
  const memberName = memberCell ? memberCell.childNodes[0].textContent.trim() : '';
  const memberId = memberCell ? (memberCell.querySelector('small')?.textContent || '').trim() : '';

  $('editTxId').value = txId;
  $('editTxMember').value = memberId ? `${memberName} (${memberId})` : memberName;

  const rawAmount = amountCell ? amountCell.textContent.replace(/[^0-9.]/g, '') : '';
  $('editAmount').value = rawAmount || '';

  const method = methodCell ? methodCell.textContent.trim().toLowerCase() : '';
  $('editMethod').value = ['cash', 'e-wallet', 'bank', 'none', 'others'].includes(method) ? method : '';

  const dateText = row.children[0].textContent.trim();
  const parsed = new Date(dateText);
  $('editDate').value = !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
  $('editDesc').value = descCell ? descCell.textContent.trim() : '';

  const status = row.dataset.txStatus || 'paid';
  $('editStatus').value = status;
}

async function handleEditSubmit(e) {
  e.preventDefault();
  if (!currentEditTx) return;

  const msg = $('editTxMessage'), saveBtn = $('editTxSaveBtn');
  if (msg) { msg.className = 'hidden'; msg.textContent = ''; }

  const row = document.querySelector(`tr[data-tx-id="${currentEditTx}"]`);
  const originalStatus = row ? row.dataset.txStatus : 'paid';
  const newStatus = $('editStatus').value;

  if (originalStatus === 'paid' && newStatus === 'unpaid') {
    const isSure = window.confirm("Are you sure you want to change this member's transaction status from Paid to Unpaid?");
    if (!isSure) return; 
  }

  const payload = {};
  const amountStr = $('editAmount').value.trim();
  const method = $('editMethod').value;
  const dateStr = $('editDate').value;
  const desc = $('editDesc').value;

  if (amountStr) {
    const num = Number(amountStr);
    if (Number.isNaN(num) || num < 0) {
      if (msg) { msg.textContent = 'Amount must be a valid number.'; msg.className = 'error'; }
      return;
    }
    payload.amount = num;
  }

  if (method) payload.payment_method = method;
  if (dateStr) payload.payment_date = dateStr;
  payload.description = desc;
  payload.status = newStatus; 

  if (Object.keys(payload).length === 0) { hideEditPanel(); return; }
  if (saveBtn) saveBtn.disabled = true;

  try {
    const res = await apiFetch(`/api/transactions/${encodeURIComponent(currentEditTx)}`, { method: 'PUT', body: JSON.stringify(payload) });
    if (!res || res.success === false) throw new Error(res?.error || 'Failed to update transaction.');

    if (msg) { msg.textContent = 'Transaction updated successfully.'; msg.className = 'success'; }

    if ($('tabSales').classList.contains('active')) loadSalesData();
    else reloadViewTransactions();
    
    hideEditPanel();
  } catch (error) {
    if (msg) { msg.textContent = error.message || 'Failed to update transaction.'; msg.className = 'error'; }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ---------- Mini Calendar Utility ----------
function initMiniCalendar(inputId, buttonId, popupId, onSelect) {
  const input = $(inputId), btn = $(buttonId), popup = $(popupId);
  if (!input || !btn || !popup) return;

  let current = input.value ? new Date(input.value) : new Date();
  if (Number.isNaN(current.getTime())) current = new Date();

  const titleEl = popup.querySelector('.mini-calendar-title');
  const gridEl = popup.querySelector('.mini-calendar-grid');
  const navBtns = popup.querySelectorAll('.mini-cal-nav');

  function renderCalendar() {
    const year = current.getFullYear(), month = current.getMonth();
    if (titleEl) {
      const formatter = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' });
      titleEl.textContent = formatter.format(current);
    }
    if (!gridEl) return;
    gridEl.innerHTML = '';

    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    dayNames.forEach((d) => {
      const h = document.createElement('button');
      h.type = 'button'; h.textContent = d; h.className = 'mini-cal-day-header';
      gridEl.appendChild(h);
    });

    const firstDay = new Date(year, month, 1), startWeekday = firstDay.getDay(), daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < startWeekday; i += 1) {
      const empty = document.createElement('button');
      empty.type = 'button'; empty.className = 'mini-cal-day mini-cal-day-disabled';
      gridEl.appendChild(empty);
    }

    const selectedDateStr = input.value || null;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const btnDay = document.createElement('button');
      btnDay.type = 'button'; btnDay.textContent = String(day); btnDay.className = 'mini-cal-day';
      const thisDate = new Date(year, month, day);
      const iso = thisDate.toISOString().slice(0, 10);
      if (selectedDateStr && iso === selectedDateStr) btnDay.classList.add('mini-cal-day-selected');

      btnDay.addEventListener('click', () => {
        input.value = iso; popup.classList.add('hidden');
        if (typeof onSelect === 'function') onSelect(iso);
        else input.dispatchEvent(new Event('change'));
      });
      gridEl.appendChild(btnDay);
    }
  }

  navBtns.forEach((n) => n.addEventListener('click', () => {
      const dir = Number(n.getAttribute('data-dir') || '0');
      current.setMonth(current.getMonth() + dir);
      renderCalendar();
  }));

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if(btn.disabled) return; 
    popup.classList.toggle('hidden');
    current = input.value ? new Date(input.value) : new Date();
    if (Number.isNaN(current.getTime())) current = new Date();
    renderCalendar();
  });

  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && !btn.contains(e.target)) popup.classList.add('hidden');
  });
}