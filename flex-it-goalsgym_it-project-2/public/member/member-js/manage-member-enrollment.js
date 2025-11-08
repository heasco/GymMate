// Server configuration
const SERVER_URL = 'http://localhost:8080';

// Global variables
let availableClasses = [];
let memberEnrollments = [];
let memberInfo = null;
let enrollCart = [];
let currentCalendarDate = new Date();
let realRemainingSessions = 0;
let tempRemainingSessions = 0;

// DOM Ready
document.addEventListener('DOMContentLoaded', function() {
    initializePage();
    setupEventListeners();
    loadInitialData();
});

// Initialize page
function initializePage() {
    // Set member name
    const memberName = localStorage.getItem('memberName') || 'Member';
    document.getElementById('memberName').textContent = memberName;
    
    // Setup sidebar and logout
    setupSidebarAndSession();
    
    // Initialize calendar
    renderCalendarGrid();
}

// Setup sidebar and session management
function setupSidebarAndSession() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    
    // Menu toggle functionality
    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
    
    // Session check
    const authUser = JSON.parse(localStorage.getItem('authUser'));
    if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
        localStorage.removeItem('authUser');
        window.location.href = '../member-login.html';
        return;
    }
    
    // Logout functionality
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authUser');
        localStorage.removeItem('memberData');
        window.location.href = '../member-login.html';
    });
    
    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('collapsed');
        }
    });
}

// Setup event listeners
function setupEventListeners() {
    // View tabs
    document.querySelectorAll('.view-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const view = this.dataset.view;
            switchView(view);
        });
    });
    
    // Calendar navigation
    document.getElementById('prevMonth').addEventListener('click', previousMonth);
    document.getElementById('nextMonth').addEventListener('click', nextMonth);
    
    // Confirm buttons
    document.getElementById('confirmCartBtn').addEventListener('click', confirmAllEnrollments);
    document.getElementById('confirmCartBtnCalendar').addEventListener('click', confirmAllEnrollments);
    
    // Search functionality
    document.getElementById('classSearch').addEventListener('input', filterClasses);
    
    // Close modals when clicking outside
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal-overlay')) {
            closeModal('dayModal');
            closeModal('timeModal');
            closeModal('singleClassModal');
        }
    });
}

// Load initial data
async function loadInitialData() {
    try {
        // Simulate API calls - replace with actual endpoints
        const memberId = 'current-member-id'; // Get from auth
        
        // Load member info
        const memberResponse = await fetch(`${SERVER_URL}/api/members/${memberId}`);
        const memberData = await memberResponse.json();
        memberInfo = memberData.data || memberData;
        
        // Load available classes
        const classesResponse = await fetch(`${SERVER_URL}/api/classes`);
        const classesData = await classesResponse.json();
        availableClasses = classesData.data || classesData;
        
        // Load member enrollments
        const enrollmentsResponse = await fetch(`${SERVER_URL}/api/enrollments/member/${memberId}`);
        const enrollmentsData = await enrollmentsResponse.json();
        memberEnrollments = enrollmentsData.data || enrollmentsData;
        
        // Update UI
        updateSessionCounter();
        renderCalendarGrid();
        renderListView();
        
    } catch (error) {
        console.error('Error loading data:', error);
        showToast('Failed to load data. Please try again.', 'error');
    }
}

// View switching
function switchView(view) {
    const calendarView = document.getElementById('calendarView');
    const listView = document.getElementById('listView');
    const tabs = document.querySelectorAll('.view-tab');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    
    if (view === 'calendar') {
        calendarView.style.display = 'block';
        listView.style.display = 'none';
        document.querySelector('[data-view="calendar"]').classList.add('active');
        renderCalendarGrid();
    } else {
        calendarView.style.display = 'none';
        listView.style.display = 'block';
        document.querySelector('[data-view="list"]').classList.add('active');
        renderListView();
    }
}

// Calendar functions
function renderCalendarGrid() {
    const container = document.getElementById('calendarContainer');
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const today = new Date();
    
    // Update month display
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('currentMonthDisplay').textContent = `${monthNames[month]} ${year}`;
    
    // Generate calendar HTML
    let html = `<div class="calendar-grid">`;
    
    // Day headers
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    dayNames.forEach(day => {
        html += `<div class="calendar-header-day">${day}</div>`;
    });
    
    // Get first day and number of days in month
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startingDay = firstDay.getDay();
    
    // Empty cells for days before the first day
    for (let i = 0; i < startingDay; i++) {
        html += `<div class="calendar-cell calendar-cell-empty"></div>`;
    }
    
    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = dateStr === today.toISOString().split('T')[0];
        const isPast = new Date(dateStr) < new Date(today.toISOString().split('T')[0]);
        const dayClasses = getClassesForDate(dateStr);
        
        html += `<div class="calendar-cell ${isToday ? 'calendar-cell-today' : ''} ${isPast ? 'calendar-cell-past' : ''}" 
                      data-date="${dateStr}" onclick="handleDateClick('${dateStr}')">`;
        html += `<div class="calendar-day-number">${day}</div>`;
        html += `<div class="calendar-day-classes">`;
        
        // Show up to 2 classes
        dayClasses.slice(0, 2).forEach(cls => {
            const className = cls.class_name || 'Class';
            html += `<div class="class-chip ${isPast ? 'past' : ''}">${className}</div>`;
        });
        
        // Show "+ more" if there are more classes
        if (dayClasses.length > 2) {
            html += `<div class="class-chip ${isPast ? 'past' : ''}">+${dayClasses.length - 2} more</div>`;
        }
        
        html += `</div></div>`;
    }
    
    // Fill remaining cells to complete the grid
    const totalCells = 42; // 6 rows × 7 columns
    const usedCells = startingDay + daysInMonth;
    for (let i = usedCells; i < totalCells; i++) {
        html += `<div class="calendar-cell calendar-cell-empty"></div>`;
    }
    
    html += `</div>`;
    container.innerHTML = html;
}

