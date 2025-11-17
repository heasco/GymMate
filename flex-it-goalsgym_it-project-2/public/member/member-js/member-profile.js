// ========================================
// Member Profile - Tokenized + Idle Warning
// ========================================

// Config
const SERVER_URL = 'http://localhost:8080';
const API_URL = SERVER_URL;
const MEMBER_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const MEMBER_IDLE_WARNING_MS = 15 * 60 * 1000;        // 15 minutes

// Idle tracking (member only)
let memberLastActivity = Date.now();
let memberIdleWarningShown = false;

// Member-scoped storage keys (avoid admin/trainer interference)
const MEMBER_KEYS = {
  token: 'member_token',
  authUser: 'member_authUser',
  role: 'member_role',
  logoutEvent: 'memberLogoutEvent',
};

// Utility
const $ = (id) => document.getElementById(id);

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

// --------------------------------------
// Auth helpers
// --------------------------------------
function getAuth() {
  try {
    bootstrapMemberFromGenericIfNeeded();
    return MemberStore.getAuthUser();
  } catch (e) {
    console.error('[Auth] Error getting authUser:', e);
    return null;
  }
}

function memberIdFromAuth() {
  const auth = getAuth();
  console.log('[Auth] Full auth object:', auth);
  if (!auth) {
    console.error('[Auth] No auth found');
    return null;
  }
  const user = auth.user || auth;
  console.log('[Auth] User object:', user);
  const id = user.memberId || user.member_id || user._id || user.id || null;
  console.log('[Auth] Extracted member ID:', id);
  return id;
}

// --------------------------------------
// Centralized logout (member-scoped)
// --------------------------------------
function memberLogout(reason) {
  console.log('[Logout] Member logout (profile):', reason || 'no reason');

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

// Wrapper to keep existing logout() calls working
function logout(reason) {
  memberLogout(reason);
}

// Cross‑tab member logout sync
window.addEventListener('storage', (event) => {
  if (event.key === MEMBER_KEYS.logoutEvent) {
    console.log('[Member Logout] profile page sees logout from another tab');
    MemberStore.clear();
    window.location.href = '../member-login.html';
  }
});

// ------------------------------
// Idle helpers (member only)
// ------------------------------
function markMemberActivity() {
  memberLastActivity = Date.now();
  // allow banner to show again after activity
  memberIdleWarningShown = false;
}

// Idle banner at top (like other member modules)
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
      memberLogout('user chose logout after idle warning (profile)');
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
  // Count these events as user activity
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, markMemberActivity, { passive: true });
  });

  // Poll every 30s
  setInterval(() => {
    bootstrapMemberFromGenericIfNeeded();

    const token = MemberStore.getToken();
    const role = MemberStore.getRole();
    const authUser = MemberStore.getAuthUser();

    if (!token || !authUser || role !== 'member') return;

    // Enforce 2-hour absolute session max
    try {
      const ts = authUser.timestamp || 0;
      if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
        console.log(
          'Member session exceeded 2 hours, logging out (profile idle watcher).'
        );
        memberLogout('session max age exceeded in profile idle watcher');
        return;
      }
    } catch (e) {
      console.error('Failed to parse authUser in idle watcher:', e);
      memberLogout('invalid authUser JSON in profile idle watcher');
      return;
    }

    // Idle warning at 15 minutes
    const idleFor = Date.now() - memberLastActivity;
    if (!memberIdleWarningShown && idleFor >= MEMBER_IDLE_WARNING_MS) {
      console.log(
        "You've been idle for 15 minutes on profile page. Showing idle banner."
      );
      memberIdleWarningShown = true;
      showMemberIdleBanner();
    }
  }, 30000);
}

