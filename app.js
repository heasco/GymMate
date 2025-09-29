// This is the main server

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
const SERVER_URL = 'https://flex-it-goalsgym-it-project-2.onrender.com';
const DB_URL = process.env.MONGODB_URI || "mongodb+srv://herodvelasco023:Qn0ihspOECvY5vq2@cluster0.vejigze.mongodb.net/goalsgym?retryWrites=true&w=majority&appName=Cluster0";

// Serve static files from the public directory
app.use(express.static('public'));

// ======================
// Middleware
// ======================
app.use(cors({  
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
    const adminExists = await mongoose.connection.db.collection('admins').countDocuments({ username: 'admin' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await mongoose.connection.db.collection('admins').insertOne({
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
// Import Models
// ======================
const Member = require('./models/Member');
const Trainer = require('./models/Trainer');
const Class = require('./models/Classes');
const Enrollment = require('./models/Enrollment');
const Feedback = require('./models/Feedback');
const Transaction = require('./models/Transaction');

// ======================
// Routes (Login)
// ======================
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Input validation
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const admin = await mongoose.connection.db.collection('admins').findOne({ 
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

// ======================
// Member Routes
// ======================

// Route: Add New Member with Auto-Generated ID
// Route: Add New Member with Auto-Generated ID
app.post('/api/members', async (req, res) => {
  console.log('[Member] Creation request received:', req.body);

  try {
    // Destructure and trim inputs
    const { 
      name: rawName, 
      memberships,
      joinDate, 
      phone: rawPhone, 
      email: rawEmail 
    } = req.body;

    // Clean and validate inputs
    const name = rawName?.trim();
    const phone = rawPhone?.trim();
    const email = rawEmail?.trim().toLowerCase();

    // Validate required fields
    if (!name || !memberships || !Array.isArray(memberships) || memberships.length === 0) {
      const errors = {};
      if (!name) errors.name = 'Name is required';
      if (!memberships || !Array.isArray(memberships) || memberships.length === 0) {
        errors.memberships = 'At least one membership is required';
      }
      return res.status(400).json({ 
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

// Validate each membership
const validatedMemberships = [];
for (const membership of memberships) {
  const { type, duration } = membership;
  
  // Validate membership type
  if (!type || !['monthly', 'combative'].includes(type)) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: {
        memberships: 'Each membership must have a valid type (monthly or combative)'
      }
    });
  }

  // Validate duration
  if (!duration || duration < 1) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: {
        memberships: 'Each membership must have a valid duration (at least 1)'
      }
    });
  }

  // Calculate startDate and endDate
  const startDate = joinDate ? new Date(joinDate) : new Date();
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + duration); // Assumes duration in months; adjust if needed (e.g., endDate.setDate(endDate.getDate() + duration) for days)

  validatedMemberships.push({
    type,
    duration,
    startDate,
    endDate,
    status: 'active' // Set default active status
  });
}

    // Create new member
    const newMember = new Member({
      name,
      memberships: validatedMemberships,
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
        memberId: savedMember.memberId,
        mongoId: savedMember._id,
        name: savedMember.name,
        memberships: savedMember.memberships,
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

// Member search endpoint
app.get('/api/members/search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters long'
      });
    }

    // Use the native MongoDB collection for searching
    const db = mongoose.connection.db;
    const membersCollection = db.collection('members');
    
    // Search for members by name or memberId
    const members = await membersCollection.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { memberId: { $regex: query, $options: 'i' } }
      ]
    }).limit(10).toArray();

    res.json({
      success: true,
      count: members.length,
      data: members
    });
  } catch (err) {
    console.error('Member search error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to search members'
    });
  }
});

// ======================
// Trainer Routes
// ======================

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
    const id = req.params.id;
    let query = { class_id: id };
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = {
        $or: [
          { class_id: id },
          { _id: new mongoose.Types.ObjectId(id) }
        ]
      };
    }
    const classData = await Class.findOne(query);
    
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
    const id = req.params.id;
    let query = { class_id: id };
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = {
        $or: [
          { class_id: id },
          { _id: new mongoose.Types.ObjectId(id) }
        ]
      };
    }
    const { class_name, description, schedule, trainer_id, capacity } = req.body;
    
    const updatedClass = await Class.findOneAndUpdate(
      query,
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
    const id = req.params.id;
    let query = { class_id: id };
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = {
        $or: [
          { class_id: id },
          { _id: new mongoose.Types.ObjectId(id) }
        ]
      };
    }
    const deletedClass = await Class.findOneAndDelete(query);
    
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

