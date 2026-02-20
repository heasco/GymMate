// ========================================
// ADD & VIEW TRANSACTIONS - Admin
// ========================================

const SERVER_URL = 'http://localhost:8080';

let selectedMember = null;
let searchTimeout = null;
let currentEditTx = null;

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
  // Clear admin-scoped keys
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
    console.error('[Admin clearLocalAuth] failed to clear generic keys:', e);
  }
}

function getApiBase() {
  return (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? SERVER_URL
    : '';
}

function getToken() {
  return AdminStore.getToken();
}

function adminLogout(reason, loginPath = '../login.html') {
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

    // Cross-tab logout sync for admin only
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
    adminLogout('adminLogoutEvent from another tab (global)', '../login.html');
  }
});

// ---------- Shared secure fetch ----------
async function apiFetch(endpoint, options = {}) {
  const ok = ensureAdminAuthOrLogout('../login.html');
  if (!ok) return;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();

  if (!token || !authUser) {
    adminLogout('missing token/authUser in admin apiFetch', '../login.html');
    return;
  }

  // Basic timestamp check (same as requireAuth)
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in apiFetch', '../login.html');
      return;
    }
    // Refresh timestamp on successful API use
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
  setupAddSectionEventListeners();
  setupViewSectionEventListeners();
  setupTabToggle();
  setupEditPanelEvents();

  // Mini calendars
  initMiniCalendar('paymentDate', 'paymentDateIcon', 'paymentDatePopup');
  initMiniCalendar('txDate', 'txDateIcon', 'txDatePopup', (dateStr) => {
    if (dateStr) filterTransactionsByDate(dateStr);
  });
  initMiniCalendar('editDate', 'editDateIcon', 'editDatePopup');

  // Load latest 10 transactions on initial load of view tab
  loadLatestTransactions();
});

// ---------- Helpers ----------
function $(id) {
  return document.getElementById(id);
}

function setupLayoutChrome() {
  const menuToggle = $('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = $('logoutBtn');

  // Security: Check timestamp + clear token/role on invalid
  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in setupLayoutChrome', '../login.html');
      return;
    }
  } catch (e) {
    adminLogout('invalid authUser JSON in setupLayoutChrome', '../login.html');
    return;
  }

  // Display admin full name in sidebar
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
      const token = getToken();
      try {
        if (token) {
          const logoutUrl = `${getApiBase()}/api/logout`;
          await fetch(logoutUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
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

  // Close sidebar when clicking outside on mobile
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
  const statusElement = $('serverStatus');
  if (!statusElement) return;

  try {
    const result = await apiFetch('/health');
    if (result) {
      statusElement.textContent = 'Connected to server successfully';
      statusElement.className = 'server-status server-connected';
    } else {
      throw new Error('Server response not OK');
    }
  } catch (error) {
    statusElement.textContent =
      'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
  }
}

// ---------- Tab toggle (Add / View) ----------
function setupTabToggle() {
  const tabAdd = $('tabAdd');
  const tabView = $('tabView');
  const addSection = $('addSection');
  const viewSection = $('viewSection');

  if (!tabAdd || !tabView || !addSection || !viewSection) return;

  tabAdd.addEventListener('click', () => {
    tabAdd.classList.add('active');
    tabView.classList.remove('active');
    addSection.classList.remove('hidden');
    viewSection.classList.add('hidden');
  });

  tabView.addEventListener('click', () => {
    tabView.classList.add('active');
    tabAdd.classList.remove('active');
    addSection.classList.add('hidden');
    viewSection.classList.remove('hidden');
    loadLatestTransactions();
  });
}

// =======================================
// ADD TRANSACTION SECTION
// =======================================
function setupAddSectionEventListeners() {
  const memberSearch = $('memberSearch');
  if (memberSearch) {
    memberSearch.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      if (query.length < 2) {
        hideSearchResults();
        return;
      }
      const searchLoading = $('searchLoading');
      if (searchLoading) searchLoading.classList.remove('hidden');
      searchTimeout = setTimeout(async () => {
        await searchMembers(query);
      }, 300);
    });
  }

  const formInputs = document.querySelectorAll(
    '#transactionForm input, #transactionForm select, #transactionForm textarea'
  );
  formInputs.forEach((input) => {
    input.addEventListener('input', checkFormCompletion);
  });

  document.addEventListener('click', (e) => {
    if (
      !e.target.closest('#memberSearch') &&
      !e.target.closest('#searchResults')
    ) {
      hideSearchResults();
    }
  });

  const submitBtn = $('submitTransactionBtn');
  if (submitBtn) {
    submitBtn.addEventListener('click', submitTransaction);
  }
}

