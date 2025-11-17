// ========================================
// MANAGE CLASS ENROLLMENT - Admin
// (Auth + shared fetch + init + health)
// ========================================

const SERVER_URL = 'http://localhost:8080';
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// --------------------------------------
// Admin-scoped storage keys (avoid cross-role interference)
// --------------------------------------
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

// --------------------------------------
// Shared auth helpers (admin‑only)
// --------------------------------------
function getApiBase() {
  return (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1')
    ? SERVER_URL
    : '';
}

function getToken() {
  return AdminStore.getToken();
}

// Clear ONLY admin‑scoped auth (do not touch member/trainer keys)
// Clear admin-scoped auth and legacy generic admin keys
function clearAdminAuth() {
  // Clear admin_* keys
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
    console.error('[clearAdminAuth] failed to clear generic admin keys:', e);
  }
}


// Centralized admin logout used by this page
function adminLogout(reason) {
  console.log('[Admin Logout]:', reason || 'no reason');
  clearAdminAuth();
  // Notify only admin tabs in this browser
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = '../admin-login.html';
}

// Centralized admin auth check for this page
function ensureAdminAuthOrLogout(loginPath) {
  try {
    // Make sure admin_* keys are populated from generic keys once
    if (!AdminStore.hasSession()) {
      bootstrapAdminFromGenericIfNeeded();
    }

    if (!AdminStore.hasSession()) {
      adminLogout('missing admin session');
      return false;
    }

    const authUser = AdminStore.getAuthUser();
    if (!authUser || authUser.role !== 'admin') {
      adminLogout('invalid or non-admin authUser');
      return false;
    }

    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded');
      return false;
    }

    // Refresh timestamp on page auth check
    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);

    // Cross-tab logout: listen for adminLogoutEvent only
    window.addEventListener('storage', (event) => {
      if (event.key === ADMIN_KEYS.logoutEvent) {
        adminLogout('adminLogoutEvent from another tab (requireAuth)');
      }
    });

    return true;
  } catch (e) {
    console.error('Auth check failed in ensureAdminAuthOrLogout:', e);
    adminLogout('exception in ensureAdminAuthOrLogout');
    return false;
  }
}

/**
 * Require a valid auth session for this page.
 * - expectedRole: 'admin' | 'member' | 'trainer'
 * - loginPath: relative path to the corresponding login page
 *
 * For this admin page, we delegate to ensureAdminAuthOrLogout
 * but keep the same signature so call sites remain unchanged.
 */
function requireAuth(expectedRole, loginPath) {
  return ensureAdminAuthOrLogout(loginPath);
}

// Cross‑tab admin logout sync (admin_* only)
window.addEventListener('storage', (event) => {
  if (event.key === ADMIN_KEYS.logoutEvent) {
    adminLogout('adminLogoutEvent from another tab (global listener)');
  }
});

// ------------------------------
// Shared secure fetch (admin‑only)
// ------------------------------
async function apiFetch(endpoint, options = {}) {
  // Guard with centralized auth
  const ok = ensureAdminAuthOrLogout('../admin-login.html');
  if (!ok) return;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();

  if (!token || !authUser) {
    adminLogout('missing token/authUser in admin apiFetch');
    return;
  }

  // Timestamp check (same logic as requireAuth)
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in apiFetch');
      return;
    }
    // refresh timestamp on successful use
    authUser.timestamp = Date.now();
    AdminStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to refresh authUser in apiFetch:', e);
    adminLogout('invalid authUser JSON in admin apiFetch');
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
    'Content-Type': 'application/json', // default for this file
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Invalid/expired session OR token revoked from another device
    console.log('401 from apiFetch, logging out admin only');
    // Broadcast admin logout, keep member/trainer sessions intact
    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    adminLogout('401 from admin apiFetch');
    return;
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

// ------------------------------
// Page state
// ------------------------------
let debounceTimeout;
let selectedMember = null;
let selectedClass = null;
let bulkEnrollments = []; // { member, classId, sessionDate, sessionTime }
let allClasses = [];
let allMembers = []; // latest ACTIVE members from server
let currentView = 'list';
let selectedDate = null;
const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ------------------------------
// Sidebar + session handling
// ------------------------------
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  // Security: Check timestamp again before wiring UI
  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in setupSidebarAndSession');
      return;
    }
  } catch (e) {
    console.error('Auth parse failed in setupSidebarAndSession:', e);
    adminLogout('invalid authUser JSON in setupSidebarAndSession');
    return;
  }

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
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
        // Admin-only logout
        localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
        adminLogout('manual admin logout button');
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

  // Prevent body scroll when sidebar is open on mobile
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

// ------------------------------
// DOM Ready
// ------------------------------
document.addEventListener('DOMContentLoaded', async function () {
  console.log('=== INIT START ===');

  // Unified auth gate (admin only)
  const ok = requireAuth('admin', '../admin-login.html');
  if (!ok) return;

  // Sidebar + logout wiring
  setupSidebarAndSession();

  // Init: Simple fetches
  await checkServerConnection();
  await Promise.all([fetchClasses(), fetchMembers('')]);
  setupEventListeners();

  const calendarMonth = document.getElementById('calendarMonth');
  if (calendarMonth) {
    calendarMonth.value = new Date().toISOString().slice(0, 7);
  } else {
    console.warn('calendarMonth not found');
  }

  generateCalendar();
  updateBulkEnrollDisplay();
  switchView('list');

  // Default date to today for list view (with future-date restriction)
  const sessionDateInput = document.getElementById('sessionDate');
  if (sessionDateInput) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const minDate = `${year}-${month}-${day}`;
    sessionDateInput.setAttribute('min', minDate);

    // Block manual input of past dates
    const enforceMin = (e) => {
      const inputValue = e.target.value;
      if (!inputValue) return;
      if (inputValue < minDate) {
        showError('Cannot select past dates. Please choose today or a future date.');
        e.target.value = minDate;
      }
    };

    sessionDateInput.addEventListener('change', enforceMin);
    sessionDateInput.addEventListener('blur', enforceMin);

    console.log('✅ sessionDate input restricted to future dates, min:', minDate);
  } else {
    console.warn('sessionDate input not found');
  }

  console.log('=== INIT COMPLETE ===');
  domCheck(); // Run diagnostic
});

