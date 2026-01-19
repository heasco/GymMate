// --------------------------------------
// Server & session configuration
// --------------------------------------
const SERVER_URL = 'http://localhost:8080';
const TRAINER_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Trainer-scoped storage keys (avoid admin/member interference)
const TRAINER_KEYS = {
  token: 'trainer_token',
  authUser: 'trainer_authUser',
  role: 'trainer_role',
  logoutEvent: 'trainerLogoutEvent',
};

const API_URL = SERVER_URL;
let allClassesData = [];
let originalClassesData = [];
let currentFilter = 'all';
let currentMinRating = 0;
let trainerId = null;

// --------------------------------------
// Trainer storage helpers (namespaced)
// --------------------------------------
const TrainerStore = {
  set(token, userPayload) {
    try {
      const authUser = {
        ...(userPayload || {}),
        timestamp: Date.now(),
        role: 'trainer',
        token,
      };

      // Prefer localStorage for cross-tab; mirror to sessionStorage
      localStorage.setItem(TRAINER_KEYS.token, token);
      localStorage.setItem(TRAINER_KEYS.authUser, JSON.stringify(authUser));
      localStorage.setItem(TRAINER_KEYS.role, 'trainer');

      sessionStorage.setItem(TRAINER_KEYS.token, token);
      sessionStorage.setItem(TRAINER_KEYS.authUser, JSON.stringify(authUser));
      sessionStorage.setItem(TRAINER_KEYS.role, 'trainer');
    } catch (e) {
      console.error('[TrainerStore.set] failed:', e);
    }
  },

  getToken() {
    return (
      sessionStorage.getItem(TRAINER_KEYS.token) ||
      localStorage.getItem(TRAINER_KEYS.token) ||
      null
    );
  },

  getAuthUser() {
    const raw =
      sessionStorage.getItem(TRAINER_KEYS.authUser) ||
      localStorage.getItem(TRAINER_KEYS.authUser);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[TrainerStore.getAuthUser] parse error:', e);
      return null;
    }
  },

  getRole() {
    return (
      sessionStorage.getItem(TRAINER_KEYS.role) ||
      localStorage.getItem(TRAINER_KEYS.role) ||
      null
    );
  },

  hasSession() {
    const token =
      localStorage.getItem(TRAINER_KEYS.token) ||
      sessionStorage.getItem(TRAINER_KEYS.token);
    const authUser =
      localStorage.getItem(TRAINER_KEYS.authUser) ||
      sessionStorage.getItem(TRAINER_KEYS.authUser);
    const role =
      localStorage.getItem(TRAINER_KEYS.role) ||
      sessionStorage.getItem(TRAINER_KEYS.role);
    return !!token && !!authUser && role === 'trainer';
  },

  clear() {
    localStorage.removeItem(TRAINER_KEYS.token);
    localStorage.removeItem(TRAINER_KEYS.authUser);
    localStorage.removeItem(TRAINER_KEYS.role);

    sessionStorage.removeItem(TRAINER_KEYS.token);
    sessionStorage.removeItem(TRAINER_KEYS.authUser);
    sessionStorage.removeItem(TRAINER_KEYS.role);
  },
};

// --------------------------------------
// Backward‑compatible bootstrap
// Copy valid trainer session from generic keys into trainer_* once
// --------------------------------------
function bootstrapTrainerFromGenericIfNeeded() {
  try {
    if (TrainerStore.hasSession()) return;

    const genToken =
      localStorage.getItem('token') || sessionStorage.getItem('token');
    const genRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');
    const genAuthRaw =
      localStorage.getItem('authUser') || sessionStorage.getItem('authUser');

    if (!genToken || !genRole || genRole !== 'trainer' || !genAuthRaw) return;

    const genAuth = JSON.parse(genAuthRaw);
    TrainerStore.set(genToken, genAuth);
  } catch (e) {
    console.error('[bootstrapTrainerFromGenericIfNeeded] failed:', e);
  }
}

// --------------------------------------
// Centralized trainer logout (scoped)
// --------------------------------------
function trainerLogout(reason) {
  console.log('[Trainer Logout]:', reason || 'no reason');

  // Clear trainer_* keys
  TrainerStore.clear();

  // Also clear legacy generic keys if they currently represent a trainer session
  try {
    const genericRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');

    if (genericRole === 'trainer') {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');

      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
    }
  } catch (e) {
    console.error('[trainerLogout] failed to clear generic trainer keys:', e);
  }

  // Notify other trainer tabs in this browser
  localStorage.setItem(TRAINER_KEYS.logoutEvent, Date.now().toString());

  window.location.href = '../login.html';
}

