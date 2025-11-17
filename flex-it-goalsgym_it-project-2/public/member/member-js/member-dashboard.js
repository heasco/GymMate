// Server configuration
const SERVER_URL = 'http://localhost:8080';
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
// Idle helpers (member)
// --------------------------------------
function markMemberActivity() {
  memberLastActivity = Date.now();
  // allow banner to show again after activity
  memberIdleWarningShown = false;
}

// Create / show idle banner
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
    textSpan.textContent = "You've been idle for 15 minutes. Stay logged in or logout?";

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
      showToast('You are still logged in.', 'info');
    });

    logoutBtn.addEventListener('click', () => {
      memberLogout('user chose logout after idle warning');
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
  // Treat these as activity
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, markMemberActivity, { passive: true });
  });

  // Check every 30 seconds
  setInterval(() => {
    bootstrapMemberFromGenericIfNeeded();

    const token = MemberStore.getToken();
    const role = MemberStore.getRole();
    const authUser = MemberStore.getAuthUser();

    if (!token || !authUser || role !== 'member') return;

    // Hard 2-hour session cap
    try {
      const ts = authUser.timestamp || 0;
      if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
        console.log('Member session exceeded 2 hours, logging out (idle watcher).');
        memberLogout('session max age exceeded in idle watcher');
        return;
      }
    } catch (e) {
      console.error('Failed to parse authUser in idle watcher:', e);
      memberLogout('invalid authUser JSON in idle watcher');
      return;
    }

    const now = Date.now();
    const idleFor = now - memberLastActivity;

    if (!memberIdleWarningShown && idleFor >= MEMBER_IDLE_WARNING_MS) {
      console.log("You've been idle for 15 minutes. Showing idle banner.");
      memberIdleWarningShown = true;
      showMemberIdleBanner();
    }
  }, 30000);
}

// --------------------------------------
// Centralized logout (member-scoped)
// --------------------------------------
function memberLogout(reason) {
  console.log('[Logout] Member logout:', reason || 'no reason');

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
    console.log('[Member Logout] detected from another tab');
    MemberStore.clear();
    window.location.href = '../member-login.html';
  }
});

// --------------------------------------
// JWT Authentication Helper for members
// --------------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  bootstrapMemberFromGenericIfNeeded();

  const token = MemberStore.getToken();
  const authUser = MemberStore.getAuthUser();
  const role = MemberStore.getRole();

  if (!token || !authUser || role !== 'member') {
    memberLogout('missing token/authUser/role in apiFetch');
    return;
  }

  // 2-hour session max check + update timestamp
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
      console.log('Session max age exceeded in apiFetch');
      memberLogout('session max age exceeded in apiFetch');
      return;
    }
    authUser.timestamp = Date.now();
    MemberStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to parse authUser in apiFetch:', e);
    memberLogout('invalid authUser JSON in apiFetch');
    return;
  }

  let url = endpoint;

  // If not a full URL, prepend SERVER_URL and ensure /api prefix
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    if (!endpoint.startsWith('/api/')) {
      endpoint = '/api' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    }
    url = `${SERVER_URL}${endpoint}`;
    console.log('API URL:', url);
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
      memberLogout('401/403 from apiFetch');
      return;
    }

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw e;
  }
}

// --------------------------------------
// Initialize page / sidebar
// --------------------------------------
document.addEventListener('DOMContentLoaded', function () {
  setupMemberIdleWatcher();
  markMemberActivity();
  initializePage();
  loadDashboard();
});

function initializePage() {
  setupSidebarAndSession();
}

