// ========================================
// Member Classes - Secure + Idle + Tokenized API
// ========================================

// Config
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

// Global variables
let allEnrollments = [];
let classNameCache = {};
let pendingCancelId = null;
let pendingFeedback = { enrollmentId: null, classId: null, className: '', trainerId: null };
let currentMonthDate = new Date();

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
// Idle helpers
// ------------------------------
function markMemberActivity() {
  memberLastActivity = Date.now();
  memberIdleWarningShown = false;
}

// Idle banner like "console on top"
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
        console.log('Member session exceeded 2 hours, logging out (idle watcher).');
        memberLogout('session max age exceeded in idle watcher');
        return;
      }
    } catch (e) {
      console.error('Failed to parse authUser in idle watcher:', e);
      memberLogout('invalid authUser JSON in idle watcher');
      return;
    }

    // Idle warning at 15 minutes
    const idleFor = Date.now() - memberLastActivity;
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

  window.location.href = '../login.html';
}

// Cross‑tab member logout sync
window.addEventListener('storage', (event) => {
  if (event.key === MEMBER_KEYS.logoutEvent) {
    console.log('[Member Logout] detected from another tab');
    MemberStore.clear();
    window.location.href = '../login.html';
  }
});

// ------------------------------
// Utility for authenticated API calls (adds security header for /api/ routes) with timeout
// Enhanced: full-URL support + role + 2-hour session check + timestamp refresh
// ------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log('apiFetch called for:', endpoint); // DEBUG

  bootstrapMemberFromGenericIfNeeded();

  const token = MemberStore.getToken();
  const role = MemberStore.getRole();
  const authUser = MemberStore.getAuthUser();

  if (!token || !authUser || role !== 'member') {
    console.log('No valid member token/authUser/role - redirecting to login'); // DEBUG
    memberLogout('missing member session in apiFetch');
    return;
  }

  // 2-hour session max check + refresh timestamp
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
      console.log('Session max age exceeded in apiFetch'); // DEBUG
      memberLogout('session max age exceeded in apiFetch');
      return;
    }
    // Treat successful API usage as activity
    authUser.timestamp = Date.now();
    MemberStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to parse authUser in apiFetch:', e);
    memberLogout('invalid authUser JSON in apiFetch');
    return;
  }

  // Use endpoint directly if it's already a full URL; otherwise prepend base
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    url =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? `${SERVER_URL}${endpoint}`
        : endpoint;
  }

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json', // Default for JSON calls
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      console.log('401/403 Unauthorized - clearing auth and redirecting'); // DEBUG
      memberLogout('401/403 from apiFetch');
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

// ✅ ENHANCED AUTH CHECK - Token + Role ('member') + 2-hour Timestamp
(function checkAuth() {
  console.log('Auth check starting for member-classes'); // DEBUG

  bootstrapMemberFromGenericIfNeeded();

  const authUser = MemberStore.getAuthUser();
  const token = MemberStore.getToken();
  const role = MemberStore.getRole();

  console.log('Auth details:', { authUser, token: !!token, role }); // DEBUG

  if (
    !authUser ||
    !token ||
    role !== 'member' ||
    Date.now() - (authUser.timestamp || 0) > MEMBER_SESSION_MAX_AGE_MS
  ) {
    console.log('Auth failed - clearing and redirecting'); // DEBUG
    memberLogout('failed auth in checkAuth');
    return;
  }

  console.log(
    'Member authenticated:',
    authUser.username || authUser.email,
    'Role:',
    role
  );
})();

// DOM Ready
document.addEventListener('DOMContentLoaded', function () {
  setupMemberIdleWatcher();
  markMemberActivity();
  setSidebarMemberName();

  initializePage();
  loadEnrollments();
  setupModalEvents();
  setupManualLogout(); // Add manual logout setup
});

