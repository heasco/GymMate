const API_URL = 'http://localhost:8080';
const $ = (id) => document.getElementById(id);

// ========== AUTH & MEMBER ID UTILS ==========
function getAuth() {
  try { return JSON.parse(localStorage.getItem('authUser') || 'null'); } catch { return null; }
}
function memberIdFromAuth() {
  const a = getAuth();
  if (!a || !a.user) return null;
  const u = a.user;
  return u.memberId || u.member_id || u._id || u.id || null;
}
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ========== MAIN GLOBALS ==========
let availableClasses = [];
let memberEnrollments = [];
let memberInfo = null;
let realRemainingSessions = 0; // always current from DB
let enrollCart = [];
let currentCalendarDate = new Date();
// Used for "projected" value when items are in cart
let tempRemainingSessions = 0;

// ========== API FETCH ==========
async function timedFetch(url, name) {
  console.time(name);
  const res = await fetch(url);
  console.timeEnd(name);
  return res;
}

// ========== TOAST HELPER ==========
function showToast(message, type = 'info') {
  // Simple alert for now; replace with Toastify or similar if needed
  const className = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
  alert(`${className.toUpperCase()}: ${message}`);
  console.log(`${type.toUpperCase()}: ${message}`);
}

function showLoadingState(show = true) {
  const btn = $('confirmCartBtn');
  if (btn) btn.disabled = show;
  // Add spinner if you have one: document.getElementById('loading')?.style.display = show ? 'block' : 'none';
}

// ========== DOM READY ==========
document.addEventListener('DOMContentLoaded', async () => {
  const auth = getAuth();
  if (!auth || auth.role !== 'member' || !auth.user) {
    window.location.href = "../member-login.html";
    return;
  }
  showLoadingState(true);
  await loadInitialData();
  setupEventListeners();
  initializeCalendarView();
  renderListView();
  switchView('calendar');
  showLoadingState(false);
});

// ========== DATA LOAD & SESSION CALC ==========
async function loadInitialData() {
  try {
    const memberId = memberIdFromAuth();
    if (!memberId) throw new Error('No member ID in auth');

    const memberPromise = timedFetch(`${API_URL}/api/members/${encodeURIComponent(memberId)}`, 'Member API').then(r => r.json());
    const classesPromise = timedFetch(`${API_URL}/api/classes`, 'Classes API').then(r => r.json());
    const enrollmentsPromise = timedFetch(`${API_URL}/api/enrollments/member/${encodeURIComponent(memberId)}`, 'Enrollments API').then(r => r.json());

    const [memberData, classesData, enrollmentsData] = await Promise.all([
      memberPromise.catch(err => { console.error('Member load failed:', err); return { success: false, data: null }; }),
      classesPromise.catch(err => { console.error('Classes load failed:', err); return { success: false, data: [] }; }),
      enrollmentsPromise.catch(err => { console.error('Enrollments load failed:', err); return { success: false, data: [] }; })
    ]);

    // Robust parsing for memberInfo
    console.log('Raw Member Response:', memberData); // DEBUG: See full backend response
    memberInfo = (memberData && memberData.success && memberData.data) ? memberData.data : memberData || null;
    console.log('Parsed memberInfo:', { hasMemberships: !!memberInfo?.memberships, membershipsLength: memberInfo?.memberships?.length, sampleMembership: memberInfo?.memberships?.[0] }); // DEBUG

    // Ensure classes/enrollments are arrays
    availableClasses = Array.isArray(classesData?.data) ? classesData.data : (Array.isArray(classesData) ? classesData : []);
    memberEnrollments = Array.isArray(enrollmentsData?.data) ? enrollmentsData.data : (Array.isArray(enrollmentsData) ? enrollmentsData : []);

    // Update UI after load
    updateSessionCounter(false, 0);
    renderCalendarGrid();
    renderListView();
    updateCartDisplay(); // Ensure cart shows
  } catch (err) {
    console.error('loadInitialData Error:', err);
    showErrorState('Failed to load data. Check console and backend.');
  }
}

