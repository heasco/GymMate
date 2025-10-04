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


let FeedbackModel;
try {
    FeedbackModel = mongoose.model('Feedback');
} catch (e) {
    FeedbackModel = mongoose.model('Feedback', feedbackSchema);
}

// IMPORTANT: Use FeedbackModel in the hook, and pre('validate') so it's before required validation!
feedbackSchema.pre('validate', async function (next) {
    if (this.isNew && !this.feedback_id) {
        try {
            const count = await FeedbackModel.countDocuments();
            this.feedback_id = `FB-${(count + 1).toString().padStart(4, '0')}`;
            next();
        } catch (err) {
            next(err);
        }
    } else {
        next();
    }
});

feedbackSchema.index({ class_id: 1, member_id: 1 }, { unique: true });

module.exports = FeedbackModel;