// ------------------------------
// DOM Diagnostic: Check All Expected Elements
// ------------------------------
function domCheck() {
  console.log('=== DOM CHECK START ===');
  const ids = [
    'classSelect',
    'membersTableBody',
    'addToBulkBtn',
    'bulkEnrollPanel',
    'bulkEnrollList',
    'confirmBulkBtn',
    'sessionDate',
    'sessionTime',
    'timeSlots',
    'sessionsTableBody',
    'emptyCartMsg',
    'sessionDetailsSection',
    'addPanelToCartBtn',
    'panelMemberSelect',
    'memberSearch',
    'autocompleteSuggestions',
    'serverStatus',
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) console.log(`✓ Found: #${id}`);
    else console.error(`✗ MISSING: #${id} (update HTML or JS)`);
  });
  console.log('=== DOM CHECK END ===');
}

// ------------------------------
// Server health check (now via apiFetch)
// ------------------------------
async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  try {
    // Can be public in backend, but apiFetch keeps things consistent
    const result = await apiFetch('/health');
    const isConnected = !!result;

    if (statusElement) {
      statusElement.className = `server-status ${
        isConnected ? 'server-connected' : 'server-disconnected'
      }`;
      statusElement.textContent = isConnected
        ? 'Connected to server successfully'
        : 'Cannot connect to server. Please try again later.';
      statusElement.style.display = 'block';
    }

    console.log('Server check:', isConnected ? 'OK' : 'Failed');
  } catch (error) {
    if (statusElement) {
      statusElement.className = 'server-status server-disconnected';
      statusElement.textContent = 'Cannot connect to server. Please try again later.';
      statusElement.style.display = 'block';
    }
    console.error('Server connection error:', error);
  }
}

async function fetchClasses() { 
  const classSelect = document.getElementById('classSelect'); 
  if (!classSelect) { 
    console.error('classSelect not found—check HTML ID'); 
    return; 
  } 
  console.log('Fetching classes...'); 
  classSelect.innerHTML = '<option value="">Loading classes...</option>'; 
  try { 
    // Secure GET with apiFetch
    const result = await apiFetch('/api/classes');
    console.log('Classes response:', result);
    allClasses = result.data || []; 
    console.log('Classes loaded:', allClasses.length, allClasses[0]); 
    classSelect.innerHTML = '<option value="">Select a class</option>'; 
    allClasses.forEach(cls => { 
      const classId = cls.class_id; 
      const option = document.createElement('option'); 
      option.value = classId; 
      option.textContent = `${cls.class_name || cls.name} - ${cls.schedule}`; 
      option.dataset.schedule = cls.schedule; 
      classSelect.appendChild(option); 
    }); 
    if (allClasses.length === 0) { 
      classSelect.innerHTML = '<option value="">No classes available</option>'; 
      showError('No classes found.'); 
    } 
  } catch (error) { 
    console.error('Error fetching classes:', error); 
    classSelect.innerHTML = '<option value="">Failed to load classes</option>'; 
    showError('Failed to fetch classes'); 
  } 
  updateSingleButtons(); 
} 

// STRICT: Only ACTIVE members with combative sessions available 
async function fetchMembers(query = '') { 
  console.log('=== FETCH MEMBERS START === Query:', query); 
  const tbody = document.getElementById('membersTableBody'); 
  if (tbody) { 
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Loading members...</td></tr>'; 
  } else { 
    console.error('membersTableBody not found—check HTML'); 
  } 

  try { 
    // Secure GET: Fetch ALL ACTIVE (backend filters status=active)
    console.log('Calling apiFetch /api/members?status=active...'); 
    const result = await apiFetch(`/api/members?status=active`); 
    console.log('Raw API response:', result);  // Dump full response for debug
    const rawMembers = result.data || result.members || [];  // Fallback if backend uses 'members' key
    console.log('Raw active members extracted:', rawMembers.length, rawMembers[0] || 'None'); 

    // Cache for client search (even if 0)
    allMembers = rawMembers; 
    if (allMembers.length === 0) { 
      console.warn('No active members in DB—seed some with status: "active"'); 
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-warning">No active members in system. Add via Add Member page.</td></tr>'; 
      showError('No active members found. Please add members first.'); 
      return; 
    } 

    // Apply strict combative filter + query (with debug)
    const eligible = strictFilterEligibleMembers(allMembers, query); 
    console.log('Eligible after filter:', eligible.length); 
    
    if (eligible.length === 0) { 
      console.warn('0 eligible—showing ALL active as fallback (no combative sessions?)'); 
      const fallbackMembers = strictFilterEligibleMembers(allMembers, query, true);  // true = ignore combative
      console.log('Fallback all active:', fallbackMembers.length); 
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-warning">No members with combative sessions. Showing all active:</td></tr>'; 
      populateMembersTable(fallbackMembers); 
      showError(query ? `No combative matches for "${query}". Showing all active.` : 'No combative sessions available. Showing all active members.'); 
      // Autocomplete/panel: Use fallback
      if (query.trim().length >= 2) { 
        populateAutocomplete(fallbackMembers.slice(0, 10)); 
      } 
      populatePanelMembers(fallbackMembers); 
    } else { 
      // Normal: Populate eligible
      populateMembersTable(eligible); 
      if (query.trim().length >= 2) { 
        populateAutocomplete(eligible.slice(0, 10));  // Top 10 for perf
      } else { 
        const suggestions = document.getElementById('autocompleteSuggestions'); 
        if (suggestions) suggestions.style.display = 'none'; 
      } 
      populatePanelMembers(eligible); 
      if (query) showSuccess(`${eligible.length} combative matches found.`); 
    } 
    console.log('=== FETCH MEMBERS END ==='); 
  } catch (error) { 
    console.error('=== FETCH MEMBERS ERROR ===', error); 
    allMembers = []; 
    const tbody = document.getElementById('membersTableBody'); 
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error: ' + (error.message || 'Network/Server Issue') + '</td></tr>'; 
    showError('Failed to load members. Check console/server.'); 
    const suggestions = document.getElementById('autocompleteSuggestions'); 
    if (suggestions) suggestions.style.display = 'none'; 
  } 
}