// ========== VIEW STATES & UTILS ==========
function showLoadingStateGlobal() {
  const c = $('calendarContainer'); if (c) c.innerHTML = '<div class="loading-state">Loading classes...</div>';
  const l = $('classesGrid'); if (l) l.innerHTML = '<div class="loading-state">Loading classes...</div>';
}
function hideLoadingStateGlobal() {
  document.querySelectorAll('.loading-state').forEach(el => el.remove());
}
function showErrorState(msg = 'Failed to load classes.') {
  const c = $('calendarContainer');
  if (c) c.innerHTML = `<div class="error-state">${msg}</div>`;
}

// ========== SESSION LOGIC ==========
function getCurrentSessionPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

// Calculate & display real remaining sessions based on DB, or "projected" if cart present
function updateSessionCounter(forceCart = false, tempOffset = 0) {
  const remainingSessionSpan = $('remainingSessions');
  const memInfoSpan = $('membershipInfo');

  if (!memberInfo) {
    if (remainingSessionSpan) remainingSessionSpan.textContent = '0';
    if (memInfoSpan) memInfoSpan.textContent = 'No member data loaded';
    realRemainingSessions = 0;
    tempRemainingSessions = 0;
    return;
  }

  let memberships = memberInfo.memberships || [];
  if (!Array.isArray(memberships)) memberships = [];

  // ALWAYS prioritize combative as "active session-count" for this context
  // Shows the most recent active combative plan (or, fallback=0)
  const combative = memberships
    .filter(m => m.type && m.type.toLowerCase() === 'combative' && (m.status || '').toLowerCase() === 'active')
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))[0];

  if (!combative) {
    // No combative membership
    if (remainingSessionSpan) remainingSessionSpan.textContent = '0';
    if (memInfoSpan) memInfoSpan.textContent = 'No active combative membership';
    realRemainingSessions = 0;
    tempRemainingSessions = 0;
    return;
  }

  // Use remainingSessions directly (net current after backend deductions; fallback 0 if missing)
  realRemainingSessions = Math.max(0, combative.remainingSessions || 0);
  const totalSessionsPerMonth = combative.sessionsPerMonth || null;  // Optional: For display if available

  // UI/Projection
  if (forceCart && enrollCart.length > 0) {
    tempRemainingSessions = Math.max(0, realRemainingSessions - enrollCart.length + tempOffset);
    if (remainingSessionSpan) {
      remainingSessionSpan.innerHTML = `${tempRemainingSessions} <small style="color:#999;">(projected)</small>`;
    }
    let infoText = `Combative (${combative.status}) | Real: ${realRemainingSessions}`;
    if (totalSessionsPerMonth) {
      infoText += ` (total: ${totalSessionsPerMonth}/month)`;
    }
    if (memInfoSpan) memInfoSpan.innerHTML = infoText;
  } else {
    tempRemainingSessions = realRemainingSessions;
    if (remainingSessionSpan) remainingSessionSpan.textContent = realRemainingSessions;
    let infoText = `Combative (${combative.status}) | Remaining: ${realRemainingSessions}`;
    if (totalSessionsPerMonth) {
      infoText += ` (allocated: ${totalSessionsPerMonth}/month)`;
    }
    if (memInfoSpan) memInfoSpan.textContent = infoText;
  }

  // Button state: Enable if cart non-empty AND real sessions cover full cart (temp is display-only)
  const confirmBtn = $('confirmCartBtn');
  if (confirmBtn) {
    const canConfirm = enrollCart.length > 0 && realRemainingSessions >= enrollCart.length;
    confirmBtn.disabled = !canConfirm;
    confirmBtn.textContent = enrollCart.length > 0 ? `Confirm All (${enrollCart.length})` : 'Confirm All Enrollments';
  }
}
// ========== CALENDAR VIEW ==========
function initializeCalendarView() {
  renderCalendarGrid();
  renderCalendarNavigation();
  updateCalendarTitle();
}
function renderCalendarGrid() {
  const container = $('calendarContainer');
  if (!container) return;
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  let html = `<div class="calendar-header">
    <button class="calendar-nav-btn" id="prevMonth">‹</button>
    <span id="currentMonthDisplay"></span>
    <button class="calendar-nav-btn" id="nextMonth">›</button></div>
    <div class="calendar-grid">`;
  const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  weekdays.forEach(day => { html += `<div class="calendar-header-day">${day}</div>`; });
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startingDay = firstDay.getDay();
  let cellIndex = 0;
  for (let i = 0; i < startingDay; i++) {
    html += `<div class="calendar-cell calendar-cell-empty"><div class="calendar-day-number"></div><div class="calendar-day-content"></div></div>`;
    cellIndex++;
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === new Date().toISOString().split('T')[0];
    const dayClasses = getClassesForDate(dateStr);
    let classChips = '';
    if (dayClasses.length > 0) {
      classChips = dayClasses.slice(0, 2).map(cls => `<div class="class-chip">${escapeHtml(cls.class_name || 'Class')}</div>`).join('');
      if (dayClasses.length > 2) classChips += `<div class="class-chip">+${dayClasses.length - 2} more</div>`;
    }
    html += `<div class="calendar-cell${isToday ? ' calendar-cell-today' : ''}" data-date="${dateStr}">
      <div class="calendar-day-number">${day}</div>
      <div class="calendar-day-content"><div class="calendar-day-classes">${classChips}</div></div></div>`;
    cellIndex++;
    if (cellIndex % 7 === 0 && day < daysInMonth) cellIndex = 0;
  }
  while (cellIndex % 7 !== 0) {
    html += `<div class="calendar-cell calendar-cell-empty"><div class="calendar-day-number"></div><div class="calendar-day-content"></div></div>`;
    cellIndex++;
  }
  html += '</div>';
  container.innerHTML = html;
  document.addEventListener('click', handleCalendarClick, true);  // Use capture to avoid conflicts
}
function renderCalendarNavigation() {
  $('prevMonth')?.addEventListener('click', previousMonth);
  $('nextMonth')?.addEventListener('click', nextMonth);
}
function handleCalendarClick(event) {
  const cell = event.target.closest('.calendar-cell');
  if (!cell || cell.classList.contains('calendar-cell-empty')) return;
  const dateStr = cell.getAttribute('data-date');
  const dayClasses = getClassesForDate(dateStr);
  showDayModal(dateStr, dayClasses);
}
function getClassesForDate(dateStr) {
  const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  return availableClasses.filter(cls => {
    const schedule = (cls.schedule || '').toLowerCase();
    if (schedule.match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/)) {
      return schedule.includes(dayName.substring(0, 3));
    }
    return true;
  });
}
function showDayModal(dateStr, classes) {
  const date = new Date(dateStr);
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  let modalContent = `
    <div class="day-modal">
      <div class="day-modal-header">
        <h3>Classes for ${formattedDate}</h3>
        <div class="day-modal-date">${dateStr}</div>
        <div class="day-modal-sessions">
           <span class="day-modal-sessions-remaining">
             Sessions remaining: <span id="modalSessionsRemaining">${tempRemainingSessions}</span>
           </span>
        </div>
      </div>
      <div class="day-modal-content">
  `;
  if (classes.length === 0) {
    modalContent += '<div class="no-classes">No classes scheduled for this date</div>';
  } else {
    classes.forEach(cls => {
      const classId = cls.class_id || cls._id;
      const className = cls.class_name || 'Unnamed Class';
      const trainer = cls.trainer_name || cls.trainer_id || 'TBD';
      const schedule = cls.schedule || 'Schedule TBD';
      modalContent += `
        <div class="class-selection">
         <div class="class-info">
           <div class="class-name">${escapeHtml(className)}</div>
           <div class="class-trainer">Trainer: ${escapeHtml(trainer)}</div>
           <div class="class-schedule">${escapeHtml(schedule)}</div>
         </div>
         <div class="class-times">
           <button class="select-time-btn" data-class="${classId}" data-class-name="${escapeHtml(className)}">
             Select Time
           </button>
         </div>
        </div>
      `;
    });
  }
  modalContent += `
        </div>
        <div class="day-modal-footer">
         <button class="btn btn-ghost" onclick="closeModal('dayModal')">Close</button>
        </div>
      </div>
  `;
  let modal = document.getElementById('dayModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dayModal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-container">
        ${modalContent}
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  const timeBtns = modal.querySelectorAll('.select-time-btn');
  timeBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      const classId = this.dataset.class;
      const className = this.dataset.className;
      showTimeSelectionModal(classId, className, dateStr);
    });
  });
}
function showTimeSelectionModal(classId, className, dateStr) {
  const cls = availableClasses.find(c => c.class_id === classId || c._id === classId);  // Assuming frontend data has class_id
  if (!cls) {
    alert('Class not found');
    return;
  }
  const timeSlots = generateTimeSlots(cls.schedule);
  let modalContent = `
    <div class="time-modal">
      <div class="time-modal-header">
        <h3>Select Time for ${escapeHtml(className)}</h3>
        <div class="time-modal-date">${new Date(dateStr).toLocaleDateString()}</div>
      </div>
      <div class="time-modal-content">
  `;
  timeSlots.forEach(timeSlot => {
    // Fixed: Check enrollment.classid (backend returns no underscores)
    const isEnrolled = memberEnrollments.some(enrollment => {
      const enDate = new Date(enrollment.sessiondate);  // Backend key: sessiondate
      return enrollment.classid === classId &&  // Backend key: classid
        enDate.toISOString().split('T')[0] === dateStr &&
        enrollment.sessiontime === timeSlot;  // Backend key: sessiontime
    });
    modalContent += `
      <div class="time-slot-item ${isEnrolled ? 'disabled' : ''}" 
           data-class="${classId}" data-date="${dateStr}" data-time="${timeSlot}">
        <div class="time-slot-label">${timeSlot}</div>
        <button class="select-enrollment-btn" ${isEnrolled ? 'disabled' : ''}>
          ${isEnrolled ? 'Already Enrolled' : 'Add to Cart'}
        </button>
      </div>
    `;
  });
  modalContent += `
      </div>
      <div class="time-modal-footer">
       <button class="btn btn-ghost" onclick="closeModal('timeModal')">Cancel</button>
      </div>
    </div>
  `;
  let modal = document.getElementById('timeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'timeModal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-container">
        ${modalContent}
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  const enrollBtns = modal.querySelectorAll('.select-enrollment-btn');
  enrollBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      if (this.disabled) return;
      const classIdVal = this.closest('.time-slot-item').dataset.class;
      const dateStrVal = this.closest('.time-slot-item').dataset.date;
      const timeSlotVal = this.closest('.time-slot-item').dataset.time;
      addToEnrollmentCart(classIdVal, dateStrVal, timeSlotVal, className);
    });
  });
}

