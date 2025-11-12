const API_URL = 'http://localhost:8080';

// Get current week range
function getCurrentWeekRange() {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    const day = now.getDay() || 7;
    start.setDate(now.getDate() - day + 1);
    end.setDate(start.getDate() + 6);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

// Calculate attendance streak
function calcAttendanceStreak(dates) {
    if (dates.length === 0) return 0;
    let streak = 1, max = 1;
    dates.sort();
    for (let i = 1; i < dates.length; i++) {
        const d0 = new Date(dates[i - 1]);
        const d1 = new Date(dates[i]);
        if ((d1 - d0) === 86400000) {
            streak++;
            if (streak > max) max = streak;
        } else {
            streak = 1;
        }
    }
    return max;
}

document.addEventListener('DOMContentLoaded', async function () {
    // ✅ SIDEBAR & AUTH SETUP
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    const authUser = JSON.parse(localStorage.getItem('authUser'));

    // 🔍 DEBUG: Log the raw authUser to diagnose structure
    console.log('=== TRAINER AUTH DEBUG ===');
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
    console.log('Extracted trainer ID:', user.trainer_id || user.trainerid || user.id || user._id);

    if (menuToggle) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    if (logoutBtn) logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authUser');
        window.location.href = '../trainer-login.html';
    });

    // Display trainer info - FIXED: Use extracted user
    const trainerNameEl = document.getElementById('trainerName');
    const specializationEl = document.getElementById('specialization');
    if (trainerNameEl) trainerNameEl.textContent = user.name || 'Unknown Trainer';
    if (specializationEl && user.specialization) {
        specializationEl.textContent = `Specialization: ${user.specialization}`;
    }

    const scheduleDiv = document.getElementById('trainerSchedule');
    const loading = document.getElementById('scheduleLoading');
    const metricsDiv = document.getElementById('dashboardMetrics');

    if (!scheduleDiv || !loading || !metricsDiv) {
        console.error('Missing required DOM elements');
        return;
    }

    try {
        // Get trainer ID - FIXED: More fallbacks
        const trainerId = user.trainer_id || user.trainerid || user.trainerId || user.id || user._id;
        if (!trainerId) {
            throw new Error('No valid trainer ID found');
        }

        console.log('Fetching classes from:', `${API_URL}/api/classes`);
        // ✅ FETCH CLASSES FOR THIS TRAINER
        const resp = await fetch(`${API_URL}/api/classes`);
        if (!resp.ok) throw new Error(`Failed to fetch classes: ${resp.status} ${resp.statusText}`);

        const data = await resp.json();
        console.log('Classes API response:', data);
        const allFromApi = data.data || [];

        // Filter classes by trainer_id
        const classes = allFromApi.filter(c => {
            const cid = c.trainer_id || c.trainerid || c.trainerId || null;
            return cid === trainerId;
        });
        console.log('Filtered classes for trainer:', classes.length, classes);

        loading.style.display = 'none';

        if (classes.length === 0) {
            scheduleDiv.innerHTML = '<div class="no-classes">No assigned classes or schedule found.</div>';
            metricsDiv.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:2.5em 1.5em;">
                        <div><strong>Weekly Attendance Total:</strong> <span class="attendance-badge high-badge">0</span></div>
                        <div><strong>Most Attended Session:</strong> <span class="attendance-badge">N/A</span></div>
                    </div>`;
            console.log('No classes found for this trainer');
            return;
        }

        const { start: weekStart, end: weekEnd } = getCurrentWeekRange();
        let totalWeeklyAttendance = 0;
        let bestSession = null;
        let bestCount = 0;

        // ✅ FETCH ENROLLMENT DATA FOR EACH CLASS
        console.log('Fetching enrollments for', classes.length, 'classes...');
        const classInfo = await Promise.all(classes.map(async c => {
            const cid = c.class_id || c.classid || c._id;
            console.log(`Fetching enrollments for class ID: ${cid}`);
            let enrollments = [];

            try {
                const enrollResp = await fetch(`${API_URL}/api/classes/${cid}/enrollments`);
                if (enrollResp.ok) {
                    const enroll = await enrollResp.json();
                    enrollments = enroll.data || [];
                } else {
                    console.error(`Enrollments fetch failed for ${cid}: ${enrollResp.status}`);
                }
            } catch (err) {
                console.error('Error fetching enrollments for', cid, ':', err);
            }

            // Calculate attendance by date
            const attendanceByDate = {};
            let weeklyAttendance = 0;

            enrollments.forEach(e => {
                const status = (e.attendance_status || '').toLowerCase();
                if (status !== 'attended') return;

                const sessionDate = e.session_date;
                const dateStr = sessionDate ? (new Date(sessionDate)).toISOString().slice(0, 10) : 'unknown';

                if (!attendanceByDate[dateStr]) attendanceByDate[dateStr] = 0;
                attendanceByDate[dateStr]++;

                const dt = new Date(dateStr);
                if (dt >= weekStart && dt <= weekEnd) weeklyAttendance++;
            });

            // Update totals
            Object.entries(attendanceByDate).forEach(([dt, count]) => {
                totalWeeklyAttendance += (new Date(dt) >= weekStart && new Date(dt) <= weekEnd) ? count : 0;
                if (count > bestCount) {
                    bestCount = count;
                    bestSession = { class: c, date: dt, count };
                }
            });

            const enrolled = enrollments.length || 0;
            const capacity = c.capacity || '-';
            const participationRate = enrolled ? Math.round((weeklyAttendance / enrolled) * 100) : 0;
            const datesAttended = Object.keys(attendanceByDate);
            const streak = calcAttendanceStreak(datesAttended);
            const lowAttendance = enrolled && c.capacity && ((enrolled / c.capacity) < 0.5);

            return {
                name: c.class_name || c.classname || 'Unnamed',
                schedule: c.schedule || '',
                capacity,
                enrolled,
                weeklyAttendance,
                participationRate,
                mostAttended: Object.entries(attendanceByDate).sort((a, b) => b[1] - a[1])[0] || null,
                streak,
                attendanceByDate,
                lowAttendance
            };
        }));

        console.log('All class info processed:', classInfo);

        // ✅ UPDATE DASHBOARD METRICS
        let dashHTML = `<div style="display:flex;flex-wrap:wrap;gap:2.5em 1.5em;">`;
        dashHTML += `<div><strong>Weekly Attendance Total:</strong> <span class="attendance-badge high-badge">${totalWeeklyAttendance}</span></div>`;
        dashHTML += `<div><strong>Most Attended Session:</strong> <span class="attendance-badge">${bestSession ? `${bestSession.class.class_name || bestSession.class.classname} (${bestSession.date}) – ${bestSession.count} attended` : "N/A"}</span></div>`;
        dashHTML += `</div>`;
        metricsDiv.innerHTML = dashHTML;

        // ✅ BUILD ATTENDANCE TABLE
        let html = `<table class="dashboard-table"><thead><tr>
                        <th>Class Name</th>
                        <th>Schedule</th>
                        <th>Capacity</th>
                        <th>Enrolled</th>
                        <th>Attendance<br>This Week</th>
                        <th>Participation<br>Rate (%)</th>
                        <th>Attendance<br>Streak</th>
                        <th>Attended By Date</th>
                    </tr></thead><tbody>`;

        for (const c of classInfo) {
            html += `<tr${c.lowAttendance ? ' style="background:#fdf6b2;color:#78350f;border-left:5px solid #eab308"' : ''}>
                            <td>${c.name}</td>
                            <td>${c.schedule}</td>
                            <td>${c.capacity}</td>
                            <td><b>${c.enrolled}</b> ${c.lowAttendance ? '<span class="attendance-badge low-badge">Low</span>' : ''}</td>
                            <td><span class="attendance-badge high-badge">${c.weeklyAttendance}</span></td>
                            <td><span class="attendance-badge">${c.participationRate}%</span></td>
                            <td><span class="attendance-badge streak-badge">${c.streak}</span></td>
                            <td>`;

            html += Object.entries(c.attendanceByDate)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, count]) => `${date}: <b>${count}</b>`).join("<br>") || '<span style="color:#999">No attended sessions</span>';

            html += `</td></tr>`;
        }

        html += "</tbody></table>";
        scheduleDiv.innerHTML = html;

        console.log('Dashboard loaded successfully');
        console.log('=== END TRAINER DEBUG ===');

    } catch (err) {
        console.error('Error loading dashboard:', err);
        loading.style.display = 'none';
        scheduleDiv.innerHTML = `<div class="error">Failed to load schedule: ${err.message}. Check console for details.</div>`;
        // Fallback metrics
        metricsDiv.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:2.5em 1.5em;">
                        <div><strong>Weekly Attendance Total:</strong> <span class="attendance-badge high-badge">Error</span></div>
                        <div><strong>Most Attended Session:</strong> <span class="attendance-badge">Error</span></div>
                    </div>`;
    }
});