// ------------------------------
// apiFetch: full URL + auth + timeout (MemberStore-based)
// ------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log('apiFetch called for:', endpoint); // DEBUG

  bootstrapMemberFromGenericIfNeeded();

  const token = MemberStore.getToken();
  const role = MemberStore.getRole();
  const authUser = MemberStore.getAuthUser();

  if (!token || !authUser || role !== 'member') {
    console.log('No valid member token/authUser/role - redirecting to login'); // DEBUG
    memberLogout('missing token/authUser/role in profile apiFetch');
    return;
  }

  // 2-hour session max check + refresh timestamp
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
      console.log('Session max age exceeded in apiFetch (profile).'); // DEBUG
      memberLogout('session max age exceeded in profile apiFetch');
      return;
    }
    // Treat successful API usage as activity
    authUser.timestamp = Date.now();
    MemberStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to parse authUser in profile apiFetch:', e);
    memberLogout('invalid authUser JSON in profile apiFetch');
    return;
  }

  // Use endpoint directly if full URL; otherwise prepend base
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    url =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
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
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      console.log('401/403 Unauthorized - clearing auth and redirecting'); // DEBUG
      memberLogout('401/403 from profile apiFetch');
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

// ✅ INITIAL AUTH CHECK - Token + Role ('member') + 2-hour Timestamp
(function checkAuth() {
  console.log('Auth check starting for member-profile'); // DEBUG

  bootstrapMemberFromGenericIfNeeded();

  const authUser = MemberStore.getAuthUser();
  const token = MemberStore.getToken();
  const role = MemberStore.getRole();

  console.log('Auth details:', {
    authUser: authUser ? authUser.username || authUser.email : null,
    token: !!token,
    role,
  }); // DEBUG

  if (
    !authUser ||
    !token ||
    role !== 'member' ||
    Date.now() - (authUser.timestamp || 0) > MEMBER_SESSION_MAX_AGE_MS
  ) {
    console.log('Auth failed - clearing and redirecting'); // DEBUG
    memberLogout('initial auth check failed (profile)');
    return;
  }

  console.log(
    'Member authenticated (profile):',
    authUser.username || authUser.email,
    'Role:',
    role
  );
})();

// Format date to "Month Day, Year"
function formatDate(dateString) {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid Date';
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  } catch (e) {
    console.error('[Date] Error formatting date:', e);
    return 'N/A';
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Init] Page loaded, initializing profile page');

  // Start idle tracking
  setupMemberIdleWatcher();
  markMemberActivity();

  // Logout functionality
  if ($('logoutBtn')) {
    $('logoutBtn').addEventListener('click', (e) => {
      e.preventDefault();
      logout('manual member logout button');
    });
  }

  // Menu toggle
  if ($('menuToggle')) {
    $('menuToggle').addEventListener('click', () => {
      document.querySelector('.sidebar')?.classList.toggle('collapsed');
      markMemberActivity();
    });
  }

  // Load current member info
  loadProfile();

  // Listen for update submit
  if ($('profileForm')) {
    $('profileForm').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      markMemberActivity();
      updateProfile();
    });
  }
});