// ========== CART MANAGEMENT ==========
function addToEnrollmentCart(classId, dateStr, timeSlot, className) {
  const existing = enrollCart.find(item =>
    item.classId === classId &&
    item.date === dateStr &&
    item.time === timeSlot
  );

  if (existing) {
    showToast('Already added to cart for this date and time', 'warning');
    return;
  }

  updateSessionCounter(false, 0);
  if (realRemainingSessions < 1) {
    showToast(`No sessions left. Real remaining: ${realRemainingSessions}. Contact admin.`, 'error');
    return;
  }

  enrollCart.push({
    classId: classId,
    className: className,
    date: dateStr,
    time: timeSlot
  });

  closeModal('timeModal');
  updateCartDisplay();

  updateSessionCounter(true, 0);

  const message = tempRemainingSessions < enrollCart.length 
    ? `Added! Projected: ${tempRemainingSessions} (over limit—can't confirm until renewed).` 
    : 'Added to cart! Sessions temporarily updated on screen.';
  showToast(message, 'success');
}

function updateCartDisplay() {
  const cartContainer = $('enrollmentCart');
  const cartContent = $('cartContent');
  const confirmBtn = $('confirmCartBtn');

  if (cartContainer) cartContainer.style.display = "block";

  console.log('Cart Update (Temp):', enrollCart.map(i => ({ class: i.className, date: i.date, time: i.time })));

  if (enrollCart.length === 0) {
    if (cartContent) cartContent.innerHTML = '<p>No temporary selections. Add from calendar or list.</p>';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Confirm All Enrollments';
    }
    updateSessionCounter(false, 0);
    return;
  }

  let html = '';
  enrollCart.forEach((item, index) => {
    const dateObj = new Date(item.date);
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    const formattedDate = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    html += `
      <div class="cart-item">
        <div class="cart-item-info">
          <strong>${escapeHtml(item.className)}</strong><br>
          <small>${dayOfWeek}, ${formattedDate} at ${escapeHtml(item.time)} (Temporary)</small>
        </div>
        <button type="button" class="cart-item-remove" onclick="removeFromCart(${index})" title="Remove (+1 session)">✕</button>
      </div>
    `;
  });
  if (cartContent) cartContent.innerHTML = html;

  updateSessionCounter(true, 0);
  if (confirmBtn) {
    confirmBtn.disabled = tempRemainingSessions < enrollCart.length || realRemainingSessions < enrollCart.length;
    confirmBtn.textContent = `Confirm All (${enrollCart.length})`;
  }
}

