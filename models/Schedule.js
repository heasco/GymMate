const mongoose = require('mongoose');

const ScheduleSchema = new mongoose.Schema({
  trainerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Trainer',  // Reference to the Trainer model
    required: [true, 'Trainer ID is required']
  },
  memberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',  // Reference to the Member model (if applicable)
    required: false  // Optional (if sessions are for members)
  },
  className: {
    type: String,
    required: [true, 'Class name is required'],
    trim: true
  },
  date: {
    type: Date,
    required: [true, 'Date is required']
  },
  startTime: {
    type: String,  // e.g., "14:30" (2:30 PM)
    required: [true, 'Start time is required'],
    match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please use HH:MM format']
  },
  endTime: {
    type: String,  // e.g., "15:30" (3:30 PM)
    required: [true, 'End time is required'],
    match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please use HH:MM format']
  },
  status: {
    type: String,
    enum: ['scheduled', 'cancelled', 'completed'],
    default: 'scheduled'
  }
}, {
  timestamps: true  // Adds createdAt and updatedAt
});

// Optional: Prevent overlapping schedules for the same trainer
ScheduleSchema.pre('save', async function(next) {
  const existingSchedule = await this.constructor.findOne({
    trainerId: this.trainerId,
    date: this.date,
    $or: [
      { startTime: { $lt: this.endTime }, endTime: { $gt: this.startTime } }
    ],
    status: { $ne: 'cancelled' }
  });

  if (existingSchedule) {
    throw new Error('Trainer already has a scheduled session at this time.');
  }
  next();
});

// Handle duplicate model definitions
if (mongoose.models.Schedule) {
  mongoose.deleteModel('Schedule');
}

module.exports = mongoose.model('Schedule', ScheduleSchema);