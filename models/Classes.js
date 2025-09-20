const mongoose = require('mongoose');

const EnrollmentSchema = new mongoose.Schema({
  member_id: {
    type: String,
    required: true
  },
  member_name: {
    type: String,
    required: true
  },
  enrollment_date: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'completed'],
    default: 'active'
  }
});

const ClassSchema = new mongoose.Schema({
  class_id: {
    type: String,
    unique: true,
    index: true
  },
  class_name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  schedule: {
    type: String,
    required: true
  },
  trainer_id: {
    type: String,
    required: true
  },
  trainer_name: {
    type: String,
    default: ''
  },
  capacity: {
    type: Number,
    required: true,
    min: 1
  },
  current_enrollment: {
    type: Number,
    default: 0
  },
  enrolled_members: [EnrollmentSchema],
  feedback: [{
    member_id: String,
    rating: Number,
    comment: String,
    date_submitted: {
      type: Date,
      default: Date.now
    }
  }],
  status: {
    type: String,
    enum: ['active', 'cancelled', 'completed'],
    default: 'active'
  }
}, {
  timestamps: true,
  collection: 'classes'
});

// Virtual for checking if class is full
ClassSchema.virtual('isFull').get(function() {
  return this.current_enrollment >= this.capacity;
});

// Auto-generate class_id before saving
ClassSchema.pre('save', async function(next) {
  if (!this.isNew || this.class_id) return next();
  
  try {
    const lastClass = await this.constructor.findOne(
      { class_id: { $exists: true } },
      { class_id: 1 },
      { sort: { class_id: -1 } }
    );
    
    const lastNumber = lastClass ? 
      parseInt(lastClass.class_id.split('-')[1], 10) : 0;
    const nextNumber = lastNumber + 1;
    
    this.class_id = `CLS-${String(nextNumber).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

// Create the model
if (mongoose.models.Class) {
  mongoose.deleteModel('Class');
}

module.exports = mongoose.model('Class', ClassSchema, 'classes');