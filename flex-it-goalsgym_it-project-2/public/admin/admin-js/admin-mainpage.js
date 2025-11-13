const SERVER_URL = 'http://localhost:8080';

// Utility for authenticated API calls (adds security header)
async function apiFetch(endpoint, options = {}) {
  const token = sessionStorage.getItem('token');
  if (!token) {
    // No token: clear any stale data and redirect
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html'; // Original path
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
    window.location.href = '../admin-login.html'; // Original path
    return;
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json(); // Returns parsed JSON for original patterns
}

// Auth check on page load (security feature)
document.addEventListener('DOMContentLoaded', () => {
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  if (!token || role !== 'admin') {
    window.location.href = '../admin-login.html'; // Original path
    return;
  }

  loadDashboardStats();
  loadTodayClassSchedules();
  setupSidebarAndSession();
});

async function loadDashboardStats() {
    try {
        // --- Member count logic robust for all APIs (original, wrapped securely) ---
        const memResp = await apiFetch('/api/members');
        const memJson = memResp; // Direct use (already JSON from apiFetch)
        if (Array.isArray(memJson.data)) {
            document.getElementById('statTotalMembers').textContent = memJson.data.length;
        } else if (typeof memJson.count === 'number') {
            document.getElementById('statTotalMembers').textContent = memJson.count;
        } else {
            document.getElementById('statTotalMembers').textContent = 0;
        }

        // Trainer count (original)
        const trainerResp = await apiFetch('/api/trainers');
        const trainerJson = trainerResp; // Direct use
        document.getElementById('statTotalTrainers').textContent = trainerJson.count || (trainerJson.data && trainerJson.data.length) || 0;

        // Classes and attendance today (original)
        const classResp = await apiFetch('/api/classes');
        const classJson = classResp; // Direct use
        let classesToday = 0, totalAttendance = 0;
        const today = new Date();
        for (const cls of classJson.data || []) {
            const enrollResp = await apiFetch(`/api/classes/${cls.class_id}/enrollments`);
            const enrollJson = enrollResp; // Direct use
            const todayAttendance = enrollJson.data && enrollJson.data.filter(e => {
                if (!e.session_date) return false;
                const eDate = new Date(e.session_date);
                return (
                    eDate.getFullYear() === today.getFullYear() &&
                    eDate.getMonth() === today.getMonth() &&
                    eDate.getDate() === today.getDate()
                );
            }).length || 0;
            if (todayAttendance > 0) classesToday++;
            totalAttendance += todayAttendance;
        }
        document.getElementById('statClassesToday').textContent = classesToday;
        document.getElementById('statAttendanceToday').textContent = totalAttendance;

        // ----------- In Gym Right Now (original) -----------
        const logsResp = await apiFetch('/api/attendance/logs/today');
        const logsJson = logsResp; // Direct use
        if (logsJson.success && Array.isArray(logsJson.logs)) {
            // Track the latest log per member today (by timestamp order)
            const latestEvent = {};
            for (const log of logsJson.logs) {
                // prefer ISO timestamp, fallback to Date.parse if needed
                const mId = log.memberId && (log.memberId._id || log.memberId);
                if (!mId) continue;
                // If not sorted, always keep the *latest* event!
                if (
                    !latestEvent[mId] ||
                    new Date(log.timestamp).getTime() > new Date(latestEvent[mId].timestamp).getTime()
                ) {
                    latestEvent[mId] = log;
                }
            }
            // Count only those whose latest event is logType: "login"
            const inGymCount = Object.values(latestEvent).filter(ev => ev.logType === "login").length;
            document.getElementById('statInGymNow').textContent = inGymCount;
        } else {
            document.getElementById('statInGymNow').textContent = '?';
        }

        // Auto-refresh every 5 seconds (original)
        setTimeout(loadDashboardStats, 5000);
    } catch (err) {
        console.error('Dashboard stats error:', err);
        document.getElementById('statTotalMembers').textContent =
            document.getElementById('statTotalTrainers').textContent =
            document.getElementById('statClassesToday').textContent =
            document.getElementById('statAttendanceToday').textContent =
            document.getElementById('statInGymNow').textContent = '?';
    }
}

async function loadTodayClassSchedules() {
    const status = document.getElementById('dashboardStatus');
    const tableBody = document.getElementById('scheduleTableBody');
    tableBody.innerHTML = '';
    try {
        const today = new Date();
        const yyyyMMdd = today.toISOString().split('T')[0];
        const classesResp = await apiFetch('/api/classes');
        const classJson = classesResp; // Direct use (already JSON)
        if (!classJson.success) throw new Error('Failed to fetch classes');
        const allClasses = classJson.data;
        const trainersResp = await apiFetch('/api/trainers');
        const trainerJson = trainersResp; // Direct use
        const trainersMap = (trainerJson.data || []).reduce((map, t) => {
            map[t.trainer_id] = t.name;
            return map;
        }, {});
        let shown = 0;
        for (const cls of allClasses) {
            const enrollResp = await apiFetch(`/api/classes/${cls.class_id}/enrollments`);
            const enrollJson = enrollResp; // Direct use
            let todayAttendance = 0;
            const todayDate = new Date(yyyyMMdd);
            if (enrollJson.data && enrollJson.data.length > 0) {
                todayAttendance = enrollJson.data.filter(e => {
                    if (!e.session_date) return false;
                    const eDate = new Date(e.session_date);
                    return (
                        eDate.getFullYear() === todayDate.getFullYear() &&
                        eDate.getMonth() === todayDate.getMonth() &&
                        eDate.getDate() === todayDate.getDate()
                    );
                }).length;
            }
            if (todayAttendance === 0 && enrollJson.data) {
                todayAttendance = enrollJson.data.filter(e => e.status === 'active').length;
            }
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${cls.class_name}</td>
                <td>${trainersMap[cls.trainer_id] || "Unknown"}</td>
                <td>${cls.schedule}</td>
                <td style="text-align:center;"><b>${todayAttendance}</b></td>
            `;
            tableBody.appendChild(tr);
            shown++;
        }
        status.textContent = shown ? '' : 'No classes scheduled for today.';
    } catch (err) {
        console.error('Schedule load error:', err);
        status.textContent = 'Failed to load schedule/attendance. ' + (err.message || err);
    }
}

function setupSidebarAndSession() {
    // Original sidebar logic (restored)
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    const authUser = JSON.parse(sessionStorage.getItem('authUser') || '{}');
    
    // Security: Check timestamp + clear token/role on logout
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