// Keep old name for compatibility
function logout(reason) {
  trainerLogout(reason);
}

// Cross‑tab trainer logout sync
window.addEventListener('storage', (event) => {
  if (event.key === TRAINER_KEYS.logoutEvent) {
    console.log('[Trainer Logout] feedback page sees logout from another tab');
    TrainerStore.clear();
    window.location.href = '../login.html';
  }
});

// --------------------------------------
// Utility for authenticated API calls
// (adds security header for /api/ routes) with timeout - Handles full URLs
// --------------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log('apiFetch called for:', endpoint); // DEBUG

  bootstrapTrainerFromGenericIfNeeded();

  const token = TrainerStore.getToken();
  const authUser = TrainerStore.getAuthUser();
  const role = TrainerStore.getRole();

  if (!token || !authUser || role !== 'trainer') {
    console.log(
      'Missing token/authUser/role in trainer-feedback apiFetch - logging out'
    ); // DEBUG
    trainerLogout('missing token/authUser/role in trainer-feedback apiFetch');
    return;
  }

  // 2-hour session max check + update timestamp
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > TRAINER_SESSION_MAX_AGE_MS) {
      console.log('Trainer session max age exceeded in trainer-feedback apiFetch');
      trainerLogout('trainer session max age exceeded in trainer-feedback apiFetch');
      return;
    }
    authUser.timestamp = Date.now();
    TrainerStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to parse authUser in trainer-feedback apiFetch:', e);
    trainerLogout('invalid authUser JSON in trainer-feedback apiFetch');
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
      console.log(
        '401/403 Unauthorized - clearing auth and redirecting (trainer-feedback)'
      ); // DEBUG
      trainerLogout('401/403 from trainer-feedback apiFetch');
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

// ✅ INITIAL AUTH CHECK - Token + Role ('trainer') + Timestamp (runs immediately)
(function checkAuth() {
  console.log('Auth check starting for trainer-feedback'); // DEBUG

  bootstrapTrainerFromGenericIfNeeded();

  const authUser = TrainerStore.getAuthUser();
  const token = TrainerStore.getToken();
  const role = TrainerStore.getRole();

  console.log('Auth details:', {
    authUser: authUser
      ? authUser.username || authUser.email || authUser.name
      : null,
    token: !!token,
    role,
  }); // DEBUG

  if (
    !authUser ||
    !token ||
    role !== 'trainer' ||
    Date.now() - (authUser.timestamp || 0) > TRAINER_SESSION_MAX_AGE_MS
  ) {
    console.log('Auth failed - clearing and redirecting'); // DEBUG
    trainerLogout('initial trainer-feedback auth failed');
    return;
  }

  console.log(
    'Trainer authenticated:',
    authUser.username || authUser.email || authUser.name,
    'Role:',
    role
  );
})();

// --------------------------------------
// DOM Ready
// --------------------------------------
document.addEventListener('DOMContentLoaded', async function () {
  setSidebarTrainerName();
  // 🔍 DEBUG: Log the raw authUser to diagnose structure
  console.log('=== TRAINER FEEDBACK AUTH DEBUG ===');

  bootstrapTrainerFromGenericIfNeeded();
  let authUser = TrainerStore.getAuthUser();
  const token = TrainerStore.getToken();
  const role = TrainerStore.getRole();

  console.log('AuthUser from TrainerStore:', authUser);
  if (authUser) {
    console.log('authUser keys:', Object.keys(authUser));
    console.log('authUser.role:', authUser.role);
    console.log('authUser.timestamp:', authUser.timestamp);
    console.log('authUser.user exists?', !!authUser.user);
    if (authUser.user) console.log('authUser.user keys:', Object.keys(authUser.user));
  }

  // FIXED AUTH CHECK: Support both wrapped (authUser.user) and flattened structures
  const user = authUser?.user || authUser; // Fallback to flattened structure
  const timestamp = authUser?.timestamp || 0;

  // ENHANCED: Token + role + timestamp check
  if (
    !authUser ||
    !user ||
    role !== 'trainer' ||
    !token ||
    Date.now() - timestamp > TRAINER_SESSION_MAX_AGE_MS
  ) {
    console.log('Auth check failed - logging out (trainer-feedback)');
    trainerLogout('trainer-feedback auth failed in DOMContentLoaded');
    return;
  }

  console.log('Auth check passed! Using user:', user);
  console.log(
    'Extracted trainer ID:',
    user.trainer_id || user.trainerid || user.trainerId || user.id || user._id
  );

  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () =>
      sidebar.classList.toggle('collapsed')
    );
  }
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      trainerLogout('manual trainer-feedback logout button');
    });
  }

  // Display trainer name
  const trainerNameEl = document.getElementById('trainerName');
  if (trainerNameEl) trainerNameEl.textContent = user.name || 'Trainer';

  // Trainer ID extraction with more fallbacks
  trainerId =
    user.trainer_id || user.trainerid || user.trainerId || user.id || user._id;
  if (!trainerId) {
    console.error('No valid trainer ID found');
    const loading = document.getElementById('loading');
    if (loading) {
      loading.textContent = 'Error: Unable to identify trainer';
    }
    return;
  }

  console.log('Trainer ID:', trainerId);

  // Load all feedback
  await loadAllFeedback();
});

