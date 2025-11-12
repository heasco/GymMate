const API_URL = 'http://localhost:8080';
document.addEventListener('DOMContentLoaded', async function () {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    const authUser = JSON.parse(localStorage.getItem('authUser'));

    // 🔍 DEBUG: Log the raw authUser to diagnose structure
    console.log('=== TRAINER SCHEDULE AUTH DEBUG ===');
    console.log('Raw authUser from localStorage:', authUser);
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

    if (!authUser || !user || role !== "trainer" || (Date.now() - timestamp > 3600000)) {
        console.log('Auth check failed - logging out');
        localStorage.removeItem('authUser');
        window.location.href = '../trainer-login.html';
        return;
    }

    console.log('Auth check passed! Using user:', user);
    console.log('Extracted trainer ID:', user.trainer_id || user.trainerid || user.trainerId || user.id || user._id);

    if (menuToggle) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    if (logoutBtn) logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authUser');
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
        // FIXED: Trainer ID extraction with more fallbacks
        const trainerId = user.trainer_id || user.trainerid || user.trainerId || user.id || user._id;
        if (!trainerId) {
            throw new Error('No valid trainer ID found');
        }

        console.log('Fetching classes for trainer ID:', trainerId);
        const resp = await fetch(`${API_URL}/api/classes`);
        if (!resp.ok) throw new Error(`Failed to fetch classes: ${resp.status} ${resp.statusText}`);

        const data = await resp.json();
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
                const enrollResp = await fetch(`${API_URL}/api/classes/${cid}/enrollments`);
                if (enrollResp.ok) {
                    const enroll = await enrollResp.json();
                    enrolledCount = (enroll.data || []).length;
                } else {
                    console.error(`Enrollments fetch failed for ${cid}: ${enrollResp.status}`);
                }
            } catch (err) {
                console.error('Error fetching enrollments:', err);
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

async function saveSchedule(classId, trainerId) {
    const statusDiv = document.getElementById(`status-${classId}`);
    const activeType = document.querySelector(`[data-class-id="${classId}"] .schedule-type-btn.active`);
    const isWeekly = activeType.textContent.includes('Weekly');

    let scheduleText = '';

    try {
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

        // FIXED: Use optional auth token (fallback to empty if not set)
        const authToken = localStorage.getItem('authToken') || '';
        const response = await fetch(`${API_URL}/api/classes/${classId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...(authToken && { 'Authorization': `Bearer ${authToken}` }) // Only add if token exists
            },
            body: JSON.stringify({
                schedule: scheduleText,
                trainer_id: trainerId
            })
        });

        const result = await response.json();
        console.log('Schedule update response:', result);

        if (response.ok) {
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
        } else {
            throw new Error(result.error || 'Failed to update schedule');
        }

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