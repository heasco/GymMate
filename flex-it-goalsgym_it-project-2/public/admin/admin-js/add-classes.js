const SERVER_URL = 'http://localhost:8080';
let calendar;
let allClasses = [];

document.addEventListener('DOMContentLoaded', async function () {
    await checkServerConnection();
    fetchTrainers();
    setupEventListeners();
    setMinimumDates();
    setupSidebarAndSession();
});

async function checkServerConnection() {
    const statusElement = document.getElementById('serverStatus');
    try {
        const response = await fetch(`${SERVER_URL}/health`);
        if (response.ok) {
            statusElement.textContent = 'Connected to server successfully';
            statusElement.className = 'server-status server-connected';
        } else {
            throw new Error('Server response not OK');
        }
    } catch (error) {
        statusElement.textContent = 'Cannot connect to server. Please try again later.';
        statusElement.className = 'server-status server-disconnected';
        console.error('Server connection error:', error);
    }
}

function setupSidebarAndSession() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    const authUser = JSON.parse(localStorage.getItem('authUser'));

    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

    if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
        localStorage.removeItem('authUser');
        window.location.href = '../admin-login.html';
        return;
    }

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authUser');
        window.location.href = '../admin-login.html';
    });
}

function setupEventListeners() {
    document.getElementById('schedule_type').addEventListener('change', toggleScheduleSection);
    document.getElementById('class_date').addEventListener('change', updateSchedulePreview);
    document.getElementById('one_start_time').addEventListener('change', updateSchedulePreview);
    document.getElementById('one_end_time').addEventListener('change', updateSchedulePreview);
    document.querySelectorAll('input[name="days"]').forEach(checkbox => {
        checkbox.addEventListener('change', updateSchedulePreview);
    });
    document.getElementById('start_time').addEventListener('change', updateSchedulePreview);
    document.getElementById('end_time').addEventListener('change', updateSchedulePreview);
    document.getElementById('start_date').addEventListener('change', updateSchedulePreview);
    document.getElementById('end_date').addEventListener('change', updateSchedulePreview);
    document.getElementById('month_start').addEventListener('change', updateSchedulePreview);
    document.getElementById('week_of_month').addEventListener('change', updateSchedulePreview);
    document.getElementById('classForm').addEventListener('submit', handleFormSubmit);
}

function setMinimumDates() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('class_date').setAttribute('min', today);
    document.getElementById('start_date').setAttribute('min', today);
    document.getElementById('end_date').setAttribute('min', today);
    document.getElementById('month_start').setAttribute('min', today);
}

