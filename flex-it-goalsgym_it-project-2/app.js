require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/members');
const trainerRoutes = require('./routes/trainers');
const classRoutes = require('./routes/classes');
const enrollmentRoutes = require('./routes/enrollments');
const feedbackRoutes = require('./routes/feedbacks');
const transactionRoutes = require('./routes/transactions');
const announcementRoutes = require('./routes/announcements');
const templateRoutes = require('./routes/templates');
const healthRoutes = require('./routes/health');
const attendanceRoutes = require('./routes/attendance');

const errorHandler = require('./middleware/errorHandler');
const { protect, admin } = require('./middleware/auth'); // NEW: Import protect middleware
const initAdmin = require('./utils/initAdmin');
const { initEnrollmentAutoUpdate } = require('./jobs/enrollmentAutoUpdate');
const { initMembershipExpiryReminder } = require('./jobs/membershipExpiryReminder'); // ADDED
const { initMembershipStatusUpdate } = require('./jobs/membershipDeactivation');

console.log('Routes mounted.');

const app = express();
const PORT = process.env.PORT || 8080;
const DB_URL = process.env.MONGODB_URI;

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

// Database connect
mongoose.connect(DB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

mongoose.connection.on('connected', async () => {
  console.log('MongoDB connected');
  // create default admin if none exists
  try {
    await initAdmin();
  } catch (err) {
    console.error('initAdmin error', err);
  }

  // Initialize enrollment auto-update job
  try {
    initEnrollmentAutoUpdate();
    console.log('Enrollment auto-update job initialized');
  } catch (err) {
    console.error('Enrollment auto-update initialization error:', err);
  }

  // Initialize membership expiry reminder job (ADDED)
  try {
    initMembershipExpiryReminder();
    console.log('Membership expiry reminder job initialized');
  } catch (err) {
    console.error('Membership expiry reminder initialization error:', err);
  }

  try {
    initMembershipStatusUpdate();
    console.log('Membership Deactivation job initialized');
  } catch (err) {
    console.error('Membership Deactivation initialization error:', err);
  }
});

mongoose.connection.on('error', err => {
  console.error('MongoDB connection error:', err);
  if (process.env.NODE_ENV === 'production') process.exit(1);
});

// Mount routes
// Keep original paths so frontend does not need to change
app.use('/api', authRoutes); // /api/login etc. - NO PROTECTION (public login)

// Protected routes: Apply protect middleware to secure data fetching
app.use('/api/members', protect, memberRoutes);
app.use('/api/trainers', protect, trainerRoutes);
app.use('/api/classes', protect, classRoutes);
app.use('/api/enrollments', protect, enrollmentRoutes);
app.use('/api/feedbacks', protect, feedbackRoutes);
app.use('/api/transactions', protect, transactionRoutes);
app.use('/api/announcements', protect, admin, announcementRoutes);
app.use('/api/templates', protect, admin, templateRoutes);
app.use('/api/attendance', protect, attendanceRoutes); // mounts /api/attendance/* etc.
app.use('/health', healthRoutes); // Secure health checks if needed

// 404 + error handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('unhandledRejection', err => {
  console.error('Unhandled Rejection:', err);
});

process.on('SIGTERM', () => {
  server.close(() => {
    mongoose.connection.close();
    console.log('Server terminated');
  });
});
