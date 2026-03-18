const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); 

const membershipSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['monthly', 'combative', 'student', 'dropsin'],
    required: true
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
    unique: true,
    sparse: true, // Prevents conflicts if email is left empty
    lowercase: true,
    trim: true
  },
  phone: {
    type: String // Optional
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
    type: String // Optional
  },
  emergencyContact: {
    name: { type: String }, // Optional
    phone: { type: String }, // Optional
    relation: { type: String } // Optional
  },
  joinDate: { 
    type: Date, 
    default: Date.now // Ensures the joinDate sent by frontend is saved
  },
  memberships: [membershipSchema],
  faceEnrolled: {
    type: Boolean,
    default: false
  },
  faceId: {
    type: String
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

// Auto-generate memberId before validating so it satisfies `required: true`
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