function handleDateClick(dateStr) {
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (date < today) {
        showToast('Cannot enroll in past dates', 'warning');
        return;
    }
    
    const dayClasses = getClassesForDate(dateStr);
    showDayModal(dateStr, dayClasses);
}

function getClassesForDate(dateStr) {
    // Filter classes that occur on this date
    return availableClasses.filter(cls => {
        // This is a simplified check - you'll need to implement proper schedule parsing
        const schedule = cls.schedule || '';
        return schedule.includes(dateStr) || !schedule; // Show all if no schedule specified
    });
}

function previousMonth() {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderCalendarGrid();
}

function nextMonth() {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderCalendarGrid();
}

// List view functions
function renderListView() {
    const container = document.getElementById('classesGrid');
    
    if (availableClasses.length === 0) {
        container.innerHTML = '<div class="no-classes">No classes available</div>';
        return;
    }
    
    let html = '';
    availableClasses.forEach(cls => {
        const isFull = (cls.current_enrollment || 0) >= (cls.capacity || 10);
        
        html += `
            <div class="class-card">
                <div class="class-header">
                    <div class="class-title">${cls.class_name || 'Unnamed Class'}</div>
                    <div class="class-trainer">Trainer: ${cls.trainer_name || 'TBD'}</div>
                    <div class="class-schedule">${cls.schedule || 'Schedule TBD'}</div>
                    <div class="class-capacity ${isFull ? 'status-full' : 'status-open'}">
                        ${isFull ? 'FULL' : `${cls.current_enrollment || 0}/${cls.capacity || 10} spots`}
                    </div>
                </div>
                <div class="class-description">
                    ${cls.description || 'No description available'}
                </div>
                <div class="class-action">
                    <button class="btn btn-primary" onclick="showClassEnrollment('${cls.class_id || cls._id}')" 
                            ${isFull ? 'disabled' : ''}>
                        ${isFull ? 'Class Full' : 'Enroll Now'}
                    </button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function filterClasses() {
    const searchTerm = document.getElementById('classSearch').value.toLowerCase();
    const classCards = document.querySelectorAll('.class-card');
    
    classCards.forEach(card => {
        const className = card.querySelector('.class-title').textContent.toLowerCase();
        const classTrainer = card.querySelector('.class-trainer').textContent.toLowerCase();
        const classDescription = card.querySelector('.class-description').textContent.toLowerCase();
        
        const matches = className.includes(searchTerm) || 
                       classTrainer.includes(searchTerm) || 
                       classDescription.includes(searchTerm);
        
        card.style.display = matches ? 'block' : 'none';
    });
}

function showClassEnrollment(classId) {
    const cls = availableClasses.find(c => c.class_id === classId || c._id === classId);
    if (!cls) return;
    
    // For simplicity, using current date - you might want a date picker
    const dateStr = new Date().toISOString().split('T')[0];
    addToEnrollmentCart(classId, dateStr, 'Default Time', cls.class_name);
}

// Modal functions
function showDayModal(dateStr, classes) {
    const date = new Date(dateStr);
    const formattedDate = date.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    
    document.getElementById('dayModalTitle').textContent = `Classes for ${formattedDate}`;
    document.getElementById('modalDateDisplay').textContent = formattedDate;
    document.getElementById('modalSessionsRemaining').textContent = tempRemainingSessions;
    
    let content = '';
    
    if (classes.length === 0) {
        content = '<div class="no-classes">No classes scheduled for this date</div>';
    } else {
        classes.forEach(cls => {
            const isPast = new Date(dateStr) < new Date();
            content += `
                <div class="class-selection">
                    <div class="class-info">
                        <div class="class-name">${cls.class_name || 'Unnamed Class'}</div>
                        <div class="class-trainer">Trainer: ${cls.trainer_name || 'TBD'}</div>
                        <div class="class-schedule">${cls.schedule || 'Schedule TBD'}</div>
                    </div>
                    <div class="class-times">
                        <button class="select-time-btn" onclick="showTimeSelection('${cls.class_id || cls._id}', '${cls.class_name}', '${dateStr}')" 
                                ${isPast ? 'disabled' : ''}>
                            ${isPast ? 'Date Passed' : 'Select Time'}
                        </button>
                    </div>
                </div>
            `;
        });
    }
    
    document.getElementById('dayModalContent').innerHTML = content;
    document.getElementById('dayModal').style.display = 'flex';
}

function showTimeSelection(classId, className, dateStr) {
    document.getElementById('timeModalTitle').textContent = `Select Time for ${className}`;
    
    // Generate time slots - you might want to get these from the class schedule
    const timeSlots = ['06:00 AM', '08:00 AM', '10:00 AM', '12:00 PM', '02:00 PM', '04:00 PM', '06:00 PM'];
    
    let content = '';
    timeSlots.forEach(time => {
        const isEnrolled = memberEnrollments.some(enrollment => 
            enrollment.classid === classId && 
            enrollment.sessiondate === dateStr && 
            enrollment.sessiontime === time
        );
        
        content += `
            <div class="time-slot-item ${isEnrolled ? 'disabled' : ''}">
                <div class="time-slot-label">${time}</div>
                <button class="select-enrollment-btn" 
                        onclick="addToEnrollmentCart('${classId}', '${dateStr}', '${time}', '${className}')"
                        ${isEnrolled ? 'disabled' : ''}>
                    ${isEnrolled ? 'Already Enrolled' : 'Add to Cart'}
                </button>
            </div>
        `;
    });
    
    document.getElementById('timeModalContent').innerHTML = content;
    document.getElementById('timeModal').style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Enrollment cart functions
function addToEnrollmentCart(classId, dateStr, timeSlot, className) {
    // Check if already in cart
    const existing = enrollCart.find(item => 
        item.classId === classId && 
        item.date === dateStr && 
        item.time === timeSlot
    );
    
    if (existing) {
        showToast('This class is already in your cart', 'warning');
        return;
    }
    
    // Check if date is in past
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (date < today) {
        showToast('Cannot enroll in past dates', 'error');
        return;
    }
    
    // Add to cart
    enrollCart.push({
        classId: classId,
        className: className,
        date: dateStr,
        time: timeSlot
    });
    
    updateCartDisplay();
    closeModal('timeModal');
    showToast('Added to enrollment cart', 'success');
}

function updateCartDisplay() {
    // Update both cart displays
    updateSingleCartDisplay('cartContent', 'confirmCartBtn');
    updateSingleCartDisplay('cartContentCalendar', 'confirmCartBtnCalendar');
    
    // Update session counter
    updateSessionCounter();
}

function updateSingleCartDisplay(contentId, buttonId) {
    const content = document.getElementById(contentId);
    const button = document.getElementById(buttonId);
    
    if (enrollCart.length === 0) {
        content.innerHTML = '<p>No classes selected yet</p>';
        button.disabled = true;
        button.textContent = 'Confirm All Enrollments';
        return;
    }
    
    let html = '';
    enrollCart.forEach((item, index) => {
        const date = new Date(item.date);
        const formattedDate = date.toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
        
        html += `
            <div class="cart-item">
                <div class="cart-item-info">
                    <strong>${item.className}</strong>
                    <small>${formattedDate} at ${item.time}</small>
                </div>
                <button class="cart-item-remove" onclick="removeFromCart(${index})">✕</button>
            </div>
        `;
    });
    
    content.innerHTML = html;
    button.disabled = enrollCart.length === 0;
    button.textContent = `Confirm All Enrollments (${enrollCart.length})`;
}

function removeFromCart(index) {
    if (index >= 0 && index < enrollCart.length) {
        enrollCart.splice(index, 1);
        updateCartDisplay();
        showToast('Removed from cart', 'info');
    }
}

function updateSessionCounter() {
    // This is a simplified version - you'll need to implement proper session counting
    const remainingSpan = document.getElementById('remainingSessions');
    const membershipInfo = document.getElementById('membershipInfo');
    
    // Simulate session counting
    const totalSessions = 10; // This should come from member's membership
    const usedSessions = memberEnrollments.length;
    realRemainingSessions = Math.max(0, totalSessions - usedSessions - enrollCart.length);
    tempRemainingSessions = realRemainingSessions;
    
    remainingSpan.textContent = realRemainingSessions;
    membershipInfo.textContent = `Premium Membership - ${usedSessions + enrollCart.length} sessions used this month`;
}

async function confirmAllEnrollments() {
    if (enrollCart.length === 0) {
        showToast('No classes to enroll in', 'warning');
        return;
    }
    
    try {
        // Simulate API calls for enrollment
        for (const item of enrollCart) {
            // Replace with actual enrollment API call
            console.log('Enrolling in:', item);
            await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API delay
        }
        
        showToast(`Successfully enrolled in ${enrollCart.length} classes!`, 'success');
        enrollCart = [];
        updateCartDisplay();
        
        // Reload data to reflect new enrollments
        await loadInitialData();
        
    } catch (error) {
        console.error('Enrollment error:', error);
        showToast('Failed to complete enrollments. Please try again.', 'error');
    }
}

// Utility functions
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