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
    return res.status(400).json({ success:false, error:'Class ID, Member ID, Trainer ID, and Rating are required' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ success:false, error:'Rating must be between 1 and 5' });
  }

  const enrollment = await Enrollment.findOne({ class_id, member_id, status: 'active' });
  if (!enrollment) return res.status(403).json({ success:false, error:'Member is not enrolled in this class' });

  const existingFeedback = await Feedback.findOne({ class_id, member_id });
  if (existingFeedback) return res.status(409).json({ success:false, error:'Feedback already submitted for this class' });

  const feedback = new Feedback({ class_id, member_id, trainer_id, rating, comment: comment || '' });
  const savedFeedback = await feedback.save();

  await Class.findOneAndUpdate({ class_id }, {
    $push: {
      feedback: {
        member_id,
        rating,
        comment: comment || '',
        date_submitted: new Date()
      }
    }
  });

  res.status(201).json({ success:true, message:'Feedback submitted successfully', data: savedFeedback });
}));

module.exports = router;