// Strict eligibility: active AND has combative sessions left 
function strictFilterEligibleMembers(members, query = '', fallback = false) { 
  console.log('=== STRICT FILTER START === Query:', query, 'Fallback mode:', fallback); 
  const q = (query || '').trim().toLowerCase(); 
  const reasons = [];  // Debug: Why each filtered out
  const filtered = members 
    .filter(m => { 
      // Already active from server, but double-check
      if ((m.status || 'inactive') !== 'active') { 
        reasons.push(`${m._id || m.memberId}: Inactive status`); 
        return false; 
      } 
      if (fallback) return true;  // Skip combative check

      // Combative check
      const combativeOnly = (m.memberships || []).filter(ms => (ms.type || '').toLowerCase() === 'combative'); 
      console.log(`Member ${m._id || m.memberId}: Combative memberships found:`, combativeOnly.length); 
      const hasAvailable = combativeOnly.some(ms => { 
        const remaining = typeof ms.remainingSessions === 'number' ? ms.remainingSessions : 
                         typeof ms.duration === 'number' ? ms.duration : 0; 
        const notExpired = !ms.endDate || new Date(ms.endDate) >= new Date(); 
        const memStatus = (ms.status || 'active').toLowerCase(); 
        const isGood = remaining > 0 && notExpired && memStatus !== 'expired'; 
        if (!isGood) { 
          reasons.push(`${m._id || m.memberId}: Combative invalid (remaining: ${remaining}, expired: ${!notExpired}, status: ${memStatus})`); 
        } 
        return isGood; 
      }); 
      if (!hasAvailable) reasons.push(`${m._id || m.memberId}: No valid combative sessions`); 
      return hasAvailable; 
    }) 
    .map(m => { 
      // Add computed fields for table/autocomplete
      const combativeOnly = (m.memberships || []).filter(ms => (ms.type || '').toLowerCase() === 'combative'); 
      const hasAvailable = combativeOnly.some(ms => { 
        const remaining = typeof ms.remainingSessions === 'number' ? ms.remainingSessions : 
                         typeof ms.duration === 'number' ? ms.duration : 0; 
        const notExpired = !ms.endDate || new Date(ms.endDate) >= new Date(); 
        const memStatus = (ms.status || 'active').toLowerCase(); 
        return remaining > 0 && notExpired && memStatus !== 'expired'; 
      }); 
      return { ...m, _hasCombativeAvailable: hasAvailable, _combativeMemberships: combativeOnly }; 
    }); 

  // Apply query filter if present
  const queryFiltered = !q ? filtered : filtered.filter(m => 
    (m.name && m.name.toLowerCase().includes(q)) || 
    (m.fullName && m.fullName.toLowerCase().includes(q)) || 
    (m.memberId && m.memberId.toLowerCase().includes(q)) || 
    (m._id && m._id.toString().includes(q))  // Fallback to _id
  ); 

  if (reasons.length > 0) { 
    console.log('Filter reasons (top 5):', reasons.slice(0, 5)); 
    if (reasons.length > 5) console.log(`... and ${reasons.length - 5} more`); 
  } 
  console.log('Filtered result:', queryFiltered.length, queryFiltered[0] || 'None'); 
  console.log('=== STRICT FILTER END ==='); 
  return queryFiltered; 
}

// Compute remaining sessions shown in table/autocomplete 
function getRemainingSessions(member) { 
  const combative = (member._combativeMemberships || member.memberships || [])
    .find(ms => (ms.type || '').toLowerCase() === 'combative'); 
  if (!combative) return fallback ? 'N/A' : 0; 
  return typeof combative.remainingSessions === 'number' 
    ? combative.remainingSessions 
    : typeof combative.duration === 'number' 
    ? combative.duration 
    : 0; 
}

// Tab Switching Function - ADDED 
function switchView(view) { 
  currentView = view; 
  const listView = document.getElementById('listView'); 
  const calendarView = document.getElementById('calendarView'); 
  const listTab = document.getElementById('listTab'); 
  const calendarTab = document.getElementById('calendarTab'); 

  if (view === 'list') { 
    if (listView) listView.classList.add('active'); 
    if (calendarView) calendarView.classList.remove('active'); 
    if (listTab) listTab.classList.add('active'); 
    if (calendarTab) calendarTab.classList.remove('active'); 
  } else if (view === 'calendar') { 
    if (calendarView) calendarView.classList.add('active'); 
    if (listView) listView.classList.remove('active'); 
    if (calendarTab) calendarTab.classList.add('active'); 
    if (listTab) listTab.classList.remove('active'); 
    generateCalendar(); // Regenerate calendar when switching 
  } 
  console.log('Switched view to:', view); 
} 

