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
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Added PUT and DELETE
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
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
  console.log('MongoDB connected');
  initializeAdmin();
});

mongoose.connection.on('error', err => {
  console.error('MongoDB connection error:', err);
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

// Routes for adding member by admin
const Member = require('./models/Member');


// Route: Add New Member with Auto-Generated ID
// ============================================
app.post('/api/members', async (req, res) => {
  console.log('[Member] Creation request received:', req.body);

  try {
    // Destructure and trim inputs
    const { 
      name: rawName, 
      type: rawType, 
      joinDate, 
      phone: rawPhone, 
      email: rawEmail 
    } = req.body;

    // Clean and validate inputs
    const name = rawName?.trim();
    const type = rawType?.trim().toLowerCase();
    const phone = rawPhone?.trim();
    const email = rawEmail?.trim().toLowerCase();

    // Validate required fields
    if (!name || !type) {
      const errors = {};
      if (!name) errors.name = 'Name is required';
      if (!type) errors.type = 'Member type is required';
      return res.status(400).json({ 
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    // Validate member type
    if (!['monthly', 'combative'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: {
          type: 'Member type must be either "monthly" or "combative"'
        }
      });
    }

    // Create new member (don't specify memberId - it will be auto-generated)
    const newMember = new Member({
      name,
      type,
      joinDate: joinDate ? new Date(joinDate) : new Date(),
      phone: phone || undefined,
      email: email || undefined
    });

    const savedMember = await newMember.save();
    console.log(`[Member] Successfully created (MongoID: ${savedMember._id}, MemberID: ${savedMember.memberId})`);

    // Successful response with both IDs
    return res.status(201).json({
      success: true,
      message: 'Member created successfully',
      data: {
        memberId: savedMember.memberId,  // The auto-generated MEM-0001 ID
        mongoId: savedMember._id,       // The MongoDB _id
        name: savedMember.name,
        type: savedMember.type,
        joinDate: savedMember.joinDate,
        phone: savedMember.phone,
        email: savedMember.email
      }
    });

  } catch (err) {
    console.error('[Member] Creation error:', err);

    // Handle duplicate key errors
    if (err.code === 11000) {
      const duplicateField = Object.keys(err.keyPattern)[0];
      const errorMessage = duplicateField === 'memberId' 
        ? 'Member ID generation conflict' 
        : `This ${duplicateField} already exists`;
      
      return res.status(409).json({
        success: false,
        error: 'Duplicate entry',
        details: {
          [duplicateField]: errorMessage
        }
      });
    }

    // Handle validation errors
    if (err.name === 'ValidationError') {
      const errors = {};
      Object.values(err.errors).forEach(e => {
        errors[e.path] = e.message;
      });
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    // Generic server error
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? {
        message: err.message,
        stack: err.stack
      } : undefined
    });
  }
});
//protect routes
const auth = require('./middleware/auth');
// Import Trainer model


// ======================
// Trainer Routes
// ======================
const Trainer = require('./models/Trainer');

// Add new trainer route
app.post('/api/trainers', async (req, res) => {
  console.log("Incoming trainer data:", req.body);
  try {

    const { name, specialization, is_available, assigned_classes } = req.body;

    // Validate required fields
    if (!name || !specialization) {
      const errors = {};
      if (!name) errors.name = 'Name is required';
      if (!specialization) errors.specialization = 'Specialization is required';

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    // Create trainer instance
    const newTrainer = new Trainer({
      name: name.trim(),
      specialization: specialization.trim(),
      is_available: is_available !== undefined ? Boolean(is_available) : true,
      assigned_classes: Array.isArray(assigned_classes) ? assigned_classes : [],
    });

    const savedTrainer = await newTrainer.save();
    console.log(`[Trainer] Created (MongoID: ${savedTrainer._id}, TrainerID: ${savedTrainer.trainer_id})`);

    res.status(201).json({
      success: true,
      message: 'Trainer created successfully',
      data: {
        trainer_id: savedTrainer.trainer_id,
        mongoId: savedTrainer._id,
        name: savedTrainer.name,
        specialization: savedTrainer.specialization,
        is_available: savedTrainer.is_available,
        assigned_classes: savedTrainer.assigned_classes,
        feedback_received: savedTrainer.feedback_received,
        createdAt: savedTrainer.createdAt
      }
    });

  } catch (err) {
    console.error("Error in /api/trainers:", err);

    if (err.code === 11000) {
      const duplicateField = Object.keys(err.keyPattern)[0];
      const errorMessage = duplicateField === 'trainer_id'
        ? 'Trainer ID generation conflict'
        : `This ${duplicateField} already exists`;

      return res.status(409).json({
        success: false,
        error: 'Duplicate entry',
        details: { [duplicateField]: errorMessage }
      });
    }

    if (err.name === 'ValidationError') {
      const errors = {};
      Object.values(err.errors).forEach(e => { errors[e.path] = e.message; });
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? { message: err.message, stack: err.stack } : undefined
    });
  }
});

// Get all trainers
// Get all trainers
app.get('/api/trainers', async (req, res) => {
  try {
    const trainers = await Trainer.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      count: trainers.length,
      data: trainers
    });
  } catch (err) {
    console.error('Error fetching trainers:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch trainers' });
  }
});

