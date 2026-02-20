const SERVER_URL = 'http://localhost:8080';

let faceImageBlobs = [];
let faceSuccessfullyCaptured = false;
let selectedMember = null;

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
  return window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
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

    // Cross-tab logout: listen for adminLogoutEvent
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

// ------------------------------
// Utility for authenticated API calls
// ------------------------------
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

  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData;

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Session invalid/expired OR logged in from another browser:
    // clear, broadcast admin logout to other tabs, and redirect.
    clearLocalAuth();
    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    window.location.href = '../login.html';
    return;
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// Setup Birthdate Calendar Icon
setupDatePicker('birthdate', 'birthdateDisplay', 'birthdateIcon');

// Limit birthdate so member is at least 13 years old (calendar max year updates automatically)
setBirthdateMaxForMinAge('birthdate', 13);

function setBirthdateMaxForMinAge(birthdateInputId, minAgeYears = 13) {
  const birthdateInput = document.getElementById(birthdateInputId);
  if (!birthdateInput) return;

  const today = new Date();
  const maxDate = new Date(
    today.getFullYear() - minAgeYears,
    today.getMonth(),
    today.getDate()
  );

  // HTML date input expects YYYY-MM-DD
  const maxStr = maxDate.toISOString().split('T')[0];

  // This directly affects the mini-calendar: you cannot pick dates after maxStr.
  birthdateInput.setAttribute('max', maxStr);
}


// ------------------------------
// Page init
// ------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const ok = requireAuth('admin', '../login.html');
  if (!ok) return;

  setupSidebarAndSession();
  initializeForm();
});

// Format date to readable format: "Month Day, Year"
function formatDate(date) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(date).toLocaleDateString('en-US', options);
}

// ------------------------------
// Sidebar + session handling
// ------------------------------
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  // Extra safety: timestamp check
  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in setupSidebarAndSession', '../login.html');
      return;
    }
  } catch (e) {
    adminLogout('invalid authUser JSON in setupSidebarAndSession', '../login.html');
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
    menuToggle.addEventListener('click', () =>
      sidebar.classList.toggle('collapsed')
    );
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const token = getToken();
      try {
        if (token) {
          const logoutUrl = `${getApiBase()}/api/logout`;
          await fetch(logoutUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
        }
      } catch (e) {
        console.error('Logout error:', e);
      } finally {
        clearLocalAuth();
        // Notify admin tabs in this browser
        localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
        window.location.href = '../login.html';
      }
    });
  }

  // Mobile sidebar click outside
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

  // Overflow handling on collapse (mobile)
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
// Initialize form + UI
// ------------------------------
function initializeForm() {
  const memberForm = document.getElementById('memberForm');

  // Setup Birthdate Calendar Icon
  setupDatePicker('birthdate', 'birthdateDisplay', 'birthdateIcon');

  // Setup Join Date Calendar Icon
  const today = new Date();
  const joinDateInput = document.getElementById('joinDate');
  const joinDateDisplay = document.getElementById('joinDateDisplay');

  if (joinDateInput) joinDateInput.valueAsDate = today;
  if (joinDateDisplay) joinDateDisplay.value = formatDate(today);

  setupDatePicker('joinDate', 'joinDateDisplay', 'joinDateIcon');

  // Membership type toggles
  const monthlyCheckbox = document.getElementById('monthlyCheckbox');
  const combativeCheckbox = document.getElementById('combativeCheckbox');
  if (monthlyCheckbox) {
    monthlyCheckbox.addEventListener('change', function () {
      document.getElementById('monthlyDetails').style.display = this.checked ? 'block' : 'none';
    });
  }
  if (combativeCheckbox) {
    combativeCheckbox.addEventListener('change', function () {
      document.getElementById('combativeDetails').style.display = this.checked ? 'block' : 'none';
    });
  }

  // Form submission
  if (memberForm) {
    memberForm.addEventListener('submit', handleFormSubmit);
  }

  // Face capture functionality
  setupFaceCapture();

  // Renewal modal functionality
  setupRenewalModal();
}