function setupEventListeners() { 
  console.log('Setting up event listeners...'); 

  // Tab switching - ADDED 
  const listTab = document.getElementById('listTab'); 
  const calendarTab = document.getElementById('calendarTab'); 

  if (listTab) { 
    listTab.addEventListener('click', () => switchView('list')); 
    console.log('✓ listTab click listener added'); 
  } else { 
    console.warn('listTab not found'); 
  } 

  if (calendarTab) { 
    calendarTab.addEventListener('click', () => switchView('calendar')); 
    console.log('✓ calendarTab click listener added'); 
  } else { 
    console.warn('calendarTab not found'); 
  } 

  const memberSearch = document.getElementById('memberSearch'); 
  if (memberSearch) { 
    memberSearch.addEventListener('input', debounce(async () => { 
      const q = memberSearch.value.trim(); 
      // Filter the active cache (no server roundtrip needed each keystroke) 
      const eligible = strictFilterEligibleMembers(allMembers, q); 
      populateMembersTable(eligible); 
      populateAutocomplete(eligible.slice(0, 5)); 
    }, 300)); 
    // Hide autocomplete on blur with delay 
    memberSearch.addEventListener('blur', () => { 
      setTimeout(() => { 
        const autocomplete = document.getElementById('autocompleteSuggestions'); 
        if (autocomplete && autocomplete.style.display === 'block') { 
          autocomplete.style.display = 'none'; 
          console.log('Autocomplete hidden on blur'); 
        } 
      }, 150); 
    }); 
    console.log('✓ memberSearch input/blur listeners added'); 
  } else console.warn('memberSearch not found'); 

  // Global click to hide autocomplete if outside 
  document.addEventListener('click', (e) => { 
    const autocomplete = document.getElementById('autocompleteSuggestions'); 
    const searchInput = document.getElementById('memberSearch'); 
    if (autocomplete && autocomplete.style.display === 'block' && 
        !searchInput.contains(e.target) && !autocomplete.contains(e.target)) { 
      autocomplete.style.display = 'none'; 
      console.log('Autocomplete hidden on outside click'); 
    } 
  }); 

  const classSelect = document.getElementById('classSelect'); 
  if (classSelect) { 
    classSelect.addEventListener('change', onClassChange); 
    console.log('✓ classSelect change listener added'); 
  } else console.error('✗ classSelect not found for listener'); 

  const panelMemberSelect = document.getElementById('panelMemberSelect'); 
  if (panelMemberSelect) { 
    panelMemberSelect.addEventListener('change', updatePanelButton); 
    console.log('✓ panelMemberSelect change listener added'); 
  } 

  const addBulkBtn = document.getElementById('addToBulkBtn'); 
  if (addBulkBtn) { 
    addBulkBtn.addEventListener('click', addSelectedToCart); 
    console.log('✓ addToBulkBtn click listener added'); 
  } else { 
    console.error('✗ addToBulkBtn not found—check HTML ID'); 
  } 

  const addPanelBtn = document.getElementById('addPanelToCartBtn'); 
  if (addPanelBtn) { 
    addPanelBtn.addEventListener('click', addPanelSelectionToCart); 
    console.log('✓ addPanelToCartBtn click listener added'); 
  } else { 
    console.error('✗ addPanelToCartBtn not found—check HTML ID'); 
  } 

  // Clear cart button - ADDED 
  const clearCartBtn = document.getElementById('clearCartBtn'); 
  if (clearCartBtn) { 
    clearCartBtn.addEventListener('click', clearCart); 
    console.log('✓ clearCartBtn click listener added'); 
  } 

  // Confirm bulk button - ADDED 
  const confirmBulkBtn = document.getElementById('confirmBulkBtn'); 
  if (confirmBulkBtn) { 
    confirmBulkBtn.addEventListener('click', confirmBulkEnroll); 
    console.log('✓ confirmBulkBtn click listener added'); 
  } 

  document.addEventListener('change', (e) => { 
    if (e.target.id === 'selectAllMembers') { 
      document.querySelectorAll('.member-checkbox').forEach(cb => cb.checked = e.target.checked); 
      updateAddToCartButton(); 
    } else if (e.target.classList.contains('member-checkbox')) { 
      toggleAllMembers(); 
      updateAddToCartButton(); 
    } 
  }); 

  const timeSelect = document.getElementById('sessionTime'); 
  if (timeSelect) timeSelect.addEventListener('change', () => console.log('Time selected:', timeSelect.value)); 

  // Calendar month change - ADDED 
  const calendarMonth = document.getElementById('calendarMonth'); 
  if (calendarMonth) { 
    calendarMonth.addEventListener('change', generateCalendar); 
    console.log('✓ calendarMonth change listener added'); 
  } 
} 

function debounce(func, wait) { 
  return function(...args) { 
    clearTimeout(debounceTimeout); 
    debounceTimeout = setTimeout(() => func.apply(this, args), wait); 
  }; 
} 

function onClassChange() { 
  const selectedClassId = document.getElementById('classSelect')?.value; 
  console.log('onClassChange: Selected class ID =', selectedClassId); 
  const sessionDetailsSection = document.getElementById('sessionDetailsSection'); 
  if (selectedClassId) { 
    if (sessionDetailsSection) { 
      sessionDetailsSection.style.display = 'block'; 
      sessionDetailsSection.classList.remove('d-none'); 
    } else console.warn('sessionDetailsSection not found'); 
    populateSessionsTable(selectedClassId); 
    const cls = allClasses.find(c => c.class_id === selectedClassId); 
    if (cls) populateTimeSlots(cls.schedule); 
  } else if (sessionDetailsSection) { 
    sessionDetailsSection.style.display = 'none'; 
    sessionDetailsSection.classList.add('d-none'); 
  } 
  updateSingleButtons(); 
  updateAddToCartButton(); 
} 

function populateTimeSlots(schedule) { 
  const timeSlotsDiv = document.getElementById('timeSlots'); 
  const timeSelect = document.getElementById('sessionTime'); 
  if (!timeSlotsDiv || !timeSelect) { 
    console.error('timeSlots or sessionTime not found'); 
    return; 
  } 
  timeSlotsDiv.innerHTML = ''; 
  timeSelect.innerHTML = '<option value="">Select Time</option>'; 
  timeSelect.style.display = 'none'; 

  // FIXED: Changed \d{1:2} to \d{1,2} 
  const timeMatch = schedule.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i); 

  if (timeMatch) { 
    const timeRange = `${timeMatch[1]} - ${timeMatch[2]}`; 
    console.log('Matched time range:', timeRange);const slotBtn = document.createElement('button'); 
    slotBtn.className = 'time-slot'; 
    slotBtn.textContent = timeRange; 
    slotBtn.type = 'button'; // Important: prevent form submission 
    slotBtn.onclick = (e) => { 
      e.preventDefault(); 
      // Remove selected class from all time slots 
      document.querySelectorAll('.time-slot').forEach(btn => btn.classList.remove('selected')); 
      // Add selected class to clicked button 
      slotBtn.classList.add('selected'); 
      // Set the select value 
      timeSelect.value = timeRange; 
      timeSelect.style.display = 'block'; 
      showSuccess('Time selected: ' + timeRange); 
      console.log('Time slot selected:', timeRange); 
    }; 
    timeSlotsDiv.appendChild(slotBtn); 
    timeSelect.innerHTML += `<option value="${timeRange}">${timeRange}</option>`; 
    console.log('Time slot button created for:', timeRange); 
  } else { 
    console.warn('No time match found in schedule:', schedule); 
    timeSlotsDiv.innerHTML = '<p class="text-muted small">No predefined slots.</p>'; 
    timeSelect.style.display = 'block'; 
  } 
} 

function populateMembersTable(members) { 
  console.log('=== POPULATE TABLE START === Members to render:', members.length, members[0] || 'None'); 
  const tbody = document.getElementById('membersTableBody'); 
  if (!tbody) { 
    console.error('membersTableBody not found—check HTML <tbody id="membersTableBody">'); 
    return; 
  } 
  tbody.innerHTML = ''; 
  const classSelectValue = document.getElementById('classSelect')?.value || ''; 
  console.log('Class selected for buttons:', classSelectValue); 

  if (members.length === 0) { 
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No members to display.</td></tr>'; 
    console.warn('Empty members array—check filter/DB'); 
    return; 
  } 

  // Render rows
  members.forEach((member, idx) => { 
    const memberId = member.memberId || member._id;  // Fallback to _id
    if (!memberId) { 
      console.warn(`Skipping member ${idx}: No ID (memberId or _id)`); 
      return; 
    } 
    const name = member.name || member.fullName || 'Unknown'; 
    const remaining = getRemainingSessions(member); 
    console.log(`Rendering row ${idx}: ${name} (ID: ${memberId}, Sessions: ${remaining})`); 

    const row = document.createElement('tr'); 
    row.innerHTML = ` 
      <td><input type="checkbox" class="form-check-input member-checkbox" value="${memberId}"></td> 
      <td>${memberId}</td> 
      <td>${name}</td> 
      <td>${remaining}</td> 
      <td> 
        <button class="action-button cart-button add-to-bulk-btn"  
                data-member-id="${memberId}" 
                onclick="addMemberToCart('${memberId}')" 
                ${!classSelectValue ? 'disabled' : ''}> 
          <i class="cart-icon">🛒</i> ${classSelectValue ? 'Add to Cart' : 'Select Class First'} 
        </button> 
      </td> 
    `; 
    tbody.appendChild(row); 
  }); 

  // Update checkboxes & button
  toggleAllMembers(); 
  updateAddToCartButton(); 
  console.log(`✓ Table populated: ${tbody.children.length} rows`); 
  console.log('=== POPULATE TABLE END ==='); 
} 

