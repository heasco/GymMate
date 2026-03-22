const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); 

const membershipSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['monthly', 'combative', 'student', 'dropsin'],
    required: true
  },
  duration: {
    type: Number 
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled'],
    default: 'active'
  },
  remainingSessions: {
    type: Number,
  },
  paymentStatus: {
    type: String,
    enum: ['paid', 'unpaid'],
    default: 'unpaid'
  }
});

const memberSchema = new mongoose.Schema({
  memberId: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true,
    trim: true
    // No unique tag here, duplicates allowed
  },
  username: { 
    type: String, 
    unique: true, 
    sparse: true, 
    lowercase: true, 
    trim: true 
  },
  password: { 
    type: String 
  },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    default: "" // Safely allows empty strings instead of null
  },
  phone: {
    type: String,
    default: "" // Safely allows empty strings instead of null
  },
  dob: {
    type: Date,
    required: true
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    required: true
  },
  address: {
    type: String,
    default: ""
  },
  emergencyContact: {
    name: { type: String, default: "" }, 
    phone: { type: String, default: "" }, 
    relation: { type: String, default: "" } 
  },
  joinDate: { 
    type: Date, 
    default: Date.now 
  },
  memberships: [membershipSchema],
  faceEnrolled: {
    type: Boolean,
    default: false
  },
  faceId: {
    type: String,
    default: ""
  },
  faceImagePaths: [{
    type: String
  }],
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true,
  collection: 'members'
});

// Create compound index for active memberships
memberSchema.index({ 'memberships.status': 1, 'memberships.endDate': 1 });

// Auto-generate memberId before validating
memberSchema.pre('validate', async function (next) {
  if (!this.isNew || this.memberId) return next();
  try {
    const last = await this.constructor.findOne({ memberId: { $exists: true } }, { memberId: 1 }, { sort: { memberId: -1 } });
    const lastNum = last && last.memberId ? parseInt(last.memberId.split('-')[1], 10) : 0;
    this.memberId = `MEM-${String(lastNum + 1).padStart(4, '0')}`;
    next();
  } catch (e) {
    next(e);
  }
});

// Hash password before saving
memberSchema.pre('save', async function (next) {
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

module.exports = mongoose.model('Member', memberSchema);