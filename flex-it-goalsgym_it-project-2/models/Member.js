const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MembershipSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['monthly', 'combative']
  },
  duration: {
    type: Number,
    required: true,
    min: [1, 'Duration must be at least 1']
  },
  startDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true
  },
  remainingSessions: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    default: 'active',
    enum: ['active', 'inactive', 'suspended', 'expired']
  }
});

const MemberSchema = new mongoose.Schema({
  memberId: {
    type: String,
    unique: true,
    index: true
  },
  name: { 
    type: String, 
    required: [true, 'Please add a name'],
    trim: true
  },
  username: {
    type: String,
    unique: true,
    required: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: [6, 'Password must be at least 6 characters']
  },
  memberships: [MembershipSchema],
  joinDate: { 
    type: Date, 
    required: true, 
    default: Date.now 
  },
  phone: { 
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        return !v || /^\+63\d{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid Philippine phone number!`
    }
  },
  email: { 
    type: String,
    lowercase: true,
    trim: true,
    validate: {
      validator: function(v) {
        return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email!`
    }
  },
  faceId: { type: String },
  faceEnrolled: { type: Boolean, default: false },
  transactions: {
    type: [String],
    default: []
  },
  status: { 
    type: String, 
    default: 'active', 
    enum: ['active', 'inactive', 'suspended'] 
  }
}, {
  timestamps: true,
  collection: 'members'
});

// Hash password before saving
MemberSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

// Calculate end dates before validation
MemberSchema.pre('validate', function(next) {
  if (this.isModified('memberships') || this.isNew) {
    this.memberships.forEach(membership => {
      if (membership.isModified('startDate') || membership.isModified('type') || 
          membership.isModified('duration') || membership.isNew) {
        
        if (membership.type === 'monthly') {
          membership.endDate = new Date(membership.startDate);
          membership.endDate.setMonth(membership.endDate.getMonth() + membership.duration);
        } else if (membership.type === 'combative') {
          membership.remainingSessions = membership.duration;
          membership.endDate = new Date(membership.startDate);
          membership.endDate.setMonth(membership.endDate.getMonth() + 6);
        }
      }
    });
  }
  next();
});

// Auto-generate memberId before saving
MemberSchema.pre('save', async function(next) {
  if (!this.isNew || this.memberId) return next();
  
  try {
    const lastMember = await this.constructor.findOne(
      { memberId: { $exists: true } },
      { memberId: 1 },
      { sort: { memberId: -1 } }
    );
    
    const lastNumber = lastMember ? 
      parseInt(lastMember.memberId.split('-')[1], 10) : 0;
    const nextNumber = lastNumber + 1;
    
    this.memberId = `MEM-${String(nextNumber).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

if (mongoose.models.Member) {
  mongoose.deleteModel('Member');
}

module.exports = mongoose.model('Member', MemberSchema, 'members');