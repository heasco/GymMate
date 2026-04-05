// --- Theme Init & Real-Time Sync ---
function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.classList.add('light-mode');
        document.body.classList.add('light-mode');
    } else {
        document.documentElement.classList.remove('light-mode');
        document.body.classList.remove('light-mode');
    }
}

// 1. Apply immediately when the dashboard loads
applyTheme(localStorage.getItem('admin_theme'));

// 2. Listen for changes
window.addEventListener('storage', (e) => {
    if (e.key === 'admin_theme') applyTheme(e.newValue);
});

const SERVER_URL = 'http://localhost:8080';

let faceImageBlobs = [];
let faceSuccessfullyCaptured = false;
let selectedMember = null;
let activeProducts = []; 
let paymentContext = 'add'; 

// --------------------------------------
// Admin session configuration
// --------------------------------------
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; 

const ADMIN_KEYS = { token: 'admin_token', authUser: 'admin_authUser', role: 'admin_role', logoutEvent: 'adminLogoutEvent' };

const AdminStore = {
  set(token, userPayload) {
    try {
      const authUser = { ...(userPayload || {}), timestamp: Date.now(), role: 'admin', token };
      localStorage.setItem(ADMIN_KEYS.token, token); localStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser)); localStorage.setItem(ADMIN_KEYS.role, 'admin');
      sessionStorage.setItem(ADMIN_KEYS.token, token); sessionStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser)); sessionStorage.setItem(ADMIN_KEYS.role, 'admin');
    } catch (e) { console.error('[AdminStore.set] failed:', e); }
  },
  getToken() { return sessionStorage.getItem(ADMIN_KEYS.token) || localStorage.getItem(ADMIN_KEYS.token) || null; },
  getAuthUser() {
    const raw = sessionStorage.getItem(ADMIN_KEYS.authUser) || localStorage.getItem(ADMIN_KEYS.authUser);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  },
  hasSession() {
    return ((localStorage.getItem(ADMIN_KEYS.token) || sessionStorage.getItem(ADMIN_KEYS.token)) &&
      (localStorage.getItem(ADMIN_KEYS.authUser) || sessionStorage.getItem(ADMIN_KEYS.authUser)) &&
      ((localStorage.getItem(ADMIN_KEYS.role) || sessionStorage.getItem(ADMIN_KEYS.role)) === 'admin'));
  },
  clear() {
    localStorage.removeItem(ADMIN_KEYS.token); localStorage.removeItem(ADMIN_KEYS.authUser); localStorage.removeItem(ADMIN_KEYS.role);
    sessionStorage.removeItem(ADMIN_KEYS.token); sessionStorage.removeItem(ADMIN_KEYS.authUser); sessionStorage.removeItem(ADMIN_KEYS.role);
  },
};

function adminLogout(reason, loginPath = '../login.html') {
  AdminStore.clear();
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = loginPath;
}

function ensureAdminAuthOrLogout(loginPath) {
  try {
    if (!AdminStore.hasSession()) { adminLogout('missing admin session', loginPath); return false; }
    const authUser = AdminStore.getAuthUser();
    if (!authUser || authUser.role !== 'admin') { adminLogout('invalid or non-admin authUser', loginPath); return false; }
    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);
    return true;
  } catch (e) { return false; }
}

function requireAuth(expectedRole, loginPath) { return ensureAdminAuthOrLogout(loginPath); }

async function apiFetch(endpoint, options = {}) {
  const ok = ensureAdminAuthOrLogout('../login.html');
  if (!ok) return;
  const token = AdminStore.getToken();
  const url = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? `${SERVER_URL}${endpoint}` : endpoint;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = { ...options.headers, Authorization: `Bearer ${token}`, ...(isFormData ? {} : { 'Content-Type': 'application/json' }) };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) { adminLogout(); return; }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// ------------------------------
// Init
// ------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth('admin', '../login.html')) return;
  setupSidebarAndSession();
  await fetchActiveProducts(); 
  initializeForm();
});

