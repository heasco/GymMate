const SERVER_URL = 'http://localhost:8080';

document.addEventListener('DOMContentLoaded', () => {
    setupSidebarAndSession();
    loadDashboardData();
    setupEventListeners();
});

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

    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('collapsed');
        }
    });
}

function setupEventListeners() {
    const launchBtn = document.getElementById('launchAttendanceBtn');
    const refreshBtn = document.getElementById('refreshBtn');

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

    refreshBtn.addEventListener('click', () => {
        loadDashboardData();
    });

    // Auto-refresh every 30 seconds
    setInterval(() => {
        loadDashboardData();
    }, 30000);
}

async function loadDashboardData() {
    try {
        const authUser = JSON.parse(localStorage.getItem('authUser'));
        const response = await fetch(`${SERVER_URL}/api/attendance/today`, {
            headers: {
                'Authorization': `Bearer ${authUser.token}`
            }
        });

        if (response.ok) {
            const result = await response.json();
            updateDashboard(result.data);
        }
    } catch (error) {
        console.error('Error loading dashboard data:', error);
    }
}

function updateDashboard(data) {
    // Update stats
    document.getElementById('todayCheckins').textContent = data.totalCheckins || 0;
    document.getElementById('currentlyInGym').textContent = data.currentlyInGym || 0;

    if (data.lastCheckin) {
        const time = new Date(data.lastCheckin.timestamp);
        document.getElementById('lastCheckin').textContent = time.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } else {
        document.getElementById('lastCheckin').textContent = 'No activity yet';
    }

    // Update recent activity
    displayRecentActivity(data.recentActivity || []);
}

function displayRecentActivity(activities) {
    const activityList = document.getElementById('activityList');

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