function updateSingleButtons() { 
  const classSelect = document.getElementById('classSelect'); 
  const hasClass = !!(classSelect && classSelect.value); 
  console.log('updateSingleButtons: hasClass =', hasClass, 'value =', classSelect?.value); 
  document.querySelectorAll('.add-to-bulk-btn').forEach(btn => { 
    btn.disabled = !hasClass; 
    const icon = btn.querySelector('.cart-icon'); 
    if (icon) { 
      btn.innerHTML = hasClass ? '<i class="cart-icon">🛒</i> Add to Cart' : 'Select Class First'; 
    } else { 
      btn.textContent = hasClass ? 'Add to Cart' : 'Select Class First'; 
    } 
  }); 
} 

function populateAutocomplete(members) { 
  const suggestions = document.getElementById('autocompleteSuggestions'); 
  if (!suggestions) return; 
  suggestions.innerHTML = ''; 
  members.forEach(member => { 
    const memberId = member.memberId; 
    if (!memberId) return; 
    const div = document.createElement('div'); 
    div.className = 'autocomplete-suggestion'; 
    div.innerHTML = `<strong>${member.name || member.fullName}</strong> (${memberId}) - ${getRemainingSessions(member)} sessions`; 
    div.onclick = (e) => { 
      e.stopPropagation(); 
      document.getElementById('memberSearch').value = member.name || member.fullName; 
      suggestions.style.display = 'none'; 
      populateMembersTable([member]); 
      console.log('Autocomplete item clicked, hidden'); 
    }; 
    suggestions.appendChild(div); 
  }); 
  suggestions.style.display = members.length > 0 ? 'block' : 'none'; 
  console.log('Autocomplete populated and shown:', members.length, 'items'); 
} 

function populatePanelMembers(members) { 
  const select = document.getElementById('panelMemberSelect'); 
  if (!select) return; 
  select.innerHTML = ''; 
  members.forEach(member => { 
    const memberId = member.memberId; 
    const option = document.createElement('option'); 
    option.value = memberId; 
    option.textContent = `${member.name || member.fullName} (${getRemainingSessions(member)} sessions)`; 
    select.appendChild(option); 
  }); 
  if (select.children.length === 0) select.innerHTML = '<option value="">No members available</option>'; 
} 

function toggleAllMembers() { 
  const selectAll = document.getElementById('selectAllMembers'); 
  if (!selectAll) return; 
  const checkboxes = document.querySelectorAll('.member-checkbox'); 
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length; 
  selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length; 
  selectAll.checked = checkedCount === checkboxes.length && checkboxes.length > 0; 
} 

function updateAddToCartButton() { 
  const checkedCount = Array.from(document.querySelectorAll('.member-checkbox:checked')).length; 
  const classSelected = !!document.getElementById('classSelect')?.value; 
  const addBtn = document.getElementById('addToBulkBtn'); 
  if (addBtn) { 
    addBtn.disabled = checkedCount === 0 || !classSelected; 
    addBtn.innerHTML = `<i class="cart-icon">🛒</i> ${checkedCount > 0 ? `Add ${checkedCount} to Cart` : 'Add Selected to Cart'}`; 
    console.log('Bulk button updated: disabled =', addBtn.disabled, 'checked =', checkedCount, 'classSelected =', classSelected); 
  } else { 
    console.error('addToBulkBtn not found—check HTML ID'); 
  } 
}

// SINGLE ADD TO CART 
function addMemberToCart(memberId) { 
  console.log('=== SINGLE ADD START ==='); 
  console.log('Adding single memberId:', memberId); 
  const member = allMembers.find(m => m.memberId === memberId); 
  if (!member) { 
    console.error('Member not found for memberId:', memberId, 'Available:', allMembers.map(m => m.memberId)); 
    showError('Member not found'); 
    return; 
  } 
  console.log('Found member:', member.name || member.fullName); 
  const classSelect = document.getElementById('classSelect'); 
  const classId = classSelect?.value; 
  if (!classId) { 
    console.error('No class selected'); 
    showError('Please select a class first'); 
    return; 
  } 
  console.log('Selected class ID:', classId); 
  const sessionDateInput = document.getElementById('sessionDate'); 
  const sessionDate = sessionDateInput ? new Date(sessionDateInput.value) : new Date(); 
  const timeSelect = document.getElementById('sessionTime'); 
  const sessionTime = timeSelect?.value || parseTimeFromSchedule(allClasses.find(c => c.class_id === classId)?.schedule); 
  console.log('Session date:', sessionDate, 'time:', sessionTime); 
  const enrollment = { member, classId, sessionDate, sessionTime }; 
  bulkEnrollments.push(enrollment); 
  console.log('✓ Pushed to bulkEnrollments, total now:', bulkEnrollments.length); 
  console.log('Calling updateBulkEnrollDisplay...'); 
  updateBulkEnrollDisplay(); 
  showSuccess(`Added ${member.name || member.fullName} to cart`); 
  console.log('=== SINGLE ADD END ==='); 
} 

