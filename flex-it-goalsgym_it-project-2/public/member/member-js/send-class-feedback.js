// ========================================
// Member Send Class Feedback - Tokenized
// ========================================

// Configuration
const SERVER_URL = 'http://localhost:8080';
const MEMBER_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const MEMBER_IDLE_WARNING_MS = 15 * 60 * 1000; // 15 minutes idle warning

// Global variables
let enrolledClasses = [];
let selectedClass = null;

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

// Utility Functions
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
    console.error('[Auth] Error:', e);
    return null;
  }
}

function memberIdFromAuth() {
  const auth = getAuth();
  if (!auth) return null;
  const user = auth.user || auth;
  return user.memberId || user.member_id || user._id || user.id || null;
}

// --------------------------------------
// Centralized member logout
// --------------------------------------
function memberLogout(reason) {
  console.log('[Logout] Member logout (feedback):', reason || 'no reason'); // DEBUG

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

// Keep existing name for compatibility with rest of file
function logout(reason) {
  memberLogout(reason);
}

// Cross‑tab member logout sync
window.addEventListener('storage', (event) => {
  if (event.key === MEMBER_KEYS.logoutEvent) {
    console.log('[Member Logout] feedback page sees logout from another tab');
    MemberStore.clear();
    window.location.href = '../member-login.html';
  }
});

// --------------------------------------
// Idle helpers
// --------------------------------------
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
      memberLogout('user chose to logout after idle warning (feedback)');
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

    // If already logged out, nothing to do
    if (!authUser || !token || role !== 'member') return;

    // Hard 2-hour max session age
    try {
      const ts = authUser.timestamp || 0;
      if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
        console.log(
          'Member session exceeded 2 hours, logging out (idle watcher).'
        ); // DEBUG
        memberLogout('session max age exceeded in idle watcher (feedback)');
        return;
      }
    } catch (e) {
      console.error('Failed to parse authUser in idle watcher:', e);
      memberLogout('invalid authUser JSON in idle watcher (feedback)');
      return;
    }

    const now = Date.now();
    const idleFor = now - memberLastActivity;

    if (!memberIdleWarningShown && idleFor >= MEMBER_IDLE_WARNING_MS) {
      console.log(
        "You've been idle for 15 minutes. Showing idle banner (feedback)."
      );
      memberIdleWarningShown = true;
      showMemberIdleBanner();
    }
  }, 30000);
}

// --------------------------------------
// Utility for authenticated API calls
// (MemberStore-based, handles full URLs)
// --------------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log('apiFetch called for:', endpoint); // DEBUG

  bootstrapMemberFromGenericIfNeeded();

  const token = MemberStore.getToken();
  const role = MemberStore.getRole();
  const authUser = MemberStore.getAuthUser();

  if (!token || !authUser || role !== 'member') {
    console.log('No valid member token/authUser/role - redirecting to login'); // DEBUG
    memberLogout('missing token/authUser/role in feedback apiFetch');
    return;
  }

  // 2-hour session max check (same policy as other member modules)
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
      console.log('Session max age exceeded in apiFetch (feedback).'); // DEBUG
      memberLogout('session max age exceeded in feedback apiFetch');
      return;
    }
    // Refresh timestamp on successful API usage (activity-based)
    authUser.timestamp = Date.now();
    MemberStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to parse authUser in feedback apiFetch:', e);
    memberLogout('invalid authUser JSON in feedback apiFetch');
    return;
  }

  // Use endpoint directly if it's already a full URL; otherwise prepend base
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
    'Content-Type': 'application/json', // Default for JSON calls
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      console.log('401/403 Unauthorized - clearing auth and redirecting'); // DEBUG
      memberLogout('401/403 from feedback apiFetch');
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

// ✅ INITIAL AUTH CHECK - Token + Role ('member') + Timestamp (runs immediately)
(function checkAuth() {
  console.log('Auth check starting for member-feedback'); // DEBUG

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
    memberLogout('initial auth check failed (feedback)');
    return;
  }

  console.log(
    'Member authenticated:',
    authUser.username || authUser.email,
    'Role:',
    role
  );
})();

// Formatting helpers
function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