async function searchMembers(query) {
  const resultsDiv = $('searchResults');
  const searchLoading = $('searchLoading');
  if (!resultsDiv || !searchLoading) return;

  try {
    const result = await apiFetch(
      `/api/members/search?query=${encodeURIComponent(query)}`
    );
    searchLoading.classList.add('hidden');

    if (!result.success || !result.data || result.data.length === 0) {
      resultsDiv.innerHTML =
        '<div class="member-result">No members found.</div>';
      resultsDiv.classList.remove('hidden');
      return;
    }

    resultsDiv.innerHTML = result.data
      .map(
        (m) => `
        <div class="member-result" data-member-id="${m.memberId}">
          <strong>${m.name}</strong><br>
          <small>Member ID: ${m.memberId}</small>
        </div>
      `
      )
      .join('');
    resultsDiv.classList.remove('hidden');

    resultsDiv.querySelectorAll('.member-result').forEach((el) =>
      el.addEventListener('click', () =>
        handleMemberSelect(el.getAttribute('data-member-id'), result.data)
      )
    );
  } catch (error) {
    searchLoading.classList.add('hidden');
    resultsDiv.innerHTML =
      '<div class="member-result">Error searching members.</div>';
    resultsDiv.classList.remove('hidden');
  }
}

function hideSearchResults() {
  const resultsDiv = $('searchResults');
  if (resultsDiv) {
    resultsDiv.classList.add('hidden');
    resultsDiv.innerHTML = '';
  }
}

function handleMemberSelect(memberId, list) {
  const member = (list || []).find((m) => m.memberId === memberId);
  selectedMember = member || null;

  const infoDiv = $('selectedMemberInfo');
  if (infoDiv && selectedMember) {
    infoDiv.classList.remove('hidden');
    infoDiv.innerHTML = `
      <h3>${selectedMember.name}</h3>
      <p><strong>Member ID:</strong> ${selectedMember.memberId}</p>
      <p><strong>Status:</strong> ${selectedMember.status || 'N/A'}</p>
    `;
  }

  const memberSearch = $('memberSearch');
  if (memberSearch && selectedMember) {
    memberSearch.value = `${selectedMember.name} (${selectedMember.memberId})`;
  }
  hideSearchResults();
  checkFormCompletion();
}

function checkFormCompletion() {
  const amount = $('amount');
  const method = $('paymentMethod');
  const date = $('paymentDate');

  const complete =
    selectedMember &&
    amount &&
    method &&
    date &&
    Number(amount.value) > 0 &&
    method.value &&
    date.value;

  const btn = $('submitTransactionBtn');
  if (btn) btn.disabled = !complete;

  updateConfirmationSummary();
}

function updateConfirmationSummary() {
  const summaryDiv = $('confirmationSummary');
  if (!summaryDiv) return;

  if (!selectedMember) {
    summaryDiv.textContent =
      'Please select a member and enter details first.';
    return;
  }

  const amount = $('amount')?.value || '';
  const method = $('paymentMethod')?.value || '';
  const date = $('paymentDate')?.value || '';
  const desc = $('description')?.value || '';

  summaryDiv.innerHTML = `
    <p><strong>Member:</strong> ${selectedMember.name} (${selectedMember.memberId})</p>
    <p><strong>Amount:</strong> ₱${amount || '0.00'}</p>
    <p><strong>Payment Method:</strong> ${method || '—'}</p>
    <p><strong>Payment Date:</strong> ${date || '—'}</p>
    <p><strong>Description:</strong> ${desc || '—'}</p>
  `;
}

