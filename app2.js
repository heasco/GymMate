app2 JS

//This is the main server

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();

// ======================
// Constants
// ======================
const PORT = process.env.PORT || 8080;
const DB_URL = process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb+srv://herodvelasco023:Qn0ihspOECvY5vq2@cluster0.vejigze.mongodb.net/goalsgym?retryWrites=true&w=majority&appName=Cluster0";

// ======================
// Middleware
// ======================
// Allow CRUD methods and simple dev CORS (restrict in production)
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50kb' }));

// Serve static front-end files from ./public
app.use(express.static(path.join(__dirname, 'public')));

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
// Models
// ======================
const Member = require('./models/Member');

// ======================
// Routes
// ======================

// Login route (unchanged)
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const admin = await mongoose.connection.db.collection('admin').findOne({ username: username.trim() });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) return res.status(401).json({ error: 'Invalid credentials' });

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

// POST /api/members (create)
app.post('/api/members', async (req, res) => {
  console.log('[Member] Creation request received:', req.body);
  try {
    const { name: rawName, type: rawType, joinDate, phone: rawPhone, email: rawEmail, status, notes } = req.body;

    const name = rawName?.trim();
    const type = rawType?.trim()?.toLowerCase();
    const phone = rawPhone?.trim();
    const email = rawEmail?.trim()?.toLowerCase();

    if (!name || !type) {
      const errors = {};
      if (!name) errors.name = 'Name is required';
      if (!type) errors.type = 'Member type is required';
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
    }

    if (!['monthly', 'combative'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: { type: 'Member type must be either "monthly" or "combative"' }
      });
    }

    const newMember = new Member({
      name,
      type,
      joinDate: joinDate ? new Date(joinDate) : new Date(),
      phone: phone || undefined,
      email: email || undefined,
      status: status || 'active',
      notes: notes || undefined
    });

    const savedMember = await newMember.save();
    console.log(`[Member] Successfully created (ID: ${savedMember._id})`);

    // return the full saved document (so front-end gets _id etc)
    return res.status(201).json(savedMember);
  } catch (err) {
    console.error('[Member] Creation error:', err);

    if (err.code === 11000) {
      const duplicateField = Object.keys(err.keyPattern || {})[0] || 'field';
      return res.status(409).json({ success: false, error: 'Duplicate entry', details: { [duplicateField]: `This ${duplicateField} already exists` } });
    }

    if (err.name === 'ValidationError') {
      const errors = {};
      Object.values(err.errors).forEach(e => { errors[e.path] = e.message; });
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
    }

    return res.status(500).json({ success: false, error: 'Internal server error', details: process.env.NODE_ENV === 'development' ? { message: err.message, stack: err.stack } : undefined });
  }
});

// GET /api/members (list)
app.get('/api/members', async (req, res) => {
  try {
    const docs = await Member.find().sort({ createdAt: -1 }).exec();
    return res.json(docs);
  } catch (err) {
    console.error('[Member] GET error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/members/:id (update)
app.put('/api/members/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body;

    const allowed = {};
    if (updates.name !== undefined) allowed.name = updates.name;
    if (updates.type !== undefined) allowed.type = updates.type;
    if (updates.joinDate !== undefined) allowed.joinDate = updates.joinDate ? new Date(updates.joinDate) : undefined;
    if (updates.phone !== undefined) allowed.phone = updates.phone;
    if (updates.email !== undefined) allowed.email = updates.email;
    if (updates.status !== undefined) allowed.status = updates.status;
    if (updates.notes !== undefined) allowed.notes = updates.notes;

    const updated = await Member.findByIdAndUpdate(id, allowed, { new: true, runValidators: true }).exec();
    if (!updated) return res.status(404).json({ success: false, error: 'Member not found' });
    return res.json(updated);
  } catch (err) {
    console.error('[Member] UPDATE error:', err);
    if (err.name === 'ValidationError') {
      const errors = {};
      Object.values(err.errors).forEach(e => (errors[e.path] = e.message));
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/members/:id (delete)
app.delete('/api/members/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await Member.findByIdAndDelete(id).exec();
    if (!deleted) return res.status(404).json({ success: false, error: 'Member not found' });
    return res.json({ success: true, message: 'Member deleted', id: deleted._id });
  } catch (err) {
    console.error('[Member] DELETE error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Protected route example
app.get('/admin/data', async (req, res) => {
  try { res.json({ data: 'This is protected admin data' }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1, timestamp: new Date().toISOString() });
});

// try custom error handler if present
try {
  const errorHandler = require('./middleware/error');
  app.use(errorHandler);
} catch (e) {
  // ignore if not present
}

// 404 fallback
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// generic error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Server start
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// process handlers
process.on('unhandledRejection', err => { console.error('Unhandled Rejection:', err); });
process.on('SIGTERM', () => { server.close(() => { mongoose.connection.close(); console.log('Server terminated'); }); });