function updateCartDisplay() {
  const cartContainer = $('enrollmentCart');
  const cartContent = $('cartContent');
  const confirmBtn = $('confirmCartBtn');

  // Always show cart
  if (cartContainer) cartContainer.style.display = "block";

  console.log('Cart Update (Temp):', enrollCart.map(i => ({ class: i.className, date: i.date, time: i.time })));

  if (enrollCart.length === 0) {
    if (cartContent) cartContent.innerHTML = '<p>No temporary selections. Add from calendar or list.</p>';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Confirm All Enrollments';
    }
    updateSessionCounter(false, 0); // Show real (no projection)
    return;
  }

  // Render full details: class + day + date + time
  let html = '';
  enrollCart.forEach((item, index) => {
    const dateObj = new Date(item.date);
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' }); // e.g., "Monday"
    const formattedDate = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); // e.g., "Oct 22, 2025"
    html += `
      <div class="cart-item">
        <div class="cart-item-info">
          <strong>${escapeHtml(item.className)}</strong><br>
          <small>${dayOfWeek}, ${formattedDate} at ${escapeHtml(item.time)} (Temporary)</small>
        </div>
        <button type="button" class="cart-item-remove" onclick="removeFromCart(${index})" title="Remove (+1 session)">✕</button>
      </div>
    `;
  });
  if (cartContent) cartContent.innerHTML = html;

  // Project on screen if cart non-empty
  updateSessionCounter(true, 0);
  if (confirmBtn) {
    confirmBtn.disabled = tempRemainingSessions < enrollCart.length || realRemainingSessions < enrollCart.length;
    confirmBtn.textContent = `Confirm All (${enrollCart.length})`;
  }
}