function setSidebarMemberName() {
  try {
    if (typeof bootstrapMemberFromGenericIfNeeded === "function") {
      bootstrapMemberFromGenericIfNeeded();
    }

    // Prefer the member-scoped authUser (memberauthUser), fallback to generic authUser
    const auth =
      (typeof MemberStore !== "undefined" && MemberStore.getAuthUser && MemberStore.getAuthUser()) ||
      (() => {
        try {
          const raw =
            sessionStorage.getItem("memberauthUser") ||
            localStorage.getItem("memberauthUser") ||
            sessionStorage.getItem("authUser") ||
            localStorage.getItem("authUser");
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      })();

    const user = auth?.user || auth;
    const displayName = user?.name || user?.username || auth?.name || auth?.username || "Member";

    const el = document.getElementById("sidebarMemberName");
    if (el) el.textContent = displayName;
  } catch (e) {
    console.error("Failed to set sidebar member name:", e);
  }
}

// Initialize page
function initializePage() {
  // Set member name (still stored separately)
  const memberName = sessionStorage.getItem('memberName') || 'Member';
  document.getElementById('memberName').textContent = memberName;

  // Setup sidebar and logout
  setupSidebarAndSession();

  // Setup calendar tabs
  setupCalendarTabs();
}

// Setup sidebar and session management
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  // Ensure member_* keys are populated if old generic keys exist
  bootstrapMemberFromGenericIfNeeded();

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
    logoutBtn.addEventListener('click', () => {
      manualLogout();
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

// MANUAL LOGOUT FUNCTION - now delegates to memberLogout
function manualLogout() {
  console.log('Manual logout triggered');
  showToast('Logging out...', 'info');
  setTimeout(() => {
    memberLogout('manual member logout button');
  }, 800);
}

// Setup manual logout triggers
function setupManualLogout() {
  // Optional tiny button for testing
  addManualLogoutButton();

  // Also available from console
  window.manualLogout = manualLogout;

  // Keyboard shortcut (Ctrl + L)
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      manualLogout();
    }
  });
}

// Add a manual logout button to the page (for testing)
function addManualLogoutButton() {
  const existing = document.getElementById('manualLogoutTestBtn');
  if (existing) return;

  const manualLogoutBtn = document.createElement('button');
  manualLogoutBtn.id = 'manualLogoutTestBtn';
  manualLogoutBtn.textContent = 'Manual Logout';
  manualLogoutBtn.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 10px 15px;
    background: #dc3545;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    z-index: 9999;
    font-size: 12px;
  `;
  manualLogoutBtn.onclick = manualLogout;

  document.body.appendChild(manualLogoutBtn);
}

// Quick logout (used by idle watcher previously) -> now just calls memberLogout
function quickLogout() {
  console.log('🚪 Quick logout triggered!');
  memberLogout('quickLogout');
}
window.quickLogout = quickLogout;

// Setup calendar tabs
function setupCalendarTabs() {
  const tabs = document.querySelectorAll('.view-tab');
  const datePicker = document.getElementById('calendarDate');

  const today = new Date();
  if (datePicker) {
    datePicker.value = today.toISOString().split('T')[0];
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', function () {
      tabs.forEach((t) => t.classList.remove('active'));
      this.classList.add('active');
      markMemberActivity();

      const view = this.dataset.view;
      switchCalendarView(view);
    });
  });

  if (datePicker) {
    datePicker.addEventListener('change', function () {
      markMemberActivity();
      const activeTab = document.querySelector('.view-tab.active');
      if (activeTab) {
        switchCalendarView(activeTab.dataset.view);
      }
    });
  }

  switchCalendarView('month');
}

// Load enrollments (SECURE: uses apiFetch)
async function loadEnrollments() {
  const memberId = getMemberIdFromAuth();
  if (!memberId) {
    memberLogout('no memberId in loadEnrollments');
    return;
  }

  const loadingElement = document.getElementById('loading');
  const errorElement = document.getElementById('error');
  const tableElement = document.getElementById('enrollmentsTable');
  const tableBody = document.getElementById('enrollmentsBody');

  loadingElement.textContent = 'Loading your enrollments...';
  errorElement.style.display = 'none';
  tableElement.style.display = 'none';
  tableBody.innerHTML = '';

  try {
    const data = await apiFetch(`/api/enrollments/member/${encodeURIComponent(memberId)}`);
    allEnrollments = data.data || [];

    if (allEnrollments.length === 0) {
      loadingElement.textContent = 'You have no upcoming enrollments.';
      await renderRemainingSessions();
      switchCalendarView('month');
      return;
    }

    // Pre-fetch all class names for better performance
    const uniqueClassIds = [
      ...new Set(
        allEnrollments
          .map((enrollment) =>
            typeof enrollment.class_id === 'string'
              ? enrollment.class_id
              : enrollment.class_id?._id || enrollment.class_id
          )
          .filter((id) => id)
      ),
    ];

    const classNamePromises = uniqueClassIds.map((classId) => getClassNameById(classId));
    await Promise.all(classNamePromises);

    loadingElement.style.display = 'none';

    const renderPromises = allEnrollments.map(async (enrollment) => {
      const className = await getClassName(enrollment);
      const day = enrollment.session_day || '';
      const date = enrollment.session_date
        ? new Date(enrollment.session_date).toLocaleDateString()
        : enrollment.enrollment_date
        ? new Date(enrollment.enrollment_date).toLocaleDateString()
        : '';
      const time = enrollment.session_time || '';
      const status = enrollment.attendance_status || enrollment.status || 'scheduled';
      const statusInfo = getStatusClass(status);

      const classIdStr =
        typeof enrollment.class_id === 'string'
          ? enrollment.class_id
          : enrollment.class_id?._id || enrollment.class_id;

      let cancelButton = '';
      if (status === 'scheduled' || status === 'active') {
        cancelButton = `<button class="btn btn-danger" data-id="${
          enrollment._id || enrollment.enrollment_id
        }" onclick="openCancelModal(event)">Cancel</button>`;
      } else {
        cancelButton = `<button class="btn" disabled>Cancel</button>`;
      }

      let feedbackButton = '';
      if (status === 'attended' || status === 'completed') {
        feedbackButton = `<button class="btn btn-primary" data-en="${
          enrollment._id || enrollment.enrollment_id
        }" data-cl="${classIdStr || ''}" data-name="${escapeHtml(
          className
        )}" onclick="openFeedbackModal(event)">Send Feedback</button>`;
      }

      const row = document.createElement('tr');
      row.innerHTML = `
            <td>${escapeHtml(className)}</td>
            <td>${escapeHtml(day)}</td>
            <td>${escapeHtml(date)}</td>
            <td>${escapeHtml(time)}</td>
            <td><span class="status-badge ${statusInfo.class}">${statusInfo.label}</span></td>
            <td>
                <div class="action-buttons">
                ${cancelButton}
                ${feedbackButton}
                </div>
            </td>
        `;
      tableBody.appendChild(row);
    });

    await Promise.all(renderPromises);
    tableElement.style.display = 'table';
  } catch (error) {
    console.error('Error loading enrollments:', error);
    errorElement.textContent = `Failed to load enrollments: ${error.message}`;
    errorElement.style.display = 'block';
    loadingElement.style.display = 'none';
  }

  await renderRemainingSessions();
  switchCalendarView('month');
}