async function fetchActiveProducts() {
  try {
    const result = await apiFetch('/api/products?status=active');
    activeProducts = result.data || [];
  } catch (error) { console.error('Failed to load products:', error); }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function setupDatePickerSync(dateInputId, displayInputId) {
  const dateInput = document.getElementById(dateInputId);
  const displayInput = document.getElementById(displayInputId);
  if (!dateInput || !displayInput) return;
  const updateDisplay = function () { displayInput.value = dateInput.value ? formatDate(dateInput.value) : ''; };
  dateInput.addEventListener('input', updateDisplay);
  dateInput.addEventListener('change', updateDisplay);
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
  if (menuToggle && sidebar) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  if (logoutBtn) logoutBtn.addEventListener('click', async () => { adminLogout(); });
}

// ------------------------------
// Form setup & Shared Payment Modal
// ------------------------------
function initializeForm() {
  setupDOBDropdowns();
  const today = new Date();
  const joinDateInput = document.getElementById('joinDate');
  const joinDateDisplay = document.getElementById('joinDateDisplay');
  if (joinDateInput) joinDateInput.valueAsDate = today;
  if (joinDateInput && joinDateDisplay) joinDateDisplay.value = formatDate(joinDateInput.value);
  setupDatePickerSync('joinDate', 'joinDateDisplay');

  const monthlyRadio = document.getElementById('monthlyRadio');
  const combativeRadio = document.getElementById('combativeRadio');
  const danceRadio = document.getElementById('danceRadio');
  const productGroup = document.getElementById('productSelectionGroup');
  const productSelect = document.getElementById('productSelect');

  function updateProductDropdown() {
    const selectedType = monthlyRadio?.checked ? 'monthly' : combativeRadio?.checked ? 'combative' : danceRadio?.checked ? 'dance' : null;
    if (!selectedType) {
        if(productGroup) productGroup.style.display = 'none';
        return;
    }
    if(productGroup) productGroup.style.display = 'block';
    if(productSelect) {
        productSelect.innerHTML = '<option value="" disabled selected>Select a product...</option>';
        const filtered = activeProducts.filter(p => p.membership_type === selectedType);
        if (filtered.length === 0) {
            productSelect.innerHTML = '<option value="" disabled>No products available for this type</option>';
            return;
        }
        filtered.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p._id; opt.dataset.price = p.price; opt.dataset.name = p.product_name;
            opt.textContent = `${p.product_name} - ₱${p.price.toLocaleString()}`;
            productSelect.appendChild(opt);
        });
    }
  }

  if (monthlyRadio) monthlyRadio.addEventListener('change', updateProductDropdown);
  if (combativeRadio) combativeRadio.addEventListener('change', updateProductDropdown);
  if (danceRadio) danceRadio.addEventListener('change', updateProductDropdown);

  const initiateBtn = document.getElementById('initiateSubmitBtn');
  if (initiateBtn) initiateBtn.addEventListener('click', validateAndShowAddPaymentModal);

  setupPaymentModal();
  setupFaceCapture();
  setupRenewalModal();
}

function setupDOBDropdowns() {
  const monthSelect = document.getElementById('birthMonth');
  const daySelect = document.getElementById('birthDay');
  const yearSelect = document.getElementById('birthYear');
  const hiddenInput = document.getElementById('birthdate');
  if (!monthSelect || !daySelect || !yearSelect || !hiddenInput) return;
  const today = new Date(); const currentYear = today.getFullYear(); const currentMonth = today.getMonth(); const currentDay = today.getDate();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  for (let y = currentYear; y >= 1900; y--) { const opt = document.createElement('option'); opt.value = y; opt.textContent = y; yearSelect.appendChild(opt); }
  months.forEach((m, index) => { const opt = document.createElement('option'); opt.value = index + 1; opt.textContent = m; monthSelect.appendChild(opt); });
  for (let d = 1; d <= 31; d++) { const opt = document.createElement('option'); opt.value = d; opt.textContent = d; daySelect.appendChild(opt); }

  function updateDays() {
    const y = parseInt(yearSelect.value); const m = parseInt(monthSelect.value);
    if (!y || !m) return;
    const daysInMonth = new Date(y, m, 0).getDate(); const selectedDay = parseInt(daySelect.value);
    daySelect.innerHTML = '<option value="" disabled selected>Day</option>';
    let maxDay = daysInMonth;
    if (y === currentYear && m === currentMonth + 1) maxDay = Math.min(daysInMonth, currentDay);
    for (let d = 1; d <= maxDay; d++) { const opt = document.createElement('option'); opt.value = d; opt.textContent = d; daySelect.appendChild(opt); }
    if (selectedDay && selectedDay <= maxDay) daySelect.value = selectedDay; else daySelect.value = "";
    updateHiddenInput();
  }

  function updateHiddenInput() {
    const y = yearSelect.value; const m = monthSelect.value; const d = daySelect.value;
    if (y && m && d) { hiddenInput.value = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; } 
    else { hiddenInput.value = ''; }
  }
  yearSelect.addEventListener('change', () => { updateDays(); updateHiddenInput(); });
  monthSelect.addEventListener('change', updateDays);
  daySelect.addEventListener('change', updateHiddenInput);
}

function setupPaymentModal() {
    const modal = document.getElementById('paymentModal');
    const closeBtn = document.getElementById('closePaymentModalBtn');
    const statusSelect = document.getElementById('paymentStatusSelect');
    const methodGroup = document.getElementById('paymentMethodGroup');
    const confirmBtn = document.getElementById('confirmPaymentAndSaveBtn');

    if (closeBtn) closeBtn.addEventListener('click', () => { if(modal) modal.style.display = 'none'; });
    if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
            if (methodGroup) methodGroup.style.display = e.target.value === 'paid' ? 'block' : 'none';
        });
    }
    if (confirmBtn) confirmBtn.addEventListener('click', executeFinalSave);
}