// Helper: Send single enrollment POST (reusable for loop)
async function enrollSingleItem(item) {
  const memberId = memberIdFromAuth();
  if (!memberId) throw new Error('Not authenticated');

  const body = {
    classid: item.classId,        // Backend expects 'classid' (string ID like 'CLS-0002')
    memberid: memberId,           // Backend expects 'memberid' (string ID like 'MEM-0001')
    sessiondate: item.date,       // Backend expects 'sessiondate' ('YYYY-MM-DD' string)
    sessiontime: item.time,       // Backend expects 'sessiontime' (string like '9:00 AM - 10:00 AM')
    membername: memberInfo?.name || 'Unknown'  // Backend expects 'membername'
  };

  const response = await fetch(`${API_URL}/api/enrollments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getAuth()?.token || ''}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: Enrollment failed`);
  }

  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Enrollment failed');

  return data;  // { success: true, data: { enrollment_id: "ENR-0003" }, remainingsessions: 5 } - Note: no underscore
}

// Main: Confirm all enrollments in cart (bulk via looping)
async function confirmAllEnrollments() {
  if (!enrollCart || enrollCart.length === 0) {
    showToast('No items in cart', 'warning');
    return;
  }

  showLoadingState(true);

  try {
    const totalItems = enrollCart.length;
    const projectedRemaining = realRemainingSessions - totalItems;
    if (projectedRemaining < 0) {
      showToast(`Not enough sessions: Need ${totalItems}, have ${realRemainingSessions}`, 'error');
      return;
    }

    // Sequential loop: Process one-by-one to avoid backend race on remainingSessions deduction
    let successful = 0;
    let failures = [];
    let lastRemaining = realRemainingSessions;

    for (let index = 0; index < enrollCart.length; index++) {
      const item = enrollCart[index];
      try {
        const result = await enrollSingleItem(item);
        console.log(`Enrollment ${index + 1} success: ${result.data.enrollment_id || 'ENR-XXXX'}, remainingsessions: ${result.remainingSessions}`);
        successful++;
        lastRemaining = result.remainingsessions || lastRemaining - 1;  // Update from backend response (no underscore)
      } catch (error) {
        console.error(`Enrollment ${index + 1} failed:`, error.message, item);
        failures.push({ index, item, error: error.message });
      }
    }

    tempRemainingSessions = lastRemaining - (totalItems - successful);

    if (successful === totalItems) {
      enrollCart = [];  // Clear cart on full success
      updateCartDisplay();
      showToast(`All ${totalItems} enrollments successful! Sessions left: ${tempRemainingSessions}`, 'success');
      await loadMemberEnrollments();  // Refetch to sync real data
      updateSessionCounter(false, 0);
    } else if (successful > 0) {
      // Partial success: Remove only successful items from cart
      const successIndices = [];
      for (let i = 0; i < totalItems; i++) {
        if (!failures.find(f => f.index === i)) successIndices.push(i);
      }
      successIndices.reverse().forEach(idx => enrollCart.splice(idx, 1));
      updateCartDisplay();
      const errorMsg = failures.map(f => `Item ${f.index + 1} (${f.item.className || f.item.classId}): ${f.error}`).join('\n');
      showToast(`${successful}/${totalItems} successful (cart updated). Errors:\n${errorMsg}`, 'partial');  // Or 'warning'
    } else {
      const errorMsg = failures.map(f => `Item ${f.index + 1} (${f.item.className || f.item.classId}): ${f.error}`).join('\n');
      showToast(`No enrollments successful. Errors:\n${errorMsg}`, 'error');
      updateCartDisplay();
    }

    console.log(`Bulk enrollment: ${successful}/${totalItems} success`, { successful, failures });

  } catch (error) {
    console.error('Bulk enrollment error:', error);
    showToast(`Bulk enrollment failed: ${error.message}`, 'error');
  } finally {
    showLoadingState(false);
  }
}

