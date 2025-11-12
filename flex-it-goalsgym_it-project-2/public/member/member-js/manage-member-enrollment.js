const API_URL = 'http://localhost:8080';
const $ = (id) => document.getElementById(id);

console.log('=== manage-member-enrollment.js loaded successfully ===');

// ========== AUTH & MEMBER ID UTILS ==========
function getAuth() {
  try { return JSON.parse(localStorage.getItem('authUser') || 'null'); } catch { return null; }
}

function memberIdFromAuth() {
    const a = getAuth();
    if (!a) return null;
    const u = a.user || a; 
    return u.memberId || u.member_id || u._id || u.id || null;
}


function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Helper function to get today's date in YYYY-MM-DD format
function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


// ========== MAIN GLOBALS ==========
let availableClasses = [];
let memberEnrollments = [];
let memberInfo = null;
let realRemainingSessions = 0;
let enrollCart = [];
let currentCalendarDate = new Date();
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
  const className = type === 'error' ? 'ERROR' : type === 'success' ? 'SUCCESS' : 'INFO';
  alert(`${className}: ${message}`);
  console.log(`${type.toUpperCase()}: ${message}`);
}

function showLoadingState(show = true) {
  const btn = $('confirmCartBtn');
  if (btn) btn.disabled = show;
}

// ========== DOM READY ==========
document.addEventListener('DOMContentLoaded', async () => {
  console.log('=== DOM Content Loaded ===');
  
const auth = getAuth();
console.log('Auth check:', auth ? 'Authenticated' : 'Not authenticated');


if (!auth || auth.role !== 'member') {
    console.warn('Authentication failed, redirecting to login');
    window.location.href = "../member-login.html";
    return;
}
  
  showLoadingState(true);
  await loadInitialData();
  setupEventListeners();
  initializeCalendarView();
  renderListView();
  switchView('calendar');
  ensureCartVisible();
  showLoadingState(false);
  
  console.log('=== Initialization complete ===');
});

// ========== DATA LOAD & SESSION CALC ==========
async function loadInitialData() {
  try {
    console.log('Loading initial data...');
    
    const memberId = memberIdFromAuth();
    if (!memberId) throw new Error('No member ID in auth');
    
    console.log('Member ID:', memberId);

    const memberPromise = timedFetch(`${API_URL}/api/members/${encodeURIComponent(memberId)}`, 'Member API').then(r => r.json());
    const classesPromise = timedFetch(`${API_URL}/api/classes`, 'Classes API').then(r => r.json());
    const enrollmentsPromise = timedFetch(`${API_URL}/api/enrollments/member/${encodeURIComponent(memberId)}`, 'Enrollments API').then(r => r.json());

    const [memberData, classesData, enrollmentsData] = await Promise.all([
      memberPromise.catch(err => { console.error('Member load failed:', err); return { success: false, data: null }; }),
      classesPromise.catch(err => { console.error('Classes load failed:', err); return { success: false, data: [] }; }),
      enrollmentsPromise.catch(err => { console.error('Enrollments load failed:', err); return { success: false, data: [] }; })
    ]);

    console.log('Raw Member Response:', memberData);
    memberInfo = (memberData && memberData.success && memberData.data) ? memberData.data : memberData || null;
    console.log('Parsed memberInfo:', { hasMemberships: !!memberInfo?.memberships, membershipsLength: memberInfo?.memberships?.length });

    availableClasses = Array.isArray(classesData?.data) ? classesData.data : (Array.isArray(classesData) ? classesData : []);
    memberEnrollments = Array.isArray(enrollmentsData?.data) ? enrollmentsData.data : (Array.isArray(enrollmentsData) ? enrollmentsData : []);

    console.log('Classes loaded:', availableClasses.length);
    console.log('Enrollments loaded:', memberEnrollments.length);

    updateSessionCounter(false, 0);
    renderCalendarGrid();
    renderListView();
    updateCartDisplay();
  } catch (err) {
    console.error('loadInitialData Error:', err);
    showErrorState('Failed to load data. Check console and backend.');
  }
}