async function executeFinalSave() {
    const btn = document.getElementById('confirmPaymentAndSaveBtn');
    if(btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

    if (paymentContext === 'add') {
        await processAddMember(btn);
    } else {
        await processRenewal(btn);
    }
}

// ------------------------------
// FLOW A: Add Member
// ------------------------------
function validateAndShowAddPaymentModal() {
    const name = document.getElementById('memberName').value.trim();
    const bYear = document.getElementById('birthYear').value;
    const bMonth = document.getElementById('birthMonth').value;
    const bDay = document.getElementById('birthDay').value;
    const genderVal = document.getElementById('gender').value;
    const joinDate = document.getElementById('joinDate').value;
    const productSelect = document.getElementById('productSelect');
    
    if (!name) return showMessage('Full Name is required', 'error');
    if (!bYear || !bMonth || !bDay) return showMessage('Date of Birth is incomplete. Please select Day, Month, and Year.', 'error');
    if (!genderVal) return showMessage('Gender is required', 'error');
    if (!joinDate) return showMessage('Join Date is required', 'error');
    if (!document.getElementById('monthlyRadio').checked && !document.getElementById('combativeRadio').checked && !document.getElementById('danceRadio').checked) return showMessage('Please select a Membership Type', 'error');
    if (!productSelect || !productSelect.value) return showMessage('Please select a Product/Plan', 'error');

    const selectedOpt = productSelect.options[productSelect.selectedIndex];
    const price = parseFloat(selectedOpt.dataset.price);
    
    const summary = document.getElementById('paymentSummaryText');
    if(summary) summary.innerHTML = `<strong>Member:</strong> ${name} <br><strong>Product:</strong> ${selectedOpt.dataset.name} <br><strong>Amount Due:</strong> <span class="price-highlight">₱${price.toLocaleString()}</span>`;

    document.getElementById('paymentStatusSelect').value = 'paid';
    document.getElementById('paymentMethodGroup').style.display = 'block';
    document.getElementById('paymentMethodSelect').value = 'cash';

    paymentContext = 'add';
    document.getElementById('confirmPaymentAndSaveBtn').textContent = 'Confirm & Save Member';
    document.getElementById('paymentModal').style.display = 'flex';
}

async function processAddMember(btn) {
    const isPaid = document.getElementById('paymentStatusSelect').value === 'paid';
    const selectedMethod = document.getElementById('paymentMethodSelect').value;
    const safePaymentMethod = ['cash', 'e-wallet', 'bank'].includes(selectedMethod) ? selectedMethod : 'cash';
    
    const productSelect = document.getElementById('productSelect');
    const selectedOpt = productSelect.options[productSelect.selectedIndex];
    const membershipType = document.getElementById('monthlyRadio').checked ? 'monthly' : document.getElementById('combativeRadio').checked ? 'combative' : 'dance';

    const memberships = [{ type: membershipType, duration: 1, paymentStatus: isPaid ? 'paid' : 'unpaid' }];
    
    const bYear = document.getElementById('birthYear').value;
    const bMonth = document.getElementById('birthMonth').value;
    const bDay = document.getElementById('birthDay').value;
    const dob = `${bYear}-${bMonth.padStart(2, '0')}-${bDay.padStart(2, '0')}`;
    const joinDate = document.getElementById('joinDate').value;

    const formData = new FormData();
    formData.append('name', document.getElementById('memberName').value.trim());
    formData.append('birthdate', dob);
    formData.append('gender', document.getElementById('gender').value);
    formData.append('joinDate', joinDate);
    formData.append('phone', document.getElementById('phone')?.value.trim() || '');
    formData.append('email', document.getElementById('email')?.value.trim() || '');
    formData.append('address', document.getElementById('address')?.value.trim() || '');
    formData.append('emergencyName', document.getElementById('emergencyName')?.value.trim() || '');
    formData.append('emergencyPhone', document.getElementById('emergencyPhone')?.value.trim() || '');
    formData.append('emergencyRelation', document.getElementById('emergencyRelation')?.value.trim() || '');
    formData.append('faceEnrolled', faceSuccessfullyCaptured ? 'yes' : 'no');
    formData.append('memberships', JSON.stringify(memberships));

    if (faceImageBlobs.length === 3) {
        formData.append('faceImage1', faceImageBlobs[0], 'face1.jpg');
        formData.append('faceImage2', faceImageBlobs[1], 'face2.jpg');
        formData.append('faceImage3', faceImageBlobs[2], 'face3.jpg');
    }

    try {
        const memberResult = await apiFetch('/api/members', { method: 'POST', body: formData });
        if (!memberResult.success) throw new Error(memberResult.error || 'Failed to add member');

        const transactionPayload = {
            member_id: memberResult.data.mongoId || memberResult.data.memberId,
            amount: parseFloat(selectedOpt.dataset.price),
            payment_method: safePaymentMethod,
            status: isPaid ? 'paid' : 'unpaid',
            payment_date: joinDate,
            description: `Purchased Plan: ${selectedOpt.dataset.name}`
        };

        const txResult = await apiFetch('/api/transactions', { method: 'POST', body: JSON.stringify(transactionPayload) });
        if (!txResult.success) throw new Error('Member created, but failed to log transaction.');

        showMessage('Member & Transaction saved successfully!', 'success');

        // FIX: Properly clear inline styles to allow CSS classes to control the dropdown visibility
        setTimeout(() => {
            document.getElementById('paymentModal').style.display = 'none';
            document.getElementById('memberForm').reset();
            
            const productSelectContainer = document.getElementById('productSelectContainer');
            if (productSelectContainer) {
                productSelectContainer.classList.remove('active');
                productSelectContainer.style.display = ''; // Clears the bug-causing inline style
            }
            
            document.getElementById('faceStatus').textContent = '';
            faceSuccessfullyCaptured = false;
            faceImageBlobs = [];
        }, 2000);

    } catch (error) { showMessage(error.message, 'error'); } 
    finally {
        if(btn) { btn.disabled = false; btn.textContent = 'Confirm & Save Member'; }
        document.getElementById('paymentModal').style.display = 'none';
    }
}

// ------------------------------
// FLOW B: Renew Member
// ------------------------------
function setupRenewalModal() {
  const renewBtn = document.getElementById('renewBtn');
  const modal = document.getElementById('renewalModal');
  const closeBtn = document.getElementById('closeRenewalBtn');
  const searchBtn = document.getElementById('searchBtn');
  const renewalForm = document.getElementById('renewalForm');

  if (renewBtn) {
      renewBtn.addEventListener('click', function (e) { 
          e.preventDefault(); 
          if (modal) modal.style.display = 'flex'; 
          resetRenewalModal(); 
      });
  }

  if (closeBtn) closeBtn.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  if (searchBtn) searchBtn.addEventListener('click', searchMember);
  
  const searchInput = document.getElementById('searchMember');
  if (searchInput) searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchMember(); }});

  const renewMonthly = document.getElementById('renewMonthly');
  const renewCombative = document.getElementById('renewCombative');
  const renewDance = document.getElementById('renewDance');
  
  function toggleRenewDetails() {
    const rmDet = document.getElementById('renewMonthlyDetails');
    const rcDet = document.getElementById('renewCombativeDetails');
    const rdDet = document.getElementById('renewDanceDetails');

    if(rmDet) rmDet.style.display = renewMonthly?.checked ? 'block' : 'none';
    if(rcDet) rcDet.style.display = renewCombative?.checked ? 'block' : 'none';
    if(rdDet) rdDet.style.display = renewDance?.checked ? 'block' : 'none';
    
    const productGroup = document.getElementById('renewalProductGroup');
    const productSelect = document.getElementById('renewalProductSelect');
    const productTitleSpan = document.getElementById('renewalProductTitle');
    const productDetailsList = document.getElementById('renewalProductDetailsList');
    
    if (!renewMonthly?.checked && !renewCombative?.checked && !renewDance?.checked) {
        if (productGroup) {
            productGroup.style.display = 'none';
            productGroup.classList.remove('active');
        }
    } else {
        if (productGroup) {
            productGroup.style.display = 'block';
            setTimeout(() => productGroup.classList.add('active'), 10);
        }
        if (productSelect) {
            productSelect.innerHTML = '<option value="" disabled selected>Select a product...</option>';
            const selectedType = renewMonthly?.checked ? 'monthly' : renewCombative?.checked ? 'combative' : renewDance?.checked ? 'dance' : null;
            
            const filtered = activeProducts.filter(p => p.membership_type === selectedType);
            if (filtered.length === 0) {
                productSelect.innerHTML = '<option value="" disabled>No products available</option>';
            } else {
                filtered.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p._id; opt.dataset.price = p.price; opt.dataset.name = p.product_name;
                    opt.textContent = `${p.product_name} - ₱${p.price.toLocaleString()}`;
                    productSelect.appendChild(opt);
                });
            }

            if (selectedType === 'monthly' && productTitleSpan) {
                productTitleSpan.textContent = 'Monthly Gym Membership';
                productDetailsList.innerHTML = `<li><i class="fas fa-check-circle"></i> Basic gym access for 1 month</li>`;
            } else if (selectedType === 'combative' && productTitleSpan) {
                productTitleSpan.textContent = 'Combative Sports Membership';
                productDetailsList.innerHTML = `<li><i class="fas fa-check-circle"></i> 12 Sessions per month</li>`;
            } else if (selectedType === 'dance' && productTitleSpan) {
                productTitleSpan.textContent = 'Dance Class';
                productDetailsList.innerHTML = `<li><i class="fas fa-check-circle"></i> Dance sessions per month</li>`;
            }
        }
    }
    updateRenewalInfo();
  }

  if (renewMonthly) renewMonthly.addEventListener('change', toggleRenewDetails);
  if (renewCombative) renewCombative.addEventListener('change', toggleRenewDetails);
  if (renewDance) renewDance.addEventListener('change', toggleRenewDetails);

  if (document.getElementById('renewalDate')) document.getElementById('renewalDate').addEventListener('change', updateRenewalInfo);
  if (document.getElementById('renewMonthlyDuration')) document.getElementById('renewMonthlyDuration').addEventListener('input', updateRenewalInfo);
  if (document.getElementById('renewCombativeSessions')) document.getElementById('renewCombativeSessions').addEventListener('input', updateRenewalInfo); 
  if (document.getElementById('renewDanceSessions')) document.getElementById('renewDanceSessions').addEventListener('input', updateRenewalInfo); 
  
  if (renewalForm) renewalForm.addEventListener('submit', validateAndShowRenewalPaymentModal);
}

