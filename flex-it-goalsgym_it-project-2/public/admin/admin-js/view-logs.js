document.addEventListener('DOMContentLoaded', function () {
  const logsTableBody = document.querySelector('#logs-table tbody');
  const roleFilter = document.getElementById('role-filter');
  const dateFilter = document.getElementById('date-filter');

  async function fetchLogs() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/login.html';
        return;
      }

      const role = roleFilter.value;
      const date = dateFilter.value;

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
        throw new Error('Failed to fetch logs');
      }

      const { data } = await response.json();
      displayLogs(data);
    } catch (error) {
      console.error('Error fetching logs:', error);
      logsTableBody.innerHTML =
        '<tr><td colspan="5">Error fetching logs.</td></tr>';
    }
  }

  function displayLogs(logs) {
    if (logs.length === 0) {
      logsTableBody.innerHTML = '<tr><td colspan="5">No logs found.</td></tr>';
      return;
    }

    logsTableBody.innerHTML = logs
      .map(
        (log) => {
          console.log(log.userId);
          return `
      <tr>
        <td>${log.userId ? log.userId.name || log.userId.username : 'N/A'}</td>
        <td>${log.ipAddress}</td>
        <td>${log.device}</td>
        <td>${log.location}</td>
        <td>${new Date(log.timestamp).toLocaleString()}</td>
      </tr>
    `
        }
      )
      .join('');
  }

  roleFilter.addEventListener('change', fetchLogs);
  dateFilter.addEventListener('change', fetchLogs);

  fetchLogs();
});
