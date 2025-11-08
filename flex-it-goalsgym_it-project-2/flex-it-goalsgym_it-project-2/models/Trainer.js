const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Feedback sub-schema for embedded array
const FeedbackSchema = new mongoose.Schema({
  session_id: {
    type: String,
    required: true,
  },
  member_id: {
    type: String,
    required: true,
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    required: true,
  },
  comment: {
    type: String,
    trim: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
}, { _id: true });

const TrainerSchema = new mongoose.Schema({
  trainer_id: {
    type: String,
    unique: true,
    index: true,
  },
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true,
  },
  username: {
    type: String,
    unique: true,
    required: true,
    lowercase: true,
    trim: true
  },
    email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email is invalid']
  },
  password: {
    type: String,
    required: true,
    minlength: [6, 'Password must be at least 6 characters']
  },
  specialization: {
    type: String,
    required: [true, 'Please add a specialization'],
    trim: true,
  },
  is_available: {
    type: Boolean,
    default: true,
  },
weeklyAvailability: {
  type: Object, 
  default: {}
},
leaveRecords: [{
  date: { type: String, required: true }, // YYYY-MM-DD
  reason: { type: String, default: "" }
}],
  assigned_classes: {
    type: [String],
    default: [],
  },
  feedback_received: {
    type: [FeedbackSchema],
    default: [],
  },
}, {
  timestamps: true,
  collection: 'trainers'
});

// Hash password before saving
TrainerSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  if (!this.isNew || this.trainer_id) return next();

  try {
    const lastTrainer = await this.constructor.findOne(
      { trainer_id: { $exists: true } },
      { trainer_id: 1 },
      { sort: { trainer_id: -1 } }
    );

    const lastNumber = lastTrainer ?
      parseInt(lastTrainer.trainer_id.split('-')[1], 10) : 0;
    const nextNumber = lastNumber + 1;

    this.trainer_id = `TRN-${String(nextNumber).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

// Instance method to add feedback
TrainerSchema.methods.addFeedback = function (sessionId, memberId, rating, comment = '') {
  this.feedback_received.push({
    session_id: sessionId,
    member_id: memberId,
    rating,
    comment,
  });
  return this.save();
};

// Instance method to get average rating
TrainerSchema.methods.getAverageRating = function () {
  if (this.feedback_received.length === 0) return 0;
  const sum = this.feedback_received.reduce((total, feedback) => total + feedback.rating, 0);
  return (sum / this.feedback_received.length).toFixed(1);
};

// Static method to find available trainers
TrainerSchema.statics.findAvailable = function () {
  return this.find({ is_available: true });
};

// Clean up any existing model before creating new one
if (mongoose.models.Trainer) {
  mongoose.deleteModel('Trainer');
}

module.exports = mongoose.model('Trainer', TrainerSchema, 'trainers');