// Get member ID from auth (now from MemberStore)
function getMemberIdFromAuth() {
  try {
    bootstrapMemberFromGenericIfNeeded();
    const authUser = MemberStore.getAuthUser();
    if (!authUser) return null;

    const user = authUser.user || authUser;
    return user.memberId || user.member_id || user._id || user.id || null;
  } catch (error) {
    console.error('Error getting member ID:', error);
    return null;
  }
}

// Status helper function
function getStatusClass(status) {
  const statusMap = {
    attended: { class: 'status-attended', label: 'Attended' },
    active: { class: 'status-active', label: 'Active' },
    scheduled: { class: 'status-active', label: 'Scheduled' },
    missed: { class: 'status-missed', label: 'Missed' },
    cancelled: { class: 'status-cancelled', label: 'Cancelled' },
    completed: { class: 'status-completed', label: 'Completed' },
  };
  return statusMap[status.toLowerCase()] || { class: 'status-active', label: 'Unknown' };
}

// Class name helper functions (SECURE: uses apiFetch)
async function getClassNameById(classId) {
  if (classNameCache[classId]) {
    return classNameCache[classId];
  }

  try {
    const response = await apiFetch(`/api/classes/${encodeURIComponent(classId)}`);
    const className = response.data?.class_name || classId;
    classNameCache[classId] = className;
    return className;
  } catch (error) {
    console.warn('Failed to fetch class name:', error);
  }

  classNameCache[classId] = classId;
  return classId;
}

function getClassName(enrollment) {
  if (enrollment.class_name) return enrollment.class_name;
  if (enrollment.class_id && enrollment.class_id.class_name) return enrollment.class_id.class_name;

  if (typeof enrollment.class_id === 'string' || enrollment.class_id) {
    const classIdStr =
      typeof enrollment.class_id === 'string'
        ? enrollment.class_id
        : enrollment.class_id?._id || enrollment.class_id;
    return getClassNameById(classIdStr);
  }

  return 'Unnamed Class';
}

