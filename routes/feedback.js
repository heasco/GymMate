const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');

const Feedback = require('../models/Feedback');
const Enrollment = require('../models/Enrollment');
const Class = require('../models/Classes');

const router = express.Router();

// POST /api/feedback
router.post('/', asyncHandler(async (req, res) => {
    const { class_id, member_id, trainer_id, rating, comment } = req.body;
    if (!class_id || !member_id || !trainer_id || !rating) {
        return res.status(400).json({ success: false, error: 'Class ID, Member ID, Trainer ID, and Rating are required' });
    }
    if (rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' });
    }

    const classDoc = await Class.findOne({ _id: class_id, 'enrolled_members': { $elemMatch: { member_id, status: 'active' } } });
    if (!classDoc) return res.status(403).json({ success:false, error:'Member is not enrolled in this class' });

    const existingFeedback = await Feedback.findOne({ class_id, member_id });
    if (existingFeedback) return res.status(409).json({ success: false, error: 'Feedback already submitted for this class' });

    const feedback = new Feedback({ class_id, member_id, trainer_id, rating, comment: comment || '' });
    const savedFeedback = await feedback.save(); // << Important!

    // Optional: also push to class feedback array for quick lookup
    await Class.updateOne({ _id: class_id },
        { $push: { feedback: { member_id, rating, comment: comment || '', date_submitted: new Date() } } }
    );

    res.status(201).json({ success: true, message: 'Feedback submitted successfully', data: savedFeedback });
}));

// GET feedback for a class (anonymized for trainers/members and full detail for admin)
router.get('/class/:id', asyncHandler(async (req, res) => {
    const class_id = req.params.id;

    let feedbacks = await Feedback.find({ class_id }).lean();

    const isAdmin = !!req.query.admin;

    if (!isAdmin) {
        feedbacks = feedbacks.map(f => {
            const { member_id, ...rest } = f;
            return { ...rest };
        });
    }

    res.json({ success: true, data: feedbacks });
}));

// GET all feedback (only for admin, show member names)
router.get('/admin/all', async (req, res) => {
    const feedbacks = await Feedback.find().lean();
    res.json({ success: true, feedbacks });
});

// GET feedbacks by memberid (for themselves)
router.get('/member/:memberid', async (req, res) => {
    const feedbacks = await Feedback.find({ memberid: req.params.memberid });
    res.json({ success: true, feedbacks });
});

// DELETE feedback by feedback_id (for admin)
router.delete('/:feedback_id', asyncHandler(async (req, res) => {
  const feedback_id = req.params.feedback_id;
  const deleted = await Feedback.findOneAndDelete({ feedback_id: feedback_id });
  if (!deleted) return res.status(404).json({ success: false, error: 'Feedback not found' });
  res.json({ success: true, message: 'Feedback deleted successfully' });
}));



module.exports = router;
