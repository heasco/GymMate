// Complete Fixed JS: Strict Active + Combative Sessions Filter, Autocomplete Hide, Bulk Button Wired
const SERVER_URL = 'http://localhost:8080';
let debounceTimeout;
let selectedMember = null;
let selectedClass = null;
let bulkEnrollments = []; // { member, classId, sessionDate, sessionTime }
let allClasses = [];
let allMembers = []; // holds latest ACTIVE members pulled from server
let currentView = 'list';
let selectedDate = null;
const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

document.addEventListener('DOMContentLoaded', async function() {
  console.log('=== INIT START ===');
  // Auth Check (Optional - Skip if No Login)
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');
  const authUser = JSON.parse(localStorage.getItem('authUser'));
  if (authUser && Date.now() - authUser.timestamp > 3600000) {
    localStorage.removeItem('authUser');
  }
  if (menuToggle) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  if (logoutBtn) logoutBtn.addEventListener('click', () => { localStorage.removeItem('authUser'); window.location.href = '../admin-login.html'; });

  // Init: Simple Fetches
  await checkServerConnection();
  await Promise.all([fetchClasses(), fetchMembers('')]);
  setupEventListeners();

  const calendarMonth = document.getElementById('calendarMonth');
  if (calendarMonth) calendarMonth.value = new Date().toISOString().slice(0, 7);
  else console.warn('calendarMonth not found');

  generateCalendar();
  updateBulkEnrollDisplay();
  switchView('list');

  // Default date to today for list view
  const sessionDateInput = document.getElementById('sessionDate');
  if (sessionDateInput) sessionDateInput.value = new Date().toISOString().split('T')[0];
  else console.warn('sessionDate input not found');

  console.log('=== INIT COMPLETE ===');
  domCheck(); // Run diagnostic
});

// DOM Diagnostic: Check All Expected Elements
function domCheck() {
  console.log('=== DOM CHECK START ===');
  const ids = ['classSelect', 'membersTableBody', 'addToBulkBtn', 'bulkEnrollPanel', 'bulkEnrollList', 'confirmBulkBtn', 'sessionDate', 'sessionTime', 'timeSlots', 'sessionsTableBody', 'emptyCartMsg', 'sessionDetailsSection', 'addPanelToCartBtn', 'panelMemberSelect', 'memberSearch', 'autocompleteSuggestions', 'serverStatus'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) console.log(`✓ Found: #${id}`);
    else console.error(`✗ MISSING: #${id} (update HTML or JS)`);
  });
  console.log('=== DOM CHECK END ===');
}

async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const isConnected = response.ok;
    if (statusElement) {
      statusElement.className = `alert ${isConnected ? 'alert-success server-connected' : 'alert-danger server-disconnected'}`;
      statusElement.textContent = isConnected ? 'Connected to server successfully' : 'Cannot connect to server. Please try again later.';
      statusElement.classList.remove('d-none');
    }
    console.log('Server check:', isConnected ? 'OK' : 'Failed');
  } catch (error) {
    if (statusElement) {
      statusElement.className = 'alert alert-danger server-disconnected';
      statusElement.textContent = 'Cannot connect to server. Please try again later.';
      statusElement.classList.remove('d-none');
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
    const response = await fetch(`${SERVER_URL}/api/classes`);
    console.log('Classes response:', response.status);
    if (response.ok) {
      const result = await response.json();
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
    } else {
      classSelect.innerHTML = '<option value="">Failed to load classes</option>';
      showError('Failed to fetch classes');
    }
  } catch (error) {
    console.error('Error fetching classes:', error);
    classSelect.innerHTML = '<option value="">Network error</option>';
    showError('Network error: Classes');
  }
  updateSingleButtons();
}

// STRICT: Only ACTIVE members with combative sessions available
async function fetchMembers(query = '') {
  const tbody = document.getElementById('membersTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Loading members...</td></tr>';
  else console.error('membersTableBody not found');

  try {
    // Pull only active from server to avoid mixing inactive
    const response = await fetch(`${SERVER_URL}/api/members?status=active`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
      }
    });
    if (!response.ok) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Server error</td></tr>';
      showError('Server error fetching members');
      return;
    }
    const result = await response.json();
    const rawMembers = Array.isArray(result.data) ? result.data : [];

    // Keep all active for client-side search
    allMembers = rawMembers;

    // Apply strict eligibility + optional query
    const eligible = strictFilterEligibleMembers(allMembers, query);
    if (eligible.length === 0) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No eligible members</td></tr>';
      showError('No active members with sessions available.');
    } else {
      populateMembersTable(eligible);
      if (query.trim().length >= 2) populateAutocomplete(eligible.slice(0, 5));
      populatePanelMembers(eligible);
    }
  } catch (error) {
    console.error('Fetch error:', error);
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Network error</td></tr>';
    showError('Network error');
  }
}

