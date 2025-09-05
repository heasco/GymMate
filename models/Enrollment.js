const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
  enrollment_id: {
    type: String,
    unique: true,
    required: true
  },
  class_id: {
    type: String,
    required: true,
    ref: 'Class'
  },
  member_id: {
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
}, {
  timestamps: true,
  collection: 'Enrollment' // Explicitly set the collection name
});

// Auto-generate enrollment_id
enrollmentSchema.pre('save', async function(next) {
  if (this.isNew) {
    try {
      const count = await mongoose.model('Enrollment').countDocuments();
      this.enrollment_id = `ENR-${(count + 1).toString().padStart(4, '0')}`;
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

// Compound index to prevent duplicate active enrollments
enrollmentSchema.index({ class_id: 1, member_id: 1 }, { 
  unique: true,
  partialFilterExpression: { status: 'active' }
});

// Explicitly set the collection name
module.exports = mongoose.model('Enrollment', enrollmentSchema, 'Enrollment');