function setSidebarTrainerName() {
  try {
    if (typeof bootstrapTrainerFromGenericIfNeeded === "function") {
      bootstrapTrainerFromGenericIfNeeded();
    }

    const auth =
      (typeof TrainerStore !== "undefined" && TrainerStore.getAuthUser && TrainerStore.getAuthUser()) ||
      (() => {
        try {
          const raw =
            sessionStorage.getItem("trainerauthUser") ||
            localStorage.getItem("trainerauthUser") ||
            sessionStorage.getItem("authUser") ||
            localStorage.getItem("authUser");
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      })();

    const user = auth?.user || auth;
    const displayName = user?.name || user?.username || auth?.name || auth?.username || "Trainer";

    const el = document.getElementById("sidebarTrainerName");
    if (el) el.textContent = displayName;
  } catch (e) {
    console.error("Failed to set sidebar trainer name:", e);
  }
}


// ✅ LOAD ALL FEEDBACK (TOKENIZED)
async function loadAllFeedback() {
  const loading = document.getElementById('loading');
  const container = document.getElementById('classesContainer');

  try {
    // ENHANCED: Token + role + timestamp check using TrainerStore
    bootstrapTrainerFromGenericIfNeeded();
    const token = TrainerStore.getToken();
    const authUser = TrainerStore.getAuthUser();
    const role = TrainerStore.getRole();

    if (
      !token ||
      !authUser ||
      role !== 'trainer' ||
      Date.now() - (authUser.timestamp || 0) > TRAINER_SESSION_MAX_AGE_MS
    ) {
      console.log('Invalid session in loadAllFeedback - logging out'); // DEBUG
      trainerLogout('invalid session in loadAllFeedback');
      return;
    }

    // ✅ FETCH ALL TRAINERS FIRST (TOKENIZED)
    const trainersData = await apiFetch(`${API_URL}/api/trainers`);
    const allTrainers = trainersData.data || [];

    // Create a map of trainer_id -> trainer name
    const trainerMap = {};
    allTrainers.forEach((trainer) => {
      const tid = trainer.trainer_id || trainer.trainerid || trainer._id;
      trainerMap[tid] = trainer.name;
    });

    // ✅ FETCH ALL CLASSES (TOKENIZED)
    const classesData = await apiFetch(`${API_URL}/api/classes`);
    const allClasses = classesData.data || [];

    // ✅ FETCH ALL FEEDBACKS (TOKENIZED)
    const feedbackData = await apiFetch(`${API_URL}/api/feedbacks/admin/all`);
    const allFeedbacks = feedbackData.feedbacks || [];

    console.log(
      'Loaded trainers:',
      allTrainers.length,
      'classes:',
      allClasses.length,
      'feedbacks:',
      allFeedbacks.length
    );

    // Organize feedbacks by class_id
    const feedbacksByClass = {};
    allFeedbacks.forEach((fb) => {
      const classId = fb.class_id;
      if (!feedbacksByClass[classId]) {
        feedbacksByClass[classId] = [];
      }
      feedbacksByClass[classId].push(fb);
    });

    // ✅ COMBINE CLASS DATA WITH FEEDBACKS AND TRAINER NAMES
    const classesWithFeedback = allClasses
      .map((cls) => {
        const classId = cls.class_id || cls.classid || cls._id;
        const feedbacks = feedbacksByClass[classId] || [];
        const classTrainerId = cls.trainer_id || cls.trainerid;
        const isMyClass = classTrainerId === trainerId;

        // ✅ GET TRAINER NAME FROM MAP
        const trainerName = trainerMap[classTrainerId] || 'Unknown Trainer';

        return {
          ...cls,
          feedbacks: feedbacks,
          originalFeedbacks: feedbacks,
          isMyClass,
          classId,
          trainerName, // add trainer name
        };
      })
      .filter((cls) => cls.feedbacks.length > 0);

    // Store both original and working copy
    originalClassesData = JSON.parse(JSON.stringify(classesWithFeedback));
    allClassesData = classesWithFeedback;

    if (loading) loading.style.display = 'none';

    if (allClassesData.length === 0) {
      container.innerHTML =
        '<div class="no-classes">No feedback available yet.</div>';
      return;
    }

    renderClasses();
  } catch (err) {
    console.error('Error loading feedback:', err);
    if (loading) loading.style.display = 'none';
    container.innerHTML =
      '<div class="no-classes">Failed to load feedback: ' +
      err.message +
      '. Please try again.</div>';
  }
}

// ✅ FILTER CLASSES (FIXED: Accept button param instead of event)
function filterClasses(type, button) {
  currentFilter = type;

  // Update button states
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.classList.remove('active');
  });
  button.classList.add('active');

  renderClasses();
}