// ======================
// Enrollment Routes
// ======================

// Enroll member in class (Admin function)
app.post('/api/enrollments', async (req, res) => {
  try {
    const { class_id, member_id } = req.body;

    // Validate required fields
    if (!class_id || !member_id) {
      return res.status(400).json({
        success: false,
        error: 'Class ID and Member ID are required'
      });
    }

    // Check if class exists
    const classData = await Class.findOne({ class_id });
    if (!classData) {
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    // Check if class is full
    if (classData.isFull) {
      return res.status(400).json({
        success: false,
        error: 'Class is full'
      });
    }

    // Check if member is already enrolled
    const existingEnrollment = await Enrollment.findOne({ 
      class_id, 
      member_id, 
      status: 'active' 
    });
    
    if (existingEnrollment) {
      return res.status(409).json({
        success: false,
        error: 'Member is already enrolled in this class'
      });
    }

    // Create enrollment
    const enrollment = new Enrollment({
      class_id,
      member_id
    });

    const savedEnrollment = await enrollment.save();

    // Update class enrollment count
    await Class.findOneAndUpdate(
      { class_id },
      { 
        $inc: { current_enrollment: 1 },
        $push: { 
          enrolled_members: { 
            member_id, 
            enrollment_date: new Date(),
            status: 'active'
          } 
        }
      }
    );

    res.status(201).json({
      success: true,
      message: 'Member enrolled successfully',
      data: savedEnrollment
    });

  } catch (err) {
    console.error('Enrollment error:', err);
    
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Member is already enrolled in this class'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to enroll member'
    });
  }
});

// Get enrollments for a class
app.get('/api/classes/:id/enrollments', async (req, res) => {
  try {
    const class_id = req.params.id;
    
    const enrollments = await Enrollment.find({ class_id })
      .sort({ enrollment_date: -1 });

    res.json({
      success: true,
      count: enrollments.length,
      data: enrollments
    });
  } catch (err) {
    console.error('Error fetching enrollments:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch enrollments'
    });
  }
});

// Get enrollments for a member
app.get('/api/members/:id/enrollments', async (req, res) => {
  try {
    const member_id = req.params.id;
    
    const enrollments = await Enrollment.find({ member_id, status: 'active' })
      .populate('class_id', 'class_name schedule trainer_id')
      .sort({ enrollment_date: -1 });

    res.json({
      success: true,
      count: enrollments.length,
      data: enrollments
    });
  } catch (err) {
    console.error('Error fetching member enrollments:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch enrollments'
    });
  }
});

// Cancel enrollment
app.put('/api/enrollments/:id/cancel', async (req, res) => {
  try {
    const enrollment_id = req.params.id;
    
    const enrollment = await Enrollment.findOne({ enrollment_id });
    if (!enrollment) {
      return res.status(404).json({
        success: false,
        error: 'Enrollment not found'
      });
    }

    if (enrollment.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Enrollment is already cancelled'
      });
    }

    enrollment.status = 'cancelled';
    await enrollment.save();

    // Update class enrollment count
    await Class.findOneAndUpdate(
      { class_id: enrollment.class_id },
      { 
        $inc: { current_enrollment: -1 },
        $set: { 
          'enrolled_members.$[elem].status': 'cancelled' 
        }
      },
      { 
        arrayFilters: [{ 'elem.member_id': enrollment.member_id }] 
      }
    );

    res.json({
      success: true,
      message: 'Enrollment cancelled successfully',
      data: enrollment
    });

  } catch (err) {
    console.error('Error cancelling enrollment:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel enrollment'
    });
  }
});