// THIS IS THE CRITICAL FUNCTION THAT WAS MISSING
async function fetchTrainers() {
    const trainerSelect = document.getElementById('trainer_id');
    const errorDiv = document.getElementById('trainerError');

    trainerSelect.innerHTML = '<option value="">Loading trainers...</option>';
    if (errorDiv) errorDiv.style.display = 'none';

    try {
        const response = await fetch(`${SERVER_URL}/api/trainers`, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const result = await response.json();

            if (result.success && result.data && result.data.length > 0) {
                trainerSelect.innerHTML = '<option value="">Select a trainer</option>';

                result.data.forEach(trainer => {
                    const option = document.createElement('option');
                    option.value = trainer.trainer_id;
                    option.textContent = `${trainer.name} (${trainer.specialization})`;
                    trainerSelect.appendChild(option);
                });

                if (errorDiv) errorDiv.style.display = 'none';
            } else {
                trainerSelect.innerHTML = '<option value="">No trainers available</option>';
                if (errorDiv) {
                    errorDiv.textContent = 'No trainers found in the system';
                    errorDiv.style.display = 'block';
                }
            }
        } else {
            trainerSelect.innerHTML = '<option value="">Error loading trainers</option>';
            if (errorDiv) {
                errorDiv.textContent = `Server error: ${response.status} ${response.statusText}`;
                errorDiv.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error fetching trainers:', error);
        trainerSelect.innerHTML = '<option value="">Error loading trainers</option>';
        if (errorDiv) {
            errorDiv.textContent = `Network error: ${error.message}`;
            errorDiv.style.display = 'block';
        }
    }
}

function toggleScheduleSection() {
    const scheduleType = document.getElementById('schedule_type').value;
    const oneTimeSchedule = document.getElementById('oneTimeSchedule');
    const recurringSchedule = document.getElementById('recurringSchedule');
    const weeklyOptions = document.getElementById('weeklyOptions');
    const monthlyOptions = document.getElementById('monthlyOptions');

    document.querySelectorAll('.section').forEach(section => {
        if (section.id !== 'formSection' && section.id !== 'scheduleViewSection') {
            section.style.display = 'none';
        }
    });

    if (scheduleType === 'one-time') {
        oneTimeSchedule.style.display = 'block';
    } else if (scheduleType === 'weekly') {
        recurringSchedule.style.display = 'block';
        weeklyOptions.style.display = 'block';
    } else if (scheduleType === 'monthly') {
        recurringSchedule.style.display = 'block';
        monthlyOptions.style.display = 'block';
    }

    updateSchedulePreview();
}

function updateSchedulePreview() {
    const scheduleType = document.getElementById('schedule_type').value;
    const scheduleInput = document.getElementById('schedule');
    const schedulePreview = document.getElementById('schedulePreview');

    if (!scheduleType) {
        schedulePreview.textContent = 'Please select schedule type and complete the information above';
        scheduleInput.value = '';
        return;
    }

    const formatTime = (time24) => {
        if (!time24) return '';
        const [hours, minutes] = time24.split(':');
        const hour12 = hours % 12 || 12;
        const ampm = hours < 12 ? 'AM' : 'PM';
        return `${hour12}:${minutes} ${ampm}`;
    };

    let scheduleText = '';

    if (scheduleType === 'one-time') {
        const date = document.getElementById('class_date').value;
        const startTime = document.getElementById('one_start_time').value;
        const endTime = document.getElementById('one_end_time').value;

        if (date && startTime && endTime) {
            if (startTime >= endTime) {
                schedulePreview.textContent = 'End time must be after start time';
                scheduleInput.value = '';
                return;
            }

            const formattedDate = new Date(date).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
            scheduleText = `One-time: ${formattedDate}, ${formatTime(startTime)} - ${formatTime(endTime)}`;
        }
    } else if (scheduleType === 'weekly' || scheduleType === 'monthly') {
        const selectedDays = Array.from(document.querySelectorAll('input[name="days"]:checked')).map(cb => cb.value);
        const startTime = document.getElementById('start_time').value;
        const endTime = document.getElementById('end_time').value;

        if (selectedDays.length > 0 && startTime && endTime) {
            if (startTime >= endTime) {
                schedulePreview.textContent = 'End time must be after start time';
                scheduleInput.value = '';
                return;
            }

            const daysText = selectedDays.join(', ');

            if (scheduleType === 'weekly') {
                const startDate = document.getElementById('start_date').value;
                const endDate = document.getElementById('end_date').value;
                let dateRange = startDate ? ` (Starting ${new Date(startDate).toLocaleDateString()})` : '';
                if (startDate && endDate) {
                    dateRange = ` (${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()})`;
                }
                scheduleText = `Weekly: ${daysText}, ${formatTime(startTime)} - ${formatTime(endTime)}${dateRange}`;
            } else {
                const monthStart = document.getElementById('month_start').value;
                scheduleText = `Monthly (4 weeks): ${daysText}, ${formatTime(startTime)} - ${formatTime(endTime)}`;
            }
        }
    }

    if (scheduleText) {
        schedulePreview.textContent = scheduleText;
        scheduleInput.value = scheduleText;
    } else {
        schedulePreview.textContent = 'Please complete all required information';
        scheduleInput.value = '';
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const classData = {
        class_name: formData.get('class_name').trim(),
        description: formData.get('description').trim(),
        schedule: formData.get('schedule').trim(),
        trainer_id: formData.get('trainer_id'),
        capacity: parseInt(formData.get('capacity'))
    };

    if (!classData.trainer_id) {
        alert('Please select a trainer');
        return;
    }

    if (!classData.schedule) {
        alert('Please complete the schedule information');
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}/api/classes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            },
            body: JSON.stringify(classData)
        });

        const responseData = await response.json();

        if (response.ok) {
            showSuccess('Class successfully added!');
            document.getElementById('classForm').reset();
            updateSchedulePreview();
            fetchTrainers();
            if (calendar) loadClassesIntoCalendar();
        } else {
            throw new Error(responseData.error || 'Submission failed');
        }
    } catch (error) {
        console.error('Error:', error);
        alert(error.message);
    }
}

function showSuccess(message) {
    const successElement = document.getElementById('successMessage');
    successElement.textContent = message;
    successElement.style.display = 'block';
    setTimeout(() => successElement.style.display = 'none', 5000);
}

function showScheduleView() {
    document.getElementById('formSection').classList.remove('active');
    document.getElementById('scheduleViewSection').classList.add('active');
    initCalendar();
}

function showFormView() {
    document.getElementById('scheduleViewSection').classList.remove('active');
    document.getElementById('formSection').classList.add('active');
}

function initCalendar() {
    if (calendar) {
        calendar.render();
        loadClassesIntoCalendar();
        return;
    }
    const calendarEl = document.getElementById('calendar');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        height: 500,
        slotMinTime: '06:00:00',
        slotMaxTime: '22:00:00',
        events: []
    });
    calendar.render();
    loadClassesIntoCalendar();
}

async function loadClassesIntoCalendar() {
    if (!calendar) return;
    try {
        const response = await fetch(`${SERVER_URL}/api/classes`);
        if (response.ok) {
            const result = await response.json();
            if (result.success && result.data) {
                calendar.removeAllEvents();
                // Add your calendar event parsing logic here
            }
        }
    } catch (error) {
        console.error('Error loading classes:', error);
    }
}