async function loadMemberEnrollments() {
  const memberId = memberIdFromAuth();
  if (!memberId) return;
  try {
    const [enrollmentsData, memberData] = await Promise.all([
      timedFetch(`${API_URL}/api/enrollments/member/${encodeURIComponent(memberId)}`, 'Reload Enrollments').then(r => r.json()),
      timedFetch(`${API_URL}/api/members/${encodeURIComponent(memberId)}`, 'Reload Member').then(r => r.json())
    ]);
    // Backend returns enrollments with keys like classid, memberid (no underscores)
    memberEnrollments = Array.isArray(enrollmentsData?.data) ? enrollmentsData.data : (Array.isArray(enrollmentsData) ? enrollmentsData : []);
    memberInfo = (memberData && memberData.success && memberData.data) ? memberData.data : memberData || null;
    updateSessionCounter(false, 0);
  } catch (err) {
    console.error('Reload failed:', err);
    showToast('Failed to reload data', 'error');
  }
}

function removeFromCart(index) {
  if (index < 0 || index >= enrollCart.length) return;

  enrollCart.splice(index, 1);
  updateCartDisplay();

  updateSessionCounter(true, 1);

  console.log('Removed from cart. Projected sessions +1.');
  if (enrollCart.length === 0) {
    updateSessionCounter(false, 0);
  }
}

