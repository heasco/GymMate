// Utility for authenticated API calls (adds security header for /api/ routes) with timeout - Handles full URLs, GET/PUT
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log('apiFetch called for:', endpoint, 'method:', options.method || 'GET');  // DEBUG (remove in production if needed)
  const token = sessionStorage.getItem('token');
  if (!token) {
    console.log('No token - redirecting to login');  // DEBUG
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../trainer-login.html';
    return;
  }

  // Use endpoint directly if it's already a full URL; otherwise prepend base
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? `http://localhost:8080${endpoint}`
      : endpoint;
  }

  const headers = { 
    ...options.headers, 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json' // Default for JSON calls
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 401) {
      console.log('401 Unauthorized - clearing auth and redirecting');  // DEBUG
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
      window.location.href = '../trainer-login.html';
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
  console.log('Auth check starting for trainer-schedule');  // DEBUG
  const authUser = JSON.parse(sessionStorage.getItem('authUser') || 'null'); 
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  
  console.log('Auth details:', { authUser: authUser ? (authUser.username || authUser.email || authUser.name) : null, token: !!token, role });  // DEBUG: Hide sensitive data
  
  // Check timestamp (1 hour) + token + trainer role
  if (!authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000 || !token || role !== 'trainer') { 
    console.log('Auth failed - clearing and redirecting');  // DEBUG
    sessionStorage.removeItem('authUser'); 
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    window.location.href = '../trainer-login.html'; 
    return;
  } 
  
  console.log('Trainer authenticated:', authUser.username || authUser.email || authUser.name, 'Role:', role);
})();

const API_URL = 'http://localhost:8080';

document.addEventListener('DOMContentLoaded', async function () {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    const authUser = JSON.parse(sessionStorage.getItem('authUser'));


    // 🔍 DEBUG: Log the raw authUser to diagnose structure
    console.log('=== TRAINER SCHEDULE AUTH DEBUG ===');
    console.log('Raw authUser from sessionStorage:', authUser);
    if (authUser) {
        console.log('authUser keys:', Object.keys(authUser));
        console.log('authUser.role:', authUser.role);
        console.log('authUser.timestamp:', authUser.timestamp);
        console.log('authUser.user exists?', !!authUser.user);
        if (authUser.user) console.log('authUser.user keys:', Object.keys(authUser.user));
    }


    // FIXED AUTH CHECK: Support both wrapped (authUser.user) and flattened structures
    const user = authUser?.user || authUser; // Fallback to flattened structure
    const role = authUser?.role;
    const timestamp = authUser?.timestamp || 0;


    // ENHANCED: Token + role + timestamp check (in addition to existing check)
    const token = sessionStorage.getItem('token');
    if (!authUser || !user || role !== "trainer" || (Date.now() - timestamp > 3600000) || !token) {
        console.log('Auth check failed - logging out');
        sessionStorage.removeItem('authUser');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('role');
        window.location.href = '../trainer-login.html';
        return;
    }


    console.log('Auth check passed! Using user:', user);
    console.log('Extracted trainer ID:', user.trainer_id || user.trainerid || user.trainerId || user.id || user._id);


    if (menuToggle) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    if (logoutBtn) logoutBtn.addEventListener('click', () => {
        // ENHANCED: Clear token + role
        sessionStorage.removeItem('authUser');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('role');
        window.location.href = '../trainer-login.html';
    });


    // FIXED: Display trainer name from extracted user
    const trainerNameEl = document.getElementById('trainerName');
    if (trainerNameEl) trainerNameEl.textContent = user.name || 'Trainer';


    const classesContainer = document.getElementById('classesContainer');
    const loading = document.getElementById('classesLoading');


    if (!classesContainer || !loading) {
        console.error('Missing DOM elements');
        return;
    }


    try {
        // ENHANCED: Token + role check before loading classes
        if (!token || role !== 'trainer' || !authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000) {
            console.log('Invalid session before API - logging out');  // DEBUG
            sessionStorage.removeItem('token');
            sessionStorage.removeItem('authUser');
            sessionStorage.removeItem('role');
            window.location.href = '../trainer-login.html';
            return;
        }


        // FIXED: Trainer ID extraction with more fallbacks
        const trainerId = user.trainer_id || user.trainerid || user.trainerId || user.id || user._id;
        if (!trainerId) {
            throw new Error('No valid trainer ID found');
        }


        console.log('Fetching classes for trainer ID:', trainerId);
        // TOKENIZED: Use apiFetch for GET classes
        const data = await apiFetch(`${API_URL}/api/classes`);
        console.log('Classes API response:', data);
        const allClasses = data.data || [];
        const trainerClasses = allClasses.filter(c => {
            const cid = c.trainer_id || c.trainerid || c.trainerId || null;
            return cid === trainerId;
        });
        console.log('Filtered classes:', trainerClasses.length);


        loading.style.display = 'none';


        if (trainerClasses.length === 0) {
            classesContainer.innerHTML = '<div class="no-classes">No classes assigned to you yet.</div>';
            return;
        }


        const classesWithEnrollment = await Promise.all(trainerClasses.map(async c => {
            const cid = c.class_id || c.classid || c._id;
            let enrolledCount = 0;


            try {
                // TOKENIZED: Use apiFetch for GET enrollments
                const enroll = await apiFetch(`${API_URL}/api/classes/${cid}/enrollments`);
                enrolledCount = (enroll.data || []).length;
            } catch (err) {
                console.error(`Enrollments fetch failed for ${cid}:`, err);
            }


            return { ...c, enrolledCount };
        }));


        renderClasses(classesWithEnrollment, trainerId);


    } catch (err) {
        console.error('Error loading classes:', err);
        loading.style.display = 'none';
        classesContainer.innerHTML = `<div class="error">Failed to load classes: ${err.message}. Please try again.</div>`;
    }
});


