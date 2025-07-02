const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const app = express();

// ======================
// Constants
// ======================
const PORT = process.env.PORT || 8080;
const DB_URL = "mongodb+srv://herodvelasco023:Qn0ihspOECvY5vq2@cluster0.vejigze.mongodb.net/goalsgym?retryWrites=true&w=majority&appName=Cluster0";

// ======================
// Middleware - Open CORS
// ======================
app.use(cors({
  origin: '*', // Allow all origins temporarily
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10kb' }));

// JSON error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: "Invalid JSON format" });
  }
  next();
});

// ======================
// Database Connection
// ======================
mongoose.connect(DB_URL, {
  dbName: 'goalsgym',
  useNewUrlParser: true,
  useUnifiedTopology: true,
  retryWrites: true,
  w: 'majority'
});

mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connected');
  initializeAdmin(); // Initialize admin for both dev and production (temporary)
});

mongoose.connection.on('error', err => {
  console.error('❌ MongoDB connection error:', err);
  if (process.env.PORT) process.exit(1); // Exit in production
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
// Routes
// ======================
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await mongoose.connection.db.collection('admin').findOne({ 
      username: username.trim() 
    });
    
    if (!admin || !(await bcrypt.compare(password, admin.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ 
      success: true,
      user: {
        id: admin._id,
        username: admin.username,
        name: admin.name
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  db: mongoose.connection.readyState === 1 
}));

// ======================
// Server Start
// ======================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`MongoDB: ${DB_URL.split('@')[1].split('?')[0]}`);
  console.log(`CORS: Enabled for all origins (*)`);
});

// Crash protection
process.on('unhandledRejection', err => {
  console.error('Unhandled Rejection:', err);
});