function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  // Ensure member_* keys are populated if old generic keys exist
  bootstrapMemberFromGenericIfNeeded();

  // JWT Token auth check
  const token = MemberStore.getToken();
  const role = MemberStore.getRole();
  const authUser = MemberStore.getAuthUser();

  if (!token || !authUser || role !== 'member') {
    memberLogout('missing member session in setupSidebarAndSession');
    return;
  }

  try {
    if (Date.now() - (authUser.timestamp || 0) > MEMBER_SESSION_MAX_AGE_MS) {
      memberLogout('member session max age exceeded in setupSidebarAndSession');
      return;
    }
  } catch (error) {
    console.error('Error parsing authUser:', error);
    memberLogout('invalid authUser JSON in setupSidebarAndSession');
    return;
  }

  // Menu toggle functionality
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      markMemberActivity();
    });
  }

  // Logout functionality
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const token = MemberStore.getToken();
      try {
        if (token) {
          const logoutUrl =
            (window.location.hostname === 'localhost' ||
              window.location.hostname === '127.0.0.1')
              ? `${SERVER_URL}/api/logout`
              : '/api/logout';
          await fetch(logoutUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
      } catch (e) {
        console.error('Member logout error:', e);
      } finally {
        memberLogout('manual member logout button');
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
}

// --------------------------------------
// Get member ID from auth
// --------------------------------------
function getMemberIdFromAuth() {
  try {
    bootstrapMemberFromGenericIfNeeded();
    const authUser = MemberStore.getAuthUser();
    if (!authUser) return null;

    const user = authUser.user || authUser;
    return (
      user.memberId ||
      user.member_id ||
      user._id ||
      user.id ||
      null
    );
  } catch (error) {
    console.error('Error getting member ID:', error);
    return null;
  }
}

// --------------------------------------
// Load dashboard data (unchanged logic)
// --------------------------------------
async function loadDashboard() {
  const memberId = getMemberIdFromAuth();
  if (!memberId) {
    memberLogout('no memberId in loadDashboard');
    return;
  }

  // Set initial loading states
  document.getElementById('dashboardName').textContent = 'Loading...';
  document.getElementById('dashboardMemberId').textContent = `ID: ${memberId}`;
  document.getElementById('membershipTypes').innerHTML = '<li>Loading memberships...</li>';
  document.getElementById('remainingCombSessions').textContent = '—';
  document.getElementById('infoEmail').textContent = 'Loading...';
  document.getElementById('infoPhone').textContent = 'Loading...';
  document.getElementById('infoJoinDate').textContent = 'Loading...';

  const errorElement = document.getElementById('error');
  if (errorElement) {
    errorElement.style.display = 'none';
  }

  try {
    // Load member data
    console.log('Loading member data for:', memberId);
    const memberResponse = await apiFetch('/members');
    let targetMember = null;

    if (memberResponse && memberResponse.success && Array.isArray(memberResponse.data)) {
      console.log(
        'Searching for member ID:',
        memberId,
        'in',
        memberResponse.data.length,
        'members'
      );
      targetMember = memberResponse.data.find((m) => {
        const matches =
          (m.memberId && m.memberId === memberId) ||
          (m.username && m.username === memberId) ||
          (m._id && m._id.toString() === memberId.toString());
        return matches;
      });

      if (targetMember) {
        console.log('Member found successfully');
      } else {
        console.warn('Member not found in members array');
        console.log(
          'Available member IDs:',
          memberResponse.data.map((m) => m.memberId || m.username || m._id)
        );
      }
    }

    const member = targetMember || memberResponse;

    // Update basic member info
    document.getElementById('dashboardName').textContent =
      member.name || member.username || 'Member';
    document.getElementById('dashboardMemberId').textContent =
      member.memberId || memberId;
    document.getElementById('infoEmail').textContent = member.email || '—';
    document.getElementById('infoPhone').textContent = member.phone || '—';

    // Format join date
    if (member.joinDate || member.createdAt) {
      const joinDate = new Date(member.joinDate || member.createdAt);
      document.getElementById('infoJoinDate').textContent =
        joinDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
    } else {
      document.getElementById('infoJoinDate').textContent = '—';
    }

    // Process memberships
    let combativeSessions = '—';
    const memberships = member.memberships || [];

    if (memberships.length > 0) {
      const membershipHTML = memberships
        .map((membership) => {
          const type = membership.type || '—';
          const endDate = membership.endDate
            ? new Date(membership.endDate).toLocaleDateString()
            : '—';
          const remainingSessions =
            membership.remainingSessions !== undefined
              ? membership.remainingSessions
              : membership.remaining !== undefined
              ? membership.remaining
              : null;

          if (
            type.toLowerCase().includes('combative') &&
            remainingSessions !== null
          ) {
            combativeSessions = parseInt(remainingSessions, 10) || 0;
          }

          return `
            <li>
              <span>${type.charAt(0).toUpperCase() + type.slice(1)}</span>
              <span style="color: var(--neutral); font-size: 0.9rem;">
                (valid until ${endDate})
                ${
                  remainingSessions !== null
                    ? ` · ${remainingSessions} sessions left`
                    : ''
                }
              </span>
            </li>
          `;
        })
        .join('');

      document.getElementById('membershipTypes').innerHTML = membershipHTML;
    } else {
      document.getElementById('membershipTypes').innerHTML =
        '<li>No active memberships</li>';
    }

    document.getElementById('remainingCombSessions').textContent =
      combativeSessions !== '—' ? combativeSessions : '0';

    // Load recent classes using the enhanced route
    await loadRecentClasses(memberId);
  } catch (error) {
    console.error('Dashboard loading error:', error);
    const errorElement = document.getElementById('error');
    if (errorElement) {
      errorElement.style.display = 'block';
      errorElement.textContent = `${
        error.message || 'Problem loading dashboard'
      }. Please try logging in again.`;
    }
  }
}

// --------------------------------------
// Load recent classes - enhanced route
// --------------------------------------
async function loadRecentClasses(memberId) {
  try {
    console.log('Loading enhanced enrollments for member:', memberId);

    const enhancedEnrollmentsResponse = await apiFetch(
      `/enrollments/member/${encodeURIComponent(memberId)}/enhanced`
    );
    let rowsHTML = '';

    console.log('Enhanced enrollments response:', enhancedEnrollmentsResponse);

    if (
      enhancedEnrollmentsResponse &&
      enhancedEnrollmentsResponse.success &&
      Array.isArray(enhancedEnrollmentsResponse.data)
    ) {
      const enrollments = enhancedEnrollmentsResponse.data;
      console.log('Enhanced enrollments loaded:', enrollments.length);

      // Sort by date (most recent first) and take latest 5
      const recentEnrollments = enrollments
        .sort(
          (a, b) =>
            new Date(b.session_date || b.date) -
            new Date(a.session_date || a.date)
        )
        .slice(0, 5);

      if (recentEnrollments.length > 0) {
        rowsHTML = recentEnrollments
          .map((enrollment) => {
            const className =
              enrollment.class_name ||
              enrollment.class_display_name ||
              'Class';
            const sessionDate = new Date(
              enrollment.session_date || enrollment.date
            );
            const dayOfWeek = sessionDate.toLocaleDateString('en-US', {
              weekday: 'long',
            });
            const formattedDate = sessionDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
            const status =
              enrollment.attendance_status ||
              enrollment.status ||
              'Scheduled';

            let statusClass = 'status-pending';
            if (
              status.toLowerCase() === 'attended' ||
              status.toLowerCase() === 'completed'
            ) {
              statusClass = 'status-completed';
            } else if (
              status.toLowerCase() === 'scheduled' ||
              status.toLowerCase() === 'active'
            ) {
              statusClass = 'status-active';
            }

            console.log('Rendering enhanced class row:', {
              className,
              dayOfWeek,
              formattedDate,
              status,
              rawEnrollment: enrollment,
            });

            return `
              <tr>
                <td>${escapeHtml(className)}</td>
                <td>${escapeHtml(dayOfWeek)}</td>
                <td>${formattedDate}</td>
                <td><span class="status-badge ${statusClass}">${escapeHtml(
                  status
                )}</span></td>
              </tr>
            `;
          })
          .join('');
      } else {
        rowsHTML = `
          <tr>
            <td colspan="4" style="color: var(--neutral); font-style: italic; text-align: center;">
              No upcoming classes
            </td>
          </tr>
        `;
      }
    } else {
      console.warn(
        'Enhanced enrollments response not successful:',
        enhancedEnrollmentsResponse
      );

      // Try fallback to original route if enhanced route fails
      console.log('Falling back to original enrollments route...');
      const fallbackResponse = await apiFetch(
        `/enrollments/member/${encodeURIComponent(memberId)}`
      );

      if (fallbackResponse && fallbackResponse.success && Array.isArray(fallbackResponse.data)) {
        const enrollments = fallbackResponse.data;
        rowsHTML = enrollments
          .slice(0, 5)
          .map((enrollment) => {
            const className = enrollment.class_id || 'Class';
            const sessionDate = new Date(
              enrollment.session_date || enrollment.date
            );
            const dayOfWeek = sessionDate.toLocaleDateString('en-US', {
              weekday: 'long',
            });
            const formattedDate = sessionDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
            const status =
              enrollment.attendance_status ||
              enrollment.status ||
              'Scheduled';

            let statusClass = 'status-pending';
            if (
              status.toLowerCase() === 'attended' ||
              status.toLowerCase() === 'completed'
            ) {
              statusClass = 'status-completed';
            } else if (
              status.toLowerCase() === 'scheduled' ||
              status.toLowerCase() === 'active'
            ) {
              statusClass = 'status-active';
            }

            return `
              <tr>
                <td>${escapeHtml(className)}</td>
                <td>${escapeHtml(dayOfWeek)}</td>
                <td>${formattedDate}</td>
                <td><span class="status-badge ${statusClass}">${escapeHtml(
                  status
                )}</span></td>
              </tr>
            `;
          })
          .join('');
      } else {
        rowsHTML = `
          <tr>
            <td colspan="4" style="color: #dc3545; font-style: italic; text-align: center;">
              Failed to load classes - both enhanced and fallback routes
            </td>
          </tr>
        `;
      }
    }

    const tableBody = document.querySelector('#recentClassesTable tbody');
    if (tableBody) {
      tableBody.innerHTML = rowsHTML;
    } else {
      console.error('Table body element #recentClassesTable tbody not found');
    }
  } catch (error) {
    console.error('Error loading recent classes:', error);
    const tableBody = document.querySelector('#recentClassesTable tbody');
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="4" style="color: #dc3545; font-style: italic; text-align: center;">
            Error loading classes
          </td>
        </tr>
      `;
    }
  }
}

// Utility function to escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show toast notification - unchanged
function showToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.cssText = `
    padding: 12px 20px;
    border-radius: var(--radius);
    color: var(--accent);
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(10px);
    animation: slideIn 0.3s ease;
  `;

  const colors = {
    success: 'linear-gradient(135deg, #28a745, #20c997)',
    error: 'linear-gradient(135deg, #dc3545, #e83e8c)',
    warning: 'linear-gradient(135deg, #ffc107, #fd7e14)',
    info: 'linear-gradient(135deg, var(--primary), var(--highlight))',
  };

  toast.style.background = colors[type] || colors.info;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }
  }, 5000);
}

// Add CSS for toast animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);
