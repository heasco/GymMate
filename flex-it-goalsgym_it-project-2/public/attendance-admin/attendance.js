// ✅ AUTH PROTECTION - Check before anything else
(function checkAuth() {
    const authUser = JSON.parse(localStorage.getItem('authUser'));
    
    // Check if user is logged in and session is valid (1 hour)
    if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
        // Not logged in or session expired - redirect to login
        localStorage.removeItem('authUser');
        window.location.href = '../admin-login.html';
        return;
    }
    
    console.log('Admin authenticated:', authUser.username);
})();

// ✅ Original attendance.js code starts here
class AttendanceSystem {
    constructor() {
        this.camera = document.getElementById('camera');
        this.snapshot = document.getElementById('snapshot');
        this.statusMessage = document.getElementById('statusMessage');
        this.logStatus = document.getElementById('logStatus');
        this.logsContainer = document.getElementById('logsContainer');
        this.modal = document.getElementById('attendanceModal');
        this.modalButtons = document.getElementById('modalButtons');
        this.modalMemberName = document.getElementById('modalMemberName');
        
        this.lastFaceId = null;
        this.lastDetectedTime = 0;
        this.attendedTodayMap = {};
        
        this.API_URL = 'http://localhost:8080';
        this.FACE_API_URL = 'http://localhost:5001';
        
        this.init();
    }

    async init() {
        await this.startCamera();
        this.startFaceDetection();
        this.loadAttendanceLogs();
        this.setupAutoRefresh();
        this.setupKeyboardShortcuts();
    }

    // ✅ NEW: Keyboard shortcuts
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // ESC to close window
            if (e.key === 'Escape') {
                if (confirm('Close attendance system?')) {
                    window.close();
                }
            }
            // R to refresh logs
            if (e.key === 'r' || e.key === 'R') {
                this.loadAttendanceLogs();
                this.updateStatus('Logs refreshed', 'success');
            }
        });
    }

    async startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                }
            });
            this.camera.srcObject = stream;
            this.updateStatus('Camera active - Ready for face detection', 'success');
        } catch (error) {
            this.updateStatus('Camera access denied: ' + error.message, 'error');
        }
    }

    updateStatus(message, type = 'info') {
        this.statusMessage.textContent = message;
        this.statusMessage.style.color = 
            type === 'error' ? '#DC3545' : 
            type === 'success' ? '#28A745' : 
            '#BFBFBF';
    }

    updateLogStatus(message, type = 'info') {
        this.logStatus.textContent = message;
        this.logStatus.style.color = 
            type === 'error' ? '#DC3545' : 
            type === 'success' ? '#28A745' : 
            type === 'warning' ? '#FFC107' : 
            '#BFBFBF';
    }

    startFaceDetection() {
        setInterval(() => this.detectFace(), 3000);
    }

    async detectFace() {
        if (!this.camera.srcObject) return;

        // Capture frame from camera
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
            this.updateStatus('Face recognition service unavailable', 'error');
        }
    }

    async handleFaceDetected(faceId) {
        // Prevent duplicate detection within 5 seconds
        if (this.lastFaceId === faceId && Date.now() - this.lastDetectedTime < 5000) {
            return;
        }

        this.lastFaceId = faceId;
        this.lastDetectedTime = Date.now();

        // Get member details
        const memberInfo = await this.getMemberInfo(faceId);
        const displayName = memberInfo?.name || faceId;

        this.updateStatus(`Face detected: ${displayName}`, 'success');
        await this.logAttendance(faceId, displayName);
    }

    async getMemberInfo(faceId) {
        try {
            const response = await fetch(`${this.API_URL}/api/members/${faceId}`);
            const data = await response.json();
            return data.success ? data.data : null;
        } catch (error) {
            return null;
        }
    }

    async logAttendance(faceId, displayName) {
        try {
            const response = await fetch(`${this.API_URL}/api/attendance/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faceId })
            });

            const data = await response.json();
            await this.handleAttendanceResponse(data, faceId, displayName);
        } catch (error) {
            this.updateLogStatus('Network error - Please try again', 'error');
        }
    }

    async handleAttendanceResponse(data, faceId, displayName) {
        if (data.success) {
            if (data.requiresSelection && data.data?.options) {
                this.showAttendanceModal(data.data.options, data.data.classOptions, faceId, displayName);
            } else if (data.alreadyLoggedIn) {
                this.updateLogStatus(`${displayName} - Already logged in`, 'warning');
            } else if (data.logged) {
                this.updateLogStatus(`${displayName} - ${data.logged.toUpperCase()} recorded`, 'success');
                this.loadAttendanceLogs();
            }
        } else {
            this.updateLogStatus(data.error || 'Attendance error', 'error');
        }
    }

    showAttendanceModal(options, classOptions, faceId, displayName) {
        this.modalMemberName.textContent = displayName;
        this.modalButtons.innerHTML = '';

        options.forEach(type => {
            const button = document.createElement('button');
            button.className = 'modal-btn';
            button.textContent = type.toUpperCase();
            button.onclick = () => this.selectAttendanceType(type, faceId, displayName, classOptions);
            this.modalButtons.appendChild(button);
        });

        this.modal.style.display = 'flex';
        this.modal.dataset.faceId = faceId;
    }

    selectAttendanceType(type, faceId, displayName, classOptions) {
        this.modal.style.display = 'none';

        let classId = null;
        if ((type === "combative" || type === "both") && classOptions?.length) {
            classId = classOptions[0];
        }

        this.logAttendanceWithType(faceId, displayName, type, classId);
    }

    async logAttendanceWithType(faceId, displayName, attendedType, classId) {
        try {
            const response = await fetch(`${this.API_URL}/api/attendance/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faceId, attendedType, classId })
            });

            const data = await response.json();

            if (data.success) {
                this.updateLogStatus(`${displayName} - ${attendedType.toUpperCase()} recorded`, 'success');
            } else {
                this.updateLogStatus(data.error || 'Attendance error', 'error');
            }

            this.loadAttendanceLogs();
        } catch (error) {
            this.updateLogStatus('Network error', 'error');
        }
    }

    async loadAttendanceLogs() {
        try {
            const response = await fetch(`${this.API_URL}/api/attendance/logs/today`);
            const data = await response.json();

            if (data.success && Array.isArray(data.logs)) {
                this.renderAttendanceLogs(data.logs);
            } else {
                this.logsContainer.innerHTML = '<p class="no-logs">No attendance logs today</p>';
            }
        } catch (error) {
            this.logsContainer.innerHTML = '<p class="error-text">Failed to load logs</p>';
        }
    }

    renderAttendanceLogs(logs) {
        if (logs.length === 0) {
            this.logsContainer.innerHTML = '<p class="no-logs">No attendance logs today</p>';
            return;
        }

        this.logsContainer.innerHTML = logs.map(log => {
            const time = new Date(log.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const memberName = log.memberId?.name || 'Unknown';
            const logTypeClass = log.logType === 'login' ? 'login' : 'logout';
            const icon = log.logType === 'login' ? '↓' : '↑';

            return `
                <div class="log-item ${logTypeClass}">
                    <span class="log-icon">${icon}</span>
                    <span class="log-name">${memberName}</span>
                    <span class="log-type">${log.logType.toUpperCase()}</span>
                    <span class="log-time">${time}</span>
                </div>
            `;
        }).join('');
    }

    setupAutoRefresh() {
        // Refresh logs every 30 seconds
        setInterval(() => {
            this.loadAttendanceLogs();
        }, 30000);
    }
}

// ✅ Initialize the attendance system when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new AttendanceSystem();
});
