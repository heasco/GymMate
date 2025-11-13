// Utility for authenticated API calls (adds security header for /api/ routes)
async function apiFetch(endpoint, options = {}) {
  const token = sessionStorage.getItem('token');
  if (!token) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html';
    return;
  }

  const url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? `${SERVER_URL}${endpoint}`
    : endpoint;

  const headers = { 
    ...options.headers, 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json' // Default for this file's JSON calls
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html';
    return;
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

const SERVER_URL = 'http://localhost:8080';

document.addEventListener('DOMContentLoaded', () => {
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  if (!token || role !== 'admin') {
    window.location.href = '../admin-login.html';
    return;
  }
  const authUser = JSON.parse(sessionStorage.getItem('authUser') || '{}');
  if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html';
    return;
  }

  setupSidebarAndSession();
  loadDashboardData();
  setupEventListeners();
});

function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
      window.location.href = '../admin-login.html';
    });
  }

  // Mobile sidebar click outside
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar && menuToggle && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
      sidebar.classList.remove('collapsed');
    }
  });

  // Overflow handling on collapse (mobile)
  if (sidebar) {
    sidebar.addEventListener('transitionend', () => {
      if (window.innerWidth <= 768 && sidebar.classList.contains('collapsed')) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = 'auto';
      }
    });
  }
}

function setupEventListeners() {
  const launchBtn = document.getElementById('launchAttendanceBtn');
  const refreshBtn = document.getElementById('refreshBtn');

  if (launchBtn) {
    launchBtn.addEventListener('click', () => {
      // Open attendance system in new window
      const width = 1400;
      const height = 900;
      const left = (screen.width - width) / 2;
      const top = (screen.height - height) / 2;

      window.open(
        '../attendance-admin/attendance-admin-mainpage.html',
        'AttendanceSystem',
        `width=${width},height=${height},top=${top},left=${left},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes`
      );
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadDashboardData();
    });
  }

  // Auto-refresh every 30 seconds
  setInterval(() => {
    loadDashboardData();
  }, 30000);
}

async function loadDashboardData() {
  try {
    // Secure GET with apiFetch
    const result = await apiFetch('/api/attendance/today');

    if (result.success !== false) {  // Assume success if no error
      updateDashboard(result.data);
    } else {
      console.error('API returned failure');
    }
  } catch (error) {
    console.error('Error loading dashboard data:', error);
  }
}

function updateDashboard(data) {
  // Update stats
  const todayCheckinsEl = document.getElementById('todayCheckins');
  const currentlyInGymEl = document.getElementById('currentlyInGym');
  const lastCheckinEl = document.getElementById('lastCheckin');
  if (todayCheckinsEl) todayCheckinsEl.textContent = data.totalCheckins || 0;
  if (currentlyInGymEl) currentlyInGymEl.textContent = data.currentlyInGym || 0;

  if (data.lastCheckin) {
    const time = new Date(data.lastCheckin.timestamp);
    if (lastCheckinEl) {
      lastCheckinEl.textContent = time.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  } else {
    if (lastCheckinEl) {
      lastCheckinEl.textContent = 'No activity yet';
    }
  }

  // Update recent activity
  displayRecentActivity(data.recentActivity || []);
}

function displayRecentActivity(activities) {
  const activityList = document.getElementById('activityList');
  if (!activityList) return;

  if (activities.length === 0) {
    activityList.innerHTML = '<div class="no-activity">No recent activity today</div>';
    return;
  }

  activityList.innerHTML = activities.slice(0, 10).map(activity => {
    const time = new Date(activity.timestamp);
    const timeStr = time.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });

    const typeClass = activity.type === 'check-in' ? 'check-in' : 'check-out';
    const icon = activity.type === 'check-in' ? 'fa-sign-in-alt' : 'fa-sign-out-alt';

    return `
      <div class="activity-item ${typeClass}">
        <div class="activity-icon">
          <i class="fas ${icon}"></i>
        </div>
        <div class="activity-details">
          <div class="activity-name">${activity.memberName}</div>
          <div class="activity-time">${timeStr}</div>
        </div>
        <div class="activity-badge ${typeClass}">
          ${activity.type === 'check-in' ? 'IN' : 'OUT'}
        </div>
      </div>
    `;
  }).join('');
}