// Strict eligibility: active AND has combative sessions left
function strictFilterEligibleMembers(members, query = '') {
  const q = (query || '').trim().toLowerCase();

  const filtered = members
    .filter(m => (m.status || 'active') === 'active')
    .map(m => {
      const combativeOnly = (m.memberships || []).filter(ms => ms.type === 'combative');
      const hasAvailable = combativeOnly.some(ms => {
        // Use remainingSessions if present, else duration as remaining baseline
        const remaining = typeof ms.remainingSessions === 'number'
          ? ms.remainingSessions
          : Number(ms.duration || 0);
        const notExpired = !ms.endDate || new Date(ms.endDate) >= new Date();
        const memStatus = ms.status || 'active';
        return remaining > 0 && notExpired && memStatus !== 'expired';
      });
      return { ...m, _hasCombativeAvailable: hasAvailable, _combativeMemberships: combativeOnly };
    })
    .filter(m => m._hasCombativeAvailable);

  if (!q) return filtered;

  return filtered.filter(m =>
    (m.name && m.name.toLowerCase().includes(q)) ||
    (m.memberId && m.memberId.toLowerCase().includes(q))
  );
}

// Compute remaining sessions shown in table/autocomplete
function getRemainingSessions(member) {
  const combative = (member._combativeMemberships || member.memberships || []).find(ms => ms.type === 'combative');
  if (!combative) return 0;
  return typeof combative.remainingSessions === 'number'
    ? combative.remainingSessions
    : Number(combative.duration || 0);
}

function setupEventListeners() {
  console.log('Setting up event listeners...');
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
    if (sessionDetailsSection) sessionDetailsSection.classList.remove('d-none');
    else console.warn('sessionDetailsSection not found');
    populateSessionsTable(selectedClassId);
    const cls = allClasses.find(c => c.class_id === selectedClassId);
    if (cls) populateTimeSlots(cls.schedule);
  } else if (sessionDetailsSection) {
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
  const timeMatch = schedule.match(/(\d{1,2}:\d{2} [AP]M - \d{1,2}:\d{2} [AP]M)/i);
  if (timeMatch) {
    const timeRange = timeMatch[1];
    const slotBtn = document.createElement('button');
    slotBtn.className = 'btn btn-sm btn-outline-info me-2 mb-2';
    slotBtn.textContent = timeRange;
    slotBtn.onclick = () => {
      timeSelect.value = timeRange;
      timeSelect.style.display = 'block';
      showSuccess('Time selected: ' + timeRange);
    };
    timeSlotsDiv.appendChild(slotBtn);
    timeSelect.innerHTML += `<option value="${timeRange}">${timeRange}</option>`;
  } else {
    timeSlotsDiv.innerHTML = '<p class="text-muted small">No predefined slots.</p>';
    timeSelect.style.display = 'block';
  }
}