// Render remaining sessions (SECURE: uses apiFetch)
async function renderRemainingSessions() {
  const memberId = getMemberIdFromAuth();
  const remainingSessionsElement = document.getElementById('remainingSessions');
  const membershipInfoElement = document.getElementById('membershipInfo');

  if (!memberId) {
    remainingSessionsElement.textContent = '—';
    return;
  }

  try {
    const response = await apiFetch(`/api/members/${encodeURIComponent(memberId)}`);
    const member = response.data;
    const memberships = member.memberships || [];

    let combativeSessions = '—';
    let membershipText = 'No active membership';

    memberships.forEach((membership) => {
      if ((membership.type || '').toLowerCase().includes('combative')) {
        if (
          membership.remainingSessions !== undefined &&
          membership.remainingSessions !== null
        ) {
          combativeSessions = parseInt(membership.remainingSessions);
        } else if (membership.remaining !== undefined && membership.remaining !== null) {
          combativeSessions = parseInt(membership.remaining);
        }
        membershipText = `${membership.type} Membership`;
      }
    });

    remainingSessionsElement.textContent =
      combativeSessions !== '—' ? combativeSessions : '0';
    membershipInfoElement.textContent = membershipText;
  } catch (error) {
    console.error('Error loading remaining sessions:', error);
    remainingSessionsElement.textContent = '—';
    membershipInfoElement.textContent = 'Error loading membership info';
  }
}

// Calendar view functions (unchanged logic)
function switchCalendarView(view) {
  const calendarContainer = document.getElementById('calendarContainer');

  calendarContainer.innerHTML =
    '<div class="loading-state">Loading ' + view + ' view...</div>';

  setTimeout(() => {
    if (view === 'today') {
      generateTodayView();
    } else if (view === 'week') {
      generateWeekView();
    } else {
      generateMonthView();
    }
  }, 500);
}

function generateTodayView() {
  const calendarContainer = document.getElementById('calendarContainer');
  const today = new Date();
  const todayEnrollments = allEnrollments.filter((enrollment) => {
    const enrollmentDate = new Date(enrollment.session_date);
    return enrollmentDate.toDateString() === today.toDateString();
  });

  let html = `
        <div class="today-view">
            <div class="today-header">
                <h4>Today's Classes</h4>
                <div class="today-date">${today.toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}</div>
            </div>
            <div class="today-classes">
    `;

  if (todayEnrollments.length === 0) {
    html += '<div class="no-classes">No classes scheduled for today</div>';
  } else {
    todayEnrollments.sort((a, b) => {
      const timeA = a.session_time || '00:00';
      const timeB = b.session_time || '00:00';
      return timeA.localeCompare(timeB);
    });

    todayEnrollments.forEach((enrollment) => {
      const key =
        typeof enrollment.class_id === 'string'
          ? enrollment.class_id
          : enrollment.class_id?._id || enrollment.class_id;
      const className = classNameCache[key] || getClassName(enrollment);
      const status = enrollment.attendance_status || enrollment.status || 'scheduled';
      const statusInfo = getStatusClass(status);

      html += `
                <div class="class-slot">
                    <div class="class-time">${enrollment.session_time || 'All day'}</div>
                    <div class="class-info">
                        <strong>${className}</strong>
                        <span>${enrollment.session_day || ''}</span>
                    </div>
                    <div class="class-status ${statusInfo.class}">${statusInfo.label}</div>
                </div>
            `;
    });
  }

  html += `</div></div>`;
  calendarContainer.innerHTML = html;
}

