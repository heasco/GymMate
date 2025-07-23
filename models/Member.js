const mongoose = require('mongoose');

const MemberSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Please add a name'] 
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
    validate: {
      validator: function(v) {
        return /\d{3}-\d{3}-\d{4}/.test(v); // Simple phone validation
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  email: { 
    type: String,
    lowercase: true,
    validate: {
      validator: function(v) {
        return /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(v);
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
  timestamps: true // Adds createdAt and updatedAt automatically
});

// Add indexes for better performance
MemberSchema.index({ name: 'text' });
MemberSchema.index({ type: 1 });
MemberSchema.index({ status: 1 });

module.exports = mongoose.model('Member', MemberSchema);