function resetRenewalModal() {
  if (document.getElementById('searchMember')) document.getElementById('searchMember').value = '';
  if (document.getElementById('searchResults')) document.getElementById('searchResults').innerHTML = '';
  if (document.getElementById('selectedMemberSection')) document.getElementById('selectedMemberSection').style.display = 'none';
  if (document.getElementById('renewalForm')) document.getElementById('renewalForm').reset();
  if (document.getElementById('renewalDate')) document.getElementById('renewalDate').valueAsDate = new Date();
  if (document.getElementById('renewMonthlyDetails')) document.getElementById('renewMonthlyDetails').style.display = 'none';
  if (document.getElementById('renewCombativeDetails')) document.getElementById('renewCombativeDetails').style.display = 'none';
  if (document.getElementById('renewDanceDetails')) document.getElementById('renewDanceDetails').style.display = 'none';
  if (document.getElementById('renewalInfoBox')) document.getElementById('renewalInfoBox').style.display = 'none';
  
  const productGroup = document.getElementById('renewalProductGroup');
  if (productGroup) {
      productGroup.style.display = 'none';
      productGroup.classList.remove('active');
  }
  
  selectedMember = null;
}

async function searchMember() {
  const query = document.getElementById('searchMember')?.value.trim();
  const resultsDiv = document.getElementById('searchResults');
  if (!query || query.length < 2) return showMessage('Please enter at least 2 characters', 'error');

  try {
    const result = await apiFetch(`/api/members/search?query=${encodeURIComponent(query)}`);
    if (!result.success) throw new Error(result.error || 'Search failed');
    if (result.data.length === 0) { 
        if (resultsDiv) resultsDiv.innerHTML = '<div class="no-results">No members found matching your search.</div>'; 
        return; 
    }
    if (resultsDiv) {
      resultsDiv.innerHTML = result.data.map((member) => {
        const statusClass = member.status === 'active' ? 'membership-active' : 'membership-inactive';
        return `
        <div class="search-result-item" onclick='selectMemberForRenewal(${JSON.stringify(member).replace(/'/g, '&apos;')})'>
          <div class="result-info">
              <strong class="${statusClass}">${member.name}</strong>
              <span class="member-id">${member.memberId}</span>
          </div>
          <div class="result-status">
              <span class="status-badge status-${member.status}">${member.status}</span>
          </div>
        </div>`
      }).join('');
    }
  } catch (error) { showMessage('Error searching members: ' + error.message, 'error'); }
}