// enrollment endpoint with combative membership check
// Enhanced enrollment endpoint with proper ID handling
app.post('/api/classes/:classId/enroll', async (req, res) => {
  try {
    const { classId } = req.params;
    const { member_id } = req.body;

    console.log(`Enrollment request: classId=${classId}, member_id=${member_id}`);

    if (!member_id) {
      return res.status(400).json({
        success: false,
        error: 'Member ID is required'
      });
    }

    // Find the class by class_id
    const classData = await Class.findOne({ class_id: classId });
    if (!classData) {
      console.log(`Class not found: ${classId}`);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    // Build query to find member by different ID formats
    let memberQuery = {};
    
    // Check if it's a MongoDB ObjectId (24 character hex string)
    if (mongoose.Types.ObjectId.isValid(member_id) && 
        new mongoose.Types.ObjectId(member_id).toString() === member_id) {
      memberQuery = { _id: new mongoose.Types.ObjectId(member_id) };
    } 
    // Check if it's a memberId (like MEM-0001)
    else if (member_id.startsWith('MEM-')) {
      memberQuery = { memberId: member_id };
    }
    // Fallback to member_id field
    else {
      memberQuery = { member_id: member_id };
    }

    // Find the member to check membership type
    const member = await mongoose.connection.db.collection('members').findOne(memberQuery);

    if (!member) {
      console.log(`Member not found with query:`, memberQuery);
      return res.status(404).json({
        success: false,
        error: 'Member not found'
      });
    }

    // Check if member has active combative membership
    const hasCombativeMembership = member.memberships && 
      Array.isArray(member.memberships) && 
      member.memberships.some(m => 
        m.type === 'combative' && 
        m.status === 'active' && 
        new Date(m.endDate) > new Date()
      );
    
    if (!hasCombativeMembership) {
      return res.status(400).json({
        success: false,
        error: 'Cannot enroll: Member must have an active combative membership'
      });
    }

    // Check if class is full
    if (classData.current_enrollment >= classData.capacity) {
      return res.status(400).json({
        success: false,
        error: 'Class is full'
      });
    }

    // Check if member is already enrolled
    const alreadyEnrolled = classData.enrolled_members.some(
      enrolledMember => {
        // Compare using the actual member ID from the found member document
        const enrolledMemberId = enrolledMember.member_id;
        const currentMemberId = member.memberId || member.member_id || member._id.toString();
        
        return enrolledMemberId === currentMemberId && enrolledMember.status === 'active';
      }
    );

    if (alreadyEnrolled) {
      return res.status(409).json({
        success: false,
        error: 'Member is already enrolled in this class'
      });
    }

    // Use the actual member ID from the document
    const actualMemberId = member.memberId || member.member_id || member._id.toString();

    // Add member to class
    classData.enrolled_members.push({
      member_id: actualMemberId,
      member_name: member.name,
      enrollment_date: new Date(),
      status: 'active'
    });

    classData.current_enrollment += 1;
    await classData.save();

    console.log(`Successfully enrolled member ${actualMemberId} in class ${classId}`);

    res.status(200).json({
      success: true,
      message: 'Member enrolled successfully',
      data: {
        class_id: classData.class_id,
        class_name: classData.class_name,
        member_id: actualMemberId,
        member_name: member.name,
        enrollment_date: new Date()
      }
    });

  } catch (err) {
    console.error('Enrollment error:', err);
    
    if (err.message && err.message.includes('combative membership')) {
      return res.status(400).json({
        success: false,
        error: 'Cannot enroll: Member must have combative membership'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to enroll member: ' + err.message
    });
  }
});

// ======================
// Enrollment Management Routes
// ======================

// Get members eligible for enrollment (combative members)
app.get('/api/combative-members', async (req, res) => {
  try {
    const combativeMembers = await mongoose.connection.db.collection('members').find({
      'memberships.type': 'combative',
      'memberships.status': 'active',
      'memberships.endDate': { $gt: new Date() } // Only active memberships
    }).project({
      memberId: 1,
      name: 1,
      phone: 1,
      email: 1,
      memberships: 1
    }).toArray();

    // Format the response to include proper member IDs
    const formattedMembers = combativeMembers.map(member => ({
      _id: member._id,
      memberId: member.memberId || member.member_id || member._id.toString(),
      name: member.name,
      phone: member.phone,
      email: member.email,
      memberships: member.memberships
    }));

    res.json({
      success: true,
      count: formattedMembers.length,
      data: formattedMembers
    });
  } catch (err) {
    console.error('Error fetching combative members:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch combative members'
    });
  }
});

// Get enrolled members for a class
app.get('/api/classes/:id/enrolled-members', async (req, res) => {
  try {
    const id = req.params.id;
    let query = { class_id: id };
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = {
        $or: [
          { class_id: id },
          { _id: new mongoose.Types.ObjectId(id) }
        ]
      };
    }
    const classData = await Class.findOne(query);
    
    if (!classData) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }
    
    res.json({
      success: true,
      count: classData.enrolled_members.filter(m => m.status === 'active').length,
      data: classData.enrolled_members.filter(m => m.status === 'active')
    });
  } catch (err) {
    console.error('Error fetching enrolled members:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch enrolled members'
    });
  }
});