// Universal Date Picker Setup Function
function setupDatePicker(dateInputId, displayInputId, iconId) {
  const dateInput = document.getElementById(dateInputId);
  const displayInput = document.getElementById(displayInputId);
  const icon = document.getElementById(iconId);

  if (!dateInput || !displayInput || !icon) return;

  // When icon is clicked, trigger the hidden date input
  icon.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    dateInput.click(); // Click the hidden date input
  });

  // Also allow clicking the display input to open calendar
  displayInput.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    dateInput.click();
  });

  // When date is selected, update the display field
  dateInput.addEventListener('change', function () {
    if (this.value) {
      displayInput.value = formatDate(this.value);
    }
  });
}

// ------------------------------
// Renewal modal
// ------------------------------
function setupRenewalModal() {
  const renewBtn = document.getElementById('renewBtn');
  const modal = document.getElementById('renewalModal');
  const closeBtn = document.getElementById('closeRenewalBtn');
  const searchBtn = document.getElementById('searchBtn');
  const renewalForm = document.getElementById('renewalForm');

  // Prevent checkbox labels from triggering date picker in renewal form
  const renewalCheckboxLabels = document.querySelectorAll('.renewal-checkbox');
  renewalCheckboxLabels.forEach((label) => {
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const checkbox = label.querySelector('input[type="checkbox"]');
      if (checkbox && e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
        const event = new Event('change', { bubbles: true });
        checkbox.dispatchEvent(event);
      }
    });
  });

  // Open modal
  if (renewBtn) {
    renewBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (modal) modal.style.display = 'flex';
      resetRenewalModal();
    });
  }

  // Close modal
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (modal) modal.style.display = 'none';
    });
  }

  // Close on outside click
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  }

  // Search member
  if (searchBtn) searchBtn.addEventListener('click', searchMember);
  const searchInput = document.getElementById('searchMember');
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchMember();
      }
    });
  }

  // Renewal checkboxes
  const renewMonthly = document.getElementById('renewMonthly');
  const renewCombative = document.getElementById('renewCombative');
  if (renewMonthly) {
    renewMonthly.addEventListener('change', function () {
      document.getElementById('renewMonthlyDetails').style.display = this.checked ? 'block' : 'none';
      updateRenewalInfo();
    });
  }
  if (renewCombative) {
    renewCombative.addEventListener('change', function () {
      document.getElementById('renewCombativeDetails').style.display = this.checked ? 'block' : 'none';
      updateRenewalInfo();
    });
  }

  // Duration changes
  const renewalDate = document.getElementById('renewalDate');
  const renewMonthlyDuration = document.getElementById('renewMonthlyDuration');
  const renewCombativeSessions = document.getElementById('renewCombativeSessions');
  if (renewalDate) renewalDate.addEventListener('change', updateRenewalInfo);
  if (renewMonthlyDuration) renewMonthlyDuration.addEventListener('input', updateRenewalInfo);
  if (renewCombativeSessions) renewCombativeSessions.addEventListener('input', updateRenewalInfo);

  // Renewal form submission
  if (renewalForm) {
    renewalForm.addEventListener('submit', handleRenewal);
  }
}

function resetRenewalModal() {
  const searchMemberInput = document.getElementById('searchMember');
  const searchResults = document.getElementById('searchResults');
  const selectedMemberSection = document.getElementById('selectedMemberSection');
  const renewalForm = document.getElementById('renewalForm');

  if (searchMemberInput) searchMemberInput.value = '';
  if (searchResults) searchResults.innerHTML = '';
  if (selectedMemberSection) selectedMemberSection.style.display = 'none';
  if (renewalForm) renewalForm.reset();

  const today = new Date();
  const renewalDateInput = document.getElementById('renewalDate');
  if (renewalDateInput) renewalDateInput.valueAsDate = today;

  document.getElementById('renewMonthlyDetails').style.display = 'none';
  document.getElementById('renewCombativeDetails').style.display = 'none';
  document.getElementById('renewalInfoBox').style.display = 'none';
  selectedMember = null;
}

async function searchMember() {
  const query = document.getElementById('searchMember')?.value.trim();
  const resultsDiv = document.getElementById('searchResults');

  if (!query || query.length < 2) {
    showMessage('Please enter at least 2 characters', 'error');
    return;
  }

  try {
    // Secure search with apiFetch (GET, returns {success: true, data: [...]})
    const result = await apiFetch(`/api/members/search?query=${encodeURIComponent(query)}`);

    if (!result.success) {
      throw new Error(result.error || 'Search failed');
    }

    if (result.data.length === 0) {
      if (resultsDiv) resultsDiv.innerHTML = '<p class="no-results">No members found</p>';
      return;
    }

    if (resultsDiv) {
      resultsDiv.innerHTML = result.data
        .map(
          (member) => `
        <div class="search-result-item" onclick='selectMemberForRenewal(${JSON.stringify(member).replace(/'/g, '&apos;')})'>
          <div class="result-info">
            <strong>${member.memberId}</strong> - ${member.name}
            <br>
            <small>Status: <span class="status-${member.status}">${member.status}</span></small>
          </div>
        </div>
      `
        )
        .join('');
    }
  } catch (error) {
    showMessage('Error searching members: ' + error.message, 'error');
  }
}