function selectMemberForRenewal(member) {
  selectedMember = member;
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('selectedMemberSection').style.display = 'block';

  let membershipHTML = '';
  if (member.memberships && member.memberships.length > 0) {
    membershipHTML = member.memberships.map((m) => {
        const isExpired = new Date(m.endDate) < new Date();
        return `<div class="membership-item ${isExpired ? 'expired' : m.status}"><span class="membership-type">${m.type.toUpperCase()}</span><span class="membership-status">${m.status}</span><span class="membership-date">Expires: ${formatDate(m.endDate.split('T')[0])}</span></div>`;
      }).join('');
  } else membershipHTML = '<p class="no-membership">No active memberships</p>';

  const memberInfoCard = document.getElementById('memberInfoCard');
  if (memberInfoCard) {
    memberInfoCard.innerHTML = `<h4><i class="fas fa-user-circle"></i> ${member.name}</h4><p><strong>Member ID:</strong> ${member.memberId}</p><p><strong>Status:</strong> <span class="status-badge status-${member.status}">${member.status}</span></p><div class="membership-list"><strong>Current Memberships:</strong>${membershipHTML}</div>`;
  }
}

function updateRenewalInfo() {
  if (!selectedMember) return;
  const renewalDateInput = document.getElementById('renewalDate');
  if (!renewalDateInput?.value) return;

  const renewalDate = new Date(renewalDateInput.value);
  const monthlyChecked = document.getElementById('renewMonthly')?.checked;
  const combativeChecked = document.getElementById('renewCombative')?.checked;
  const danceChecked = document.getElementById('renewDance')?.checked;
  const infoBox = document.getElementById('renewalInfoBox');

  if (!monthlyChecked && !combativeChecked && !danceChecked) { if (infoBox) infoBox.style.display = 'none'; return; }
  let infoHTML = '<strong><i class="fas fa-info-circle"></i> Renewal Summary:</strong><br><br>';

  if (monthlyChecked) {
    const duration = parseInt(document.getElementById('renewMonthlyDuration')?.value) || 1;
    const currentMembership = selectedMember.memberships?.find((m) => m.type === 'monthly');
    const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, duration, 'monthly');
    infoHTML += `<div class="info-item"><strong>Monthly Membership:</strong><br><span class="detail-line">Start Date: ${formatDate(renewalDateInput.value)}</span><br><span class="detail-line">End Date: ${formatDate(endDate.toISOString().split('T')[0])}</span><br><span class="detail-line">Duration: ${duration} month(s)</span></div>`;
  }

  if (combativeChecked) {
    const duration = parseInt(document.getElementById('renewCombativeSessions')?.value) || 12; // defaulting to 12 if tracking by sessions
    const currentMembership = selectedMember.memberships?.find((m) => m.type === 'combative');
    const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, 1, 'combative'); // Assuming combative renews for 1 month block at a time
    infoHTML += `<div class="info-item"><strong>Combative Membership:</strong><br><span class="detail-line">Start Date: ${formatDate(renewalDateInput.value)}</span><br><span class="detail-line">End Date: ${formatDate(endDate.toISOString().split('T')[0])}</span><br><span class="detail-line">Sessions: ${duration}</span></div>`;
  }

  if (danceChecked) {
    const duration = parseInt(document.getElementById('renewDanceSessions')?.value) || 12; // assuming dance tracks similarly to combative
    const currentMembership = selectedMember.memberships?.find((m) => m.type === 'dance');
    const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, 1, 'dance');
    infoHTML += `<div class="info-item"><strong>Dance Class:</strong><br><span class="detail-line">Start Date: ${formatDate(renewalDateInput.value)}</span><br><span class="detail-line">End Date: ${formatDate(endDate.toISOString().split('T')[0])}</span><br><span class="detail-line">Sessions: ${duration}</span></div>`;
  }

  if (infoBox) { infoBox.innerHTML = infoHTML; infoBox.style.display = 'block'; }
}