function generateWeekView() {
  const calendarContainer = document.getElementById('calendarContainer');
  const datePicker = document.getElementById('calendarDate');
  const selectedDate = datePicker ? new Date(datePicker.value) : new Date();

  const startOfWeek = new Date(selectedDate);
  startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay());

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  let html = `
        <div class="week-view">
            <div class="week-header">
    `;

  for (let i = 0; i < 7; i++) {
    const currentDay = new Date(startOfWeek);
    currentDay.setDate(startOfWeek.getDate() + i);

    const isToday = currentDay.toDateString() === new Date().toDateString();
    const dayName = dayNames[i];
    const date = currentDay.getDate();
    const month = monthNames[currentDay.getMonth()];

    html += `
            <div class="week-day-header ${isToday ? 'today' : ''}">
                <div class="day-name">${dayName}</div>
                <div class="day-date">${month} ${date}</div>
            </div>
        `;
  }

  html += `</div><div class="week-grid">`;

  const timeSlots = [
    '6:00 AM',
    '7:00 AM',
    '8:00 AM',
    '9:00 AM',
    '10:00 AM',
    '11:00 AM',
    '12:00 PM',
    '1:00 PM',
    '2:00 PM',
    '3:00 PM',
    '4:00 PM',
    '5:00 PM',
    '6:00 PM',
    '7:00 PM',
  ];

  timeSlots.forEach((time) => {
    html += `<div class="time-slot">${time}</div>`;

    for (let i = 0; i < 7; i++) {
      const currentDay = new Date(startOfWeek);
      currentDay.setDate(startOfWeek.getDate() + i);
      const dateStr = currentDay.toISOString().split('T')[0];

      const dayEnrollments = allEnrollments.filter((enrollment) => {
        const enrollmentDate = new Date(enrollment.session_date);
        return (
          enrollmentDate.toISOString().split('T')[0] === dateStr &&
          enrollment.session_time === time
        );
      });

      const hasClass = dayEnrollments.length > 0;

      html += `
                <div class="week-cell ${hasClass ? 'has-class' : ''}">
                    ${
                      hasClass
                        ? dayEnrollments
                            .map((enrollment) => {
                              const key =
                                typeof enrollment.class_id === 'string'
                                  ? enrollment.class_id
                                  : enrollment.class_id?._id || enrollment.class_id;
                              const className =
                                classNameCache[key] || getClassName(enrollment);
                              const status =
                                enrollment.attendance_status ||
                                enrollment.status ||
                                'scheduled';
                              const statusInfo = getStatusClass(status);
                              return `
                                    <div class="week-event">
                                        <strong>${className}</strong>
                                        <small>${statusInfo.label}</small>
                                    </div>
                                `;
                            })
                            .join('')
                        : ''
                    }
                </div>
            `;
    }
  });

  html += `</div></div>`;
  calendarContainer.innerHTML = html;
}

