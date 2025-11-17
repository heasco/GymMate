// ========================================
// Member Transactions - Tokenized front-end
// ========================================

const SERVER_URL = 'http://localhost:8080';

// Idle + session limits (member only)
const MEMBER_IDLE_WARNING_MS = 15 * 60 * 1000; // 15 minutes
const MEMBER_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Member-scoped storage keys (avoid admin/trainer interference)
const MEMBER_KEYS = {
  token: 'member_token',
  authUser: 'member_authUser',
  role: 'member_role',
  logoutEvent: 'memberLogoutEvent',
};

// --------------------------------------
// Member storage helpers (namespaced)
// --------------------------------------
const MemberStore = {
  set(token, userPayload) {
    try {
      const authUser = {
        ...(userPayload || {}),
        timestamp: Date.now(),
        role: 'member',
        token,
      };

      // Prefer localStorage for cross-tab; mirror to sessionStorage
      localStorage.setItem(MEMBER_KEYS.token, token);
      localStorage.setItem(MEMBER_KEYS.authUser, JSON.stringify(authUser));
      localStorage.setItem(MEMBER_KEYS.role, 'member');

      sessionStorage.setItem(MEMBER_KEYS.token, token);
      sessionStorage.setItem(MEMBER_KEYS.authUser, JSON.stringify(authUser));
      sessionStorage.setItem(MEMBER_KEYS.role, 'member');
    } catch (e) {
      console.error('[MemberStore.set] failed:', e);
    }
  },

  getToken() {
    return (
      sessionStorage.getItem(MEMBER_KEYS.token) ||
      localStorage.getItem(MEMBER_KEYS.token) ||
      null
    );
  },

  getAuthUser() {
    const raw =
      sessionStorage.getItem(MEMBER_KEYS.authUser) ||
      localStorage.getItem(MEMBER_KEYS.authUser);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[MemberStore.getAuthUser] parse error:', e);
      return null;
    }
  },

  getRole() {
    return (
      sessionStorage.getItem(MEMBER_KEYS.role) ||
      localStorage.getItem(MEMBER_KEYS.role) ||
      null
    );
  },

  hasSession() {
    const token =
      localStorage.getItem(MEMBER_KEYS.token) ||
      sessionStorage.getItem(MEMBER_KEYS.token);
    const authUser =
      localStorage.getItem(MEMBER_KEYS.authUser) ||
      sessionStorage.getItem(MEMBER_KEYS.authUser);
    const role =
      localStorage.getItem(MEMBER_KEYS.role) ||
      sessionStorage.getItem(MEMBER_KEYS.role);
    return !!token && !!authUser && role === 'member';
  },

  clear() {
    localStorage.removeItem(MEMBER_KEYS.token);
    localStorage.removeItem(MEMBER_KEYS.authUser);
    localStorage.removeItem(MEMBER_KEYS.role);

    sessionStorage.removeItem(MEMBER_KEYS.token);
    sessionStorage.removeItem(MEMBER_KEYS.authUser);
    sessionStorage.removeItem(MEMBER_KEYS.role);
  },
};

// --------------------------------------
// Backward‑compatible bootstrap
// Copy valid member session from generic keys into member_* once
// --------------------------------------
function bootstrapMemberFromGenericIfNeeded() {
  try {
    if (MemberStore.hasSession()) return;

    const genToken =
      localStorage.getItem('token') || sessionStorage.getItem('token');
    const genRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');
    const genAuthRaw =
      localStorage.getItem('authUser') || sessionStorage.getItem('authUser');

    if (!genToken || !genRole || genRole !== 'member' || !genAuthRaw) return;

    const genAuth = JSON.parse(genAuthRaw);
    MemberStore.set(genToken, genAuth);
  } catch (e) {
    console.error('[bootstrapMemberFromGenericIfNeeded] failed:', e);
  }
}

// ------------------------------
// Shared member helpers
// ------------------------------
function memberLogout(reason) {
  console.log('Member logout (transactions):', reason || 'no reason provided'); // DEBUG

  // Clear member_* keys
  MemberStore.clear();

  // Also clear legacy generic keys if they currently represent a member session
  try {
    const genericRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');

    if (genericRole === 'member') {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');

      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
    }
  } catch (e) {
    console.error('[memberLogout] failed to clear generic member keys:', e);
  }

  // Notify other member tabs in this browser
  localStorage.setItem(MEMBER_KEYS.logoutEvent, Date.now().toString());

  window.location.href = '../member-login.html';
}

// Cross‑tab member logout sync
window.addEventListener('storage', (event) => {
  if (event.key === MEMBER_KEYS.logoutEvent) {
    console.log('[Member Logout] transactions page sees logout from another tab');
    MemberStore.clear();
    window.location.href = '../member-login.html';
  }
});