function calculateNewEndDate(renewalDate, currentEndDateStr, durationMonths, membershipType) {
  const renewal = new Date(renewalDate);
  const currentEnd = currentEndDateStr ? new Date(currentEndDateStr) : null;
  if ((membershipType === 'combative' || membershipType === 'dance') && currentEnd) {
    const twoMonthsAgo = new Date(renewal);
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    if (currentEnd < twoMonthsAgo) { const newEnd = new Date(renewal); newEnd.setMonth(newEnd.getMonth() + durationMonths); return newEnd; }
  }
  if (currentEnd && renewal < currentEnd) { const newEnd = new Date(currentEnd); newEnd.setMonth(newEnd.getMonth() + durationMonths); return newEnd; } 
  else { const newEnd = new Date(renewal); newEnd.setMonth(newEnd.getMonth() + durationMonths); return newEnd; }
}

function validateAndShowRenewalPaymentModal(e) {
    e.preventDefault();
    if (!selectedMember) return showMessage('Please select a member first', 'error');
    
    const monthlyChecked = document.getElementById('renewMonthly').checked;
    const combativeChecked = document.getElementById('renewCombative').checked;
    const danceChecked = document.getElementById('renewDance').checked;
    if (!monthlyChecked && !combativeChecked && !danceChecked) return showMessage('Please select a membership type to renew', 'error');

    const productSelect = document.getElementById('renewalProductSelect');
    if (!productSelect || !productSelect.value) return showMessage('Please select a Product/Plan', 'error');

    const selectedOpt = productSelect.options[productSelect.selectedIndex];
    const price = parseFloat(selectedOpt.dataset.price);

    const summaryText = document.getElementById('paymentSummaryText');
    if(summaryText) {
        summaryText.innerHTML = `
            <strong>Renewing Member:</strong> ${selectedMember.name} <br>
            <strong>Product:</strong> ${selectedOpt.dataset.name} <br>
            <strong>Amount Due:</strong> <span class="price-highlight">₱${price.toLocaleString()}</span>
        `;
    }

    document.getElementById('paymentStatusSelect').value = 'paid';
    document.getElementById('paymentMethodGroup').style.display = 'block';
    document.getElementById('paymentMethodSelect').value = 'cash';

    paymentContext = 'renew';
    const confirmBtn = document.getElementById('confirmPaymentAndSaveBtn');
    if(confirmBtn) confirmBtn.textContent = 'Confirm & Renew Membership';

    const modal = document.getElementById('paymentModal');
    if(modal) modal.style.display = 'flex';
}