async function submitTransaction() {
  if (!selectedMember) return;

  const btn = $('submitTransactionBtn');
  const resultBox = $('transactionResult');
  const resultMsg = $('resultMessage');

  if (btn) btn.disabled = true;
  if (resultBox) {
    resultBox.className = '';
    resultBox.classList.add('hidden');
  }
  if (resultMsg) {
    resultMsg.className = '';
    resultMsg.classList.add('hidden');
  }

  const payload = {
    member_id: selectedMember.memberId,
    amount: Number($('amount').value),
    payment_method: $('paymentMethod').value,
    payment_date: $('paymentDate').value,
    description: ($('description').value || '').trim(),
  };

  try {
    const res = await apiFetch('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res || res.success === false) {
      throw new Error(res?.error || 'Failed to add transaction.');
    }

    if (resultMsg) {
      resultMsg.textContent = res.message || 'Transaction added successfully.';
      resultMsg.className = 'success';
      resultMsg.classList.remove('hidden');
    }

    if (resultBox) {
      resultBox.className = 'success';
      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <p><strong>Transaction ID:</strong> ${res.data.transaction_id}</p>
        <p><strong>Member:</strong> ${selectedMember.name} (${selectedMember.memberId})</p>
        <p><strong>Amount:</strong> ₱${res.data.amount.toFixed(2)}</p>
        <p><strong>Payment Method:</strong> ${res.data.payment_method}</p>
        <p><strong>Payment Date:</strong> ${new Date(
          res.data.payment_date
        ).toLocaleDateString()}</p>
        <p><strong>Description:</strong> ${res.data.description || '—'}</p>
      `;
    }

    // Clear form for next entry
    const form = document.getElementById('transactionForm');
    if (form) {
        const formElements = form.querySelectorAll('input, select, textarea');
        formElements.forEach(element => {
            const key = `${window.location.pathname}-${element.id || element.name}`;
            sessionStorage.removeItem(key);
        });
        form.reset();
    }
    selectedMember = null;
    const selectedMemberInfo = document.getElementById('selectedMemberInfo');
    if (selectedMemberInfo) {
        selectedMemberInfo.classList.add('hidden');
    }
    checkFormCompletion();
    updateConfirmationSummary();

    loadLatestTransactions();
  } catch (error) {
    if (resultMsg) {
      resultMsg.textContent = error.message || 'Failed to add transaction.';
      resultMsg.className = 'error';
      resultMsg.classList.remove('hidden');
    }
    if (resultBox) {
      resultBox.className = 'error';
      resultBox.classList.remove('hidden');
      resultBox.innerHTML = '';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// =======================================
// VIEW TRANSACTIONS SECTION
// =======================================
function setupViewSectionEventListeners() {
  const searchInput = $('txSearch');
  const searchBtn = $('txSearchBtn');
  const resetBtn = $('txResetBtn');
  const dateInput = $('txDate');

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const q = searchInput ? searchInput.value.trim() : '';
      if (!q && (!dateInput || !dateInput.value)) {
        loadLatestTransactions();
      } else if (q) {
        searchTransactions(q);
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        searchBtn?.click();
      }
    });
  }

  if (dateInput) {
    dateInput.addEventListener('change', () => {
      if (dateInput.value) {
        filterTransactionsByDate(dateInput.value);
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (dateInput) dateInput.value = '';
      $('txViewError')?.classList.add('hidden');
      $('txEmpty')?.classList.add('hidden');
      loadLatestTransactions();
    });
  }
}

function formatPeso(amount) {
  const n = Number(amount || 0);
  return n.toLocaleString('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  });
}

function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function renderTxTable(list) {
  const body = $('txTableBody');
  const empty = $('txEmpty');
  if (!body) return;

  body.innerHTML = '';

  if (!list || list.length === 0) {
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');

  list.forEach((tx) => {
    const tr = document.createElement('tr');
    tr.dataset.txId = tx.transaction_id || '';
    tr.dataset.txMemberName = tx.member_name || 'Unknown';
    tr.dataset.txMemberId = tx.member_id || '';
    tr.dataset.txAmount = tx.amount != null ? String(tx.amount) : '';
    tr.dataset.txMethod = tx.payment_method || '';
    tr.dataset.txDate = tx.payment_date || tx.createdAt || '';
    tr.dataset.txDesc = tx.description || '';

    tr.innerHTML = `
      <td>${formatDate(tx.payment_date || tx.createdAt)}</td>
      <td>${tx.transaction_id || '—'}</td>
      <td>${tx.member_name || 'Unknown'}<br><small>${tx.member_id}</small></td>
      <td>${(tx.payment_method || '').toUpperCase()}</td>
      <td class="right-align">${Number(tx.amount || 0).toFixed(2)}</td>
      <td>${tx.description || '—'}</td>
      <td class="center-align">
        <div class="tx-actions">
          <button
            type="button"
            class="tx-action-btn edit"
            data-tx-id="${tx.transaction_id}"
          >
            Edit
          </button>
          <button
            type="button"
            class="tx-action-btn delete"
            data-tx-id="${tx.transaction_id}"
          >
            Delete
          </button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll('.tx-action-btn.edit').forEach((btn) =>
    btn.addEventListener('click', () =>
      openEditPanel(btn.getAttribute('data-tx-id'))
    )
  );
  body.querySelectorAll('.tx-action-btn.delete').forEach((btn) =>
    btn.addEventListener('click', () =>
      handleDeleteTransaction(btn.getAttribute('data-tx-id'))
    )
  );
}

async function loadLatestTransactions() {
  const status = $('txViewStatus');
  const errorBox = $('txViewError');
  if (status) {
    status.textContent = 'Loading latest 10 transactions...';
    status.classList.remove('hidden');
  }
  if (errorBox) {
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
  }

  try {
    const res = await apiFetch('/api/transactions');
    if (!res || res.success === false) {
      throw new Error(res?.error || 'Failed to load transactions.');
    }
    renderTxTable(res.data || []);
  } catch (error) {
    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  } finally {
    if (status) status.classList.add('hidden');
  }
}

async function searchTransactions(query) {
  const status = $('txViewStatus');
  const errorBox = $('txViewError');
  if (status) {
    status.textContent = 'Searching transactions...';
    status.classList.remove('hidden');
  }
  if (errorBox) {
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
  }

  try {
    const res = await apiFetch(
      `/api/transactions/search?q=${encodeURIComponent(query)}`
    );
    if (!res || res.success === false) {
      throw new Error(res?.error || 'Failed to search transactions.');
    }
    renderTxTable(res.data || []);
  } catch (error) {
    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  } finally {
    if (status) status.classList.add('hidden');
  }
}

async function filterTransactionsByDate(dateStr) {
  const status = $('txViewStatus');
  const errorBox = $('txViewError');
  if (status) {
    status.textContent = 'Filtering by date...';
    status.classList.remove('hidden');
  }
  if (errorBox) {
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
  }

  try {
    const res = await apiFetch(
      `/api/transactions/date?date=${encodeURIComponent(dateStr)}`
    );
    if (!res || res.success === false) {
      throw new Error(res?.error || 'Failed to filter transactions by date.');
    }
    renderTxTable(res.data || []);
  } catch (error) {
    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  } finally {
    if (status) status.classList.add('hidden');
  }
}

// ---------- Delete ----------
async function handleDeleteTransaction(txId) {
  if (!txId) return;
  const confirmDelete = window.confirm(
    `Are you sure you want to delete transaction ${txId}?`
  );
  if (!confirmDelete) return;

  try {
    const res = await apiFetch(`/api/transactions/${encodeURIComponent(txId)}`, {
      method: 'DELETE',
    });
    if (!res || res.success === false) {
      throw new Error(res?.error || 'Failed to delete transaction.');
    }
    alert('Transaction deleted successfully.');
    loadLatestTransactions();
  } catch (e) {
    alert(e.message || 'Failed to delete transaction.');
  }
}

// =======================================
// EDIT PANEL LOGIC
// =======================================
function setupEditPanelEvents() {
  const overlay = $('editTxOverlay');
  const closeBtn = $('editTxCloseBtn');
  const cancelBtn = $('editTxCancelBtn');
  const form = $('editTxForm');

  if (!overlay) return;

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      hideEditPanel();
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      hideEditPanel();
    });
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      hideEditPanel();
    }
  });

  if (form) {
    form.addEventListener('submit', handleEditSubmit);
  }
}