function showMessage(message, type = 'success') {
  console.log(`[Message] ${type}: ${message}`);
  const messageEl = $('feedbackStatus');
  if (!messageEl) return;

  messageEl.textContent = message;
  messageEl.className = `message ${type}`;
  messageEl.style.display = 'block';

  if (type === 'success') {
    setTimeout(() => {
      messageEl.style.display = 'none';
    }, 5000);
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Init] Page loaded');

  // Start idle tracking
  setupMemberIdleWatcher();
  markMemberActivity();

  // Menu toggle
  if ($('menuToggle')) {
    $('menuToggle').addEventListener('click', () => {
      document.querySelector('.sidebar')?.classList.toggle('collapsed');
      markMemberActivity();
    });
  }

  // Logout
  if ($('logoutBtn')) {
    $('logoutBtn').addEventListener('click', (e) => {
      e.preventDefault();
      logout('manual member logout button');
    });
  }

  // Load member name
  loadMemberName();

  // Load classes into dropdown
  loadAttendedClasses();

  // Class selection change
  if ($('classSelect')) {
    $('classSelect').addEventListener('change', function () {
      const selectedValue = this.value;
      console.log('[Select] Changed to:', selectedValue);

      if (selectedValue) {
        const classData = enrolledClasses.find(
          (c) => c.enrollment_id === selectedValue
        );
        if (classData) {
          selectedClass = classData;
          console.log('[Select] Selected class:', selectedClass);
        }
      } else {
        selectedClass = null;
      }
    });
  }

  // View feedback button
  if ($('viewFeedbackBtn')) {
    $('viewFeedbackBtn').addEventListener('click', viewMyFeedback);
  }

  // Close feedback modal
  if ($('closeFeedbackModal')) {
    $('closeFeedbackModal').addEventListener('click', () => {
      $('feedbackModal').style.display = 'none';
    });
  }

  // Form submission
  if ($('feedbackForm')) {
    $('feedbackForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitFeedback();
    });
  }
});

// Load Member Name
function loadMemberName() {
  const authUser = getAuth();
  if (authUser) {
    const user = authUser.user || authUser;
    const userName = user.name || 'Member';

    if ($('memberName')) {
      $('memberName').textContent = userName;
    }
    if ($('memberIdBadge')) {
      $('memberIdBadge').textContent = user.memberId || 'Member';
    }
  }
}

// Load ATTENDED Classes ONLY
async function loadAttendedClasses() {
  console.log('[LoadClasses] Starting...');

  const memberId = memberIdFromAuth();
  console.log('[LoadClasses] Member ID:', memberId);

  if (!memberId) {
    console.error('[LoadClasses] No member ID');
    logout('no memberId in loadAttendedClasses');
    return;
  }

  const classSelect = $('classSelect');
  if (!classSelect) {
    console.error('[LoadClasses] classSelect not found!');
    return;
  }

  classSelect.innerHTML = '<option value="">Loading classes...</option>';

  try {
    const url = `${SERVER_URL}/api/enrollments/member/${encodeURIComponent(
      memberId
    )}/attended`;
    console.log('[LoadClasses] Fetching:', url);

    const data = await apiFetch(url);
    console.log('[LoadClasses] Data received:', data);

    const enrollments = data?.data || [];
    console.log('[LoadClasses] Attended enrollments:', enrollments.length);

    if (enrollments.length === 0) {
      classSelect.innerHTML =
        '<option value="">No attended classes yet</option>';
      showMessage('You have not attended any classes yet', 'error');
      return;
    }

    console.log('[LoadClasses] Fetching class details...');
    const classDetails = await Promise.all(
      enrollments.map(async (enrollment) => {
        try {
          const classUrl = `${SERVER_URL}/api/classes/${encodeURIComponent(
            enrollment.class_id
          )}`;
          const classData = await apiFetch(classUrl);

          return {
            enrollment_id: enrollment.enrollment_id || enrollment._id,
            class_id: enrollment.class_id,
            class_name: classData?.data?.class_name || 'Unnamed Class',
            trainer_id: classData?.data?.trainer_id || '',
            session_date: enrollment.session_date,
            session_time: enrollment.session_time,
            attendance_status: enrollment.attendance_status,
            status: enrollment.status,
          };
        } catch (error) {
          console.error(
            `[LoadClasses] Error fetching class ${enrollment.class_id}:`,
            error
          );
        }
        return null;
      })
    );

    enrolledClasses = classDetails
      .filter((cls) => cls !== null)
      .sort(
        (a, b) =>
          new Date(b.session_date).getTime() -
          new Date(a.session_date).getTime()
      );

    console.log('[LoadClasses] Processed classes:', enrolledClasses.length);

    classSelect.innerHTML =
      '<option value="">-- Select your attended class --</option>';

    enrolledClasses.forEach((cls) => {
      const option = document.createElement('option');
      option.value = cls.enrollment_id;
      option.textContent = `${cls.class_name} - ${formatDate(
        cls.session_date
      )} ✓`;
      classSelect.appendChild(option);
    });

    console.log(
      '[LoadClasses] Dropdown populated with',
      enrolledClasses.length,
      'attended classes'
    );
  } catch (error) {
    console.error('[LoadClasses] Error:', error);
    classSelect.innerHTML =
      '<option value="">Failed to load classes</option>';
    showMessage(
      'Failed to load your classes. Please refresh the page.',
      'error'
    );
  }
}