// Remove member from class
app.delete('/api/classes/:classId/enrollments/:memberId', async (req, res) => {
  try {
    const { classId, memberId } = req.params;
    
    const classData = await Class.findOne({ class_id: classId });
    if (!classData) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }
    
    // Find the enrollment - we need to handle different ID formats
    const enrollmentIndex = classData.enrolled_members.findIndex(
      enrollment => {
        // Compare using string values to handle different ID formats
        return enrollment.member_id.toString() === memberId.toString() && 
               enrollment.status === 'active';
      }
    );
    
    if (enrollmentIndex === -1) {
      return res.status(404).json({ success: false, error: 'Enrollment not found' });
    }
    
    // Update enrollment status to cancelled
    classData.enrolled_members[enrollmentIndex].status = 'cancelled';
    classData.current_enrollment -= 1;
    
    await classData.save();
    
    res.json({
      success: true,
      message: 'Member removed from class successfully'
    });
  } catch (err) {
    console.error('Error removing member from class:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to remove member from class'
    });
  }
});


// ======================
// Feedback Routes
// ======================

// Submit feedback for a class
app.post('/api/feedback', async (req, res) => {
  try {
    const { class_id, member_id, trainer_id, rating, comment } = req.body;

    // Validate required fields
    if (!class_id || !member_id || !trainer_id || !rating) {
      return res.status(400).json({
        success: false,
        error: 'Class ID, Member ID, Trainer ID, and Rating are required'
      });
    }

    // Validate rating range
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: 'Rating must be between 1 and 5'
      });
    }

    // Check if member is enrolled in the class
    const enrollment = await Enrollment.findOne({ 
      class_id, 
      member_id, 
      status: 'active' 
    });
    
    if (!enrollment) {
      return res.status(403).json({
        success: false,
        error: 'Member is not enrolled in this class'
      });
    }

    // Check if member already submitted feedback for this class
    const existingFeedback = await Feedback.findOne({ class_id, member_id });
    if (existingFeedback) {
      return res.status(409).json({
        success: false,
        error: 'Feedback already submitted for this class'
      });
    }

    // Create feedback
    const feedback = new Feedback({
      class_id,
      member_id,
      trainer_id,
      rating,
      comment: comment || ''
    });

    const savedFeedback = await feedback.save();

    // Also add feedback to the class document
    await Class.findOneAndUpdate(
      { class_id },
      {
        $push: {
          feedback: {
            member_id,
            rating,
            comment: comment || '',
            date_submitted: new Date()
          }
        }
      }
    );

    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      data: savedFeedback
    });

  } catch (err) {
    console.error('Feedback submission error:', err);
    
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Feedback already submitted for this class'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to submit feedback'
    });
  }
});