function generateMonthView() {
  const calendarContainer = document.getElementById('calendarContainer');

  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const today = new Date();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDay = firstDay.getDay();

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  let html = `<div class="month-view">
    <div class="month-header">
         <button class="month-nav-btn" id="prevMonth" title="Previous Month">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
         </button>
         <h4>${monthNames[month]} ${year}</h4>
         <button class="month-nav-btn" id="nextMonth" title="Next Month">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
         </button>
    </div>
    <div class="calendar-grid">`;

  dayNames.forEach((day) => {
    html += `<div class="calendar-header-day">${day}</div>`;
  });

  for (let i = 0; i < startingDay; i++) {
    html += `<div class="calendar-day empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(year, month, day);
    const isToday = currentDate.toDateString() === today.toDateString();
    const dateStr = currentDate.toISOString().split('T')[0];

    const dayEnrollments = allEnrollments.filter((enrollment) => {
      if (!enrollment.session_date) return false;
      const enrollmentDate = new Date(enrollment.session_date);
      return enrollmentDate.toISOString().split('T')[0] === dateStr;
    });

    html += `<div class="calendar-day${isToday ? ' today' : ''}">
     <span class="calendar-day-number">${day}</span>
     <div class="calendar-day-classes">`;

    if (dayEnrollments.length > 0) {
      dayEnrollments.slice(0, 3).forEach((enrollment) => {
        const key =
          typeof enrollment.class_id === 'string'
            ? enrollment.class_id
            : enrollment.class_id?.id || enrollment.class_id;
        const className = classNameCache[key] || getClassName(enrollment);
        const status = enrollment.attendance_status || enrollment.status || 'scheduled';
        const statusInfo = getStatusClass(status);
        const shortName =
          className.length > 12 ? className.substring(0, 12) + '...' : className;

        html += `<div class="calendar-class" title="${className} - ${statusInfo.label}">
         <span>${shortName}</span>
         <span class="calendar-status ${statusInfo.class}">${statusInfo.label.charAt(
           0
         )}</span>
       </div>`;
      });

      if (dayEnrollments.length > 3) {
        html += `<div class="calendar-class">+${dayEnrollments.length - 3} more</div>`;
      }
    }

    html += `</div></div>`;
  }

  const totalCells = 42;
  const usedCells = startingDay + daysInMonth;
  const remainingCells = totalCells - usedCells;

  for (let i = 0; i < remainingCells; i++) {
    html += `<div class="calendar-day empty"></div>`;
  }

  html += `</div></div>`;
  calendarContainer.innerHTML = html;

  const prevMonthBtn = document.getElementById('prevMonth');
  const nextMonthBtn = document.getElementById('nextMonth');

  if (prevMonthBtn) {
    prevMonthBtn.addEventListener('click', () => {
      currentMonthDate.setMonth(currentMonthDate.getMonth() - 1);
      markMemberActivity();
      generateMonthView();
    });
  }

  if (nextMonthBtn) {
    nextMonthBtn.addEventListener('click', () => {
      currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
      markMemberActivity();
      generateMonthView();
    });
  }
}

// Modal functions
function setupModalEvents() {
  document.getElementById('cancelNo').addEventListener('click', () => {
    closeModal('cancelModal');
  });

  document.getElementById('cancelYes').addEventListener('click', async () => {
    const id = pendingCancelId;
    if (!id) return;
    closeModal('cancelModal');
    await performCancel(id);
  });

  document.getElementById('feedbackCancel').addEventListener('click', () => {
    closeModal('feedbackModal');
    pendingFeedback = { enrollmentId: null, classId: null, className: '', trainerId: null };
  });

  document.getElementById('feedbackSend').addEventListener('click', sendFeedback);
}

function openCancelModal(event) {
  const id = event.target.getAttribute('data-id');
  if (!id) return;
  pendingCancelId = id;
  document.getElementById('cancelModal').style.display = 'flex';
}

async function openFeedbackModal(event) {
  const button = event.target;
  const enrollmentId = button.getAttribute('data-en');
  const classId = button.getAttribute('data-cl');
  const className = button.getAttribute('data-name') || '';

  let trainerId = null;
  if (classId) {
    try {
      const response = await apiFetch(`/api/classes/${encodeURIComponent(classId)}`);
      trainerId = response.data?.trainer_id || null;
    } catch (error) {
      console.error('Error fetching class details:', error);
    }
  }

  pendingFeedback = { enrollmentId, classId, className, trainerId };
  document.getElementById('feedbackTitle').textContent = `Send Feedback - ${className}`;
  document.getElementById('feedbackClassInfo').textContent = `Class: ${className}`;
  document.getElementById('feedbackRating').value = '';
  document.getElementById('feedbackComment').value = '';
  document.getElementById('feedbackModal').style.display = 'flex';
}

async function sendFeedback() {
  const rating = document.getElementById('feedbackRating').value;
  const comment = document.getElementById('feedbackComment').value.trim();

  if (!pendingFeedback || !pendingFeedback.classId) {
    showToast('Missing class information', 'error');
    return;
  }

  if (!rating) {
    showToast('Please select a rating', 'warning');
    return;
  }

  const memberId = getMemberIdFromAuth();
  if (!memberId) {
    showToast('Please login again', 'error');
    return;
  }

  try {
    const payload = {
      class_id: pendingFeedback.classId,
      member_id: memberId,
      trainer_id: pendingFeedback.trainerId || '',
      rating: parseInt(rating),
      comment: comment || '',
    };

    const data = await apiFetch('/api/feedbacks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!data.success && data.error) {
      throw new Error(data.error || data.message || 'Failed to send feedback');
    }

    showToast('Feedback sent successfully!', 'success');
    closeModal('feedbackModal');
    pendingFeedback = { enrollmentId: null, classId: null, className: '', trainerId: null };
  } catch (error) {
    console.error('Error sending feedback:', error);
    showToast('Failed to send feedback: ' + error.message, 'error');
  }
}

async function performCancel(enrollmentId) {
  try {
    const data = await apiFetch(
      `/api/enrollments/${encodeURIComponent(enrollmentId)}/cancel`,
      {
        method: 'PUT',
      }
    );

    if (!data.success && data.error) {
      throw new Error(data.error || data.message || 'Failed to cancel enrollment');
    }

    showToast('Enrollment cancelled successfully!', 'success');
    await loadEnrollments();
  } catch (error) {
    console.error('Error cancelling enrollment:', error);
    showToast('Failed to cancel enrollment: ' + error.message, 'error');
  }
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

// Utility functions
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

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
