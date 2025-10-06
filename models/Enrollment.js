const mongoose = require('mongoose');

const EnrollmentSchema = new mongoose.Schema({
  enrollment_id: {
    type: String,
    unique: true,
    index: true
  },
  class_id: {
    type: String,
    required: true,
    ref: 'Class'
  },
  member_id: {
    type: String,
    required: true,
    ref: 'Member'
  },
  member_name: {
    type: String,
    required: true
  },
  session_date: {
    type: Date,
    required: true
  },
  session_time: {
    type: String,
    required: true // e.g., "9:00 AM - 10:00 AM"
  },
  enrollment_date: {
    type: Date,
    default: Date.now
  },
  attendance_status: {
    type: String,
    enum: ['scheduled', 'attended', 'missed', 'cancelled'],
    default: 'scheduled'
  },
  attended_at: {
    type: Date,
    default: null
  },
  cancelled_at: {
    type: Date,
    default: null
  },
  refund_processed: {
    type: Boolean,
    default: false
  },
  notes: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'completed'],
    default: 'active'
  }
}, {
  timestamps: true,
  collection: 'enrollments'
});

// Auto-generate enrollment_id before saving
EnrollmentSchema.pre('save', async function(next) {
  if (!this.isNew || this.enrollment_id) return next();
  
  try {
    const lastEnrollment = await this.constructor.findOne(
      { enrollment_id: { $exists: true } },
      { enrollment_id: 1 },
      { sort: { enrollment_id: -1 } }
    );
    
    const lastNumber = lastEnrollment ? 
      parseInt(lastEnrollment.enrollment_id.split('-')[1], 10) : 0;
    const nextNumber = lastNumber + 1;
    
    this.enrollment_id = `ENR-${String(nextNumber).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

// Create the model
if (mongoose.models.Enrollment) {
  mongoose.deleteModel('Enrollment');
}

module.exports = mongoose.model('Enrollment', EnrollmentSchema, 'enrollments');