// ========== LIST VIEW ==========
function renderListView() {
  const container = document.getElementById('classesGrid');
  if (!container || availableClasses.length === 0) {
    container.innerHTML = `
      <div class="column is-full">
        <div class="has-text-centered py-6">
          <p class="is-size-5 has-text-grey">No classes available</p>
        </div>
      </div>
    `;
    return;
  }
  let html = `<div class="columns is-multiline">`;
  availableClasses.forEach(cls => {
    const classId = cls.class_id || cls._id;
    const className = cls.class_name || 'Unnamed Class';
    const trainerName = cls.trainer_name || cls.trainer_id || 'TBD';
    const capacity = cls.capacity || 10;
    const currentEnrollment = cls.current_enrollment || 0;
    const isFull = currentEnrollment >= capacity;
    html += `
      <div class="column is-6-desktop is-12-mobile">
        <div class="class-card">
          <div class="card-content">
            <div class="class-header">
              <h3 class="class-title">${escapeHtml(className)}</h3>
              <div class="class-schedule">${escapeHtml(cls.schedule || 'Schedule TBD')}</div>
              <div class="class-trainer">Trainer: ${escapeHtml(trainerName)}</div>
              <div class="class-capacity">
                ${isFull ? '<span class="status-full">FULL</span>' :
                `<span class="status-open">${currentEnrollment}/${capacity} spots</span>`}
              </div>
            </div>
            <div class="class-description">
              <p>${escapeHtml(cls.description || 'No description available')}</p>
            </div>
            <div class="class-action">
              <button class="btn btn-primary" onclick="showClassForEnrollment('${classId}')"
                      ${isFull ? 'disabled' : ''}>
                ${isFull ? 'Class Full' : 'Enroll Now'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
}
function showClassForEnrollment(classId) {
  const cls = availableClasses.find(c => c.class_id === classId || c._id === classId);
  if (!cls) {
    alert('Class not found');
    return;
  }
  const timeSlots = generateTimeSlots(cls.schedule);
  let modalContent = `
    <div class="single-class-modal">
      <div class="modal-header">
        <h2>${escapeHtml(cls.class_name)}</h2>
        <div class="modal-date">${new Date().toLocaleDateString()}</div>
      </div>
      <div class="modal-body">
        <p><strong>Trainer:</strong> ${escapeHtml(cls.trainer_name || cls.trainer_id || 'TBD')}</p>
        <p><strong>Schedule:</strong> ${escapeHtml(cls.schedule || 'Schedule TBD')}</p>
        <p><strong>Description:</strong> ${escapeHtml(cls.description || 'No description')}</p>
        <div class="time-selection">
          <h4>Select Date and Time</h4>
          <input type="date" id="enrollDatePicker" value="${new Date().toISOString().split('T')[0]}"
                 class="date-picker">
          <div class="time-slots">
  `;
  timeSlots.forEach(timeSlot => {
    modalContent += `
      <button class="time-slot-btn" data-class="${classId}" data-date="${new Date().toISOString().split('T')[0]}"
              data-time="${timeSlot}">
        ${timeSlot}
      </button>
    `;
  });
  modalContent += `
          </div>
          <div class="modal-actions">
            <button class="btn btn-primary" onclick="addSingleEnrollment('${classId}', '${escapeHtml(cls.class_name)}')">
              Add to Cart
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  let modal = document.getElementById('singleClassModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'singleClassModal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-container">
        ${modalContent}
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  const datePicker = document.getElementById('enrollDatePicker');
  if (datePicker) {
    datePicker.addEventListener('change', function () {
      const timeBtns = modal.querySelectorAll('.time-slot-btn');
      timeBtns.forEach(btn => {
        btn.dataset.date = this.value;
      });
    });
  }
  const timeSlotBtns = modal.querySelectorAll('.time-slot-btn');
  timeSlotBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      timeSlotBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const classIdVal = this.dataset.class;
      const dateVal = this.dataset.date;
      const timeVal = this.dataset.time;
      addToEnrollmentCart(classIdVal, dateVal, timeVal, cls.class_name);
      modal.style.display = 'none';
    });
  });
}

