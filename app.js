//This is the main server

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const app = express();

// ======================
// Constants
// ======================
const PORT = process.env.PORT || 8080;
const DB_URL = process.env.MONGODB_URI || "mongodb+srv://herodvelasco023:Qn0ihspOECvY5vq2@cluster0.vejigze.mongodb.net/goalsgym?retryWrites=true&w=majority&appName=Cluster0";

// ======================
// Middleware
// ======================
app.use(cors({
  origin: '*', // Allow all origins temporarily
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10kb' }));

// ======================
// Database Connection
// ======================
mongoose.connect(DB_URL, {
  dbName: 'goalsgym',
  useNewUrlParser: true,
  useUnifiedTopology: true,
  ssl: true,
  retryWrites: true,
  socketTimeoutMS: 30000,
  connectTimeoutMS: 30000
});

mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connected');
  initializeAdmin();
});

mongoose.connection.on('error', err => {
  console.error('❌ MongoDB connection error:', err);
  if (process.env.NODE_ENV === 'production') process.exit(1);
});

// ======================
// Admin Initialization
// ======================
async function initializeAdmin() {
  try {
    const adminExists = await mongoose.connection.db.collection('admin').countDocuments({ username: 'admin' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await mongoose.connection.db.collection('admin').insertOne({
        username: 'admin',
        password: hashedPassword,
        name: 'System Admin',
        phone: '+1234567890',
        role: 'admin',
        createdAt: new Date()
      });
      console.log('🔑 Default admin created');
    }
  } catch (err) {
    console.error('Admin initialization error:', err);
  }
}

// ======================
// Routes (Routes for Login)
// ======================
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Input validation
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const admin = await mongoose.connection.db.collection('admin').findOne({ 
      username: username.trim() 
    });
    
    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Successful login - return user data
    res.json({ 
      success: true,
      user: {
        id: admin._id,
        username: admin.username,
        name: admin.name,
        role: admin.role
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

//Routes for adding member by admin:
const Member = require('./models/Member');

// Then your route handler
app.post('/api/members', async (req, res) => {
  try {
    // Add admin authentication check here if needed
    // if (!req.user || req.user.role !== 'admin') {
    //   return res.status(403).json({ error: 'Unauthorized' });
    // }

    const { name, type, joinDate, phone, email } = req.body;

    // Validate required fields
    if (!name || !type) {
      return res.status(400).json({ error: 'Name and member type are required' });
    }

    // Create new member document
    const newMember = new Member({
      name,
      type,
      joinDate: joinDate || new Date(),
      phone,
      email
      // status and dates are automatically added by defaults
    });

    // Save to MongoDB
    const savedMember = await newMember.save();

    res.status(201).json({
      success: true,
      message: 'Member added successfully',
      member: {
        id: savedMember._id,
        name: savedMember.name,
        type: savedMember.type
      }
    });

  } catch (err) {
    console.error('Error adding member:', err);
    
    // Handle duplicate key errors (if you have unique constraints)
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Member already exists' });
    }

    // Handle validation errors
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ 
        error: 'Validation error',
        details: messages 
      });
    }
    
    res.status(500).json({ error: 'Server error while adding member' });
  }
});

// Protected route example
app.get('/admin/data', async (req, res) => {
  try {
    // In a real app, you'd check session/localStorage here
    res.json({ data: 'This is protected admin data' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// After all your routes
const errorHandler = require('./middleware/error');
app.use(errorHandler);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    db: mongoose.connection.readyState === 1,
    timestamp: new Date().toISOString()
  });
});

// ======================
// Error Handling
// ======================
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ======================
// Server Start
// ======================
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// ======================
// Process Handlers
// ======================
process.on('unhandledRejection', err => {
  console.error('Unhandled Rejection:', err);
});

process.on('SIGTERM', () => {
  server.close(() => {
    mongoose.connection.close();
    console.log('Server terminated');
  });
});