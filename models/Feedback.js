// Feedback.js
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

// Auto-generate feedback_id
feedbackSchema.pre('save', async function(next) {
    if (this.isNew) {
        try {
            const count = await mongoose.models.Feedback.countDocuments();
            this.feedback_id = `FB-${(count + 1).toString().padStart(4, '0')}`;
            next();
        } catch (error) {
            next(error);
        }
    } else {
        next();
    }
});

// Prevent duplicate feedback from same member for same class
feedbackSchema.index({ class_id: 1, member_id: 1 }, { unique: true });

module.exports = mongoose.models.Feedback || mongoose.model('Feedback', feedbackSchema);