// ========== MODAL CLOSE ==========
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
}
function addSingleEnrollment(classId, className) {
  const date = $('enrollDatePicker')?.value || new Date().toISOString().split('T')[0];
  const timeSlot = document.querySelector('.time-slot-btn.active')?.dataset.time || 'N/A';
  addToEnrollmentCart(classId, date, timeSlot, className);
}

// ========== EVENTS ==========
function setupEventListeners() {
  const calendarTab = document.getElementById('tabCalendar');
  const listTab = document.getElementById('tabList');
  const confirmBtn = $('confirmCartBtn');
  if (calendarTab) {
    calendarTab.addEventListener('click', () => switchView('calendar'));
  }
  if (listTab) {
    listTab.addEventListener('click', () => switchView('list'));
  }
  if (confirmBtn) {
    confirmBtn.addEventListener('click', confirmAllEnrollments);
  }
  document.addEventListener('click', function (e) {
    if (e.target.classList.contains('modal-overlay')) {
      closeModal('dayModal');
      closeModal('timeModal');
      closeModal('singleClassModal');
    }
  });
}
function switchView(view) {
  const calendarView = document.getElementById('calendarView');
  const listView = document.getElementById('listView');
  if (view === 'calendar') {
    calendarView.style.display = 'block';
    listView.style.display = 'none';
    document.getElementById('tabCalendar').classList.add('active');
    document.getElementById('tabList').classList.remove('active');
    renderCalendarGrid();
  } else {
    calendarView.style.display = 'none';
    listView.style.display = 'block';
    document.getElementById('tabList').classList.add('active');
    document.getElementById('tabCalendar').classList.remove('active');
    renderListView();
  }
}
function previousMonth() {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
  renderCalendarGrid();
}
function nextMonth() {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
  renderCalendarGrid();
}

// ========== TIME SLOT FOR CLASS ==========
function generateTimeSlots(schedule) {
  const timeSlotRanges = [];
  if (typeof schedule === 'string') {
    const match = schedule.match(/(\d{1,2}:\d{2}\s?[AP]M)\s*-\s*(\d{1,2}:\d{2}\s?[AP]M)/i);
    if (match) {
      timeSlotRanges.push(`${match[1]} - ${match[2]}`);
      return timeSlotRanges;
    }
    const matches = schedule.match(/\d{1,2}:\d{2}\s?[AP]M/g);
    if (matches) return matches;
  }
  return ['03:00 PM - 04:00 PM'];
}
function updateCalendarTitle() {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[currentCalendarDate.getMonth()];
  const year = currentCalendarDate.getFullYear();
  const titleElement = document.getElementById('currentMonthDisplay');
  if (titleElement) {
    titleElement.textContent = `${monthName} ${year}`;
  }
}