// ------------------------------
// Secure fetch helper (member)
// ------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  bootstrapMemberFromGenericIfNeeded();

  const token = MemberStore.getToken();
  const authUser = MemberStore.getAuthUser();
  const role = MemberStore.getRole();

  if (!token || !authUser || role !== 'member') {
    memberLogout('missing token/authUser/role in apiFetch (transactions)');
    return;
  }

  // Hard 2-hour session limit
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
      memberLogout('session max age exceeded in apiFetch (transactions)');
      return;
    }
    // Treat successful API calls as activity (refresh timestamp)
    authUser.timestamp = Date.now();
    MemberStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to parse authUser in apiFetch (transactions):', e);
    memberLogout('invalid authUser JSON in apiFetch (transactions)');
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

    if (res.status === 401 || res.status === 403) {
      memberLogout('401/403 from apiFetch (transactions)');
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

// ------------------------------
// Initial auth check: token + role + timestamp (2 hours)
// ------------------------------
(function checkAuth() {
  console.log('Auth check starting for member-transactions'); // DEBUG

  bootstrapMemberFromGenericIfNeeded();

  const authUser = MemberStore.getAuthUser();
  const token = MemberStore.getToken();
  const role = MemberStore.getRole();

  if (
    !authUser ||
    !token ||
    role !== 'member' ||
    Date.now() - (authUser.timestamp || 0) > MEMBER_SESSION_MAX_AGE_MS
  ) {
    memberLogout('initial auth check failed (transactions)');
  }
})();

// Utility
const $ = (id) => document.getElementById(id);

function getAuth() {
  try {
    bootstrapMemberFromGenericIfNeeded();
    return MemberStore.getAuthUser();
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

// ------------------------------
// Idle tracking (member only)
// ------------------------------
let memberLastActivity = Date.now();
let memberIdleWarningShown = false;

function markMemberActivity() {
  memberLastActivity = Date.now();
  memberIdleWarningShown = false;
}

// Idle banner at top
function showMemberIdleBanner() {
  let banner = document.getElementById('memberIdleBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'memberIdleBanner';
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
      const token = MemberStore.getToken();
      const authUser = MemberStore.getAuthUser();
      if (token && authUser) {
        authUser.timestamp = Date.now();
        MemberStore.set(token, authUser);
      }
      markMemberActivity();
      memberIdleWarningShown = true;
      hideMemberIdleBanner();
    });

    logoutBtn.addEventListener('click', () => {
      memberLogout('user chose to logout after idle warning (transactions)');
    });

    banner.appendChild(textSpan);
    banner.appendChild(stayBtn);
    banner.appendChild(logoutBtn);
    document.body.appendChild(banner);
  } else {
    banner.style.display = 'flex';
  }
}

function hideMemberIdleBanner() {
  const banner = document.getElementById('memberIdleBanner');
  if (banner) banner.style.display = 'none';
}

function setupMemberIdleWatcher() {
  // Any user interaction counts as activity
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, markMemberActivity, { passive: true });
  });

  // Check every 30 seconds
  setInterval(() => {
    bootstrapMemberFromGenericIfNeeded();

    const authUser = MemberStore.getAuthUser();
    const token = MemberStore.getToken();
    const role = MemberStore.getRole();

    // If already logged out, stop caring
    if (!authUser || !token || role !== 'member') {
      return;
    }

    // Hard 2-hour kill (even if active)
    try {
      const ts = authUser.timestamp || 0;
      if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
        console.log('Member session exceeded 2 hours, logging out.'); // DEBUG
        memberLogout('session max age exceeded in idle watcher (transactions)');
        return;
      }
    } catch (e) {
      console.error('Failed to parse authUser in idle watcher:', e);
      memberLogout('invalid authUser JSON in idle watcher (transactions)');
      return;
    }

    const now = Date.now();
    const idleFor = now - memberLastActivity;

    if (!memberIdleWarningShown && idleFor >= MEMBER_IDLE_WARNING_MS) {
      console.log(
        "You've been idle for 15 minutes. Showing idle banner (transactions)."
      );
      memberIdleWarningShown = true;
      showMemberIdleBanner();
    }
  }, 30000);
}

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  // Start idle tracking for member
  setupMemberIdleWatcher();
  markMemberActivity();

  // Sidebar toggle
  const menuToggle = $('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      markMemberActivity();
    });
  }

  // Logout
  const logoutBtn = $('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      memberLogout('manual member logout button (transactions)');
    });
  }

  // Greeting
  const storedName = sessionStorage.getItem('memberName');
  if ($('memberName')) {
    $('memberName').textContent = (storedName || 'Member').toUpperCase();
  }

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