function ensureCartVisible() {
  const cartContainer = $('enrollmentCart');
  if (cartContainer) {
    cartContainer.style.display = 'block';
    console.log('Cart container made visible');
  } else {
    console.error('enrollmentCart element not found in HTML!');
  }
}

// ========== VIEW STATES & UTILS ==========
function showErrorState(msg = 'Failed to load classes.') {
  const c = $('calendarContainer');
  if (c) c.innerHTML = `<div class="error-state" style="padding: 2rem; text-align: center; color: #dc3545;">${msg}</div>`;
}

// ========== SESSION LOGIC ==========
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

  const combative = memberships
    .filter(m => m.type && m.type.toLowerCase() === 'combative' && (m.status || '').toLowerCase() === 'active')
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))[0];

  if (!combative) {
    if (remainingSessionSpan) remainingSessionSpan.textContent = '0';
    if (memInfoSpan) memInfoSpan.textContent = 'No active combative membership';
    realRemainingSessions = 0;
    tempRemainingSessions = 0;
    return;
  }

  realRemainingSessions = Math.max(0, combative.remainingSessions || 0);
  const totalSessionsPerMonth = combative.sessionsPerMonth || null;

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

  const confirmBtn = $('confirmCartBtn');
  if (confirmBtn) {
    const canConfirm = enrollCart.length > 0 && realRemainingSessions >= enrollCart.length;
    confirmBtn.disabled = !canConfirm;
    confirmBtn.textContent = enrollCart.length > 0 ? `Confirm All (${enrollCart.length})` : 'Confirm All Enrollments';
  }
  
  console.log('Session counter updated - Real:', realRemainingSessions, 'Temp:', tempRemainingSessions);
}

// ========== CALENDAR VIEW ==========
function initializeCalendarView() {
  renderCalendarGrid();
  renderCalendarNavigation();
  updateCalendarTitle();
}