function showEditPanel() {
  const overlay = $('editTxOverlay');
  if (!overlay) return;
  overlay.classList.add('is-open');
}

function hideEditPanel() {
  const overlay = $('editTxOverlay');
  const msg = $('editTxMessage');
  currentEditTx = null;
  if (overlay) overlay.classList.remove('is-open');
  if (msg) {
    msg.className = 'hidden';
    msg.textContent = '';
  }
}

function openEditPanel(txId) {
  if (!txId) return;
  const body = $('txTableBody');
  if (!body) return;

  const row = [...body.querySelectorAll('tr')].find(
    (tr) =>
      tr.querySelector('.tx-action-btn.edit') &&
      tr.querySelector('.tx-action-btn.edit').dataset.txId === txId
  );
  if (!row) return;

  currentEditTx = txId;
  fillEditFormFromRow(row);
  showEditPanel();
}

function fillEditFormFromRow(row) {
  const txId = row.querySelector('.tx-action-btn.edit')?.dataset.txId || '';
  const memberCell = row.children[2];
  const amountCell = row.children[4];
  const descCell = row.children[5];
  const methodCell = row.children[3];

  const memberName = memberCell
    ? memberCell.childNodes[0].textContent.trim()
    : '';
  const memberId = memberCell
    ? (memberCell.querySelector('small')?.textContent || '').trim()
    : '';

  $('editTxId').value = txId;
  $('editTxMember').value = memberId
    ? `${memberName} (${memberId})`
    : memberName;

  const rawAmount = amountCell ? amountCell.textContent.replace(/[^0-9.]/g, '') : '';
  $('editAmount').value = rawAmount || '';

  const method = methodCell ? methodCell.textContent.trim().toLowerCase() : '';
  $('editMethod').value =
    method === 'cash' || method === 'e-wallet' || method === 'bank'
      ? method
      : '';

  const dateText = row.children[0].textContent.trim();
  const parsed = new Date(dateText);
  if (!Number.isNaN(parsed.getTime())) {
    $('editDate').value = parsed.toISOString().slice(0, 10);
  } else {
    $('editDate').value = '';
  }

  $('editDesc').value = descCell ? descCell.textContent.trim() : '';
}

