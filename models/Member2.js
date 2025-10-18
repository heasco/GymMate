MEMBER2 JS

// models/Member.js

const mongoose = require('mongoose');

const MemberSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['monthly', 'combative'],
    default: 'monthly'
  },
  joinDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  phone: {
    type: String,
    trim: true,
    validate: {
      // Accepts common international/local formats (digits, spaces, parentheses, dashes, plus)
      validator: function (v) {
        if (!v) return true; // allow empty
        return /^[+\d]?(?:[\d\s().-]{7,})$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    validate: {
      validator: function (v) {
        if (!v) return true; // allow empty
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email!`
    }
  },
  status: {
    type: String,
    default: 'active',
    enum: ['active', 'inactive', 'pending', 'suspended']
  },
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Indexes
MemberSchema.index({ name: 'text' });
MemberSchema.index({ type: 1 });
MemberSchema.index({ status: 1 });
// Make email unique only when provided
MemberSchema.index({ email: 1 }, { unique: true, sparse: true });

// Pre-save sanitization
MemberSchema.pre('save', function (next) {
  if (this.email) this.email = this.email.trim().toLowerCase();
  if (this.phone) this.phone = this.phone.trim();
  if (this.name) this.name = this.name.trim();
  next();
});

module.exports = mongoose.model('Member', MemberSchema);