function renderCalendarGrid() {
  const container = $('calendarContainer');
  if (!container) {
    console.error('calendarContainer not found');
    return;
  }
  
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  
  // Add aria-labels and titles to nav buttons so they are explicit and accessible
  let html = `<div class="calendar-header">
    <button class="calendar-nav-btn" id="prevMonth" aria-label="Previous month" title="Previous month">‹</button>
    <span id="currentMonthDisplay"></span>
    <button class="calendar-nav-btn" id="nextMonth" aria-label="Next month" title="Next month">›</button></div>
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
  const todayStr = getTodayDateString();
  const isToday = dateStr === todayStr;
  const isPast = dateStr < todayStr; 
  const dayClasses = getClassesForDate(dateStr);

    
    let classChips = '';
    if (dayClasses.length > 0) {
      classChips = dayClasses.slice(0, 2).map(cls => 
        `<div class="class-chip">${escapeHtml(cls.class_name || 'Class')}</div>`
      ).join('');
      if (dayClasses.length > 2) {
        classChips += `<div class="class-chip">+${dayClasses.length - 2} more</div>`;
      }
    }
    
    html += `<div class="calendar-cell${isToday ? ' calendar-cell-today' : ''}${isPast ? ' past-date' : ''}${dayClasses.length > 0 ? ' has-classes' : ''}" data-date="${dateStr}"${isPast ? ' style="pointer-events: none; opacity: 0.5; cursor: not-allowed;"' : ''}>
      <div class="calendar-day-number">${day}</div>
      <div class="calendar-day-content"><div class="calendar-day-classes">${classChips}</div></div></div>`;
    
    cellIndex++;
  }
  
  while (cellIndex % 7 !== 0) {
    html += `<div class="calendar-cell calendar-cell-empty"><div class="calendar-day-number"></div><div class="calendar-day-content"></div></div>`;
    cellIndex++;
  }
  
  html += '</div>';
  container.innerHTML = html;
  
  // ensure title is set immediately so month is always visible
  updateCalendarTitle();
  // ensure navigation buttons exist and have handlers
  renderCalendarNavigation();

  // rebind click handler for cells
  document.removeEventListener('click', handleCalendarClick, true);
  document.addEventListener('click', handleCalendarClick, true);
  
  console.log('Calendar rendered with', availableClasses.length, 'total classes');
}

function renderCalendarNavigation() {
  const prev = $('prevMonth');
  const next = $('nextMonth');
  if (prev) {
    prev.removeEventListener('click', previousMonth);
    prev.addEventListener('click', previousMonth);
  }
  if (next) {
    next.removeEventListener('click', nextMonth);
    next.addEventListener('click', nextMonth);
  }
}

function handleCalendarClick(event) {
  const cell = event.target.closest('.calendar-cell');
  if (!cell || cell.classList.contains('calendar-cell-empty')) return;
  
  const dateStr = cell.getAttribute('data-date');
  if (!dateStr) return;
  
  // ✅ Prevent clicking past dates
  const todayStr = getTodayDateString();
  if (dateStr < todayStr) {
    showToast('Cannot select past dates', 'error');
    return;
  }
}

function getClassesForDate(dateStr) {
  const date = new Date(dateStr);
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  
  const matchingClasses = availableClasses.filter(cls => {
    const schedule = (cls.schedule || '').toLowerCase();
    if (schedule.includes(dayName)) {
      return true;
    }
    const dayAbbr = dayName.substring(0, 3);
    if (schedule.includes(dayAbbr)) {
      return true;
    }
    return false;
  });
  
  return matchingClasses;
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
  const cls = availableClasses.find(c => c.class_id === classId || c._id === classId);
  if (!cls) {
    showToast('Class not found', 'error');
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
    const isEnrolled = memberEnrollments.some(enrollment => {
      const enDate = new Date(enrollment.sessiondate);
      return enrollment.classid === classId &&
        enDate.toISOString().split('T')[0] === dateStr &&
        enrollment.sessiontime === timeSlot;
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
  closeModal('singleClassModal');
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

  if (cartContainer) cartContainer.style.display = 'block';

  console.log('Cart Update:', enrollCart.length, 'items');

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
        <button type="button" class="cart-item-remove" onclick="removeFromCart(${index})" title="Remove">✕</button>
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

async function enrollSingleItem(item) {
  const memberId = memberIdFromAuth();
  if (!memberId) throw new Error('Not authenticated');

  const body = {
    class_id: item.classId,  
    member_id: memberId,            
    session_date: item.date,        
    session_time: item.time,         
    member_name: memberInfo?.name || 'Unknown'
  };

  console.log('Posting enrollment:', body);

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
  console.log('Enrollment response:', data);
  
  if (!data.success) throw new Error(data.error || 'Enrollment failed');

  return data;
}


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
      showLoadingState(false);
      return;
    }

    let successful = 0;
    let failures = [];
    let lastRemaining = realRemainingSessions;

    for (let index = 0; index < enrollCart.length; index++) {
      const item = enrollCart[index];
      try {
        const result = await enrollSingleItem(item);
        console.log(`Enrollment ${index + 1} success`);
        successful++;
        // ✅ BACKEND RETURNS remaining_sessions (WITH UNDERSCORE)
        lastRemaining = result.remaining_sessions || lastRemaining - 1;
      } catch (error) {
        console.error(`Enrollment ${index + 1} failed:`, error.message);
        failures.push({ index, item, error: error.message });
      }
    }

    tempRemainingSessions = lastRemaining;

    if (successful === totalItems) {
      enrollCart = [];
      updateCartDisplay();
      showToast(`All ${totalItems} enrollments successful! Sessions left: ${tempRemainingSessions}`, 'success');
      await loadMemberEnrollments();
      updateSessionCounter(false, 0);
    } else if (successful > 0) {
      const successIndices = [];
      for (let i = 0; i < totalItems; i++) {
        if (!failures.find(f => f.index === i)) successIndices.push(i);
      }
      successIndices.reverse().forEach(idx => enrollCart.splice(idx, 1));
      updateCartDisplay();
      const errorMsg = failures.map(f => `${f.item.className}: ${f.error}`).join('; ');
      showToast(`${successful}/${totalItems} successful. Errors: ${errorMsg}`, 'warning');
    } else {
      const errorMsg = failures.map(f => `${f.item.className}: ${f.error}`).join('; ');
      showToast(`No enrollments successful. Errors: ${errorMsg}`, 'error');
      updateCartDisplay();
    }

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

  console.log('Removed from cart');
  if (enrollCart.length === 0) {
    updateSessionCounter(false, 0);
  }
}

// ========== LIST VIEW ==========
function renderListView() {
  const container = $('classesGrid');
  if (!container || availableClasses.length === 0) {
    if (container) {
      container.innerHTML = `
        <div class="no-classes-message" style="padding: 2rem; text-align: center;">
          <p>No classes available</p>
        </div>
      `;
    }
    return;
  }
  
  let html = '<div class="classes-grid-container">';
  availableClasses.forEach(cls => {
    const classId = cls.class_id || cls._id;
    const className = cls.class_name || 'Unnamed Class';
    const trainerName = cls.trainer_name || cls.trainer_id || 'TBD';
    const capacity = cls.capacity || 10;
    const currentEnrollment = cls.current_enrollment || 0;
    const isFull = currentEnrollment >= capacity;
    
    html += `
      <div class="class-card">
        <div class="class-card-content">
          <h3 class="class-title">${escapeHtml(className)}</h3>
          <div class="class-schedule">${escapeHtml(cls.schedule || 'Schedule TBD')}</div>
          <div class="class-trainer">Trainer: ${escapeHtml(trainerName)}</div>
          <div class="class-capacity">
            ${isFull ? '<span class="status-full">FULL</span>' :
            `<span class="status-open">${currentEnrollment}/${capacity} spots</span>`}
          </div>
          <div class="class-description">
            <p>${escapeHtml(cls.description || 'No description available')}</p>
          </div>
          <button class="btn btn-primary class-enroll-btn" onclick="showClassForEnrollment('${classId}')"
                  ${isFull ? 'disabled' : ''}>
            ${isFull ? 'Class Full' : 'Enroll Now'}
          </button>
        </div>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

function showClassForEnrollment(classId) {
  const cls = availableClasses.find(c => c.class_id === classId || c._id === classId);
  if (!cls) {
    showToast('Class not found', 'error');
    return;
  }
  
  const timeSlots = generateTimeSlots(cls.schedule);
  const className = cls.class_name || 'Unnamed Class';
  
  let modalContent = `
    <div class="single-class-modal">
      <div class="modal-header">
        <h2>${escapeHtml(className)}</h2>
        <div class="modal-subheader">
          <p><strong>Trainer:</strong> ${escapeHtml(cls.trainer_name || cls.trainer_id || 'TBD')}</p>
          <p><strong>Schedule:</strong> ${escapeHtml(cls.schedule || 'Schedule TBD')}</p>
          <p><strong>Description:</strong> ${escapeHtml(cls.description || 'No description')}</p>
        </div>
      </div>
      <div class="modal-body">
        <div class="time-selection">
          <h4>Select Date and Time</h4>
          <label for="enrollDatePicker">Date:</label>
          <input type="date" id="enrollDatePicker" value="${getTodayDateString()}" min="${getTodayDateString()}" class="date-picker" style="width:100%;padding:0.5rem;margin-bottom:1rem;border:1px solid #ccc;border-radius:4px;">
                 class="date-picker" style="width: 100%; padding: 0.5rem; margin-bottom: 1rem; border: 1px solid #ccc; border-radius: 4px;">
          <label>Time Slot:</label>
          <div class="time-slots" style="margin-top: 0.5rem;">
  `;
  
  timeSlots.forEach(timeSlot => {
    modalContent += `
      <button class="time-slot-btn" data-class="${classId}" data-class-name="${escapeHtml(className)}" 
              data-date="${new Date().toISOString().split('T')[0]}" data-time="${timeSlot}"
              style="margin: 0.5rem; padding: 0.8rem 1.5rem; border: 2px solid #ccc; background: white; cursor: pointer; border-radius: 4px;">
        ${timeSlot}
      </button>
    `;
  });
  
  modalContent += `
          </div>
        </div>
      </div>
      <div class="modal-footer" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #ccc;">
        <button class="btn btn-ghost" onclick="closeModal('singleClassModal')" style="margin-right: 1rem;">Cancel</button>
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
    <div class="modal-overlay" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 9999;">
      <div class="modal-container" style="background: white; padding: 2rem; border-radius: 8px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto;">
        ${modalContent}
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  
const datePicker = document.getElementById('enrollDatePicker');
if (datePicker) {
  datePicker.addEventListener('change', function() {
    const inputValue = this.value;
    const minDate = getTodayDateString();
    
    // ✅ Validate past dates
    if (inputValue < minDate) {
      showToast('Cannot select past dates. Please choose today or a future date.', 'error');
      this.value = minDate;
      return;
    }
    
    const timeBtns = modal.querySelectorAll('.time-slot-btn');
    timeBtns.forEach(btn => {
      btn.dataset.date = this.value;
    });
    console.log('Date changed to:', this.value);
  });
}

  
  const timeSlotBtns = modal.querySelectorAll('.time-slot-btn');
  timeSlotBtns.forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      
      timeSlotBtns.forEach(b => {
        b.style.background = 'white';
        b.style.borderColor = '#ccc';
        b.style.color = '#000';
      });
      this.style.background = '#28a745';
      this.style.color = 'white';
      this.style.borderColor = '#28a745';
      
      const classIdVal = this.dataset.class;
      const classNameVal = this.dataset.className;
      const dateVal = this.dataset.date;
      const timeVal = this.dataset.time;
      
      console.log('Adding to cart:', { classIdVal, classNameVal, dateVal, timeVal });
      
      addToEnrollmentCart(classIdVal, dateVal, timeVal, classNameVal);
      
      setTimeout(() => {
        modal.style.display = 'none';
      }, 500);
    });
  });
  
  console.log('Modal opened for class:', className);
}

// ========== MODAL CLOSE ==========
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
}

// ========== EVENTS ==========
function setupEventListeners() {
  const calendarTab = $('tabCalendar');
  const listTab = $('tabList');
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
  const calendarView = $('calendarView');
  const listView = $('listView');
  const tabCalendar = $('tabCalendar');
  const tabList = $('tabList');
  
  if (view === 'calendar') {
    if (calendarView) calendarView.style.display = 'block';
    if (listView) listView.style.display = 'none';
    if (tabCalendar) tabCalendar.classList.add('active');
    if (tabList) tabList.classList.remove('active');
    renderCalendarGrid();
  } else {
    if (calendarView) calendarView.style.display = 'none';
    if (listView) listView.style.display = 'block';
    if (tabList) tabList.classList.add('active');
    if (tabCalendar) tabCalendar.classList.remove('active');
    renderListView();
  }
}

function previousMonth() {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
  renderCalendarGrid();
  updateCalendarTitle();
}

function nextMonth() {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
  renderCalendarGrid();
  updateCalendarTitle();
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
  const titleElement = $('currentMonthDisplay');
  if (titleElement) {
    titleElement.textContent = `${monthName} ${year}`;
  }
}