function selectMemberForRenewal(member) {
  selectedMember = member;
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('selectedMemberSection').style.display = 'block';

  const memberInfoCard = document.getElementById('memberInfoCard');

  let membershipHTML = '';
  if (member.memberships && member.memberships.length > 0) {
    membershipHTML = member.memberships
      .map((m) => {
        const endDate = new Date(m.endDate);
        const isExpired = endDate < new Date();
        return `
        <div class="membership-item ${isExpired ? 'expired' : m.status}">
          <span class="membership-type">${m.type.toUpperCase()}</span>
          <span class="membership-status">${m.status}</span>
          <span class="membership-date">Expires: ${formatDate(endDate)}</span>
        </div>
      `;
      })
      .join('');
  } else {
    membershipHTML = '<p class="no-membership">No active memberships</p>';
  }

  if (memberInfoCard) {
    memberInfoCard.innerHTML = `
      <h4><i class="fas fa-user-circle"></i> ${member.name}</h4>
      <p><strong>Member ID:</strong> ${member.memberId}</p>
      <p><strong>Status:</strong> <span class="status-badge status-${member.status}">${member.status}</span></p>
      <div class="membership-list">
        <strong>Current Memberships:</strong>
        ${membershipHTML}
      </div>
    `;
  }
}

function updateRenewalInfo() {
  if (!selectedMember) return;

  const renewalDateInput = document.getElementById('renewalDate');
  if (!renewalDateInput?.value) return;

  const renewalDate = new Date(renewalDateInput.value);
  const monthlyChecked = document.getElementById('renewMonthly').checked;
  const combativeChecked = document.getElementById('renewCombative').checked;
  const infoBox = document.getElementById('renewalInfoBox');

  if (!monthlyChecked && !combativeChecked) {
    if (infoBox) infoBox.style.display = 'none';
    return;
  }

  let infoHTML = '<strong><i class="fas fa-info-circle"></i> Renewal Summary:</strong><br><br>';

  if (monthlyChecked) {
    const duration =
      parseInt(document.getElementById('renewMonthlyDuration').value) || 1;
    const currentMembership = selectedMember.memberships?.find(
      (m) => m.type === 'monthly'
    );
    const endDate = calculateNewEndDate(
      renewalDate,
      currentMembership?.endDate,
      duration,
      'monthly'
    );

    infoHTML += `
      <div class="info-item">
        <strong>Monthly Membership:</strong><br>
        <span class="detail-line">Start Date: ${formatDate(renewalDate)}</span><br>
        <span class="detail-line">End Date: ${formatDate(endDate)}</span><br>
        <span class="detail-line">Duration: ${duration} month(s)</span>
      </div>
    `;
  }

  if (combativeChecked) {
    const sessions =
      parseInt(document.getElementById('renewCombativeSessions').value) || 12;
    const currentMembership = selectedMember.memberships?.find(
      (m) => m.type === 'combative'
    );
    const endDate = calculateNewEndDate(
      renewalDate,
      currentMembership?.endDate,
      1,
      'combative'
    );

    infoHTML += `
      <div class="info-item">
        <strong>Combative Membership:</strong><br>
        <span class="detail-line">Start Date: ${formatDate(renewalDate)}</span><br>
        <span class="detail-line">End Date: ${formatDate(endDate)}</span><br>
        <span class="detail-line">Sessions: ${sessions}</span><br>
        <span class="detail-line">Duration: 1 month</span>
      </div>
    `;
  }

  if (infoBox) {
    infoBox.innerHTML = infoHTML;
    infoBox.style.display = 'block';
  }
}

