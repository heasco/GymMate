// ========================================
// Member Transactions - Tokenized front-end
// ========================================

const SERVER_URL = 'http://localhost:8080';

// Secure fetch helper (same pattern as other member pages)
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  const token = sessionStorage.getItem('token');

  if (!token) {
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    window.location.href = '../member-login.html';
    return;
  }

  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    url =
      location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? `${SERVER_URL}${endpoint}`
        : endpoint;
  }

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.status === 401) {
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('role');
      window.location.href = '../member-login.html';
      return;
    }

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error(`API timeout after ${timeoutMs}ms`);
    throw e;
  }
}

// Initial auth check: token + role + timestamp (1 hour)
(function checkAuth() {
  const authUser = JSON.parse(sessionStorage.getItem('authUser') || 'null');
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');

  if (
    !authUser ||
    Date.now() - (authUser.timestamp || 0) > 3600000 ||
    !token ||
    role !== 'member'
  ) {
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    window.location.href = '../member-login.html';
  }
})();

// Utility
const $ = (id) => document.getElementById(id);

function getAuth() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

function getMemberMongoId() {
  const a = getAuth();
  if (!a) return null;
  const u = a.user || a;
  return u._id || u.id || u.memberId || u.member_id || null;
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

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  // Sidebar toggle
  const menuToggle = $('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  }

  // Logout
  const logoutBtn = $('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('memberData');
      sessionStorage.removeItem('memberName');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('role');
      window.location.href = '../member-login.html';
    });
  }

  // Greeting
  const storedName = sessionStorage.getItem('memberName');
  if ($('memberName')) $('memberName').textContent = (storedName || 'Member').toUpperCase();

  const auth = getAuth();
  const u = auth?.user || auth;
  if (u && $('memberIdBadge')) {
    $('memberIdBadge').textContent = u.memberId || u._id || 'Member';
  }

  // Load transactions
  loadTransactions();
});

async function loadTransactions() {
  const loadingEl = $('transactionsLoading');
  const errorEl = $('transactionsError');
  const bodyEl = $('transactionsBody');
  const emptyEl = $('noTransactions');

  if (!bodyEl) return;

  if (loadingEl) loadingEl.style.display = '';
  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }
  if (emptyEl) emptyEl.style.display = 'none';
  bodyEl.innerHTML = '';

  const memberId = getMemberMongoId();
  if (!memberId) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (errorEl) {
      errorEl.style.display = '';
      errorEl.textContent = 'Session expired. Please log in again.';
    }
    return;
  }

  try {
    const res = await apiFetch(
      `/api/transactions/member/${encodeURIComponent(memberId)}`
    );
    if (!res || res.success === false) {
      throw new Error(res?.error || 'Failed to load transactions.');
    }

    const list = res.data || [];
    renderTransactions(list);
  } catch (e) {
    if (errorEl) {
      errorEl.style.display = '';
      errorEl.textContent = e.message || 'Failed to load transactions.';
    }
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function renderTransactions(list) {
  const bodyEl = $('transactionsBody');
  const emptyEl = $('noTransactions');
  const totalTxEl = $('totalTransactions');
  const totalAmountEl = $('totalAmount');

  if (!bodyEl) return;

  bodyEl.innerHTML = '';

  if (!list || list.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    if (totalTxEl) totalTxEl.textContent = '0';
    if (totalAmountEl) totalAmountEl.textContent = '₱0.00';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  let totalAmount = 0;

  list.forEach((tx) => {
    totalAmount += Number(tx.amount || 0);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${tx.transaction_id || '—'}</td>
      <td>${formatDate(tx.payment_date || tx.createdAt)}</td>
      <td>${tx.description || 'Payment'}</td>
      <td>${(tx.payment_method || '').toUpperCase()}</td>
      <td class="right-align">${Number(tx.amount || 0).toFixed(2)}</td>
    `;
    bodyEl.appendChild(tr);
  });

  if (totalTxEl) totalTxEl.textContent = String(list.length);
  if (totalAmountEl) totalAmountEl.textContent = formatPeso(totalAmount);
}