async function handleEditSubmit(e) {
  e.preventDefault();
  if (!currentEditTx) return;

  const msg = $('editTxMessage');
  const saveBtn = $('editTxSaveBtn');

  if (msg) {
    msg.className = 'hidden';
    msg.textContent = '';
  }

  const payload = {};
  const amountStr = $('editAmount').value.trim();
  const method = $('editMethod').value;
  const dateStr = $('editDate').value;
  const desc = $('editDesc').value;

  if (amountStr) {
    const num = Number(amountStr);
    if (Number.isNaN(num) || num <= 0) {
      if (msg) {
        msg.textContent = 'Amount must be a positive number.';
        msg.className = 'error';
      }
      return;
    }
    payload.amount = num;
  }

  if (method) payload.payment_method = method;
  if (dateStr) payload.payment_date = dateStr;
  payload.description = desc;

  if (Object.keys(payload).length === 0) {
    hideEditPanel();
    return;
  }

  if (saveBtn) saveBtn.disabled = true;

  try {
    const res = await apiFetch(
      `/api/transactions/${encodeURIComponent(currentEditTx)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
    if (!res || res.success === false) {
      throw new Error(res?.error || 'Failed to update transaction.');
    }

    if (msg) {
      msg.textContent = 'Transaction updated successfully.';
      msg.className = 'success';
    }

    await loadLatestTransactions();
    hideEditPanel();
  } catch (error) {
    if (msg) {
      msg.textContent = error.message || 'Failed to update transaction.';
      msg.className = 'error';
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ---------- Mini Calendar Utility ----------
function initMiniCalendar(inputId, buttonId, popupId, onSelect) {
  const input = $(inputId);
  const btn = $(buttonId);
  const popup = $(popupId);
  if (!input || !btn || !popup) return;

  let current = input.value ? new Date(input.value) : new Date();
  if (Number.isNaN(current.getTime())) current = new Date();

  const titleEl = popup.querySelector('.mini-calendar-title');
  const gridEl = popup.querySelector('.mini-calendar-grid');
  const navBtns = popup.querySelectorAll('.mini-cal-nav');

  function renderCalendar() {
    const year = current.getFullYear();
    const month = current.getMonth();

    if (titleEl) {
      const formatter = new Intl.DateTimeFormat('en-PH', {
        month: 'long',
        year: 'numeric',
      });
      titleEl.textContent = formatter.format(current);
    }

    if (!gridEl) return;
    gridEl.innerHTML = '';

    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    dayNames.forEach((d) => {
      const h = document.createElement('button');
      h.type = 'button';
      h.textContent = d;
      h.className = 'mini-cal-day-header';
      gridEl.appendChild(h);
    });

    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startWeekday; i += 1) {
      const empty = document.createElement('button');
      empty.type = 'button';
      empty.className = 'mini-cal-day mini-cal-day-disabled';
      empty.textContent = '';
      gridEl.appendChild(empty);
    }

    const selectedDateStr = input.value || null;

    for (let day = 1; day <= daysInMonth; day += 1) {
      const btnDay = document.createElement('button');
      btnDay.type = 'button';
      btnDay.textContent = String(day);
      btnDay.className = 'mini-cal-day';

      const thisDate = new Date(year, month, day);
      const iso = thisDate.toISOString().slice(0, 10);
      if (selectedDateStr && iso === selectedDateStr) {
        btnDay.classList.add('mini-cal-day-selected');
      }

      btnDay.addEventListener('click', () => {
        input.value = iso;
        popup.classList.add('hidden');
        if (typeof onSelect === 'function') {
          onSelect(iso);
        } else {
          input.dispatchEvent(new Event('change'));
        }
      });

      gridEl.appendChild(btnDay);
    }
  }

  navBtns.forEach((n) =>
    n.addEventListener('click', () => {
      const dir = Number(n.getAttribute('data-dir') || '0');
      current.setMonth(current.getMonth() + dir);
      renderCalendar();
    })
  );

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.classList.toggle('hidden');
    current = input.value ? new Date(input.value) : new Date();
    if (Number.isNaN(current.getTime())) current = new Date();
    renderCalendar();
  });

  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && !btn.contains(e.target)) {
      popup.classList.add('hidden');
    }
  });
}


