const SERVER_URL = 'http://localhost:8080';

let faceImageBlobs = [];
let faceSuccessfullyCaptured = false;
let selectedMember = null;

// --------------------------------------
// Admin session configuration
// --------------------------------------
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

const ADMIN_KEYS = {
  token: 'admin_token',
  authUser: 'admin_authUser',
  role: 'admin_role',
  logoutEvent: 'adminLogoutEvent',
};

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
    return sessionStorage.getItem(ADMIN_KEYS.token) || localStorage.getItem(ADMIN_KEYS.token) || null;
  },
  getAuthUser() {
    const raw = sessionStorage.getItem(ADMIN_KEYS.authUser) || localStorage.getItem(ADMIN_KEYS.authUser);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  },
  hasSession() {
    return (
      (localStorage.getItem(ADMIN_KEYS.token) || sessionStorage.getItem(ADMIN_KEYS.token)) &&
      (localStorage.getItem(ADMIN_KEYS.authUser) || sessionStorage.getItem(ADMIN_KEYS.authUser)) &&
      ((localStorage.getItem(ADMIN_KEYS.role) || sessionStorage.getItem(ADMIN_KEYS.role)) === 'admin')
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

function clearLocalAuth() {
  AdminStore.clear();
  try {
    const genericRole = localStorage.getItem('role') || sessionStorage.getItem('role');
    if (genericRole === 'admin') {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
    }
  } catch (e) {}
}

function getApiBase() {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? SERVER_URL : '';
}

function getToken() {
  return AdminStore.getToken();
}

function adminLogout(reason, loginPath = '../login.html') {
  console.log('[Admin Logout]:', reason || 'no reason');
  clearLocalAuth();
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = loginPath;
}

function ensureAdminAuthOrLogout(loginPath) {
  try {
    if (!AdminStore.hasSession()) bootstrapAdminFromGenericIfNeeded();
    if (!AdminStore.hasSession()) { adminLogout('missing admin session', loginPath); return false; }

    const authUser = AdminStore.getAuthUser();
    if (!authUser || authUser.role !== 'admin') { adminLogout('invalid authUser', loginPath); return false; }

    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) { adminLogout('session expired', loginPath); return false; }

    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);

    window.addEventListener('storage', (event) => {
      if (event.key === ADMIN_KEYS.logoutEvent) adminLogout('logout from another tab', loginPath);
    });
    return true;
  } catch (e) {
    adminLogout('exception in auth check', loginPath);
    return false;
  }
}

function requireAuth(expectedRole, loginPath) {
  return ensureAdminAuthOrLogout(loginPath);
}

window.addEventListener('storage', (event) => {
  if (event.key === ADMIN_KEYS.logoutEvent) adminLogout('global logout', '../login.html');
});