// Load member profile (unchanged logic, now using MemberStore-backed apiFetch)
async function loadProfile() {
  console.log('[Profile] Starting to load profile...');

  const memberId = memberIdFromAuth();
  console.log('[Profile] Member ID from auth:', memberId);

  if (!memberId) {
    console.error('[Profile] No member ID found, logging out');
    return logout('no memberId in loadProfile');
  }

  if ($('profileMsg')) $('profileMsg').style.display = 'none';

  try {
    const url = `${API_URL}/api/members/${encodeURIComponent(memberId)}`;
    console.log('[Profile] Fetching from URL:', url);

    const response = await apiFetch(url);
    console.log('[Profile] Response data:', response);

    const member = response.data || response;
    console.log('[Profile] Member object:', member);

    // Display member name in greeting
    if ($('profileName')) {
      $('profileName').textContent = member.name || 'Member';
      console.log('[Profile] Set profile name:', member.name);
    }

    // Display member ID badge
    if ($('profileMemberId')) {
      $('profileMemberId').textContent = member.memberId || 'N/A';
      console.log('[Profile] Set member ID:', member.memberId);
    }

    // Display basic contact info
    if ($('profileEmail')) $('profileEmail').value = member.email || '';
    if ($('profilePhone')) $('profilePhone').value = member.phone || '';

    // Display member since (createdAt)
    if ($('memberSince')) {
      const joinDateValue = member.createdAt || member.joinDate;
      console.log('[Profile] Join date raw value:', joinDateValue);
      const formattedDate = formatDate(joinDateValue);
      console.log('[Profile] Join date formatted:', formattedDate);
      $('memberSince').textContent = formattedDate;
    }

    // Display membership status (from member.status)
    if ($('membershipStatus')) {
      const status = member.status || 'inactive';
      $('membershipStatus').textContent =
        status.charAt(0).toUpperCase() + status.slice(1);
      $('membershipStatus').className = `info-value status-${status}`;
      console.log('[Profile] Set membership status:', status);
    }

    // Display membership types and remaining sessions
    if (member.memberships && member.memberships.length > 0) {
      const types = member.memberships
        .map((m) => m.type.charAt(0).toUpperCase() + m.type.slice(1))
        .join(', ');
      if ($('membershipType')) {
        $('membershipType').textContent = types;
        console.log('[Profile] Set membership types:', types);
      }

      const combative = member.memberships.find((m) => m.type === 'combative');
      if ($('remainingSessions')) {
        if (combative) {
          $('remainingSessions').textContent = `${
            combative.remainingSessions || 0
          } sessions`;
        } else {
          $('remainingSessions').textContent = '—';
        }
      }
    } else if ($('membershipType')) {
      $('membershipType').textContent = 'No active memberships';
    }

    console.log('[Profile] Profile loaded successfully!');
  } catch (e) {
    console.error('[Profile] Error loading profile:', e);

    if ($('profileMsg')) {
      $('profileMsg').className = 'message error';
      $('profileMsg').style.display = '';
      $('profileMsg').textContent = 'Failed to load profile: ' + e.message;
    }

    if ($('profileName')) $('profileName').textContent = 'Error loading';
    if ($('profileMemberId')) $('profileMemberId').textContent = 'Error';
    if ($('memberSince')) $('memberSince').textContent = 'Error';
  }
}

// Update member profile (unchanged logic, now using MemberStore-backed apiFetch)
async function updateProfile() {
  console.log('[Update] Starting profile update...');

  const memberId = memberIdFromAuth();
  if (!memberId) {
    console.error('[Update] No member ID, logging out');
    return logout('no memberId in updateProfile');
  }

  const email = $('profileEmail').value.trim();
  const phone = $('profilePhone').value.trim();

  if ($('profileMsg')) $('profileMsg').style.display = 'none';

  try {
    const url = `${API_URL}/api/members/${encodeURIComponent(memberId)}/profile`;
    console.log('[Update] PUT to URL:', url);

    const responseData = await apiFetch(url, {
      method: 'PUT',
      body: JSON.stringify({ email, phone }),
    });
    console.log('[Update] Response data:', responseData);

    if (responseData.error || responseData.message) {
      throw new Error(
        responseData.error || responseData.message || 'Update failed'
      );
    }

    // Update auth user in MemberStore and generic authUser for compatibility
    const token = MemberStore.getToken();
    const currentAuth = MemberStore.getAuthUser();
    if (token && currentAuth && responseData.data) {
      const updated = {
        ...currentAuth,
        user: responseData.data,
      };
      MemberStore.set(token, updated);

      // Also refresh generic authUser used by login.js / older code
      try {
        localStorage.setItem('authUser', JSON.stringify(updated));
        sessionStorage.setItem('authUser', JSON.stringify(updated));
      } catch (e) {
        console.error('[Update] Failed to update generic authUser:', e);
      }

      console.log('[Update] Updated MemberStore + authUser');
    }

    if ($('profileMsg')) {
      $('profileMsg').className = 'message success';
      $('profileMsg').textContent = 'Changes saved!';
      $('profileMsg').style.display = '';
    }

    // Reload profile after 2 seconds
    setTimeout(() => {
      loadProfile();
      if ($('profileMsg')) {
        $('profileMsg').style.display = 'none';
      }
    }, 2000);
  } catch (e) {
    console.error('[Update] Error updating profile:', e);

    if ($('profileMsg')) {
      $('profileMsg').className = 'message error';
      $('profileMsg').textContent = 'Error: ' + (e.message || 'Update failed');
      $('profileMsg').style.display = '';
    }
  }
}
