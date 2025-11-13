const SERVER_URL = 'http://localhost:8080';

let calendar;
let allClasses = [];

// Utility for authenticated API calls (adds security header for /api/ routes)
async function apiFetch(endpoint, options = {}) {
  const token = sessionStorage.getItem('token');
  if (!token) {
    // No token: clear any stale data and redirect
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html'; // Path from admin-js/ folder
    return;
  }

  const url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? `${SERVER_URL}${endpoint}`
    : endpoint;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
    'Authorization': `Bearer ${token}` // JWT security header
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Token invalid/expired: clear and redirect
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html'; // Path from admin-js/
    return;
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json(); // Returns parsed JSON for original patterns
}

// Auth check on page load (security feature)
document.addEventListener('DOMContentLoaded', async function () {
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  if (!token || role !== 'admin') {
    window.location.href = '../admin-login.html'; // Redirect if not authorized
    return;
  }

  await checkServerConnection();
  await fetchTrainers(); // Now secure
  setupEventListeners();
  setMinimumDates();
  setupSidebarAndSession();
});

async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  try {
    console.log('Attempting health check to:', `${SERVER_URL}/health`); // Debug log
    const response = await fetch(`${SERVER_URL}/health`);
    console.log('Health response status:', response.status); // Debug log
    if (response.ok) {
      statusElement.textContent = 'Connected to server successfully';
      statusElement.className = 'server-status server-connected';
    } else {
      throw new Error(`Server response not OK: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error('Health check failed:', error); // Detailed error in console
    statusElement.textContent = 'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
  }
}
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');
  const authUser = JSON.parse(sessionStorage.getItem('authUser') || '{}');
  
  // Security: Check timestamp + clear token/role on invalid
  if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html';
    return;
  }
  
  menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html';
  });
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
      sidebar.classList.remove('collapsed');
    }
  });
  sidebar.addEventListener('transitionend', () => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('collapsed')) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
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

async function fetchTrainers() {
  const trainerSelect = document.getElementById('trainer_id');
  const errorDiv = document.getElementById('trainerError');
  trainerSelect.innerHTML = 'Loading trainers...';
  if (errorDiv) errorDiv.style.display = 'none';

  try {
    const result = await apiFetch('/api/trainers'); // Secure fetch
    if (result.success && result.data && result.data.length > 0) {
      trainerSelect.innerHTML = 'Select a trainer';
      result.data.forEach(trainer => {
        const option = document.createElement('option');
        option.value = trainer.trainer_id;
        option.textContent = `${trainer.name} (${trainer.specialization})`;
        trainerSelect.appendChild(option);
      });
      if (errorDiv) errorDiv.style.display = 'none';
    } else {
      trainerSelect.innerHTML = 'No trainers available';
      if (errorDiv) {
        errorDiv.textContent = 'No trainers found in the system';
        errorDiv.style.display = 'block';
      }
    }
  } catch (error) {
    console.error('Error fetching trainers:', error);
    trainerSelect.innerHTML = 'Error loading trainers';
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
    const result = await apiFetch('/api/classes', { // Secure POST
      method: 'POST',
      body: JSON.stringify(classData)
    });
    if (result.success) {
      showSuccess('Class successfully added!');
      document.getElementById('classForm').reset();
      updateSchedulePreview();
      await fetchTrainers(); // Reload trainers if needed
      if (calendar) loadClassesIntoCalendar();
    } else {
      throw new Error(result.error || 'Submission failed');
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
    const result = await apiFetch('/api/classes'); // Secure fetch for calendar events
    if (result.success && result.data) {
      calendar.removeAllEvents();
      allClasses = result.data;
      // Add your calendar event parsing logic here (e.g., from schedule string to events)
      // Example: Parse schedule to create events; limit to 100 for performance
      result.data.slice(0, 100).forEach(cls => {
        // Placeholder: Assume schedule parse yields start/end; customize as needed
        // calendar.addEvent({ title: cls.class_name, start: '2025-11-13T10:00:00', end: '2025-11-13T11:00:00' });
      });
    }
  } catch (error) {
    console.error('Error loading classes:', error);
  }
}