// Get feedback for a class
app.get('/api/classes/:id/feedback', async (req, res) => {
  try {
    const class_id = req.params.id;
    
    const feedback = await Feedback.find({ class_id })
      .sort({ date_submitted: -1 });

    res.json({
      success: true,
      count: feedback.length,
      data: feedback
    });
  } catch (err) {
    console.error('Error fetching feedback:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch feedback'
    });
  }
});

// Get feedback for a trainer
app.get('/api/trainers/:id/feedback', async (req, res) => {
  try {
    const trainer_id = req.params.id;
    
    const feedback = await Feedback.find({ trainer_id })
      .populate('class_id', 'class_name')
      .sort({ date_submitted: -1 });

    res.json({
      success: true,
      count: feedback.length,
      data: feedback
    });
  } catch (err) {
    console.error('Error fetching trainer feedback:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch feedback'
    });
  }
});

// Get average rating for a trainer
app.get('/api/trainers/:id/rating', async (req, res) => {
  try {
    const trainer_id = req.params.id;
    
    const result = await Feedback.aggregate([
      { $match: { trainer_id } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalFeedback: { $sum: 1 }
        }
      }
    ]);

    const averageRating = result.length > 0 ? result[0].averageRating.toFixed(1) : 0;
    const totalFeedback = result.length > 0 ? result[0].totalFeedback : 0;

    res.json({
      success: true,
      data: {
        averageRating,
        totalFeedback
      }
    });
  } catch (err) {
    console.error('Error calculating trainer rating:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate rating'
    });
  }
});

// Protected route example
app.get('/admin/data', async (req, res) => {
  try {
    res.json({ data: 'This is protected admin data' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    db: mongoose.connection.readyState === 1,
    timestamp: new Date().toISOString()
  });
});

// ======================
// Transaction Routes
// ======================

// Add new transaction
app.post('/api/transactions', async (req, res) => {
  try {
    const { member_id, amount, payment_method, payment_date, description } = req.body;

    // Validate required fields
    if (!member_id || !amount || !payment_method || !payment_date) {
      return res.status(400).json({
        success: false,
        error: 'Member ID, amount, payment method, and payment date are required'
      });
    }

    if (!['cash', 'e-wallet', 'bank'].includes(payment_method)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment method'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be positive'
      });
    }

    const parsedDate = new Date(payment_date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment date format'
      });
    }

    // Find member
    let memberQuery = { memberId: member_id };
    if (mongoose.Types.ObjectId.isValid(member_id)) {
      memberQuery = {
        $or: [
          { memberId: member_id },
          { _id: new mongoose.Types.ObjectId(member_id) }
        ]
      };
    }
    const member = await Member.findOne(memberQuery);

    if (!member) {
      return res.status(404).json({
        success: false,
        error: 'Member not found'
      });
    }

    // Create transaction
    const newTransaction = new Transaction({
      member_id: member.memberId || member._id.toString(),
      amount,
      payment_method,
      payment_date: parsedDate,
      description: description?.trim()
    });

    const savedTransaction = await newTransaction.save();

    // Update member's transactions array
    await Member.findByIdAndUpdate(member._id, {
      $push: { transactions: savedTransaction.transaction_id }
    });

    res.status(201).json({
      success: true,
      message: 'Transaction added successfully',
      data: {
        transaction_id: savedTransaction.transaction_id,
        member_id: savedTransaction.member_id,
        amount: savedTransaction.amount,
        payment_method: savedTransaction.payment_method,
        payment_date: savedTransaction.payment_date,
        description: savedTransaction.description,
        createdAt: savedTransaction.createdAt
      }
    });

  } catch (err) {
    console.error('Transaction creation error:', err);
    
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Transaction ID conflict'
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
    
    res.status(500).json({
      success: false,
      error: 'Failed to add transaction'
    });
  }
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