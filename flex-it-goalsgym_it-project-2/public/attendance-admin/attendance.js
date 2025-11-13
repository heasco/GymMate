// Utility for authenticated API calls (adds security header for /api/ routes) with timeout
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log('apiFetch called for:', endpoint);  // DEBUG
  const token = sessionStorage.getItem('token');
  if (!token) {
    console.log('No token - redirecting to login');  // DEBUG
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
    'Content-Type': 'application/json' // Default for JSON calls
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 401) {
      console.log('401 Unauthorized - clearing auth and redirecting');  // DEBUG
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
      window.location.href = '../admin-login.html';
      return;
    }
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`API timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

const SERVER_URL = 'http://localhost:8080';

// ✅ ENHANCED AUTH CHECK - Token + Role + Timestamp (MUST BE FIRST)
(function checkAuth() {
  console.log('Auth check starting');  // DEBUG
  const authUser = JSON.parse(sessionStorage.getItem('authUser') || 'null'); 
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  
  console.log('Auth details:', { authUser, token: !!token, role });  // DEBUG: Hide actual token
  
  // Check timestamp (1 hour) + token + admin role
  if (!authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000 || !token || role !== 'admin') { 
    console.log('Auth failed - clearing and redirecting');  // DEBUG
    sessionStorage.removeItem('authUser'); 
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html'; 
    return;
  } 
  
  console.log('Admin authenticated:', authUser.username, 'Role:', role);
})();


// ✅ Secured AttendanceSystem - All API calls via apiFetch
class AttendanceSystem {
  constructor() {
    console.log('Constructor called');  // DEBUG
    this.camera = document.getElementById('camera');
    this.snapshot = document.getElementById('snapshot');
    this.statusMessage = document.getElementById('statusMessage');
    this.logStatus = document.getElementById('logStatus');
    this.logsContainer = document.getElementById('logsContainer');
    this.modal = document.getElementById('attendanceModal');
    this.modalButtons = document.getElementById('modalButtons');
    this.modalMemberName = document.getElementById('modalMemberName');
    
    // FIXED: Smart fallback - Target existing loading parent from screenshot
    if (!this.logsContainer) {
      console.warn('logsContainer (#logsContainer) not found - searching for loading parent');
      // Find .loading-logs or element with loading text, use its parent as container
      let loadingEl = document.querySelector('.loading-logs') || 
                      Array.from(document.querySelectorAll('*')).find(el => 
                        el.textContent && el.textContent.includes('Loading attendance logs')
                      );
      if (loadingEl) {
        this.logsContainer = loadingEl.parentElement;  // Use parent (e.g., under header)
        console.log('Using existing logs section via loading parent');
        // Ensure ID for future refs
        this.logsContainer.id = 'logsContainer';
      } else {
        // Last resort: Create under attendance header/section
        const header = document.querySelector('h3, [class*="logs"], [class*="attendance"]') || 
                       document.querySelector('.sidebar');  // From screenshot: sidebar-like
        if (header) {
          this.logsContainer = document.createElement('div');
          this.logsContainer.id = 'logsContainer';
          this.logsContainer.className = 'attendance-logs-container';  // For styling match
          this.logsContainer.innerHTML = '<div class="loading-logs">Loading attendance logs...</div>';
          header.parentNode.insertBefore(this.logsContainer, header.nextSibling);  // Insert after header
          console.log('Created fallback container after header');
        } else {
          // Absolute last: Append to body (but styled minimally)
          this.logsContainer = document.createElement('div');
          this.logsContainer.id = 'logsContainer';
          this.logsContainer.style.cssText = 'position: relative; margin: 10px; padding: 10px; background: #333; color: white;';  // Basic dark match
          this.logsContainer.innerHTML = '<div class="loading-logs">Loading attendance logs...</div>';
          document.body.appendChild(this.logsContainer);
          console.log('Created minimal fallback on body');
        }
      }
    } else {
      console.log('logsContainer found directly');
    }
    
    console.log('Elements resolved:', {  // DEBUG
      camera: !!this.camera,
      logsContainer: !!this.logsContainer,
      modal: !!this.modal
    });
    
    this.lastFaceId = null;
    this.lastDetectedTime = 0;
    this.attendedTodayMap = {};
    
    this.API_URL = 'http://localhost:8080';
    this.FACE_API_URL = 'http://localhost:5001';
    
    this.init();
  }

  async init() {
    console.log('Init called');  // DEBUG
    try {
      // Sidebar/menu toggle if present (matches your original UI)
      const menuToggle = document.getElementById('menuToggle'); 
      const sidebar = document.querySelector('.sidebar'); 
      const logoutBtn = document.getElementById('logoutBtn'); 

      console.log('UI elements:', { menuToggle: !!menuToggle, sidebar: !!sidebar, logoutBtn: !!logoutBtn });  // DEBUG

      if (menuToggle && sidebar) { 
        menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed')); 
      } 

      // ✅ LOGOUT - Clears token + authUser + role
      if (logoutBtn) { 
        logoutBtn.addEventListener('click', () => { 
          sessionStorage.removeItem('token');
          sessionStorage.removeItem('authUser'); 
          sessionStorage.removeItem('role');
          window.location.href = '../admin-login.html'; 
        }); 
      } 

      // Close sidebar on outside click (mobile, original behavior)
      document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && sidebar && menuToggle && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
          sidebar.classList.remove('collapsed');
        }
      });

      if (sidebar) {
        sidebar.addEventListener('transitionend', () => {
          if (window.innerWidth <= 768 && sidebar.classList.contains('collapsed')) {
            document.body.style.overflow = 'hidden';
          } else {
            document.body.style.overflow = 'auto';
          }
        });
      }

      await this.startCamera();
      this.startFaceDetection();
      
      // FIXED: Clear loading immediately to unblock UI (null-safe, replaces in place)
      console.log('Clearing logsContainer...');  // DEBUG
      if (this.logsContainer) {
        // Remove loading child specifically to avoid full reset if header inside
        const loadingChild = this.logsContainer.querySelector('.loading-logs') || 
                             Array.from(this.logsContainer.children).find(child => 
                               child.textContent && child.textContent.includes('Loading attendance logs')
                             );
        if (loadingChild) {
          loadingChild.remove();
          console.log('Original loading removed - ready for logs');
        } else {
          this.logsContainer.innerHTML = '';  // Fallback clear
        }
      } else {
        console.error('logsContainer still null after fallback - skipping clear');
      }
      
      await this.loadAttendanceLogs();  // Now safe, renders in correct spot
      this.setupAutoRefresh();
      this.setupKeyboardShortcuts();
      console.log('Init completed successfully');  // DEBUG
    } catch (error) {
      console.error('Init error:', error);  // DEBUG: Catch any init failures
      // Fallback UI update (null-safe)
      if (this.logsContainer) {
        this.logsContainer.innerHTML = '<p class="no-logs">Error loading (check console)</p>';
      }
    }
  }

  // Keyboard shortcuts (original: R refresh, ESC close)
  setupKeyboardShortcuts() {
    console.log('Setting up keyboard shortcuts');  // DEBUG
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (confirm('Close attendance system?')) {
          window.close();
        }
      }
      if (e.key === 'r' || e.key === 'R') {
        this.loadAttendanceLogs();
        this.updateStatus('Logs refreshed', 'success');
      }
    });
  }

  async startCamera() {
    console.log('Starting camera');  // DEBUG
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      });
      if (this.camera) this.camera.srcObject = stream;
      this.updateStatus('Camera active - Ready for face detection', 'success');
      console.log('Camera started successfully');  // DEBUG
    } catch (error) {
      console.error('Camera error:', error);  // DEBUG
      this.updateStatus('Camera access denied: ' + error.message, 'error');
    }
  }

  updateStatus(message, type = 'info') {
    if (this.statusMessage) {
      this.statusMessage.textContent = message;
      this.statusMessage.style.color = 
        type === 'error' ? '#DC3545' : 
        type === 'success' ? '#28A745' : 
        '#BFBFBF';
    }
  }

  updateLogStatus(message, type = 'info') {
    if (this.logStatus) {
      this.logStatus.textContent = message;
      this.logStatus.style.color = 
        type === 'error' ? '#DC3545' : 
        type === 'success' ? '#28A745' : 
        type === 'warning' ? '#FFC107' : 
        '#BFBFBF';
    }
  }

  startFaceDetection() {
    console.log('Starting face detection interval');  // DEBUG
    setInterval(() => this.detectFace(), 3000);  // Original 3s interval
  }

  async detectFace() {
    if (!this.camera || !this.camera.srcObject) return;

    // Capture frame from camera (original method)
    const context = this.snapshot.getContext('2d');
    this.snapshot.width = this.camera.videoWidth;
    this.snapshot.height = this.camera.videoHeight;
    context.drawImage(this.camera, 0, 0, this.snapshot.width, this.snapshot.height);

    // Convert to blob for API
    const blob = await new Promise(resolve => 
      this.snapshot.toBlob(resolve, 'image/jpeg', 0.9)
    );

    await this.sendFaceForVerification(blob);
  }

  async sendFaceForVerification(blob) {
    const formData = new FormData();
    formData.append('image', blob, 'face_capture.jpg');

    try {
      const response = await fetch(`${this.FACE_API_URL}/api/verify-face`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data && data.status === 'success' && data.faceId) {
        await this.handleFaceDetected(data.faceId);
      } else {
        this.updateStatus('No recognizable face detected', 'info');
        this.lastFaceId = null;
      }
    } catch (error) {
      console.error('Face verification error:', error);  // DEBUG
      this.updateStatus('Face recognition service unavailable', 'error');
    }
  }

  async handleFaceDetected(faceId) {
    // Prevent duplicate within 5s (original)
    if (this.lastFaceId === faceId && Date.now() - this.lastDetectedTime < 5000) {
      return;
    }

    this.lastFaceId = faceId;
    this.lastDetectedTime = Date.now();

    // Get member details (secure apiFetch)
    const memberInfo = await this.getMemberInfo(faceId);
    const displayName = memberInfo?.name || memberInfo?.firstName + ' ' + memberInfo?.lastName || faceId;

    this.updateStatus(`Face detected: ${displayName}`, 'success');
    await this.logAttendance(faceId, displayName);
  }

  // Secure GET member info
  async getMemberInfo(faceId) {
    try {
      const response = await apiFetch(`/api/members/${faceId}`);
      return response.success ? response.data : null;
    } catch (error) {
      console.error('Error fetching member:', error);
      return null;
    }
  }

  // Secure POST attendance log (initial)
  async logAttendance(faceId, displayName) {
    try {
      const response = await apiFetch('/api/attendance/log', {
        method: 'POST',
        body: JSON.stringify({ faceId })
      });

      await this.handleAttendanceResponse(response, faceId, displayName);
    } catch (error) {
      console.error('Attendance log error:', error);
      this.updateLogStatus('Network error - Please try again', 'error');
    }
  }

  async handleAttendanceResponse(data, faceId, displayName) {
    if (data && data.success) {
      if (data.requiresSelection && data.data?.options) {
        this.showAttendanceModal(data.data.options, data.data.classOptions, faceId, displayName);
      } else if (data.alreadyLoggedIn) {
        this.updateLogStatus(`${displayName} - Already logged in`, 'warning');
      } else if (data.logged) {
        this.updateLogStatus(`${displayName} - ${data.logged.toUpperCase()} recorded`, 'success');
        this.loadAttendanceLogs();
      }
    } else {
      this.updateLogStatus(data?.error || 'Attendance error', 'error');
    }
  }

  showAttendanceModal(options, classOptions, faceId, displayName) {
    if (!this.modal || !this.modalMemberName || !this.modalButtons) return;  // Null-safe
    this.modalMemberName.textContent = displayName;
    this.modalButtons.innerHTML = '';

    options.forEach(type => {
      const button = document.createElement('button');
      button.className = 'modal-btn';
      button.textContent = type.charAt(0).toUpperCase() + type.slice(1);
      button.onclick = () => this.selectAttendanceType(type, faceId, displayName, classOptions);
      this.modalButtons.appendChild(button);
    });

    this.modal.style.display = 'flex';
    this.modal.dataset.faceId = faceId;
  }

  selectAttendanceType(type, faceId, displayName, classOptions) {
    if (this.modal) this.modal.style.display = 'none';

    let classId = null;
    if ((type === "combative" || type === "both") && classOptions?.length) {
      classId = classOptions[0].id;
    }

    this.logAttendanceWithType(faceId, displayName, type, classId);
  }

  // Secure POST attendance with type
  async logAttendanceWithType(faceId, displayName, attendedType, classId) {
    try {
      const response = await apiFetch('/api/attendance/log', {
        method: 'POST',
        body: JSON.stringify({ faceId, attendedType, classId })
      });

      if (response && response.success) {
        this.updateLogStatus(`${displayName} - ${attendedType.toUpperCase()} recorded`, 'success');
      } else {
        this.updateLogStatus(response?.error || 'Attendance error', 'error');
      }

      this.loadAttendanceLogs();
    } catch (error) {
      console.error('Attendance with type error:', error);
      this.updateLogStatus('Network error', 'error');
    }
  }

  // FIXED: Applied attendance-checker.js logic - Use /api/attendance/today, extract recentActivity as logs
  async loadAttendanceLogs() {
    console.log('Starting log load...');  // DEBUG
    try {
      // Like attendance-checker.js: GET /api/attendance/today
      const result = await apiFetch('/api/attendance/today');
      console.log('Logs API Response:', result);  // DEBUG: Check {success, data: {..., recentActivity: [...]}}
      
      // Like checker.js: Assume success if no false; extract recentActivity as logs
      let logs = [];
      if (result && result.success !== false && result.data && result.data.recentActivity && Array.isArray(result.data.recentActivity)) {
        logs = result.data.recentActivity;
      } else if (Array.isArray(result)) {
        logs = result;  // Fallback: Plain array
      } else if (result && result.data && Array.isArray(result.data)) {
        logs = result.data;  // Fallback: {data: [...]}
      }

      // Limit to 10 recent like checker.js
      logs = logs.slice(0, 10);
      console.log('Rendering', logs.length, 'logs');  // DEBUG: Confirm count
      this.renderAttendanceLogs(logs);
    } catch (error) {
      console.error('Load logs error:', error);  // e.g., 404 if no route, or timeout
      // FIXED: Null-safe fallback message
      if (this.logsContainer) {
        this.logsContainer.innerHTML = '<p class="no-logs">No attendance logs today (or check backend route/server)</p>';
      } else {
        console.warn('Cannot show fallback - logsContainer null');
      }
    }
  }

  // UPDATED: Render from recentActivity format (type: 'check-in'/'check-out' → logType, memberName, timestamp)
  renderAttendanceLogs(logs) {
    console.log('Rendering logs:', logs);  // DEBUG
    // FIXED: Early null check to prevent crash
    if (!this.logsContainer) {
      console.error('Cannot render - logsContainer missing');  // DEBUG
      return;
    }
    if (logs.length === 0) {
      if (this.logsContainer) this.logsContainer.innerHTML = '<p class="no-logs">No attendance logs today</p>';
      return;
    }

    this.logsContainer.innerHTML = logs.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // From activity: memberName, type → logType ('check-in' → 'login', 'check-out' → 'logout')
      const memberName = log.memberName || 'Unknown';
      const logType = log.type === 'check-in' ? 'login' : (log.type === 'check-out' ? 'logout' : 'UNKNOWN');
      const logTypeClass = logType;
      const icon = logType === 'login' ? '↓' : '↑';

      // Matches your original CSS: .log-item + spans (log-name, log-time, log-type)
      return `
        <div class="log-item ${logTypeClass}">
          <span class="log-icon">${icon}</span>
          <span class="log-time">${time}</span>
          <span class="log-name">${memberName}</span>
          <span class="log-type">${logType.toUpperCase()}</span>
        </div>
      `;
    }).join('');
    console.log('Logs rendered successfully in container');  // DEBUG
  }

  setupAutoRefresh() {
    console.log('Setting up auto-refresh');  // DEBUG
    setInterval(() => {
      this.loadAttendanceLogs();
    }, 30000);  // Original 30s (matches checker.js auto-refresh)
  }
}


// ✅ Initialize when DOM ready (after auth check)
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded - initializing AttendanceSystem');  // DEBUG
  new AttendanceSystem();
});