// BULK ADD TO CART 
function addSelectedToCart() { 
  console.log('=== BULK ADD START ==='); 
  const selectedCheckboxes = document.querySelectorAll('.member-checkbox:checked'); 
  console.log('Checked count:', selectedCheckboxes.length); 
  if (selectedCheckboxes.length === 0) { 
    showError('Select at least one member'); 
    return; 
  } 
  const classSelect = document.getElementById('classSelect'); 
  const classId = classSelect?.value; 
  if (!classId) { 
    console.error('No class selected'); 
    showError('Please select a class first'); 
    return; 
  } 
  const sessionDateInput = document.getElementById('sessionDate'); 
  const sessionDate = sessionDateInput ? new Date(sessionDateInput.value) : new Date(); 
  const timeSelect = document.getElementById('sessionTime'); 
  const sessionTime = timeSelect?.value || parseTimeFromSchedule(allClasses.find(c => c.class_id === classId)?.schedule); 
  let addedCount = 0; 
  selectedCheckboxes.forEach(cb => { 
    const memberId = cb.value; 
    const member = allMembers.find(m => m.memberId === memberId); 
    if (member) { 
      bulkEnrollments.push({ member, classId, sessionDate, sessionTime }); 
      addedCount++; 
      console.log('Added bulk:', memberId); 
    } else { 
      console.error('Member not found:', memberId); 
    } 
  }); 
  selectedCheckboxes.forEach(cb => cb.checked = false); 
  toggleAllMembers(); 
  updateAddToCartButton(); 
  console.log('✓ Total in cart:', bulkEnrollments.length); 
  console.log('Calling updateBulkEnrollDisplay...'); 
  updateBulkEnrollDisplay(); 
  showSuccess(`${addedCount} added to cart`); 
  console.log('=== BULK ADD END ==='); 
} 

async function populateSessionsTable(classId) { 
  const tbody = document.getElementById('sessionsTableBody'); 
  if (!tbody) { 
    console.error('sessionsTableBody not found'); 
    return; 
  } 
  tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Loading...</td></tr>'; 
  try {
    // Secure GET with apiFetch
    const result = await apiFetch(`/api/enrollments?class_id=${classId}`);
    tbody.innerHTML = ''; 
    (result.data || []).forEach(enr => { 
      const row = document.createElement('tr'); 
      row.innerHTML = ` 
        <td>${enr.memberId || enr.memberid}</td> 
        <td>${enr.name || enr.membername}</td> 
        <td>${enr.session_date || enr.sessiondate}</td> 
        <td>${enr.session_time || enr.sessiontime}</td> 
        <td><span class="badge bg-info">${enr.attendance_status || enr.attendancestatus}</span></td> 
        <td><button class="action-button" onclick="markAttended('${enr._id}')">Mark Attended</button></td> 
      `; 
      tbody.appendChild(row); 
    }); 
    if (tbody.children.length === 0) tbody.innerHTML = '<tr><td colspan="6" class="text-center">No sessions.</td></tr>'; 
  } catch (error) {
    console.error('Sessions error:', error); 
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No sessions found.</td></tr>'; 
  }
} 

// CART DISPLAY UPDATE 
function updateBulkEnrollDisplay() { 
  console.log('=== UPDATE CART DISPLAY START ==='); 
  console.log('Items in cart:', bulkEnrollments.length); 
  const panel = document.getElementById('bulkEnrollPanel'); 
  const list = document.getElementById('bulkEnrollList'); 
  const emptyMsg = document.getElementById('emptyCartMsg'); 
  const bulkBtn = document.getElementById('confirmBulkBtn'); 

  console.log('DOM elements found:', !!panel, !!list, !!emptyMsg, !!bulkBtn); 

  if (!panel) { 
    console.error("bulkEnrollPanel not found - cart won't show. Add <div id=\"bulkEnrollPanel\"> to HTML.");
    return; 
  } 
  if (!list) { 
    console.error('bulkEnrollList not found—check HTML ID'); 
    return; 
  } 

  if (emptyMsg) emptyMsg.style.display = 'block'; 
  list.innerHTML = ''; 

  if (bulkEnrollments.length === 0) { 
    console.log('Cart empty—hiding panel'); 
    panel.style.display = 'none'; 
    if (bulkBtn) { 
      bulkBtn.disabled = true; 
      bulkBtn.innerHTML = '<i class="save-icon">💾</i> Bulk Enroll Selected'; 
    } 
    if (emptyMsg) { 
      emptyMsg.textContent = 'Your cart is empty. Add members above!'; 
    } 
    console.log('=== UPDATE CART DISPLAY END (EMPTY) ==='); 
    return; 
  } 

  // Show panel 
  console.log('Cart has items—showing panel'); 
  panel.style.display = 'block'; 
  if (emptyMsg) emptyMsg.style.display = 'none'; 
  if (bulkBtn) { 
    bulkBtn.disabled = false; 
    bulkBtn.innerHTML = `<i class="save-icon">💾</i> Bulk Enroll (${bulkEnrollments.length})`; 
  } 

  bulkEnrollments.forEach((enr, idx) => { 
    const classObj = allClasses.find(c => c.class_id === enr.classId); 
    const className = classObj ? (classObj.class_name || classObj.name) : 'Unknown'; 
    const memberId = enr.member.memberId; 
    const li = document.createElement('li'); 
    li.innerHTML = ` 
      <div class="flex-grow-1"> 
        <div><strong>${enr.member.name || enr.member.fullName}</strong> (ID: ${memberId}) → <span class="text-info">${className}</span></div> 
        <small class="text-muted d-block">${enr.sessionDate.toLocaleDateString()} @ ${enr.sessionTime}</small> 
      </div> 
      <button class="remove-btn" onclick="removeFromBulk(${idx})">Remove</button> 
    `; 
    list.appendChild(li); 
    console.log(`✓ Added to display: ${memberId} for ${className}`); 
  }); 
  console.log('✓ Cart panel shown, list populated'); 
  console.log('=== UPDATE CART DISPLAY END (POPULATED) ==='); 
} 

function removeFromBulk(idx) { 
  if (bulkEnrollments[idx]) { 
    bulkEnrollments.splice(idx, 1); 
    updateBulkEnrollDisplay(); 
    showSuccess('Removed from cart'); 
  } 
} 

function clearCart() { 
  bulkEnrollments = []; 
  updateBulkEnrollDisplay(); 
  showSuccess('Cart cleared'); 
} 

