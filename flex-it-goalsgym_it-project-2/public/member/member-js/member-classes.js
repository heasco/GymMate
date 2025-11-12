// Server configuration
const SERVER_URL = 'http://localhost:8080';

// Global variables
let allEnrollments = [];
let classNameCache = {};
let pendingCancelId = null;
let pendingFeedback = { enrollmentId: null, classId: null, className: '', trainerId: null };
let currentMonthDate = new Date();

// DOM Ready
document.addEventListener('DOMContentLoaded', function() {
    initializePage();
    loadEnrollments();
    setupModalEvents();
    setupManualLogout(); // Add manual logout setup
});

// Initialize page
function initializePage() {
    // Set member name
    const memberName = localStorage.getItem('memberName') || 'Member';
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
    
    // Menu toggle functionality
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }
    
    // Session check
    const authUser = JSON.parse(localStorage.getItem('authUser'));
    if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
        localStorage.removeItem('authUser');
        window.location.href = 'file:///C:/Users/Admin/OneDrive/Desktop/ThesisPROJECT/flex-it-goalsgym_it-project-2/flex-it-goalsgym_it-project-2/public/member-login.html';
        return;
    }
    
    // Logout functionality
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            manualLogout();
        });
    }
    
    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && sidebar && !sidebar.contains(e.target) && menuToggle && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('collapsed');
        }
    });
}

// MANUAL LOGOUT FUNCTION - You can call this from anywhere
function manualLogout() {
    console.log("Manual logout triggered");
    
    // Clear all user data
    localStorage.removeItem('authUser');
    localStorage.removeItem('memberData');
    localStorage.removeItem('memberName');
    
    // Show confirmation message
    showToast('Logging out...', 'info');
    
    // Redirect to login page after short delay
    setTimeout(() => {
        window.location.href = 'file:///C:/Users/Admin/OneDrive/Desktop/ThesisPROJECT/flex-it-goalsgym_it-project-2/flex-it-goalsgym_it-project-2/public/member-login.html';;
    }, 1000);
}

// Setup manual logout triggers
function setupManualLogout() {
    // Add a manual logout button to the page (optional)
    addManualLogoutButton();
    
    // You can also call manualLogout() from browser console
    window.manualLogout = manualLogout;
    
    // Add keyboard shortcut (Ctrl + L for logout)
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            manualLogout();
        }
    });
}

// Add a manual logout button to the page (for testing)
function addManualLogoutButton() {
    // Create manual logout button
    const manualLogoutBtn = document.createElement('button');
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
    
    // Add to page
    document.body.appendChild(manualLogoutBtn);
}

// Quick manual logout function you can call from browser console
function quickLogout() {
    console.log('🚪 Quick logout triggered!');
    localStorage.clear();
    window.location.href = 'file:///C:/Users/Admin/OneDrive/Desktop/ThesisPROJECT/flex-it-goalsgym_it-project-2/flex-it-goalsgym_it-project-2/public/member-login.html';;
}

// Make it available globally
window.quickLogout = quickLogout;

// Setup calendar tabs
function setupCalendarTabs() {
    const tabs = document.querySelectorAll('.view-tab');
    const datePicker = document.getElementById('calendarDate');
    
    // Set today's date
    const today = new Date();
    datePicker.value = today.toISOString().split('T')[0];
    
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            // Add active class to clicked tab
            this.classList.add('active');
            
            // Handle different views
            const view = this.dataset.view;
            switchCalendarView(view);
        });
    });
    
    // Setup date picker
    datePicker.addEventListener('change', function() {
        const activeTab = document.querySelector('.view-tab.active');
        if (activeTab) {
            switchCalendarView(activeTab.dataset.view);
        }
    });
    
    // Initialize with monthly view
    switchCalendarView('month');
}