function parseScheduleDays(schedule) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const activeDays = [];


    days.forEach(day => {
        if (schedule.includes(day)) {
            activeDays.push(day);
        }
    });


    return activeDays;
}


function renderClasses(classes, trainerId) {
    const container = document.getElementById('classesContainer');
    let html = '';


    classes.forEach(cls => {
        const classId = cls.class_id || cls.classid || cls._id;
        const className = cls.class_name || cls.classname || 'Unnamed Class';
        const description = cls.description || 'No description available';
        const schedule = cls.schedule || 'Not scheduled';
        const capacity = cls.capacity || '-';
        const enrolled = cls.enrolledCount || 0;


        const activeDays = parseScheduleDays(schedule);
        const dayChecks = {
            'Mon': activeDays.includes('Mon'),
            'Tue': activeDays.includes('Tue'),
            'Wed': activeDays.includes('Wed'),
            'Thu': activeDays.includes('Thu'),
            'Fri': activeDays.includes('Fri'),
            'Sat': activeDays.includes('Sat'),
            'Sun': activeDays.includes('Sun')
        };


        html += `
                    <div class="class-card" data-class-id="${classId}">
                    <div class="class-header">
                        <h3>${className}</h3>
                        <span class="enrollment">${enrolled}/${capacity} Enrolled</span>
                    </div>
                    <p class="class-description">${description}</p>
                    <div class="class-details">
                        <div class="detail-item">
                            <strong>Current Schedule:</strong>
                            <div class="current-schedule">${schedule}</div>
                        </div>
                        <div class="detail-item"><strong>Capacity:</strong> ${capacity}</div>
                    </div>
                    <button class="save-btn" onclick="toggleEditForm('${classId}')">Edit Schedule</button>
                    
                    <div class="edit-form" id="editForm-${classId}" style="display: none;">
                        <h4>Update Schedule</h4>
                        
                        <div class="schedule-type-selector">
                            <button type="button" class="schedule-type-btn active" onclick="setScheduleType('${classId}', 'weekly')">
                                <i class="fa-solid fa-check btn-icon"></i> Weekly Recurring
                            </button>
                            <button type="button" class="schedule-type-btn" onclick="setScheduleType('${classId}', 'onetime')">
                                <i class="fa-solid fa-calendar-days btn-icon"></i> One-Time Event
                            </button>
                        </div>


                        <div class="schedule-options" id="weeklyOptions-${classId}">
                            <label class="section-label">
                                <i class="fa-solid fa-check label-icon"></i> Select Days:
                            </label>
                            <div class="day-checkboxes">
                                <div class="day-checkbox-item">
                                    <input type="checkbox" id="mon-${classId}" value="Monday" ${dayChecks.Mon ? 'checked' : ''}>
                                    <label for="mon-${classId}">Monday</label>
                                </div>
                                <div class="day-checkbox-item">
                                    <input type="checkbox" id="tue-${classId}" value="Tuesday" ${dayChecks.Tue ? 'checked' : ''}>
                                    <label for="tue-${classId}">Tuesday</label>
                                </div>
                                <div class="day-checkbox-item">
                                    <input type="checkbox" id="wed-${classId}" value="Wednesday" ${dayChecks.Wed ? 'checked' : ''}>
                                    <label for="wed-${classId}">Wednesday</label>
                                </div>
                                <div class="day-checkbox-item">
                                    <input type="checkbox" id="thu-${classId}" value="Thursday" ${dayChecks.Thu ? 'checked' : ''}>
                                    <label for="thu-${classId}">Thursday</label>
                                </div>
                                <div class="day-checkbox-item">
                                    <input type="checkbox" id="fri-${classId}" value="Friday" ${dayChecks.Fri ? 'checked' : ''}>
                                    <label for="fri-${classId}">Friday</label>
                                </div>
                                <div class="day-checkbox-item">
                                    <input type="checkbox" id="sat-${classId}" value="Saturday" ${dayChecks.Sat ? 'checked' : ''}>
                                    <label for="sat-${classId}">Saturday</label>
                                </div>
                                <div class="day-checkbox-item">
                                    <input type="checkbox" id="sun-${classId}" value="Sunday" ${dayChecks.Sun ? 'checked' : ''}>
                                    <label for="sun-${classId}">Sunday</label>
                                </div>
                            </div>
                            <label class="section-label" style="margin-top: 1rem;">
                                <i class="fa-solid fa-clock label-icon"></i> Time Range:
                            </label>
                            <div class="time-input-group">
                                <div class="time-input-wrapper">
                                    <input type="time" id="startTime-${classId}" value="07:00" required>
                                    <i class="fa-solid fa-clock time-icon-right" onclick="document.getElementById('startTime-${classId}').showPicker()"></i>
                                </div>
                                <span style="color: var(--accent);">to</span>
                                <div class="time-input-wrapper">
                                    <input type="time" id="endTime-${classId}" value="08:00" required>
                                    <i class="fa-solid fa-clock time-icon-right" onclick="document.getElementById('endTime-${classId}').showPicker()"></i>
                                </div>
                            </div>
                        </div>


                        <div class="schedule-options" id="onetimeOptions-${classId}" style="display: none;">
                            <label class="section-label">
                                <i class="fa-solid fa-calendar-days label-icon"></i> Select Date:
                            </label>
                            <div class="date-input-wrapper">
                                <input type="date" class="date-picker-input" id="eventDate-${classId}" required>
                                <i class="fa-solid fa-calendar-days date-icon-right" onclick="document.getElementById('eventDate-${classId}').showPicker()"></i>
                            </div>
                            <label class="section-label" style="margin-top: 1rem;">
                                <i class="fa-solid fa-clock label-icon"></i> Time Range:
                            </label>
                            <div class="time-input-group">
                                <div class="time-input-wrapper">
                                    <input type="time" id="eventStartTime-${classId}" value="07:00" required>
                                    <i class="fa-solid fa-clock time-icon-right" onclick="document.getElementById('eventStartTime-${classId}').showPicker()"></i>
                                </div>
                                <span style="color: var(--accent);">to</span>
                                <div class="time-input-wrapper">
                                    <input type="time" id="eventEndTime-${classId}" value="08:00" required>
                                    <i class="fa-solid fa-clock time-icon-right" onclick="document.getElementById('eventEndTime-${classId}').showPicker()"></i>
                                </div>
                            </div>
                        </div>


                        <div class="form-actions" style="margin-top: 1.5rem;">
                            <button class="save-btn" onclick="saveSchedule('${classId}', '${trainerId}')">Save Changes</button>
                            <button class="save-btn" onclick="toggleEditForm('${classId}')" style="background: #666;">Cancel</button>
                        </div>
                        <div class="edit-status" id="status-${classId}" style="display: none;"></div>
                    </div>
                    </div>
                `;
    });


    container.innerHTML = html;


    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach(input => {
        input.min = today;
    });
}


