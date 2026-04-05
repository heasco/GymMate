// --- Theme Init & Real-Time Sync ---
function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.classList.add('light-mode');
        document.body.classList.add('light-mode');
    } else {
        document.documentElement.classList.remove('light-mode');
        document.body.classList.remove('light-mode');
    }
}

// 1. Apply immediately when the dashboard loads
applyTheme(localStorage.getItem('admin_theme'));

// 2. Listen for changes
window.addEventListener('storage', (e) => {
    if (e.key === 'admin_theme') applyTheme(e.newValue);
});


document.addEventListener('DOMContentLoaded', function () {
  const logsTableBody = document.querySelector('#logs-table tbody');

  // View toggle buttons
  const webLogsBtn = document.getElementById('web-logs-btn');
  const gymAttendanceBtn = document.getElementById('gym-attendance-btn');
  const expiredMembershipsBtn = document.getElementById('expired-memberships-btn');

  // Filters Containers
  const webLogsFilters = document.getElementById('web-logs-filters');
  const gymAttendanceFilters = document.getElementById('gym-attendance-filters');
  const expiredMembershipsFilters = document.getElementById('expired-memberships-filters');

  // Table headers
  const webLogsHeader = document.getElementById('web-logs-header');
  const gymAttendanceHeader = document.getElementById('gym-attendance-header');
  const expiredMembershipsHeader = document.getElementById('expired-memberships-header');

  // Web Log Filter Elements
  const webNameSearch = document.getElementById('web-name-search');
  const roleFilter = document.getElementById('role-filter');
  const webStartDate = document.getElementById('web-start-date');
  const webEndDate = document.getElementById('web-end-date');
  const webEndIcon = document.getElementById('webEndIcon');
  const webSearchBtn = document.getElementById('web-search-btn');
  const webResetBtn = document.getElementById('web-reset-btn');

  // Gym Attendance Filter Elements
  const nameSearch = document.getElementById('name-search');
  const gymStartDate = document.getElementById('gym-start-date');
  const gymEndDate = document.getElementById('gym-end-date');
  const gymEndIcon = document.getElementById('gymEndIcon');
  const logTypeFilter = document.getElementById('log-type-filter');
  const searchBtn = document.getElementById('search-btn');
  const resetBtn = document.getElementById('reset-btn');

  // Expired Memberships Filter Elements
  const expiredNameSearch = document.getElementById('expired-name-search');
  const expiredStartDate = document.getElementById('expired-start-date');
  const expiredStartIcon = document.getElementById('expiredStartIcon');
  const expiredSearchBtn = document.getElementById('expired-search-btn');
  const expiredResetBtn = document.getElementById('expired-reset-btn');

  // Pagination Elements
  const pageSizeSelect = document.getElementById('pageSize');
  const prevPageBtn = document.getElementById('prevPage');
  const nextPageBtn = document.getElementById('nextPage');
  const pageInfo = document.getElementById('pageInfo');

  let currentView = 'web'; // 'web', 'gym', or 'expired'
  let currentPage = 1;
  let pageSize = 25;

  // --- Utility: Refresh View with Page Reset ---
  function triggerSearch() {
    currentPage = 1;
    refreshCurrentView();
  }

  function refreshCurrentView() {
    if (currentView === 'web') fetchWebLogs();
    else if (currentView === 'gym') fetchGymAttendance();
    else if (currentView === 'expired') fetchExpiredMemberships();
  }

  // --- Handlers for linking Start and End dates ---
  function handleStartDateChange(startInput, endInput, endIcon, fetchFunction) {
    if (startInput.value) {
      endInput.disabled = false;
      endIcon.disabled = false;
      
      if (endInput.value && new Date(endInput.value) < new Date(startInput.value)) {
        endInput.value = '';
      }
    } else {
      endInput.disabled = true;
      endIcon.disabled = true;
      endInput.value = '';
    }
    triggerSearch();
  }

  // Date Event Listeners
  webStartDate.addEventListener('change', () => handleStartDateChange(webStartDate, webEndDate, webEndIcon, triggerSearch));
  webEndDate.addEventListener('change', triggerSearch);

  gymStartDate.addEventListener('change', () => handleStartDateChange(gymStartDate, gymEndDate, gymEndIcon, triggerSearch));
  gymEndDate.addEventListener('change', triggerSearch);
  
  expiredStartDate.addEventListener('change', triggerSearch);


  // --- Initialize mini-calendars ---
  initMiniCalendar('web-start-date', 'webStartIcon', 'webStartPopup', () => { webStartDate.dispatchEvent(new Event('change')) });
  initMiniCalendar('web-end-date', 'webEndIcon', 'webEndPopup', () => { webEndDate.dispatchEvent(new Event('change')) }, 'web-start-date');
  
  initMiniCalendar('gym-start-date', 'gymStartIcon', 'gymStartPopup', () => { gymStartDate.dispatchEvent(new Event('change')) });
  initMiniCalendar('gym-end-date', 'gymEndIcon', 'gymEndPopup', () => { gymEndDate.dispatchEvent(new Event('change')) }, 'gym-start-date');

  initMiniCalendar('expired-start-date', 'expiredStartIcon', 'expiredStartPopup', () => { expiredStartDate.dispatchEvent(new Event('change')) });

  // --- View Toggle ---
  function setView(view) {
    currentView = view;
    currentPage = 1; // Reset page on view switch
    
    // Reset all
    webLogsBtn.classList.remove('active');
    gymAttendanceBtn.classList.remove('active');
    expiredMembershipsBtn.classList.remove('active');
    
    webLogsFilters.style.display = 'none';
    gymAttendanceFilters.style.display = 'none';
    expiredMembershipsFilters.style.display = 'none';
    
    webLogsHeader.style.display = 'none';
    gymAttendanceHeader.style.display = 'none';
    expiredMembershipsHeader.style.display = 'none';

    if (view === 'web') {
      webLogsBtn.classList.add('active');
      webLogsFilters.style.display = 'flex';
      webLogsHeader.style.display = 'table-header-group';
    } else if (view === 'gym') {
      gymAttendanceBtn.classList.add('active');
      gymAttendanceFilters.style.display = 'flex';
      gymAttendanceHeader.style.display = 'table-header-group';
    } else if (view === 'expired') {
      expiredMembershipsBtn.classList.add('active');
      expiredMembershipsFilters.style.display = 'flex';
      expiredMembershipsHeader.style.display = 'table-header-group';
    }

    refreshCurrentView();
  }

  // --- Pagination Logic ---
  function updatePaginationUI(pagination) {
    if (!pagination) return;
    const { page, pages, total } = pagination;
    
    const totalPages = pages > 0 ? pages : 1;
    pageInfo.textContent = `Page ${page} of ${totalPages} (${total} total)`;
    
    prevPageBtn.disabled = page <= 1;
    nextPageBtn.disabled = page >= totalPages;
  }

  pageSizeSelect.addEventListener('change', (e) => {
    pageSize = parseInt(e.target.value, 10);
    currentPage = 1; // Reset to page 1 on page size change
    refreshCurrentView();
  });

  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      refreshCurrentView();
    }
  });

  nextPageBtn.addEventListener('click', () => {
    currentPage++;
    refreshCurrentView();
  });

  // --- Data Fetching ---
  async function fetchWebLogs() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/login.html';
        return;
      }

      const params = new URLSearchParams();
      if (webNameSearch.value.trim()) params.append('name', webNameSearch.value.trim());
      if (roleFilter.value) params.append('role', roleFilter.value);
      if (webStartDate.value) params.append('startDate', webStartDate.value);
      if (webEndDate.value && !webEndDate.disabled) params.append('endDate', webEndDate.value);
      
      params.append('page', currentPage);
      params.append('limit', pageSize);

      const url = `http://localhost:8080/api/logs?${params.toString()}`;

      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Failed to fetch web logs');

      const { data, pagination } = await response.json();
      displayWebLogs(data);
      updatePaginationUI(pagination);
    } catch (error) {
      console.error('Error fetching web logs:', error);
      logsTableBody.innerHTML = '<tr><td colspan="6">Error fetching web logs.</td></tr>';
    }
  }

  function displayWebLogs(logs) {
    if (logs.length === 0) {
      logsTableBody.innerHTML = '<tr><td colspan="6" class="center-align">No web logs found.</td></tr>';
      return;
    }
    logsTableBody.innerHTML = logs.map(log => `
      <tr>
        <td>${new Date(log.timestamp).toLocaleString()}</td>
        <td><strong>${log.userId ? log.userId.name || log.userId.username : 'N/A'}</strong></td>
        <td>${log.userModel}</td>
        <td>${log.ipAddress}</td>
        <td>${log.device}</td>
        <td>${log.location}</td>
      </tr>
    `).join('');
  }

  async function fetchGymAttendance() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/login.html';
        return;
      }

      const params = new URLSearchParams();
      if (nameSearch.value.trim()) params.append('name', nameSearch.value.trim());
      if (logTypeFilter.value) params.append('logType', logTypeFilter.value);
      if (gymStartDate.value) params.append('startDate', gymStartDate.value);
      if (gymEndDate.value && !gymEndDate.disabled) params.append('endDate', gymEndDate.value);
      
      params.append('page', currentPage);
      params.append('limit', pageSize);

      const url = `http://localhost:8080/api/attendance-logs?${params.toString()}`;

      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Failed to fetch gym attendance');

      const { data, pagination } = await response.json();
      displayGymAttendance(data);
      updatePaginationUI(pagination);
    } catch (error) {
      console.error('Error fetching gym attendance:', error);
      logsTableBody.innerHTML = '<tr><td colspan="4">Error fetching gym attendance.</td></tr>';
    }
  }

  function displayGymAttendance(logs) {
    if (logs.length === 0) {
      logsTableBody.innerHTML = '<tr><td colspan="4" class="center-align">No gym attendance logs found.</td></tr>';
      return;
    }
    logsTableBody.innerHTML = logs.map(log => {
      const memberName = log.memberId && log.memberId.name ? log.memberId.name : 'Unknown or Deleted Member';
      return `
        <tr>
          <td>${new Date(log.timestamp).toLocaleString()}</td>
          <td><strong>${memberName}</strong></td>
          <td>${log.logType.toUpperCase()}</td>
          <td>${log.attendedType}</td>
        </tr>
      `
    }).join('');
  }

  async function fetchExpiredMemberships() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/login.html';
        return;
      }

      const params = new URLSearchParams();
      if (expiredNameSearch.value.trim()) params.append('name', expiredNameSearch.value.trim());
      if (expiredStartDate.value) params.append('startDate', expiredStartDate.value);
      
      params.append('page', currentPage);
      params.append('limit', pageSize);

      const url = `http://localhost:8080/api/logs/expired?${params.toString()}`;

      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Failed to fetch expired memberships');

      const { data, pagination } = await response.json();
      displayExpiredMemberships(data);
      updatePaginationUI(pagination);
    } catch (error) {
      console.error('Error fetching expired memberships:', error);
      logsTableBody.innerHTML = '<tr><td colspan="6">Error fetching expired memberships.</td></tr>';
    }
  }

  function displayExpiredMemberships(logs) {
    if (logs.length === 0) {
      logsTableBody.innerHTML = '<tr><td colspan="6" class="center-align">No expired memberships found.</td></tr>';
      return;
    }
    logsTableBody.innerHTML = logs.map(log => {
      const memberName = log.member && log.member.name ? log.member.name : 'Unknown or Deleted Member';
      return `
        <tr>
          <td>${new Date(log.archivedAt).toLocaleString()}</td>
          <td><strong>${memberName}</strong></td>
          <td>${log.type.toUpperCase()}</td>
          <td>${log.duration} Days</td>
          <td>${new Date(log.startDate).toLocaleDateString()}</td>
          <td>${new Date(log.endDate).toLocaleDateString()}</td>
        </tr>
      `
    }).join('');
  }

  // --- UI Listeners ---

  // Web Logs View Listeners
  webLogsBtn.addEventListener('click', () => setView('web'));
  roleFilter.addEventListener('change', triggerSearch);
  webSearchBtn.addEventListener('click', triggerSearch);
  
  webNameSearch.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') triggerSearch();
  });

  webResetBtn.addEventListener('click', () => {
    webNameSearch.value = '';
    roleFilter.value = '';
    webStartDate.value = '';
    webEndDate.value = '';
    webEndDate.disabled = true;
    webEndIcon.disabled = true;
    triggerSearch();
  });

  // Gym Attendance View Listeners
  gymAttendanceBtn.addEventListener('click', () => setView('gym'));
  searchBtn.addEventListener('click', triggerSearch);
  
  logTypeFilter.addEventListener('change', triggerSearch);
  
  nameSearch.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') triggerSearch();
  });

  resetBtn.addEventListener('click', () => {
    nameSearch.value = '';
    gymStartDate.value = '';
    gymEndDate.value = '';
    gymEndDate.disabled = true;
    gymEndIcon.disabled = true;
    logTypeFilter.value = '';
    triggerSearch();
  });

  // Expired Memberships View Listeners
  expiredMembershipsBtn.addEventListener('click', () => setView('expired'));
  expiredSearchBtn.addEventListener('click', triggerSearch);
  
  expiredNameSearch.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') triggerSearch();
  });

  expiredResetBtn.addEventListener('click', () => {
    expiredNameSearch.value = '';
    expiredStartDate.value = '';
    triggerSearch();
  });

  // Initial load
  setView('web');
  
  // ---------- Mini Calendar Utility ----------
  function initMiniCalendar(inputId, buttonId, popupId, onSelect, minDateInputId = null) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(buttonId);
    const popup = document.getElementById(popupId);
    if (!input || !btn || !popup) return;

    let current = input.value ? new Date(input.value) : new Date();
    if (Number.isNaN(current.getTime())) current = new Date();

    const titleEl = popup.querySelector('.mini-calendar-title');
    const gridEl = popup.querySelector('.mini-calendar-grid');
    const navBtns = popup.querySelectorAll('.mini-cal-nav');

    function renderCalendar() {
      const year = current.getFullYear();
      const month = current.getMonth();
      const today = new Date();
      today.setHours(0,0,0,0);

      let minDateLimit = null;
      if (minDateInputId) {
        const minInput = document.getElementById(minDateInputId);
        if (minInput && minInput.value) {
          minDateLimit = new Date(minInput.value);
          minDateLimit.setHours(0,0,0,0);
        }
      }

      if (titleEl) {
        const formatter = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' });
        titleEl.textContent = formatter.format(current);
      }

      if (!gridEl) return;
      gridEl.innerHTML = '';

      const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
      dayNames.forEach((d) => {
        const h = document.createElement('button');
        h.type = 'button';
        h.textContent = d;
        h.className = 'mini-cal-day-header';
        gridEl.appendChild(h);
      });

      const firstDay = new Date(year, month, 1);
      const startWeekday = firstDay.getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      for (let i = 0; i < startWeekday; i += 1) {
        const empty = document.createElement('button');
        empty.type = 'button';
        empty.className = 'mini-cal-day mini-cal-day-disabled';
        empty.textContent = '';
        gridEl.appendChild(empty);
      }

      const selectedDateStr = input.value || null;

      for (let day = 1; day <= daysInMonth; day += 1) {
        const btnDay = document.createElement('button');
        btnDay.type = 'button';
        btnDay.textContent = String(day);
        
        const thisDate = new Date(year, month, day);
        const iso = thisDate.toISOString().slice(0, 10);
        
        let isDisabled = false;
        if (thisDate > today) {
          isDisabled = true;
        }
        if (minDateLimit && thisDate < minDateLimit) {
          isDisabled = true;
        }

        if (isDisabled) {
          btnDay.className = 'mini-cal-day mini-cal-day-disabled';
          btnDay.disabled = true;
        } else {
          btnDay.className = 'mini-cal-day';
          if (selectedDateStr && iso === selectedDateStr) {
            btnDay.classList.add('mini-cal-day-selected');
          }
          btnDay.addEventListener('click', () => {
            input.value = iso;
            popup.classList.add('hidden');
            if (typeof onSelect === 'function') {
              onSelect(iso);
            }
          });
        }
        gridEl.appendChild(btnDay);
      }
    }

    navBtns.forEach((n) =>
      n.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dir = Number(n.getAttribute('data-dir') || '0');
        current.setMonth(current.getMonth() + dir);
        renderCalendar();
      })
    );

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      popup.classList.toggle('hidden');
      current = input.value ? new Date(input.value) : new Date();
      if (Number.isNaN(current.getTime())) current = new Date();
      renderCalendar();
    });

    document.addEventListener('click', (e) => {
      if (!popup.contains(e.target) && !btn.contains(e.target)) {
        popup.classList.add('hidden');
      }
    });
  }
});