function populateMembersTable(members) {
  const tbody = document.getElementById('membersTableBody');
  if (!tbody) {
    console.error('membersTableBody not found');
    return;
  }
  tbody.innerHTML = '';
  const classSelectValue = document.getElementById('classSelect')?.value || '';

  // Render only strictly-eligible list
  members.forEach((member) => {
    const memberId = member.memberId;
    if (!memberId) return;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="form-check-input member-checkbox" value="${memberId}"></td>
      <td>${memberId}</td>
      <td>${member.name || member.fullName || 'Unknown'}</td>
      <td>${getRemainingSessions(member)}</td>
      <td>
        <button class="btn btn-sm btn-info add-to-bulk-btn" 
                data-member-id="${memberId}"
                onclick="addMemberToCart('${memberId}')"
                ${!classSelectValue ? 'disabled' : ''}>
          ${classSelectValue ? 'Add to Cart' : 'Select Class First'}
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
  if (tbody.children.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No eligible members</td></tr>';
  }
  console.log('Members table populated:', members.length, 'rows');
  toggleAllMembers();
  updateAddToCartButton();
}

function updateSingleButtons() {
  const classSelect = document.getElementById('classSelect');
  const hasClass = !!(classSelect && classSelect.value);
  console.log('updateSingleButtons: hasClass =', hasClass, 'value =', classSelect?.value);
  document.querySelectorAll('.add-to-bulk-btn').forEach(btn => {
    btn.disabled = !hasClass;
    btn.textContent = hasClass ? 'Add to Cart' : 'Select Class First';
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
    div.className = 'autocomplete-suggestion p-2 border-bottom cursor-pointer hover-bg';
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
    addBtn.innerHTML = `<i class="fas fa-cart-plus me-2"></i> ${checkedCount > 0 ? `Add ${checkedCount} to Cart` : 'Add Selected to Cart'}`;
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

function populateSessionsTable(classId) {
  const tbody = document.getElementById('sessionsTableBody');
  if (!tbody) {
    console.error('sessionsTableBody not found');
    return;
  }
  tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Loading...</td></tr>';
  fetch(`${SERVER_URL}/api/enrollments?class_id=${classId}`)
    .then(res => res.ok ? res.json() : Promise.reject('No sessions'))
    .then(result => {
      tbody.innerHTML = '';
      (result.data || []).forEach(enr => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${enr.memberId || enr.memberid}</td>
          <td>${enr.name || enr.membername}</td>
          <td>${enr.session_date || enr.sessiondate}</td>
          <td>${enr.session_time || enr.sessiontime}</td>
          <td><span class="badge bg-info">${enr.attendance_status || enr.attendancestatus}</span></td>
          <td><button class="btn btn-sm btn-success attend-button" onclick="markAttended('${enr._id}')">Mark Attended</button></td>
        `;
        tbody.appendChild(row);
      });
      if (tbody.children.length === 0) tbody.innerHTML = '<tr><td colspan="6" class="text-center">No sessions.</td></tr>';
    })
    .catch(err => {
      console.error('Sessions error:', err);
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No sessions found.</td></tr>';
    });
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

  if (emptyMsg) emptyMsg.classList.add('d-none');
  list.innerHTML = '';

  if (bulkEnrollments.length === 0) {
    console.log('Cart empty—hiding panel');
    panel.style.display = 'none';
    panel.classList.add('d-none');
    if (bulkBtn) {
      bulkBtn.disabled = true;
      bulkBtn.innerHTML = '<i class="fas fa-save me-2"></i> Bulk Enroll';
    }
    if (emptyMsg) {
      emptyMsg.classList.remove('d-none');
      emptyMsg.textContent = 'Your cart is empty. Add members above!';
    }
    console.log('=== UPDATE CART DISPLAY END (EMPTY) ===');
    return;
  }

  // Show panel
  console.log('Cart has items—showing panel');
  panel.style.display = 'block';
  panel.classList.remove('d-none');
  if (bulkBtn) {
    bulkBtn.disabled = false;
    bulkBtn.innerHTML = `<i class="fas fa-save me-2"></i> Bulk Enroll (${bulkEnrollments.length})`;
  }

  bulkEnrollments.forEach((enr, idx) => {
    const classObj = allClasses.find(c => c.class_id === enr.classId);
    const className = classObj ? (classObj.class_name || classObj.name) : 'Unknown';
    const memberId = enr.member.memberId;
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-start';
    li.innerHTML = `
      <div class="flex-grow-1">
        <div><strong>${enr.member.name || enr.member.fullName}</strong> (ID: ${memberId}) → <span class="text-info">${className}</span></div>
        <small class="text-muted d-block">${enr.sessionDate.toLocaleDateString()} @ ${enr.sessionTime}</small>
      </div>
      <button class="btn btn-sm btn-danger ms-2" onclick="removeFromBulk(${idx})">
        <i class="fas fa-trash"></i>
      </button>
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
  if (!confirm(`Enroll ${bulkEnrollments.length}?`)) return;
  let successCount = 0;
  const errors = [];
  for (const enr of bulkEnrollments) {
    try {
      const memberId = enr.member.memberId;
      const postBody = {
        classid: enr.classId,
        memberid: memberId,
        membername: enr.member.name || enr.member.fullName,
        sessiondate: enr.sessionDate.toISOString().split('T')[0],
        sessiontime: enr.sessionTime,
        attendancestatus: 'scheduled',
        status: 'active'
      };
      const response = await fetch(`${SERVER_URL}/api/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody)
      });
      if (response.ok) {
        successCount++;
      } else {
        const errText = await response.text();
        errors.push(`Failed ${memberId}: ${errText}`);
      }
    } catch (error) {
      errors.push(`Error ${enr.member.memberId}: ${error.message}`);
    }
  }
  if (errors.length > 0) showError(errors.join('; '));
  showSuccess(`${successCount} enrolled`);
  bulkEnrollments = [];
  updateBulkEnrollDisplay();
  await fetchMembers('');
}

function showSuccess(message) {
  console.log('SUCCESS:', message);
  const successEl = document.getElementById('successMessage');
  if (successEl) {
    const msgBody = successEl.querySelector('.message-body');
    if (msgBody) msgBody.textContent = message;
    successEl.classList.remove('d-none');
    setTimeout(() => successEl.classList.add('d-none'), 3000);
  }
}

function showError(message) {
  console.error('ERROR:', message);
  const errorEl = document.getElementById('errorMessage');
  if (errorEl) {
    const errorText = document.getElementById('errorText');
    if (errorText) errorText.textContent = message;
    errorEl.classList.remove('d-none');
    setTimeout(() => errorEl.classList.add('d-none'), 5000);
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

function switchView(view) {
  currentView = view;
  const tabElement = document.getElementById(view === 'list' ? 'listTab' : 'calendarTab');
  if (tabElement) {
    const tabs = new bootstrap.Tab(tabElement);
    tabs.show();
  }
  if (view === 'calendar') generateCalendar();
}

function generateCalendar() {
  const calendarMonth = document.getElementById('calendarMonth');
  if (!calendarMonth) return;
  const [year, month] = calendarMonth.value.split('-').map(Number);
  const title = document.getElementById('calendarTitle');
  if (title) title.textContent = `${new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' })} ${year}`;
  const firstDay = new Date(year, month - 1, 1).getDay();
  const lastDay = new Date(year, month, 0).getDate();
  const tbody = document.getElementById('calendarBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  let row = document.createElement('tr');
  for (let i = 0; i < firstDay; i++) {
    const emptyCell = document.createElement('td');
    emptyCell.className = 'calendar-day bg-secondary';
    row.appendChild(emptyCell);
  }
  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(year, month - 1, day);
    const td = document.createElement('td');
    td.className = 'calendar-day';
    td.innerHTML = `<div class="day-number">${day}</div>`;
    if (date.toDateString() === new Date().toDateString()) td.classList.add('today');
    const classesToday = allClasses.filter(cls => isClassOnDay(cls.schedule, date.getDay()));
    classesToday.forEach(cls => {
      const classEl = document.createElement('div');
      classEl.className = 'class-on-day small text-danger';
      classEl.textContent = cls.class_name || cls.name;
      td.appendChild(classEl);
    });
    td.onclick = (e) => selectDate(date, e);
    row.appendChild(td);
    if (row.children.length === 7) {
      tbody.appendChild(row);
      row = document.createElement('tr');
    }
  }
  if (row.children.length > 0) tbody.appendChild(row);
}

function isClassOnDay(schedule, dayIndex) {
  return schedule.toLowerCase().includes(dayOfWeekNames[dayIndex].toLowerCase());
}

function parseTimeFromSchedule(schedule) {
  const match = schedule.match(/(\d{1,2}:\d{2} [AP]M - \d{1,2}:\d{2} [AP]M)/i);
  return match ? match[1] : '9:00 AM - 10:00 AM';
}

function selectDate(date, event) {
  selectedDate = date;
  const panelTitle = document.getElementById('panelTitle');
  if (panelTitle) panelTitle.textContent = `Selected Date: ${date.toDateString()}`;
  const datePanel = document.getElementById('datePanel');
  if (datePanel) datePanel.classList.remove('d-none');
  const classesToday = allClasses.filter(cls => isClassOnDay(cls.schedule, date.getDay()));
  const details = document.getElementById('classDetails');
  if (details) {
    details.innerHTML = classesToday.length === 0 ? '<p class="text-muted">No classes.</p>' : '';
    classesToday.forEach(cls => {
      const classId = cls.class_id;
      const card = document.createElement('div');
      card.className = 'class-card card mb-2';
      card.innerHTML = `
        <div class="card-body p-3">
          <h5 class="card-title text-danger">${cls.class_name || cls.name}</h5>
          <p class="card-text mb-1"><strong>Trainer:</strong> ${cls.trainer_name || 'TBD'}</p>
          <p class="card-text mb-1"><strong>Time:</strong> ${parseTimeFromSchedule(cls.schedule)}</p>
          <p class="card-text mb-0"><strong>Description:</strong> ${cls.description || 'None'}</p>
          <button class="btn btn-sm btn-info mt-2" onclick="addClassToCart('${classId}', event)">Add Members</button>
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
    panel.classList.remove('d-none');
    console.log('✓ Cart panel forced visible');
  } else {
    console.error('✗ bulkEnrollPanel not found');
  }
};