function calculateNewEndDate(
  renewalDate,
  currentEndDateStr,
  durationMonths,
  membershipType
) {
  const renewal = new Date(renewalDate);
  const currentEnd = currentEndDateStr ? new Date(currentEndDateStr) : null;

  if (membershipType === 'combative' && currentEnd) {
    const twoMonthsAgo = new Date(renewal);
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    if (currentEnd < twoMonthsAgo) {
      const newEnd = new Date(renewal);
      newEnd.setMonth(newEnd.getMonth() + durationMonths);
      return newEnd;
    }
  }

  if (currentEnd && renewal < currentEnd) {
    const newEnd = new Date(currentEnd);
    newEnd.setMonth(newEnd.getMonth() + durationMonths);
    return newEnd;
  } else {
    const newEnd = new Date(renewal);
    newEnd.setMonth(newEnd.getMonth() + durationMonths);
    return newEnd;
  }
}

async function handleRenewal(e) {
  e.preventDefault();

  if (!selectedMember) {
    showMessage('Please select a member first', 'error');
    return;
  }

  const monthlyChecked = document.getElementById('renewMonthly').checked;
  const combativeChecked = document.getElementById('renewCombative').checked;

  if (!monthlyChecked && !combativeChecked) {
    showMessage('Please select at least one membership type to renew', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn?.innerHTML;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
  }

  try {
    const renewalDate = new Date(document.getElementById('renewalDate').value);
    const updatedMemberships = [];

    if (selectedMember.memberships) {
      selectedMember.memberships.forEach((m) => {
        if (m.type === 'monthly' && !monthlyChecked) {
          updatedMemberships.push(m);
        } else if (m.type === 'combative' && !combativeChecked) {
          updatedMemberships.push(m);
        }
      });
    }

    if (monthlyChecked) {
      const duration =
        parseInt(document.getElementById('renewMonthlyDuration').value) || 1;
      const currentMembership = selectedMember.memberships?.find(
        (m) => m.type === 'monthly'
      );
      const endDate = calculateNewEndDate(
        renewalDate,
        currentMembership?.endDate,
        duration,
        'monthly'
      );

      updatedMemberships.push({
        type: 'monthly',
        duration: duration,
        startDate: renewalDate.toISOString(),
        endDate: endDate.toISOString(),
        status: 'active',
      });
    }

    if (combativeChecked) {
      const sessions =
        parseInt(document.getElementById('renewCombativeSessions').value) || 12;
      const currentMembership = selectedMember.memberships?.find(
        (m) => m.type === 'combative'
      );
      const endDate = calculateNewEndDate(
        renewalDate,
        currentMembership?.endDate,
        1,
        'combative'
      );

      updatedMemberships.push({
        type: 'combative',
        duration: sessions,
        remainingSessions: sessions,
        startDate: renewalDate.toISOString(),
        endDate: endDate.toISOString(),
        status: 'active',
      });
    }

    // Secure PUT with apiFetch (JSON body)
    const result = await apiFetch(`/api/members/${selectedMember._id}`, {
      method: 'PUT',
      body: JSON.stringify({
        memberships: updatedMemberships,
        status: 'active',
      }),
    });

    if (result.success) {
      showMessage('Membership renewed successfully!', 'success');
      setTimeout(() => {
        document.getElementById('renewalModal').style.display = 'none';
        resetRenewalModal();
      }, 2000);
    } else {
      throw new Error(result.error || 'Failed to renew membership');
    }
  } catch (error) {
    showMessage('Error: ' + error.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  }
}

// ------------------------------
// Add member form submit
// ------------------------------
async function handleFormSubmit(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn?.textContent;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Adding...';
  }

  const memberships = [];
  if (document.getElementById('monthlyCheckbox').checked) {
    memberships.push({
      type: 'monthly',
      duration: parseInt(document.getElementById('monthlyDuration').value),
    });
  }
  if (document.getElementById('combativeCheckbox').checked) {
    memberships.push({
      type: 'combative',
      duration: parseInt(document.getElementById('combativeSessions').value),
    });
  }

  if (memberships.length === 0) {
    showMessage('Please select at least one membership type', 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
    return;
  }

  const formData = new FormData();
  formData.append('name', document.getElementById('memberName').value.trim());
  formData.append('birthdate', document.getElementById('birthdate').value);
  formData.append('joinDate', document.getElementById('joinDate').value);
  formData.append('phone', document.getElementById('phone').value.trim() || '');
  formData.append('email', document.getElementById('email').value.trim() || '');
  formData.append('faceEnrolled', faceSuccessfullyCaptured ? 'yes' : 'no');
  formData.append('memberships', JSON.stringify(memberships));

  if (faceImageBlobs.length === 3) {
    formData.append('faceImage1', faceImageBlobs[0], 'face1.jpg');
    formData.append('faceImage2', faceImageBlobs[1], 'face2.jpg');
    formData.append('faceImage3', faceImageBlobs[2], 'face3.jpg');
  }

  try {
    // Secure POST with apiFetch (FormData for image/blob)
    const result = await apiFetch('/api/members', {
      method: 'POST',
      body: formData, // Multipart: Backend multer parses fields + file
    });

    if (result.success) {
      showMessage('Member added successfully!', 'success');
      setTimeout(() => {
        // Clear form persistence from session storage
        const form = document.getElementById('memberForm');
        if (form) {
          const formElements = form.querySelectorAll('input, select, textarea');
          formElements.forEach(element => {
            const key = `${window.location.pathname}-${element.id || element.name}`;
            sessionStorage.removeItem(key);
          });
        }
        
        document.getElementById('memberForm').reset();

        // Reset join date to today
        const today = new Date();
        document.getElementById('joinDate').valueAsDate = today;
        document.getElementById('joinDateDisplay').value = formatDate(today);
        document.getElementById('birthdateDisplay').value = '';

        document.getElementById('monthlyDetails').style.display = 'none';
        document.getElementById('combativeDetails').style.display = 'none';
        document.getElementById('faceStatus').textContent = '';
        faceSuccessfullyCaptured = false;
        faceImageBlobs = [];
        document.getElementById('message').className = 'message hidden';
      }, 2000);
    } else {
      throw new Error(result.error || 'Failed to add member');
    }
  } catch (error) {
    console.error('Add member error:', error);
    showMessage('Network error: ' + error.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

// ------------------------------
// Face capture
// ------------------------------
function setupFaceCapture() {
  const openBtn = document.getElementById('openFacePaneBtn');
  const closeBtn = document.getElementById('closeFacePaneBtn');
  const captureBtn = document.getElementById('captureFaceBtn');
  const confirmBtn = document.getElementById('confirmFaceBtn');
  const facePane = document.getElementById('facePane');
  const video = document.getElementById('camera');
  const canvas = document.getElementById('snapshot');
  const faceStatus = document.getElementById('faceStatus');
  const resultMsg = document.getElementById('faceResultMsg');

  let stream = null;

  if (openBtn) {
    openBtn.addEventListener('click', async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (video) {
          video.srcObject = stream;
          video.style.display = 'block';
        }
        if (canvas) canvas.style.display = 'none';
        if (facePane) facePane.style.display = 'flex';
        if (confirmBtn) confirmBtn.disabled = true;
        if (resultMsg) resultMsg.textContent = '';
        faceImageBlobs = []; // Reset on open
        captureBtn.disabled = false;
      } catch (err) {
        alert('Camera access denied or unavailable');
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (facePane) facePane.style.display = 'none';
      if (video) video.style.display = 'block';
      if (canvas) canvas.style.display = 'none';
    });
  }

  if (captureBtn) {
    captureBtn.addEventListener('click', () => {
      if (video && canvas && faceImageBlobs.length < 3) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        canvas.toBlob((blob) => {
          faceImageBlobs.push(blob);
          const remaining = 3 - faceImageBlobs.length;
          if (remaining > 0) {
            resultMsg.textContent = `Photo ${faceImageBlobs.length} captured! ${remaining} more to go.`;
          } else {
            resultMsg.textContent = 'All 3 photos captured! Review and confirm.';
            captureBtn.disabled = true;
            confirmBtn.disabled = false;
          }
        }, 'image/jpeg');
      }

      if (video) video.style.display = 'none';
      if (canvas) canvas.style.display = 'block';
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (faceImageBlobs.length === 3) {
        faceSuccessfullyCaptured = true;
        if (faceStatus) {
          faceStatus.textContent = '✓ 3 Faces Captured';
          faceStatus.className = 'fp-status-message success';
        }

        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
        if (facePane) facePane.style.display = 'none';
        if (resultMsg) resultMsg.textContent = '';
      }
    });
  }
}

// ------------------------------
// Messages
// ------------------------------
function showMessage(text, type) {
  const messageDiv = document.getElementById('message');
  if (messageDiv) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    setTimeout(() => {
      messageDiv.className = 'message hidden';
    }, 5000);
  }
}