async function confirmBulkEnroll() { 
  if (bulkEnrollments.length === 0) { 
    showError('Cart is empty'); 
    return; 
  } 
  if (!confirm(`Enroll ${bulkEnrollments.length} members?`)) return; 

  let successCount = 0; 
  const errors = [];for (const enr of bulkEnrollments) { 
    try { 
      const memberId = enr.member.memberId; 

      // FIXED: Match backend field names exactly 
      const postBody = { 
        class_id: enr.classId,           // was: classid 
        member_id: memberId,             // was: memberid 
        session_date: enr.sessionDate.toISOString().split('T')[0],  // was: sessiondate 
        session_time: enr.sessionTime,   // was: sessiontime 
        member_name: enr.member.name || enr.member.fullName 
      }; 

      console.log('Posting enrollment:', postBody); 

      // Secure POST with apiFetch 
      const result = await apiFetch('/api/enrollments', { 
        method: 'POST', 
        body: JSON.stringify(postBody) 
      }); 

      console.log('Enrollment success:', result); 
      successCount++; 
    } catch (error) { 
      errors.push(`Failed ${enr.member.memberId}: ${error.message}`); 
      console.error('Enrollment failed:', error); 
    } 
  } 

  if (errors.length > 0) { 
    showError(errors.join('; ')); 
  } 

  if (successCount > 0) { 
    showSuccess(`${successCount} member(s) enrolled successfully`); 
  } 

  bulkEnrollments = []; 
  updateBulkEnrollDisplay(); 
  await fetchMembers(''); 

  // Refresh scheduled sessions table 
  const classSelect = document.getElementById('classSelect'); 
  if (classSelect && classSelect.value) { 
    populateSessionsTable(classSelect.value); 
  } 
} 

function showSuccess(message) { 
  console.log('SUCCESS:', message); 
  const successEl = document.getElementById('successMessage'); 
  if (successEl) { 
    successEl.textContent = message; 
    successEl.style.display = 'block'; 
    setTimeout(() => successEl.style.display = 'none', 3000); 
  } else { 
    // Temp element if missing 
    const tempSuccess = document.createElement('div'); 
    tempSuccess.id = 'successMessage'; 
    tempSuccess.className = 'message success show'; 
    tempSuccess.textContent = message; 
    document.body.appendChild(tempSuccess); 
    setTimeout(() => { 
      if (tempSuccess.parentNode) tempSuccess.parentNode.removeChild(tempSuccess); 
    }, 3000); 
  } 
} 

function showError(message) { 
  console.error('ERROR:', message); 
  const errorEl = document.getElementById('errorMessage'); 
  if (errorEl) { 
    errorEl.textContent = message; 
    errorEl.style.display = 'block'; 
    setTimeout(() => errorEl.style.display = 'none', 5000); 
  } else { 
    // Temp element if missing 
    const tempError = document.createElement('div'); 
    tempError.id = 'errorMessage'; 
    tempError.className = 'message error show'; 
    tempError.textContent = message; 
    document.body.appendChild(tempError); 
    setTimeout(() => { 
      if (tempError.parentNode) tempError.parentNode.removeChild(tempError); 
    }, 5000); 
  } 
} 

function updatePanelButton() { 
  const panelSelect = document.getElementById('panelMemberSelect'); 
  const addPanelBtn = document.getElementById('addPanelToCartBtn'); 
  if (addPanelBtn) { 
    const hasSelection = panelSelect && panelSelect.selectedOptions.length > 0; 
    addPanelBtn.disabled = !hasSelection; 
    console.log('Panel button updated: disabled =', !hasSelection, 'selected =', panelSelect?.selectedOptions.length); 
  } else { 
    console.error('addPanelToCartBtn not found'); 
  } 
} 

function generateCalendar() { 
  const calendarMonth = document.getElementById('calendarMonth'); 
  if (!calendarMonth) return; 

  const [year, month] = calendarMonth.value.split('-').map(Number); 
  const title = document.getElementById('calendarTitle'); 
  if (title) { 
    title.textContent = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' }); 
  } 

  const firstDay = new Date(year, month - 1, 1).getDay(); 
  const lastDay = new Date(year, month, 0).getDate(); 
  const tbody = document.getElementById('calendarBody'); 
  if (!tbody) return; 

  tbody.innerHTML = ''; 
  let row = document.createElement('tr'); 

  // Get today's date 
  const today = new Date(); 
  today.setHours(0, 0, 0, 0); 

  // Empty cells before first day 
  for (let i = 0; i < firstDay; i++) { 
    const emptyCell = document.createElement('td'); 
    emptyCell.className = 'calendar-day'; 
    row.appendChild(emptyCell); 
  } 

  // Generate calendar days 
  for (let day = 1; day <= lastDay; day++) { 
    const date = new Date(year, month - 1, day); 
    date.setHours(0, 0, 0, 0); 

    const td = document.createElement('td'); 
    td.className = 'calendar-day'; 
    td.innerHTML = `<div class="day-number">${day}</div>`; 

    // Check if date is in the past 
    const isPast = date < today; 
    const isToday = date.toDateString() === today.toDateString(); 

    // Find classes scheduled for this day of the week 
    const classesToday = allClasses.filter(cls => isClassOnDay(cls.schedule, date.getDay())); 

    //  Add classes to the day - LIMIT TO 4, show "+X more" if needed 
    if (classesToday.length > 0) { 
      td.classList.add('has-class'); 

      const maxDisplay = 4; 
      const classesToShow = classesToday.slice(0, maxDisplay); 
      const remainingCount = classesToday.length - maxDisplay; 

      // Show first 4 classes 
      classesToShow.forEach(cls => { 
        const classEl = document.createElement('div'); 
        classEl.className = 'class-on-day'; 
        classEl.textContent = cls.class_name || cls.name || 'Class'; 
        td.appendChild(classEl); 
      }); 

      // Show "+X more classes" if there are more than 4 
      if (remainingCount > 0) { 
        const moreEl = document.createElement('div'); 
        moreEl.className = 'class-on-day more-classes'; 
        moreEl.textContent = `+${remainingCount} more ${remainingCount === 1 ? 'class' : 'classes'}`; 
        td.appendChild(moreEl); 
      } 
    } 

    // Apply styling based on date status 
    if (isPast) { 
      td.classList.add('past-date'); 
      // Don't add click handler for past dates 
    } else { 
      // Current/future dates are clickable 
      if (isToday) { 
        td.classList.add('today'); 
      } 
      td.onclick = (e) => selectDate(date, e); 
    } 

    row.appendChild(td); 
    if (row.children.length === 7) { 
      tbody.appendChild(row); 
      row = document.createElement('tr'); 
    } 
  } 

  // Add last row if incomplete 
  if (row.children.length > 0) { 
    tbody.appendChild(row); 
  } 

  console.log('Calendar generated for', year, month); 
} 

function isClassOnDay(schedule, dayIndex) { 
  return schedule.toLowerCase().includes(dayOfWeekNames[dayIndex].toLowerCase()); 
} 