async function processRenewal(btn) {
    const isPaid = document.getElementById('paymentStatusSelect').value === 'paid';
    const selectedMethod = document.getElementById('paymentMethodSelect').value;
    const safePaymentMethod = ['cash', 'e-wallet', 'bank'].includes(selectedMethod) ? selectedMethod : 'cash'; 
    const productSelect = document.getElementById('renewalProductSelect');
    const selectedOpt = productSelect.options[productSelect.selectedIndex];

    try {
        const renewalDate = new Date(document.getElementById('renewalDate').value);
        const updatedMemberships = [];
        const monthlyChecked = document.getElementById('renewMonthly').checked;
        const combativeChecked = document.getElementById('renewCombative').checked;
        const danceChecked = document.getElementById('renewDance').checked;

        if (selectedMember.memberships) {
            selectedMember.memberships.forEach((m) => {
                if (m.type === 'monthly' && !monthlyChecked) updatedMemberships.push(m);
                else if (m.type === 'combative' && !combativeChecked) updatedMemberships.push(m);
                else if (m.type === 'dance' && !danceChecked) updatedMemberships.push(m);
            });
        }

        if (monthlyChecked) {
            const duration = parseInt(document.getElementById('renewMonthlyDuration').value) || 1;
            const cm = selectedMember.memberships?.find((m) => m.type === 'monthly');
            const endDate = calculateNewEndDate(renewalDate, cm?.endDate, duration, 'monthly');
            updatedMemberships.push({ type: 'monthly', duration: duration, startDate: renewalDate.toISOString(), endDate: endDate.toISOString(), status: 'active', paymentStatus: isPaid ? 'paid' : 'unpaid' });
        }

        if (combativeChecked) {
            // duration mapping is handled safely - 1 month block for the number of sessions
            const sessions = parseInt(document.getElementById('renewCombativeSessions').value) || 12;
            const cm = selectedMember.memberships?.find((m) => m.type === 'combative');
            const endDate = calculateNewEndDate(renewalDate, cm?.endDate, 1, 'combative'); 
            updatedMemberships.push({ type: 'combative', duration: 1, remainingSessions: sessions, startDate: renewalDate.toISOString(), endDate: endDate.toISOString(), status: 'active', paymentStatus: isPaid ? 'paid' : 'unpaid' });
        }

        if (danceChecked) {
            const sessions = parseInt(document.getElementById('renewDanceSessions').value) || 12;
            const cm = selectedMember.memberships?.find((m) => m.type === 'dance');
            const endDate = calculateNewEndDate(renewalDate, cm?.endDate, 1, 'dance'); 
            updatedMemberships.push({ type: 'dance', duration: 1, remainingSessions: sessions, startDate: renewalDate.toISOString(), endDate: endDate.toISOString(), status: 'active', paymentStatus: isPaid ? 'paid' : 'unpaid' });
        }

        const result = await apiFetch(`/api/members/${selectedMember._id}/renew`, {
            method: 'PUT', body: JSON.stringify({ memberships: updatedMemberships, status: 'active' })
        });

        if (!result.success) throw new Error(result.error || 'Failed to renew membership');

        const txPayload = {
            member_id: selectedMember.memberId,
            amount: parseFloat(selectedOpt.dataset.price),
            payment_method: safePaymentMethod,
            status: isPaid ? 'paid' : 'unpaid',
            payment_date: renewalDate.toISOString(),
            description: `Renewed Plan: ${selectedOpt.dataset.name}`
        };
        const txResult = await apiFetch('/api/transactions', { method: 'POST', body: JSON.stringify(txPayload) });
        if (!txResult.success) throw new Error('Renewed successfully, but failed to log transaction.');

        showMessage('Membership renewed & transaction logged!', 'success');
        setTimeout(() => { 
            document.getElementById('paymentModal').style.display = 'none';
            document.getElementById('renewalModal').style.display = 'none'; 
            resetRenewalModal(); 
        }, 2000);

    } catch (error) { showMessage('Error: ' + error.message, 'error'); } 
    finally { 
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm & Renew Membership'; } 
        document.getElementById('paymentModal').style.display = 'none';
    }
}