function setScheduleType(classId, type) {
    const weeklyOptions = document.getElementById(`weeklyOptions-${classId}`);
    const onetimeOptions = document.getElementById(`onetimeOptions-${classId}`);
    const buttons = document.querySelectorAll(`[data-class-id="${classId}"] .schedule-type-btn`);


    buttons.forEach((btn, idx) => {
        if ((type === 'weekly' && idx === 0) || (type === 'onetime' && idx === 1)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });


    if (type === 'weekly') {
        weeklyOptions.style.display = 'block';
        onetimeOptions.style.display = 'none';
    } else {
        weeklyOptions.style.display = 'none';
        onetimeOptions.style.display = 'block';
    }
}


function toggleEditForm(classId) {
    const form = document.getElementById(`editForm-${classId}`);
    if (form.style.display === 'none') {
        form.style.display = 'block';
    } else {
        form.style.display = 'none';
    }
}


// TOKENIZED: SAVE SCHEDULE
async function saveSchedule(classId, trainerId) {
    const statusDiv = document.getElementById(`status-${classId}`);
    const activeType = document.querySelector(`[data-class-id="${classId}"] .schedule-type-btn.active`);
    const isWeekly = activeType.textContent.includes('Weekly');


    let scheduleText = '';


    try {
        // ENHANCED: Token + role check before API call
        const token = sessionStorage.getItem('token');
        const authUser = JSON.parse(sessionStorage.getItem('authUser') || 'null');
        const role = sessionStorage.getItem('role');
        if (!token || role !== 'trainer' || !authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000) {
            console.log('Invalid session in saveSchedule - logging out');  // DEBUG
            sessionStorage.removeItem('token');
            sessionStorage.removeItem('authUser');
            sessionStorage.removeItem('role');
            window.location.href = '../trainer-login.html';
            return;
        }


        if (isWeekly) {
            const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
            const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            const selectedDays = [];


            days.forEach((day, idx) => {
                const checkbox = document.getElementById(`${day}-${classId}`);
                if (checkbox && checkbox.checked) {
                    selectedDays.push(dayNames[idx]);
                }
            });


            if (selectedDays.length === 0) {
                statusDiv.textContent = 'Please select at least one day';
                statusDiv.className = 'edit-status error';
                statusDiv.style.display = 'block';
                return;
            }


            const startTime = document.getElementById(`startTime-${classId}`).value;
            const endTime = document.getElementById(`endTime-${classId}`).value;


            if (!startTime || !endTime) {
                statusDiv.textContent = 'Please select start and end times';
                statusDiv.className = 'edit-status error';
                statusDiv.style.display = 'block';
                return;
            }


            scheduleText = `${selectedDays.join(', ')} ${formatTime(startTime)} - ${formatTime(endTime)}`;


        } else {
            const eventDate = document.getElementById(`eventDate-${classId}`).value;
            const eventStartTime = document.getElementById(`eventStartTime-${classId}`).value;
            const eventEndTime = document.getElementById(`eventEndTime-${classId}`).value;


            if (!eventDate || !eventStartTime || !eventEndTime) {
                statusDiv.textContent = 'Please fill in all fields';
                statusDiv.className = 'edit-status error';
                statusDiv.style.display = 'block';
                return;
            }


            const date = new Date(eventDate);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            scheduleText = `${dateStr} ${formatTime(eventStartTime)} - ${formatTime(eventEndTime)}`;
        }


        statusDiv.textContent = 'Updating schedule...';
        statusDiv.className = 'edit-status';
        statusDiv.style.display = 'block';


        // TOKENIZED: Use apiFetch for PUT (standardized to 'token')
        const result = await apiFetch(`${API_URL}/api/classes/${classId}`, {
            method: 'PUT',
            body: JSON.stringify({
                schedule: scheduleText,
                trainer_id: trainerId
            })
        });


        console.log('Schedule update response:', result);


        if (result.error) {
            throw new Error(result.error || 'Failed to update schedule');
        }


        statusDiv.textContent = '✓ Schedule updated successfully!';
        statusDiv.className = 'edit-status success';


        const scheduleDisplay = document.querySelector(`[data-class-id="${classId}"] .current-schedule`);
        if (scheduleDisplay) {
            scheduleDisplay.textContent = scheduleText;
        }


        setTimeout(() => {
            toggleEditForm(classId);
            statusDiv.style.display = 'none';
        }, 2000);


    } catch (err) {
        console.error('Error updating schedule:', err);
        statusDiv.textContent = `Error: ${err.message}`;
        statusDiv.className = 'edit-status error';
        statusDiv.style.display = 'block';
    }
}


function formatTime(time24) {
    const [hours, minutes] = time24.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
}