// Get available trainers only
app.get('/api/trainers/available', async (req, res) => {
  try {
    const availableTrainers = await Trainer.findAvailable();
    res.json({
      success: true,
      count: availableTrainers.length,
      data: availableTrainers
    });
  } catch (err) {
    console.error('Error fetching available trainers:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch available trainers' });
  }
});

// Add to your app.js after other model imports
const Class = require('./models/Classes');

// ======================
// Class Routes
// ======================

// Add new class route
app.post('/api/classes', async (req, res) => {
  console.log("Incoming class data:", req.body);
  try {
    const { class_name, description, schedule, trainer_id, capacity } = req.body;

    // Validate required fields
    if (!class_name || !schedule || !trainer_id || !capacity) {
      const errors = {};
      if (!class_name) errors.class_name = 'Class name is required';
      if (!schedule) errors.schedule = 'Schedule is required';
      if (!trainer_id) errors.trainer_id = 'Trainer ID is required';
      if (!capacity) errors.capacity = 'Capacity is required';

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    // Create class instance
    const newClass = new Class({
      class_name: class_name.trim(),
      description: description ? description.trim() : '',
      schedule: schedule.trim(),
      trainer_id: trainer_id.trim(),
      capacity: parseInt(capacity)
    });

    const savedClass = await newClass.save();
    console.log(`[Class] Created (MongoID: ${savedClass._id}, ClassID: ${savedClass.class_id})`);

    res.status(201).json({
      success: true,
      message: 'Class created successfully',
      data: {
        class_id: savedClass.class_id,
        mongoId: savedClass._id,
        class_name: savedClass.class_name,
        description: savedClass.description,
        schedule: savedClass.schedule,
        trainer_id: savedClass.trainer_id,
        capacity: savedClass.capacity,
        createdAt: savedClass.createdAt
      }
    });

  } catch (err) {
    console.error("Error in /api/classes:", err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Duplicate entry',
        details: { class_id: 'Class ID generation conflict' }
      });
    }

    if (err.name === 'ValidationError') {
      const errors = {};
      Object.values(err.errors).forEach(e => { errors[e.path] = e.message; });
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? { message: err.message, stack: err.stack } : undefined
    });
  }
});

// Get all classes
app.get('/api/classes', async (req, res) => {
  try {
    const classes = await Class.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      count: classes.length,
      data: classes
    });
  } catch (err) {
    console.error('Error fetching classes:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch classes' });
  }
});

// Get class by ID
app.get('/api/classes/:id', async (req, res) => {
  try {
    const classData = await Class.findOne({ 
      $or: [
        { class_id: req.params.id },
        { _id: req.params.id }
      ]
    });
    
    if (!classData) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }
    
    res.json({
      success: true,
      data: classData
    });
  } catch (err) {
    console.error('Error fetching class:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch class' });
  }
});

// Update class
app.put('/api/classes/:id', async (req, res) => {
  try {
    const { class_name, description, schedule, trainer_id, capacity } = req.body;
    
    const updatedClass = await Class.findOneAndUpdate(
      { 
        $or: [
          { class_id: req.params.id },
          { _id: req.params.id }
        ]
      },
      { 
        class_name, 
        description, 
        schedule, 
        trainer_id, 
        capacity 
      },
      { new: true, runValidators: true }
    );
    
    if (!updatedClass) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }
    
    res.json({
      success: true,
      message: 'Class updated successfully',
      data: updatedClass
    });
  } catch (err) {
    console.error('Error updating class:', err);
    
    if (err.name === 'ValidationError') {
      const errors = {};
      Object.values(err.errors).forEach(e => { errors[e.path] = e.message; });
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }
    
    res.status(500).json({ success: false, error: 'Failed to update class' });
  }
});

// Delete class
app.delete('/api/classes/:id', async (req, res) => {
  try {
    const deletedClass = await Class.findOneAndDelete({
      $or: [
        { class_id: req.params.id },
        { _id: req.params.id }
      ]
    });
    
    if (!deletedClass) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }
    
    res.json({
      success: true,
      message: 'Class deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting class:', err);
    res.status(500).json({ success: false, error: 'Failed to delete class' });
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

// ======================
// Schedule Routes
// ======================