async function apiFetch(endpoint, options = {}) {
  if (!ensureAdminAuthOrLogout('../login.html')) return;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();

  if (!token || !authUser) { adminLogout('missing token', '../login.html'); return; }

  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) { adminLogout('session expired', '../login.html'); return; }
    authUser.timestamp = Date.now();
    AdminStore.set(token, authUser);
  } catch (e) { adminLogout('invalid authUser', '../login.html'); return; }

  const url = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? `${SERVER_URL}${endpoint}` : endpoint;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    clearLocalAuth();
    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    window.location.href = '../login.html';
    return;
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// ------------------------------
// Page init
// ------------------------------
document.addEventListener('DOMContentLoaded', () => {
  if (!requireAuth('admin', '../login.html')) return;

  setupSidebarAndSession();
  initializeForm();
});

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  const adminNameEl = document.getElementById('adminFullName');
  if (adminNameEl) {
    const authUser = AdminStore.getAuthUser();
    adminNameEl.textContent = authUser?.name ? authUser.name : 'Admin';
  }

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const token = getToken();
      try {
        if (token) await fetch(`${getApiBase()}/api/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch (e) {} finally {
        clearLocalAuth();
        localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
        window.location.href = '../login.html';
      }
    });
  }
}

function initializeForm() {
  // Checkboxes for main add form
  const monthlyCheckbox = document.getElementById('monthly');
  const combativeCheckbox = document.getElementById('combative');
  
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

  // Bind submit button
  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) {
    submitBtn.addEventListener('click', handleFormSubmit);
  }

  setupFaceCapture();
  setupRenewalModal();
}

// ------------------------------
// Renewal modal
// ------------------------------
function setupRenewalModal() {
  const renewBtn = document.getElementById('openRenewalModalBtn');
  const modal = document.getElementById('renewalModal');
  const closeBtn = document.getElementById('closeRenewalModal');
  const searchBtn = document.getElementById('searchBtn');
  const searchInput = document.getElementById('memberSearch');
  const renewSubmitBtn = document.getElementById('renewSubmitBtn');

  if (renewBtn) {
    renewBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (modal) modal.style.display = 'flex';
      resetRenewalModal();
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
  
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  if (searchBtn) searchBtn.addEventListener('click', searchMember);
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); searchMember(); }
    });
  }

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

  const renewStartDate = document.getElementById('renewStartDate');
  const renewMonthlyDuration = document.getElementById('renewMonthlyDuration');
  const renewCombativeDuration = document.getElementById('renewCombativeDuration');
  
  if (renewStartDate) renewStartDate.addEventListener('change', updateRenewalInfo);
  // Also listen to custom UI updates if your calendar script modifies the value programmatically
  if (renewStartDate) {
    const observer = new MutationObserver(updateRenewalInfo);
    observer.observe(renewStartDate, { attributes: true, attributeFilter: ['value'] });
  }

  if (renewMonthlyDuration) renewMonthlyDuration.addEventListener('input', updateRenewalInfo);
  if (renewCombativeDuration) renewCombativeDuration.addEventListener('input', updateRenewalInfo);

  if (renewSubmitBtn) {
    renewSubmitBtn.addEventListener('click', handleRenewal);
  }
}

function resetRenewalModal() {
  const searchInput = document.getElementById('memberSearch');
  const searchResults = document.getElementById('searchResults');
  const renewalFormSection = document.getElementById('renewalFormSection');
  const renewForm = document.getElementById('renewForm');

  if (searchInput) searchInput.value = '';
  if (searchResults) searchResults.innerHTML = '';
  if (renewalFormSection) renewalFormSection.style.display = 'none';
  if (renewForm) renewForm.reset();

  document.getElementById('renewMonthlyDetails').style.display = 'none';
  document.getElementById('renewCombativeDetails').style.display = 'none';
  document.getElementById('renewalInfoBox').style.display = 'none';
  selectedMember = null;
}

async function searchMember() {
  const query = document.getElementById('memberSearch')?.value.trim();
  const resultsDiv = document.getElementById('searchResults');

  if (!query || query.length < 2) {
    showMessage('Please enter at least 2 characters', 'error');
    return;
  }

  try {
    const result = await apiFetch(`/api/members/search?query=${encodeURIComponent(query)}`);

    if (!result.success) throw new Error(result.error || 'Search failed');

    if (result.data.length === 0) {
      if (resultsDiv) resultsDiv.innerHTML = '<p class="no-results" style="color:#aaa; text-align:center;">No members found</p>';
      return;
    }

    if (resultsDiv) {
      resultsDiv.innerHTML = result.data.map(member => `
        <div class="search-result-item" style="background:rgba(255,255,255,0.05); padding:15px; border-radius:8px; margin-bottom:10px; cursor:pointer; border:1px solid rgba(255,255,255,0.1);" onclick='selectMemberForRenewal(${JSON.stringify(member).replace(/'/g, '&apos;')})'>
            <strong style="color:#B30000;">${member.memberId}</strong> - <span style="color:#fff;">${member.name}</span>
            <br><small style="color:#aaa;">Status: ${member.status.toUpperCase()}</small>
        </div>
      `).join('');
    }
  } catch (error) {
    showMessage('Error searching members: ' + error.message, 'error');
  }
}

window.selectMemberForRenewal = function(member) {
  selectedMember = member;
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('renewalFormSection').style.display = 'block';

  document.getElementById('selectedMemberName').textContent = member.name;
  document.getElementById('selectedMemberEmail').textContent = member.email || member.memberId;

  const currentMembershipsList = document.getElementById('currentMembershipsList');
  if (member.memberships && member.memberships.length > 0) {
    currentMembershipsList.innerHTML = member.memberships.map(m => {
        const endDate = new Date(m.endDate);
        const isExpired = endDate < new Date();
        const color = isExpired ? '#ff4d4d' : '#4caf50';
        return `
        <div style="background: rgba(0,0,0,0.3); padding: 10px; border-left: 3px solid ${color}; margin-bottom: 8px; border-radius: 4px;">
          <strong style="color:#fff; text-transform:uppercase;">${m.type}</strong> 
          <span style="color:${color}; font-size: 0.85rem; margin-left:10px;">${isExpired ? 'EXPIRED' : 'ACTIVE'}</span><br>
          <small style="color:#aaa;">Expires: ${formatDate(m.endDate)}</small>
        </div>`;
      }).join('');
  } else {
    currentMembershipsList.innerHTML = '<p style="color:#aaa; font-style:italic;">No active memberships</p>';
  }
}

function updateRenewalInfo() {
  if (!selectedMember) return;

  const dateVal = document.getElementById('renewStartDate')?.value;
  const renewalDate = dateVal ? new Date(dateVal) : new Date();
  
  const monthlyChecked = document.getElementById('renewMonthly').checked;
  const combativeChecked = document.getElementById('renewCombative').checked;
  const infoBox = document.getElementById('renewalInfoBox');

  if (!monthlyChecked && !combativeChecked) {
    if (infoBox) infoBox.style.display = 'none';
    return;
  }

  let infoHTML = '<strong style="color:#B30000;"><i class="fas fa-info-circle"></i> Renewal Summary:</strong><br><br>';

  if (monthlyChecked) {
    const duration = parseInt(document.getElementById('renewMonthlyDuration').value) || 1;
    const currentMembership = selectedMember.memberships?.find(m => m.type === 'monthly');
    const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, duration, 'monthly');

    infoHTML += `
      <div style="margin-bottom:10px; color:#ddd; font-size:0.9rem;">
        <strong style="color:#fff;">Monthly Gym:</strong><br>
        • Start Date: ${formatDate(renewalDate)}<br>
        • End Date: ${formatDate(endDate)}<br>
        • Duration: ${duration} month(s)
      </div>`;
  }

  if (combativeChecked) {
    // New UI: Combative duration is in MONTHS (1 month = 12 sessions)
    const durationMonths = parseInt(document.getElementById('renewCombativeDuration').value) || 1;
    const sessions = durationMonths * 12;
    const currentMembership = selectedMember.memberships?.find(m => m.type === 'combative');
    const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, durationMonths, 'combative');

    infoHTML += `
      <div style="color:#ddd; font-size:0.9rem;">
        <strong style="color:#fff;">Combative Sports:</strong><br>
        • Start Date: ${formatDate(renewalDate)}<br>
        • End Date: ${formatDate(endDate)}<br>
        • Duration: ${durationMonths} month(s)<br>
        • Sessions Allowed: ${sessions}
      </div>`;
  }

  if (infoBox) {
    infoBox.innerHTML = infoHTML;
    infoBox.style.display = 'block';
    infoBox.style.background = 'rgba(179, 0, 0, 0.1)';
    infoBox.style.padding = '15px';
    infoBox.style.borderRadius = '8px';
    infoBox.style.border = '1px solid rgba(179, 0, 0, 0.3)';
    infoBox.style.marginTop = '15px';
  }
}

function calculateNewEndDate(renewalDate, currentEndDateStr, durationMonths, membershipType) {
  const renewal = new Date(renewalDate);
  const currentEnd = currentEndDateStr ? new Date(currentEndDateStr) : null;

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

  const submitBtn = document.getElementById('renewSubmitBtn');
  const originalText = submitBtn?.innerHTML;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
  }

  try {
    const dateVal = document.getElementById('renewStartDate').value;
    const renewalDate = dateVal ? new Date(dateVal) : new Date();
    const updatedMemberships = [];

    if (selectedMember.memberships) {
      selectedMember.memberships.forEach((m) => {
        if (m.type === 'monthly' && !monthlyChecked) updatedMemberships.push(m);
        else if (m.type === 'combative' && !combativeChecked) updatedMemberships.push(m);
      });
    }

    if (monthlyChecked) {
      const duration = parseInt(document.getElementById('renewMonthlyDuration').value) || 1;
      const currentMembership = selectedMember.memberships?.find(m => m.type === 'monthly');
      const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, duration, 'monthly');

      updatedMemberships.push({
        type: 'monthly',
        duration: duration,
        startDate: renewalDate.toISOString(),
        endDate: endDate.toISOString(),
        status: 'active',
      });
    }

    if (combativeChecked) {
      const durationMonths = parseInt(document.getElementById('renewCombativeDuration').value) || 1;
      const sessions = durationMonths * 12; // 1 month = 12 sessions
      const currentMembership = selectedMember.memberships?.find(m => m.type === 'combative');
      const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, durationMonths, 'combative');

      updatedMemberships.push({
        type: 'combative',
        duration: durationMonths, // passing the duration to backend
        remainingSessions: sessions, // Explicitly pass sessions
        startDate: renewalDate.toISOString(),
        endDate: endDate.toISOString(),
        status: 'active',
      });
    }

    // POINTING TO THE NEW /RENEW ENDPOINT
    const result = await apiFetch(`/api/members/${selectedMember._id}/renew`, {
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
  const btn = document.getElementById('submitBtn');
  const originalText = btn?.textContent;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Adding...';
  }

  const memberships = [];
  if (document.getElementById('monthly').checked) {
    memberships.push({
      type: 'monthly',
      duration: parseInt(document.getElementById('monthlyDuration').value) || 1,
    });
  }
  if (document.getElementById('combative').checked) {
    const durationMonths = parseInt(document.getElementById('combativeDuration').value) || 1;
    memberships.push({
      type: 'combative',
      duration: durationMonths,
      // The backend will handle the 1 month = 12 sessions conversion if configured,
      // but you can also pass remainingSessions directly if your backend schema allows it.
      remainingSessions: durationMonths * 12
    });
  }

  if (memberships.length === 0) {
    showMessage('Please select at least one membership type', 'error');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    return;
  }

  // Handle custom date fields or fallback to current date
  const dobVal = document.getElementById('dob').value;
  const joinDateVal = document.getElementById('startDate').value;

  const formData = new FormData();
  formData.append('name', document.getElementById('name').value.trim());
  formData.append('birthdate', dobVal || new Date().toISOString());
  formData.append('joinDate', joinDateVal || new Date().toISOString());
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
    const result = await apiFetch('/api/members', {
      method: 'POST',
      body: formData,
    });

    if (result.success) {
      showMessage('Member added successfully!', 'success');
      setTimeout(() => {
        document.getElementById('addMemberForm').reset();
        document.getElementById('monthlyDetails').style.display = 'none';
        document.getElementById('combativeDetails').style.display = 'none';
        
        const faceStatus = document.getElementById('faceStatus');
        if(faceStatus) faceStatus.textContent = 'No face data registered';
        
        faceSuccessfullyCaptured = false;
        faceImageBlobs = [];
      }, 2000);
    } else {
      throw new Error(result.error || 'Failed to add member');
    }
  } catch (error) {
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
  const openBtn = document.getElementById('openFacePane');
  const closeBtn = document.getElementById('closeFacePane');
  const captureBtn = document.getElementById('captureBtn');
  const confirmBtn = document.getElementById('confirmFaceBtn');
  const facePane = document.getElementById('facePane');
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const faceStatus = document.getElementById('faceStatus');
  const resultMsg = document.getElementById('faceResultMsg');

  let stream = null;

  if (openBtn) {
    openBtn.addEventListener('click', async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (video) { video.srcObject = stream; video.style.display = 'block'; }
        if (canvas) canvas.style.display = 'none';
        if (facePane) facePane.style.display = 'flex';
        if (confirmBtn) confirmBtn.disabled = true;
        if (resultMsg) resultMsg.textContent = '';
        faceImageBlobs = [];
        if (captureBtn) captureBtn.disabled = false;
      } catch (err) { alert('Camera access denied or unavailable'); }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (facePane) facePane.style.display = 'none';
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
          faceStatus.style.color = '#4caf50';
        }
        if (stream) stream.getTracks().forEach((track) => track.stop());
        if (facePane) facePane.style.display = 'none';
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
    messageDiv.style.display = 'block';
    messageDiv.style.padding = '15px';
    messageDiv.style.borderRadius = '5px';
    messageDiv.style.marginBottom = '20px';
    messageDiv.style.textAlign = 'center';
    
    if (type === 'success') {
      messageDiv.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
      messageDiv.style.border = '1px solid #4caf50';
      messageDiv.style.color = '#4caf50';
    } else {
      messageDiv.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
      messageDiv.style.border = '1px solid #f44336';
      messageDiv.style.color = '#f44336';
    }

    setTimeout(() => { messageDiv.style.display = 'none'; }, 5000);
  } else {
    alert(text);
  }
}