/* =========================================================
   SECTION 5: SHARED UTILITIES
   ========================================================= */

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
        if (video) { video.srcObject = stream; video.style.display = 'block'; }
        if (canvas) canvas.style.display = 'none';
        if (facePane) facePane.style.display = 'flex';
        if (confirmBtn) confirmBtn.disabled = true;
        if (resultMsg) resultMsg.textContent = '';
        faceImageBlobs = []; 
        captureBtn.disabled = false;
      } catch (err) { alert('Camera access denied or unavailable'); }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (facePane) facePane.style.display = 'none';
      if (video) video.style.display = 'block';
      if (canvas) canvas.style.display = 'none';
    });
  }

  if (captureBtn) {
    captureBtn.addEventListener('click', () => {
      if (video && canvas && faceImageBlobs.length < 3) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          faceImageBlobs.push(blob);
          const remaining = 3 - faceImageBlobs.length;
          if (remaining > 0) resultMsg.textContent = `Photo ${faceImageBlobs.length} captured! ${remaining} more to go.`;
          else { resultMsg.textContent = 'All 3 photos captured! Review and confirm.'; captureBtn.disabled = true; confirmBtn.disabled = false; }
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
        if (faceStatus) { faceStatus.textContent = '✓ 3 Faces Captured'; faceStatus.className = 'fp-status-message success'; }
        if (stream) stream.getTracks().forEach((track) => track.stop());
        if (facePane) facePane.style.display = 'none';
        if (resultMsg) resultMsg.textContent = '';
      }
    });
  }
}

function showMessage(text, type) {
  const messageDiv = document.getElementById('message');
  if (messageDiv) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';
    setTimeout(() => { messageDiv.className = 'message hidden'; messageDiv.style.display = 'none'; }, 5000);
  }
}

/* ========================================
   ADD MEMBER - CONDITIONAL PRODUCT FLOW
======================================== */

document.addEventListener('DOMContentLoaded', () => {
    const monthlyRadio = document.getElementById('monthlyRadio');
    const combativeRadio = document.getElementById('combativeRadio');
    const danceRadio = document.getElementById('danceRadio');
    const productSelectContainer = document.getElementById('productSelectContainer');
    const productCardHeader = document.getElementById('productCardHeader');
    const productTitleSpan = document.getElementById('productTitle');
    const productDetailsList = document.getElementById('productDetailsList');

    if (!monthlyRadio || !combativeRadio || !danceRadio || !productSelectContainer) return;

    function handleRadioChange() {
        if (monthlyRadio.checked) {
            updateProductField('monthly');
        } else if (combativeRadio.checked) {
            updateProductField('combative');
        } else if (danceRadio.checked) {
            updateProductField('dance');
        }
    }

    function updateProductField(type) {
        productSelectContainer.classList.add('active'); 

        productDetailsList.innerHTML = '';

        if (type === 'monthly') {
            productTitleSpan.textContent = 'Monthly Gym Membership';
            productDetailsList.innerHTML = `
                <li><i class="fas fa-check-circle"></i> Basic gym access for 1 month</li>
                <li><i class="fas fa-check-circle"></i> Equipment access</li>
                <li><i class="fas fa-check-circle"></i> No extra sessions or combat training included</li>
            `;
            const oldProductSelectGroup = document.getElementById('productSelectionGroup');
            if(oldProductSelectGroup) oldProductSelectGroup.style.display = 'none';

        } else if (type === 'combative') {
            productTitleSpan.textContent = 'Combative Sports Membership';
            productDetailsList.innerHTML = `
                <li><i class="fas fa-check-circle"></i> 12 Sessions, valid for 1 month</li>
                <li><i class="fas fa-check-circle"></i> Requires initial payment</li>
            `;
            const oldProductSelectGroup = document.getElementById('productSelectionGroup');
            if(oldProductSelectGroup) oldProductSelectGroup.style.display = 'none';
        } else if (type === 'dance') {
            productTitleSpan.textContent = 'Dance Class';
            productDetailsList.innerHTML = `
                <li><i class="fas fa-check-circle"></i> Dance sessions, valid for 1 month</li>
                <li><i class="fas fa-check-circle"></i> Requires initial payment</li>
            `;
            const oldProductSelectGroup = document.getElementById('productSelectionGroup');
            if(oldProductSelectGroup) oldProductSelectGroup.style.display = 'none';
        }
    }

    monthlyRadio.addEventListener('change', handleRadioChange);
    combativeRadio.addEventListener('change', handleRadioChange);
    danceRadio.addEventListener('change', handleRadioChange);

    handleRadioChange();
});