// ✅ APPLY RATING FILTER
function applyRatingFilter() {
  currentMinRating = parseInt(document.getElementById('minRating').value);
  renderClasses();
}

// ✅ RENDER CLASSES
function renderClasses() {
  const container = document.getElementById('classesContainer');

  // Start with original data (deep copy to avoid mutation)
  let filtered = JSON.parse(JSON.stringify(originalClassesData));

  // Filter by class ownership first
  if (currentFilter === 'my') {
    filtered = filtered.filter((cls) => cls.isMyClass);
  }

  // Filter feedbacks by rating for each class
  if (currentMinRating > 0) {
    filtered = filtered
      .map((cls) => {
        const filteredFeedbacks = cls.originalFeedbacks.filter(
          (fb) => fb.rating >= currentMinRating
        );
        return {
          ...cls,
          feedbacks: filteredFeedbacks,
          feedbackCount: filteredFeedbacks.length,
        };
      })
      .filter((cls) => cls.feedbacks.length > 0);
  }

  if (filtered.length === 0) {
    container.innerHTML =
      '<div class="no-classes">No classes match the selected filters.</div>';
    return;
  }

  let html = '';

  filtered.forEach((cls) => {
    const className = cls.class_name || cls.classname || 'Unnamed Class';
    const schedule = cls.schedule || 'Not scheduled';
    const trainerName = cls.trainerName || 'Unknown Trainer';
    const avgRating = calculateAverageRating(cls.feedbacks);
    const myClassBadge = cls.isMyClass
      ? '<span class="my-class-badge">My Class</span>'
      : '';
    const myClassCls = cls.isMyClass ? 'my-class' : '';

    html += `
      <div class="class-card ${myClassCls}">
        <div class="class-header">
          <h3>${className}</h3>
          <div class="class-meta">
            ${myClassBadge}
            <div class="schedule">${schedule}</div>
            <div class="enrollment">${cls.feedbacks.length} Feedback${
      cls.feedbacks.length !== 1 ? 's' : ''
    }</div>
          </div>
        </div>
        <div class="trainer-info">
          <strong>Trainer:</strong> ${trainerName} | <strong>Avg Rating:</strong> ${avgRating.toFixed(
      1
    )} ⭐
        </div>
        <div class="feedback-section">
          <h4>Student Feedback</h4>
          <div class="feedback-list">
            ${renderFeedbacks(cls.feedbacks)}
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// ✅ RENDER FEEDBACKS
function renderFeedbacks(feedbacks) {
  if (feedbacks.length === 0) {
    return '<div class="no-feedbacks">No feedback for this class yet.</div>';
  }

  return feedbacks
    .map((fb) => {
      const rating = fb.rating || 0;
      const comment = fb.comment || 'No comment provided';
      const date = fb.date_submitted
        ? new Date(fb.date_submitted).toLocaleDateString()
        : 'Unknown date';
      const stars = generateStars(rating);

      return `
        <div class="feedback-item">
          <div class="feedback-header">
            <div class="star-rating">
              ${stars}
              <span class="rating-number">(${rating}/5)</span>
            </div>
            <div class="feedback-date">${date}</div>
          </div>
          <div class="feedback-comment">"${comment}"</div>
          <div class="feedback-meta">
            <strong>Member ID:</strong> ${fb.member_id}
          </div>
        </div>
      `;
    })
    .join('');
}

// ✅ GENERATE STARS
function generateStars(rating) {
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    if (i <= rating) {
      stars += '<span class="star filled">★</span>';
    } else {
      stars += '<span class="star">☆</span>';
    }
  }
  return stars;
}

// ✅ CALCULATE AVERAGE RATING
function calculateAverageRating(feedbacks) {
  if (feedbacks.length === 0) return 0;
  const sum = feedbacks.reduce((acc, fb) => acc + (fb.rating || 0), 0);
  return sum / feedbacks.length;
}
