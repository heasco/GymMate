// ========================================
// Member Dashboard - Full Member + Enrollments + Classes
// ========================================

// Server base (matches your app.js port)
const SERVER_URL = 'http://localhost:8080';

// Secure API fetch (your pattern) - Always full URL for APIs
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  const token = sessionStorage.getItem('token');
  if (!token) {
    sessionStorage.clear();
    window.location.href = '../member-login.html';
    return;
  }
  let url = endpoint;
  if (!endpoint.startsWith('http')) {
    if (!endpoint.startsWith('/api/')) {
      endpoint = '/api' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    }
    url = `${SERVER_URL}${endpoint}`;
    console.log('API URL:', url);  // Debug
  }
  const headers = { ...options.headers, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.status === 401 || res.status === 403) {
      sessionStorage.clear();
      window.location.href = '../member-login.html';
      return;
    }
    if (!res.ok) throw new Error(`API error: ${res.status} - ${res.statusText}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw e;
  }
}

// Auth check on load (1-hour expiry, role: 'member')
(function checkAuth() {
  const authUser = JSON.parse(sessionStorage.getItem('authUser') || 'null');
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  if (!authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000 || !token || role !== 'member') {
    sessionStorage.clear();
    window.location.href = '../member-login.html';
  }
})();

// Utilities
const $ = (id) => document.getElementById(id);
function getAuth() {
  try { return JSON.parse(sessionStorage.getItem('authUser') || 'null'); } catch { return null; }
}
function getMemberId() {
  const a = getAuth(); if (!a) return null;
  const u = a.user || a;
  const memberId = u.memberId || u.member_id || u.id;  // Custom string ID first
  if (memberId) {
    console.log('Using memberId:', memberId);
    return memberId;
  }
  return null;
}

// DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  // Sidebar toggle
  const menuToggle = $('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  }

  // Logout
  const logoutBtn = $('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      sessionStorage.clear();
      window.location.href = '../member-login.html';
    });
  }

  // Set basic info (from session)
  const storedName = sessionStorage.getItem('memberName') || 'Member';
  if ($('dashboardName')) $('dashboardName').textContent = storedName;
  const auth = getAuth();
  const sessionU = auth?.user || auth;  // Renamed for clarity
  if (sessionU && $('dashboardMemberId')) {
    $('dashboardMemberId').textContent = `ID: ${sessionU.memberId || sessionU.member_id || sessionU._id?.toString().slice(-6) || 'N/A'}`;
  }

  // Load dashboard data
  await loadDashboardData();
});

// Load dashboard - Member (memberships/remaining), Enrollments (upcoming classes), Classes (names)
async function loadDashboardData() {
  const memberId = getMemberId();
  if (!memberId) {
    showError('Session expired or invalid user data. Please log in again.');
    return;
  }

  // Re-define session user here (scope fix)
  const auth = getAuth();
  const sessionU = auth?.user || auth;

  const now = new Date();
  let fullMember = null;
  let enrollsData = [];

  try {
    // Parallel: Full member (for updated memberships/remaining) + Upcoming enrollments (for classes)
    const [memberRes, enrollsRes] = await Promise.allSettled([
      apiFetch(`/members/${memberId}`),
      apiFetch(`/enrollments/member/${memberId}`)
    ]);

    // Full Member (your route: /members/:memberId)
    if (memberRes.status === 'fulfilled' && memberRes.value?.success && memberRes.value.data) {
      fullMember = memberRes.value.data;
      console.log('Full member data:', fullMember);  // Debug: Check memberships
    } else {
      console.warn('Member fetch failed, using session fallback');
      fullMember = sessionU;  // Partial session
    }

    // Upcoming Enrollments (your route: active, future sessions)
    if (enrollsRes.status === 'fulfilled' && enrollsRes.value?.success && Array.isArray(enrollsRes.value.data)) {
      enrollsData = enrollsRes.value.data;
      console.log('Upcoming enrollments:', enrollsData);  // Debug
    }

    // Profile from fullMember (updated) + session fallback (scope-safe)
    if ($('infoEmail')) $('infoEmail').textContent = fullMember.email || sessionU.email || 'N/A';
    if ($('infoPhone')) $('infoPhone').textContent = fullMember.phone || sessionU.phone || 'N/A';
    if ($('infoJoinDate')) {
      const joinDate = fullMember.joinDate || fullMember.createdAt || sessionU.joinDate;
      $('infoJoinDate').textContent = joinDate ? new Date(joinDate).toLocaleDateString() : 'N/A';
    }

    // Recent/Upcoming Table (from enrollments)
    const recentAndUpcoming = enrollsData.slice(0, 5);
    const tbody = $('recentClassesTable')?.querySelector('tbody');
    if (tbody) {
      tbody.innerHTML = recentAndUpcoming.length ? recentAndUpcoming.map(e => {
        const date = new Date(e.session_date || e.sessiondate || e.date);
        const status = e.attendance_status === 'attended' ? 'Attended' : 'Upcoming';
        return `
          <tr>
            <td>${e.className || e.class?.name || 'Class'}</td>
            <td>${date.toLocaleDateString('en-US', { weekday: 'short' })}</td>
            <td>${date.toLocaleDateString()}</td>
            <td class="${status.toLowerCase()}">${status}</td>
          </tr>
        `;
      }).join('') : '<tr><td colspan="4" style="color: var(--neutral); font-style: italic;">No upcoming classes</td></tr>';
    }

    // Memberships List (from fullMember; active only)
    const memberships = fullMember.memberships || sessionU.memberships || [];
    const activeTypes = memberships.filter(m => 
      m.status === 'active' && 
      now >= new Date(m.startDate || m.start_date) && 
      now <= new Date(m.endDate || m.end_date)
    ).map(m => m.type);
    const hasMonthly = activeTypes.includes('monthly');
    const hasCombative = activeTypes.includes('combative');

    console.log('Active types:', activeTypes);  // Debug

    const membershipList = $('membershipTypes');
    if (membershipList) {
      membershipList.innerHTML = activeTypes.length ? 
        activeTypes.map(type => `<li>${type.charAt(0).toUpperCase() + type.slice(1)} Membership</li>`).join('') : 
        '<li>No active memberships</li>';
    }

    // Remaining Sessions (from fullMember memberships.remainingSessions; class names from upcoming combative enrolls)
    let remainingText = '—';
    const activeCombative = memberships.find(m => m.type === 'combative' && m.status === 'active' && now >= new Date(m.startDate || m.start_date) && now <= new Date(m.endDate || m.end_date));
    const combRemaining = activeCombative ? (activeCombative.remainingSessions || 0) : 0;

    // Get unique class names for upcoming combative enrollments (fetch classes if needed)
    let upcomingClassNames = [];
    const upcomingCombEnrolls = enrollsData.filter(e => 
      (e.class?.type || 'combative') === 'combative' &&  // Assume class.type; adjust if flat
      new Date(e.session_date || e.sessiondate) >= now
    );
    if (upcomingCombEnrolls.length > 0 && !upcomingCombEnrolls[0].class?.name) {
      // Sequential fetch classes (limit 5; your /classes/:id route)
      for (const enroll of upcomingCombEnrolls.slice(0, 5)) {
        try {
          const classRes = await apiFetch(`/classes/${enroll.classid || enroll.class_id}`);
          if (classRes?.success && classRes.data?.name) {
            upcomingClassNames.push(classRes.data.name);
          }
        } catch (classErr) {
          console.warn('Class fetch failed for', enroll.classid, classErr);
        }
      }
    } else {
      // Already populated? Use e.class.name
      upcomingClassNames = [...new Set(upcomingCombEnrolls.map(e => e.class?.name || e.className).filter(Boolean))];
    }
    const classesStr = upcomingClassNames.length ? ` (Upcoming: ${upcomingClassNames.join(', ')})` : '';

    console.log('Combative remaining:', combRemaining, 'Upcoming classes:', upcomingClassNames);  // Debug

    if (hasMonthly) {
      remainingText = 'Unlimited gym access';
      if (hasCombative && combRemaining > 0) {
        remainingText += ` + ${combRemaining} combative sessions remaining${classesStr}`;
      } else if (hasCombative) {
        remainingText += ` + 0 combative sessions remaining${classesStr}`;
      }
    } else if (hasCombative) {
      remainingText = combRemaining ? `${combRemaining} sessions remaining${classesStr}` : '0';
    }
    if ($('remainingCombSessions')) $('remainingCombSessions').textContent = remainingText;

    console.log('Final remaining text:', remainingText);  // Debug

  } catch (err) {
    console.error('Dashboard load failed:', err);
    showError(`Failed to load dashboard: ${err.message}. Check backend on port 8080.`);
  }
}

function showError(msg) {
  const errorEl = $('error');
  if (errorEl) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
}