// Load enrollments
async function loadEnrollments() {
    const memberId = getMemberIdFromAuth();
    if (!memberId) {
        window.location.href = 'file:///C:/Users/Admin/OneDrive/Desktop/ThesisPROJECT/flex-it-goalsgym_it-project-2/flex-it-goalsgym_it-project-2/public/member-login.html';
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
        const response = await fetch(`${SERVER_URL}/api/enrollments/member/${encodeURIComponent(memberId)}`);
        if (!response.ok) throw new Error('Failed to load enrollments');

        const data = await response.json();
        allEnrollments = data.data || [];

        if (allEnrollments.length === 0) {
            loadingElement.textContent = 'You have no upcoming enrollments.';
            await renderRemainingSessions();
            switchCalendarView('month');
            return;
        }

        // Pre-fetch all class names for better performance
        const uniqueClassIds = [...new Set(allEnrollments.map(enrollment => 
            typeof enrollment.class_id === 'string' ? enrollment.class_id : (enrollment.class_id?._id || enrollment.class_id)
        ).filter(id => id))];

        const classNamePromises = uniqueClassIds.map(classId => getClassNameById(classId));
        await Promise.all(classNamePromises);

        loadingElement.style.display = 'none';

        // Render enrollment rows
        const renderPromises = allEnrollments.map(async (enrollment) => {
            const className = await getClassName(enrollment);
            const day = enrollment.session_day || '';
            const date = enrollment.session_date ? new Date(enrollment.session_date).toLocaleDateString() : 
                        (enrollment.enrollment_date ? new Date(enrollment.enrollment_date).toLocaleDateString() : '');
            const time = enrollment.session_time || '';
            const status = enrollment.attendance_status || enrollment.status || 'scheduled';
            const statusInfo = getStatusClass(status);

            const classIdStr = typeof enrollment.class_id === 'string' ? enrollment.class_id : 
                              (enrollment.class_id?._id || enrollment.class_id);

            let cancelButton = '';
            if (status === 'scheduled' || status === 'active') {
                cancelButton = `<button class="btn btn-danger" data-id="${enrollment._id || enrollment.enrollment_id}" onclick="openCancelModal(event)">Cancel</button>`;
            } else {
                cancelButton = `<button class="btn" disabled>Cancel</button>`;
            }

            let feedbackButton = '';
            if (status === 'attended' || status === 'completed') {
                feedbackButton = `<button class="btn btn-primary" data-en="${enrollment._id || enrollment.enrollment_id}" data-cl="${classIdStr || ''}" data-name="${escapeHtml(className)}" onclick="openFeedbackModal(event)">Send Feedback</button>`;
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
        errorElement.textContent = error.message || 'Error loading enrollments';
        errorElement.style.display = 'block';
        loadingElement.style.display = 'none';
    }

    await renderRemainingSessions();
    switchCalendarView('month');
}


// Get member ID from auth
function getMemberIdFromAuth() {
    try {
        const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
        if (!authUser) return null;
        
        const user = authUser.user || authUser;  // ✅ FIXED: Support both old and new login structure
        return user.memberId || user.member_id || user._id || user.id || null;
    } catch (error) {
        console.error('Error getting member ID:', error);
        return null;
    }
}


// Status helper function
function getStatusClass(status) {
    const statusMap = {
        'attended': { class: 'status-attended', label: 'Attended' },
        'active': { class: 'status-active', label: 'Active' },
        'scheduled': { class: 'status-active', label: 'Scheduled' },
        'missed': { class: 'status-missed', label: 'Missed' },
        'cancelled': { class: 'status-cancelled', label: 'Cancelled' },
        'completed': { class: 'status-completed', label: 'Completed' }
    };
    return statusMap[status.toLowerCase()] || { class: 'status-active', label: 'Unknown' };
}

// Class name helper functions
async function getClassNameById(classId) {
    if (classNameCache[classId]) {
        return classNameCache[classId];
    }
    
    try {
        const response = await fetch(`${SERVER_URL}/api/classes/${encodeURIComponent(classId)}`);
        if (response.ok) {
            const data = await response.json();
            const className = data.data?.class_name || classId;
            classNameCache[classId] = className;
            return className;
        }
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
        const classIdStr = typeof enrollment.class_id === 'string' ? enrollment.class_id : (enrollment.class_id?._id || enrollment.class_id);
        return getClassNameById(classIdStr);
    }
    
    return 'Unnamed Class';
}

// Render remaining sessions
async function renderRemainingSessions() {
    const memberId = getMemberIdFromAuth();
    const remainingSessionsElement = document.getElementById('remainingSessions');
    const membershipInfoElement = document.getElementById('membershipInfo');

    if (!memberId) {
        remainingSessionsElement.textContent = '—';
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}/api/members/${encodeURIComponent(memberId)}`);
        if (response.ok) {
            const data = await response.json();
            const member = data.data;
            const memberships = member.memberships || [];

            let combativeSessions = '—';
            let membershipText = 'No active membership';

            memberships.forEach(membership => {
                if ((membership.type || '').toLowerCase().includes('combative')) {
                    if (membership.remainingSessions !== undefined && membership.remainingSessions !== null) {
                        combativeSessions = parseInt(membership.remainingSessions);
                    } else if (membership.remaining !== undefined && membership.remaining !== null) {
                        combativeSessions = parseInt(membership.remaining);
                    }
                    membershipText = `${membership.type} Membership`;
                }
            });

            remainingSessionsElement.textContent = combativeSessions !== '—' ? combativeSessions : '0';
            membershipInfoElement.textContent = membershipText;
        }
    } catch (error) {
        console.error('Error loading remaining sessions:', error);
        remainingSessionsElement.textContent = '—';
        membershipInfoElement.textContent = 'Error loading membership info';
    }
}

// Calendar view functions
function switchCalendarView(view) {
    const calendarContainer = document.getElementById('calendarContainer');
    
    calendarContainer.innerHTML = '<div class="loading-state">Loading ' + view + ' view...</div>';
    
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
    const todayEnrollments = allEnrollments.filter(enrollment => {
        const enrollmentDate = new Date(enrollment.session_date);
        return enrollmentDate.toDateString() === today.toDateString();
    });

    let html = `
        <div class="today-view">
            <div class="today-header">
                <h4>Today's Classes</h4>
                <div class="today-date">${today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
            <div class="today-classes">
    `;

    if (todayEnrollments.length === 0) {
        html += '<div class="no-classes">No classes scheduled for today</div>';
    } else {
        // Sort by time
        todayEnrollments.sort((a, b) => {
            const timeA = a.session_time || '00:00';
            const timeB = b.session_time || '00:00';
            return timeA.localeCompare(timeB);
        });

        todayEnrollments.forEach(enrollment => {
            const className = classNameCache[typeof enrollment.class_id === 'string' ? enrollment.class_id : (enrollment.class_id?._id || enrollment.class_id)] || getClassName(enrollment);
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
    
    // Get start of week (Sunday)
    const startOfWeek = new Date(selectedDate);
    startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay());
    
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    let html = `
        <div class="week-view">
            <div class="week-header">
    `;
    
    // Generate week header
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
    
    // Generate week grid with time slots
    const timeSlots = [
        '6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM',
        '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM'
    ];
    
    timeSlots.forEach(time => {
        html += `<div class="time-slot">${time}</div>`;
        
        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(startOfWeek);
            currentDay.setDate(startOfWeek.getDate() + i);
            const dateStr = currentDay.toISOString().split('T')[0];
            
            const dayEnrollments = allEnrollments.filter(enrollment => {
                const enrollmentDate = new Date(enrollment.session_date);
                return enrollmentDate.toISOString().split('T')[0] === dateStr && 
                       enrollment.session_time === time;
            });
            
            const hasClass = dayEnrollments.length > 0;
            
            html += `
                <div class="week-cell ${hasClass ? 'has-class' : ''}">
                    ${hasClass ? 
                        dayEnrollments.map(enrollment => {
                            const className = classNameCache[typeof enrollment.class_id === 'string' ? enrollment.class_id : (enrollment.class_id?._id || enrollment.class_id)] || getClassName(enrollment);
                            const status = enrollment.attendance_status || enrollment.status || 'scheduled';
                            const statusInfo = getStatusClass(status);
                            return `
                                <div class="week-event">
                                    <strong>${className}</strong>
                                    <small>${statusInfo.label}</small>
                                </div>
                            `;
                        }).join('') 
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
  
  // ✅ Use global currentMonthDate instead of date picker
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const today = new Date();
  
  // Get first day of month and last day of month
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDay = firstDay.getDay(); // 0=Sunday, 1=Monday, etc.
  
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
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
  
  // Generate day headers (Sun, Mon, Tue, etc.) - IN A ROW
  dayNames.forEach(day => {
    html += `<div class="calendar-header-day">${day}</div>`;
  });
  
  // Generate empty cells for days before the first day of the month
  for (let i = 0; i < startingDay; i++) {
    html += `<div class="calendar-day empty"></div>`;
  }
  
  // Generate days of the month - IN A GRID
  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(year, month, day);
    const isToday = currentDate.toDateString() === today.toDateString();
    const dateStr = currentDate.toISOString().split('T')[0];
    
    const dayEnrollments = allEnrollments.filter(enrollment => {
      if (!enrollment.session_date) return false;
      const enrollmentDate = new Date(enrollment.session_date);
      return enrollmentDate.toISOString().split('T')[0] === dateStr;
    });
    
    html += `<div class="calendar-day${isToday ? ' today' : ''}">
      <span class="calendar-day-number">${day}</span>
      <div class="calendar-day-classes">`;
    
    if (dayEnrollments.length > 0) {
      // Show up to 3 classes to avoid overflow
      dayEnrollments.slice(0, 3).forEach(enrollment => {
        const className = classNameCache[typeof enrollment.class_id === 'string' ? enrollment.class_id : enrollment.class_id?.id || enrollment.class_id] || getClassName(enrollment);
        const status = enrollment.attendance_status || enrollment.status || 'scheduled';
        const statusInfo = getStatusClass(status);
        const shortName = className.length > 12 ? className.substring(0, 12) + '...' : className;
        
        html += `<div class="calendar-class" title="${className} - ${statusInfo.label}">
          <span>${shortName}</span>
          <span class="calendar-status ${statusInfo.class}">${statusInfo.label.charAt(0)}</span>
        </div>`;
      });
      
      // Show "+X more" if there are more classes
      if (dayEnrollments.length > 3) {
        html += `<div class="calendar-class">+${dayEnrollments.length - 3} more</div>`;
      }
    }
    
    html += `</div></div>`;
  }
  
  // Calculate how many empty cells we need at the end to complete the grid (6 rows × 7 columns = 42 cells)
  const totalCells = 42;
  const usedCells = startingDay + daysInMonth;
  const remainingCells = totalCells - usedCells;
  
  for (let i = 0; i < remainingCells; i++) {
    html += `<div class="calendar-day empty"></div>`;
  }
  
  html += `</div></div>`; // Close calendar-grid and month-view
  
  calendarContainer.innerHTML = html;
  
  // ✅ Add month navigation event listeners
  const prevMonthBtn = document.getElementById('prevMonth');
  const nextMonthBtn = document.getElementById('nextMonth');
  
  if (prevMonthBtn) {
    prevMonthBtn.addEventListener('click', () => {
      currentMonthDate.setMonth(currentMonthDate.getMonth() - 1);
      generateMonthView();
    });
  }
  
  if (nextMonthBtn) {
    nextMonthBtn.addEventListener('click', () => {
      currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
      generateMonthView();
    });
  }
}


// Modal functions
function setupModalEvents() {
    // Cancel modal buttons
    document.getElementById('cancelNo').addEventListener('click', () => {
        closeModal('cancelModal');
    });
    
    document.getElementById('cancelYes').addEventListener('click', async () => {
        const id = pendingCancelId;
        if (!id) return;
        closeModal('cancelModal');
        await performCancel(id);
    });
    
    // Feedback modal buttons
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
            const response = await fetch(`${SERVER_URL}/api/classes/${encodeURIComponent(classId)}`);
            if (response.ok) {
                const data = await response.json();
                trainerId = data.data?.trainer_id || null;
            }
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
            comment: comment || ''
        };
        
        const response = await fetch(`${SERVER_URL}/api/feedbacks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
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
        const response = await fetch(`${SERVER_URL}/api/enrollments/${encodeURIComponent(enrollmentId)}/cancel`, {
            method: 'PUT'
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || data.message || 'Failed to cancel enrollment');
        }
        
        showToast('Enrollment cancelled successfully!', 'success');
        await loadEnrollments(); // Reload to reflect changes
        
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
    // Create toast container if it doesn't exist
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
    
    // Create toast element
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
    
    // Set background color based on type
    const colors = {
        success: 'linear-gradient(135deg, #28a745, #20c997)',
        error: 'linear-gradient(135deg, #dc3545, #e83e8c)',
        warning: 'linear-gradient(135deg, #ffc107, #fd7e14)',
        info: 'linear-gradient(135deg, var(--primary), var(--highlight))'
    };
    
    toast.style.background = colors[type] || colors.info;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    // Remove toast after 5 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}

// Add CSS for toast animations
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