function parseTimeFromSchedule(schedule) { 
  const match = schedule.match(/(\d{1,2}:\d{2} [AP]M - \d{1,2}:\d{2} [AP]M)/i); 
  return match ? match[1] : '9:00 AM - 10:00 AM'; 
}function selectDate(date, event) { 
  selectedDate = date; 
  const panelTitle = document.getElementById('panelTitle'); 
  if (panelTitle) panelTitle.textContent = `Selected Date: ${date.toDateString()}`; 
  const datePanel = document.getElementById('datePanel'); 
  if (datePanel) datePanel.style.display = 'block'; 
  const classesToday = allClasses.filter(cls => isClassOnDay(cls.schedule, date.getDay())); 
  const details = document.getElementById('classDetails'); 
  if (details) { 
    details.innerHTML = classesToday.length === 0 ? '<p class="text-muted">No classes.</p>' : ''; 
    classesToday.forEach(cls => { 
      const classId = cls.class_id; 
      const card = document.createElement('div'); 
      card.className = 'class-card'; 
      card.innerHTML = ` 
        <div class="card-body"> 
          <h5 class="text-danger">${cls.class_name || cls.name}</h5> 
          <p><strong>Trainer:</strong> ${cls.trainer_name || 'TBD'}</p> 
          <p><strong>Time:</strong> ${parseTimeFromSchedule(cls.schedule)}</p> 
          <p><strong>Description:</strong> ${cls.description || 'None'}</p> 
          <button class="action-button cart-button" onclick="addClassToCart('${classId}', event)"> 
            <i class="cart-icon">🛒</i> Add Members 
          </button> 
        </div> 
      `; 
      details.appendChild(card); 
    }); 
  } 
  document.querySelectorAll('.calendar-day').forEach(td => td.classList.remove('selected')); 
  event.target.closest('td').classList.add('selected'); 
  updatePanelButton(); 
} 

// Calendar "Add Selection to Cart" 
function addPanelSelectionToCart() { 
  console.log('=== CALENDAR ADD START ==='); 
  const selectedOptions = document.getElementById('panelMemberSelect').selectedOptions; 
  console.log('Selected options count:', selectedOptions.length); 
  if (selectedOptions.length === 0) { 
    showError('Select at least one member'); 
    return; 
  } 
  if (!selectedDate) { 
    showError('Select a date first'); 
    return; 
  } 
  const classesToday = allClasses.filter(cls => isClassOnDay(cls.schedule, selectedDate.getDay())); 
  console.log('Classes on date:', classesToday.length); 
  if (classesToday.length === 0) { 
    showError('No classes scheduled on this date'); 
    return; 
  } 
  let addedCount = 0; 
  for (let opt of selectedOptions) { 
    const memberId = opt.value; 
    const member = allMembers.find(m => m.memberId === memberId); 
    if (member) { 
      classesToday.forEach(cls => { 
        const classId = cls.class_id; 
        const sessionTime = parseTimeFromSchedule(cls.schedule); 
        bulkEnrollments.push({ 
          member, 
          classId, 
          sessionDate: new Date(selectedDate), 
          sessionTime 
        }); 
        addedCount++; 
        console.log('Calendar added:', memberId, 'to class:', classId, 'on', selectedDate.toDateString()); 
      }); 
    } else { 
      console.error('Calendar member not found:', memberId); 
    } 
  } 
  document.getElementById('panelMemberSelect').selectedIndex = -1; 
  updatePanelButton(); 
  updateBulkEnrollDisplay(); 
  showSuccess(`${addedCount} enrollments added to cart for ${classesToday.length} classes`); 
  console.log('=== CALENDAR ADD END ==='); 
} 

function addClassToCart(classId, event) { 
  event.stopPropagation(); 
  const cls = allClasses.find(c => c.class_id === classId); 
  const selectedOptions = document.getElementById('panelMemberSelect').selectedOptions; 
  if (selectedOptions.length === 0) return showError('Select members'); 
  let addedCount = 0; 
  for (let opt of selectedOptions) { 
    const memberId = opt.value; 
    const member = allMembers.find(m => m.memberId === memberId); 
    if (member) { 
      const sessionTime = parseTimeFromSchedule(cls.schedule); 
      bulkEnrollments.push({ member, classId, sessionDate: new Date(selectedDate), sessionTime }); 
      addedCount++; 
    } 
  } 
  document.getElementById('panelMemberSelect').selectedIndex = -1; 
  updatePanelButton(); 
  updateBulkEnrollDisplay(); 
  showSuccess(`${addedCount} added for ${cls.class_name || cls.name}`); 
} 

function markAttended(enrollmentId) { 
  console.log('Mark attended:', enrollmentId); 
  showSuccess('Marked as attended'); 
} 

// MANUAL TEST FUNCTIONS (call in console) 
window.testAddCart = function() { 
  console.log('=== MANUAL TEST: Adding first member ==='); 
  if (allMembers.length === 0) return console.error('No members loaded'); 
  if (allClasses.length === 0) return console.error('No classes loaded'); 
  const testMember = allMembers[0]; 
  const testClass = allClasses[0]; 
  document.getElementById('classSelect').value = testClass.class_id; 
  onClassChange(); 
  addMemberToCart(testMember.memberId); 
}; 
window.testBulkAdd = function() { 
  console.log('=== MANUAL TEST: Bulk Add 2 ==='); 
  const checkboxes = document.querySelectorAll('.member-checkbox'); 
  if (checkboxes.length < 2) return console.error('Not enough members'); 
  checkboxes[0].checked = true; 
  checkboxes[1].checked = true; 
  updateAddToCartButton(); 
  addSelectedToCart(); 
}; 
window.testCalendarAdd = function() { 
  console.log('=== MANUAL TEST: Calendar Add ==='); 
  if (!selectedDate) return console.error('Select a date first'); 
  if (allMembers.length === 0) return console.error('No members'); 
  const testMember = allMembers[0]; 
  document.getElementById('panelMemberSelect').value = testMember.memberId; 
  addPanelSelectionToCart(); 
}; 
window.testShowCart = function() { 
  console.log('=== MANUAL TEST: Force show cart ==='); 
  const panel = document.getElementById('bulkEnrollPanel'); 
  if (panel) { 
    panel.style.display = 'block'; 
    console.log('✓ Cart panel forced visible'); 
  } else { 
    console.error('✗ bulkEnrollPanel not found'); 
  } 
};
