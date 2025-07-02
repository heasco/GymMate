require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const helmet = require('helmet');
const app = express();

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// Temporary CORS (replace with your actual frontend URL later)
app.use(cors({
  origin: '*', // ⚠️ Temporary - change to your Render frontend URL after deployment
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Database connection
const DB_URL = process.env.MONGODB_URI || "mongodb://localhost:27017/goalsgym";

mongoose.connect(DB_URL, {
  dbName: 'goalsgym',
  useNewUrlParser: true,
  useUnifiedTopology: true
});

mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connected');
  if (process.env.NODE_ENV !== 'production') initializeAdmin();
});

mongoose.connection.on('error', err => {
  console.error('❌ MongoDB error:', err);
  if (process.env.NODE_ENV === 'production') process.exit(1);
});

// Admin initialization (dev only)
async function initializeAdmin() {
  try {
    const adminExists = await mongoose.connection.db.collection('admin').countDocuments({ username: 'admin' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await mongoose.connection.db.collection('admin').insertOne({
        username: 'admin',
        password: hashedPassword,
        role: 'admin',
        createdAt: new Date()
      });
      console.log('🔑 Default admin created');
    }
  } catch (err) {
    console.error('Admin init error:', err);
  }
}

// Routes
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await mongoose.connection.db.collection('admin').findOne({ username });
    
    if (!admin || !(await bcrypt.compare(password, admin.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ 
      success: true,
      user: { id: admin._id, username: admin.username }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' ? 'Server error' : err.message 
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`Access at: http://localhost:${PORT}`);
});