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
const healthRoutes = require('./routes/health');

const errorHandler = require('./middleware/errorHandler');
const initAdmin = require('./utils/initAdmin');

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
});

mongoose.connection.on('error', err => {
  console.error('MongoDB connection error:', err);
  if (process.env.NODE_ENV === 'production') process.exit(1);
});

// Mount routes
// Keep original paths so frontend does not need to change
app.use('/api', authRoutes); // /api/admin/login etc
app.use('/api/members', memberRoutes);
app.use('/api/trainers', trainerRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/feedbacks', feedbackRoutes);
app.use('/api/transactions', transactionRoutes);

app.use('/health', healthRoutes);

// 404 + error handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
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
