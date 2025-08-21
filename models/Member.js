const mongoose = require('mongoose');

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
      validator: function(v) {
        return /^\+63\d{10}$/.test(v); // Philippine format: +639XXXXXXXXX
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
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email!`
    }
  },
  status: { 
    type: String, 
    default: 'active', 
    enum: ['active', 'inactive', 'suspended'] 
  }
}, {
  timestamps: true
});

// Auto-generate memberId before saving
MemberSchema.pre('save', async function(next) {
  if (!this.isNew || this.memberId) return next();
  
  try {
    // Find the member with highest memberId
    const lastMember = await this.constructor.findOne(
      { memberId: { $exists: true } },
      { memberId: 1 },
      { sort: { memberId: -1 } }
    );
    
    // Extract the number and increment
    const lastNumber = lastMember ? 
      parseInt(lastMember.memberId.split('-')[1], 10) : 0;
    const nextNumber = lastNumber + 1;
    
    // Format as MEM-0001
    this.memberId = `MEM-${String(nextNumber).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

// Create the model (handle potential duplicate models)
if (mongoose.models.Member) {
  mongoose.deleteModel('Member');
}

module.exports = mongoose.model('Member', MemberSchema);