// View My Feedback
async function viewMyFeedback() {
  console.log('[ViewFeedback] Loading feedback...');
  const memberId = memberIdFromAuth();
  if (!memberId) {
    logout('no memberId in viewMyFeedback');
    return;
  }

  const modal = $('feedbackModal');
  const feedbackList = $('feedbackList');
  if (!modal || !feedbackList) {
    console.error('[ViewFeedback] Modal elements not found');
    return;
  }

  modal.style.display = 'block';
  feedbackList.innerHTML = 'Loading your feedback...';

  try {
    const data = await apiFetch(
      `${SERVER_URL}/api/feedbacks/member/${encodeURIComponent(memberId)}`
    );
    console.log('[ViewFeedback] Feedback data:', data);
    const feedbacks = data?.feedbacks || [];

    if (feedbacks.length === 0) {
      feedbackList.innerHTML = "You haven't sent any feedback yet.";
      return;
    }

    const feedbacksWithClasses = await Promise.all(
      feedbacks.map(async (feedback) => {
        try {
          const classData = await apiFetch(
            `${SERVER_URL}/api/classes/${encodeURIComponent(
              feedback.class_id
            )}`
          );
          return {
            ...feedback,
            class_name: classData?.data?.class_name || 'Unknown Class',
          };
        } catch (error) {
          console.error(
            `[ViewFeedback] Error fetching class ${feedback.class_id}:`,
            error
          );
        }
        return { ...feedback, class_name: 'Unknown Class' };
      })
    );

    feedbackList.innerHTML = feedbacksWithClasses
      .map((fb) => {
        const stars = '⭐'.repeat(fb.rating || 0);
        const date = formatDate(fb.createdAt || fb.date_submitted || '');
        const commentSafe = (fb.comment || '')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        return `
          <div class="feedback-item">
            <div class="feedback-header">
              <h4>${fb.class_name}</h4>
              <span class="feedback-date">${date}</span>
            </div>
            <div class="feedback-rating">${stars}</div>
            <div class="feedback-comment">${commentSafe}</div>
          </div>
        `;
      })
      .join('');
  } catch (error) {
    console.error('[ViewFeedback] Error:', error);
    feedbackList.innerHTML = `Failed to load feedback: ${error.message}`;
  }
}

// Submit Feedback
async function submitFeedback() {
  console.log('[Submit] Starting...');

  const rating = document.querySelector('input[name="rating"]:checked');
  const comment = $('feedbackText')?.value.trim();
  const memberId = memberIdFromAuth();

  if (!memberId) {
    logout('no memberId in submitFeedback');
    return;
  }

  // Validation
  if (!selectedClass) {
    showMessage('Please select an attended class from the dropdown.', 'error');
    return;
  }

  if (!rating) {
    showMessage('Please provide a rating (1-5 stars).', 'error');
    return;
  }

  if (!comment || comment.length < 10) {
    showMessage(
      'Please write feedback (minimum 10 characters).',
      'error'
    );
    return;
  }

  if (!selectedClass.trainer_id) {
    showMessage(
      'Unable to find trainer information for this class.',
      'error'
    );
    return;
  }

  try {
    console.log(
      '[Submit] Submitting feedback for:',
      selectedClass.class_name
    );

    const data = await apiFetch(`${SERVER_URL}/api/feedbacks`, {
      method: 'POST',
      body: JSON.stringify({
        class_id: selectedClass.class_id,
        member_id: memberId,
        trainer_id: selectedClass.trainer_id,
        rating: parseInt(rating.value, 10),
        comment: comment,
      }),
    });
    console.log('[Submit] Response:', data);

    if (data?.error || data?.message) {
      throw new Error(
        data.error || data.message || 'Failed to send feedback'
      );
    }

    showMessage('Thank you for your feedback! 🎉', 'success');

    if ($('feedbackForm')) {
      $('feedbackForm').reset();
    }

    document
      .querySelectorAll('input[name="rating"]')
      .forEach((radio) => {
        radio.checked = false;
      });

    selectedClass = null;
    if ($('classSelect')) {
      $('classSelect').value = '';
    }
  } catch (error) {
    console.error('[Submit] Error:', error);
    showMessage(
      `Failed to send feedback: ${error.message}`,
      'error'
    );
  }
}
