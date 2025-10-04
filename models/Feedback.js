const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  feedback_id: { type: String, unique: true, required: true },
  class_id: { type: String, required: true, ref: 'Class' },
  member_id: { type: String, required: true },
  trainer_id: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, trim: true, maxlength: 500 },
  date_submitted: { type: Date, default: Date.now }
}, { timestamps: true });

// Must be before model registration!
feedbackSchema.pre('validate', async function (next) {
  if (this.isNew && !this.feedback_id) {
    try {
      // If model not yet registered, use mongoose.models for counting
      const Feedback = mongoose.models['Feedback'] || mongoose.model('Feedback', feedbackSchema);
      const count = await Feedback.countDocuments();
      this.feedback_id = `FB-${(count + 1).toString().padStart(4, '0')}`;
      next();
    } catch (err) {
      next(err);
    }
  } else {
    next();
  }
});

// Unique: only one feedback per class+member
feedbackSchema.index({ class_id: 1, member_id: 1 }, { unique: true });

module.exports = mongoose.model('Feedback', feedbackSchema);
