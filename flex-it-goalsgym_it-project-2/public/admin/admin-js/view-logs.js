document.addEventListener('DOMContentLoaded', function () {
  const logsTableBody = document.querySelector('#logs-table tbody');

  // View toggle buttons
  const webLogsBtn = document.getElementById('web-logs-btn');
  const gymAttendanceBtn = document.getElementById('gym-attendance-btn');

  // Filters
  const webLogsFilters = document.getElementById('web-logs-filters');
  const gymAttendanceFilters = document.getElementById('gym-attendance-filters');

  // Table headers
  const webLogsHeader = document.getElementById('web-logs-header');
  const gymAttendanceHeader = document.getElementById('gym-attendance-header');

  // Web Log Filters
  const roleFilter = document.getElementById('role-filter');
  const webDateFilter = document.getElementById('web-date-filter');

  // Gym Attendance Filters
  const nameSearch = document.getElementById('name-search');
  const gymDateFilter = document.getElementById('gym-date-filter');
  const logTypeFilter = document.getElementById('log-type-filter');
  const searchBtn = document.getElementById('search-btn');
  const resetBtn = document.getElementById('reset-btn');

  let currentView = 'web'; // 'web' or 'gym'

  function setView(view) {
    currentView = view;
    if (view === 'web') {
      webLogsBtn.classList.add('active');
      gymAttendanceBtn.classList.remove('active');
      webLogsFilters.style.display = 'flex';
      gymAttendanceFilters.style.display = 'none';
      webLogsHeader.style.display = 'table-header-group';
      gymAttendanceHeader.style.display = 'none';
      fetchWebLogs();
    } else {
      webLogsBtn.classList.remove('active');
      gymAttendanceBtn.classList.add('active');
      webLogsFilters.style.display = 'none';
      gymAttendanceFilters.style.display = 'flex';
      webLogsHeader.style.display = 'none';
      gymAttendanceHeader.style.display = 'table-header-group';
      fetchGymAttendance();
    }
  }

  async function fetchWebLogs() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/login.html';
        return;
      }

      const role = roleFilter.value;
      const date = webDateFilter.value;

      let url = 'http://localhost:8080/api/logs?';
      if (role) {
        url += `role=${role}&`;
      }
      if (date) {
        url += `date=${date}&`;
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch web logs');
      }

      const { data } = await response.json();
      displayWebLogs(data);
    } catch (error) {
      console.error('Error fetching web logs:', error);
      logsTableBody.innerHTML =
        '<tr><td colspan="5">Error fetching web logs.</td></tr>';
    }
  }

  function displayWebLogs(logs) {
    if (logs.length === 0) {
      logsTableBody.innerHTML =
        '<tr><td colspan="6">No web logs found.</td></tr>';
      return;
    }

    logsTableBody.innerHTML = logs
      .map(
        (log) => `
      <tr>
        <td>${log.userId ? log.userId.name || log.userId.username : 'N/A'}</td>
        <td>${log.userModel}</td>
        <td>${log.ipAddress}</td>
        <td>${log.device}</td>
        <td>${log.location}</td>
        <td>${new Date(log.timestamp).toLocaleString()}</td>
      </tr>
    `
      )
      .join('');
  }

  async function fetchGymAttendance() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/login.html';
        return;
      }

      const name = nameSearch.value;
      const date = gymDateFilter.value;
      const logType = logTypeFilter.value;

      let url = 'http://localhost:8080/api/attendance-logs?';
      if (name) {
        url += `name=${name}&`;
      }
      if (date) {
        url += `date=${date}&`;
      }
      if (logType) {
        url += `logType=${logType}&`;
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch gym attendance');
      }

      const { data } = await response.json();
      displayGymAttendance(data);
    } catch (error) {
      console.error('Error fetching gym attendance:', error);
      logsTableBody.innerHTML =
        '<tr><td colspan="4">Error fetching gym attendance.</td></tr>';
    }
  }

  function displayGymAttendance(logs) {
    if (logs.length === 0) {
      logsTableBody.innerHTML =
        '<tr><td colspan="4">No gym attendance found.</td></tr>';
      return;
    }

    logsTableBody.innerHTML = logs
      .map(
        (log) => {
          const memberName = log.memberId && log.memberId.name ? log.memberId.name : 'Unknown or Deleted Member';
          return `
      <tr>
        <td>${memberName}</td>
        <td>${log.logType}</td>
        <td>${log.attendedType}</td>
        <td>${new Date(log.timestamp).toLocaleString()}</td>
      </tr>
    `
        }
      )
      .join('');
  }

  // Event Listeners
  webLogsBtn.addEventListener('click', () => setView('web'));
  gymAttendanceBtn.addEventListener('click', () => setView('gym'));

  roleFilter.addEventListener('change', fetchWebLogs);
  webDateFilter.addEventListener('change', fetchWebLogs);

  searchBtn.addEventListener('click', fetchGymAttendance);
  resetBtn.addEventListener('click', () => {
    nameSearch.value = '';
    gymDateFilter.value = '';
    logTypeFilter.value = '';
    fetchGymAttendance();
  });

  // Initial load
  setView('web');
});

