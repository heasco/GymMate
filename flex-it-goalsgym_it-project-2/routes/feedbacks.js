const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth');
const Feedback = require('../models/Feedback');
const Member = require('../models/Member');

const router = express.Router();

// @desc    Submit new class feedback
// @route   POST /api/feedbacks
// @access  Private (Members)
router.post('/', protect, asyncHandler(async (req, res) => {
    const { class_id, member_id, trainer_id, rating, comment } = req.body;

    // 1. Basic validation
    if (!class_id || !member_id || !trainer_id || !rating) {
        return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }

    // 2. Resolve member query (handles both custom memberId string and MongoDB ObjectId)
    let query = { memberId: member_id };
    if (mongoose.Types.ObjectId.isValid(member_id)) {
        query = { $or: [{ memberId: member_id }, { _id: new mongoose.Types.ObjectId(member_id) }] };
    }

    const member = await Member.findOne(query);
    if (!member) {
        return res.status(404).json({ success: false, error: 'Member not found.' });
    }

    // 3. FEATURE: Check which products/memberships are attached to the member
    // The member must have at least one 'active' membership product to leave feedback.
    const hasActiveProduct = member.memberships && member.memberships.some(m => m.status === 'active');
    
    if (!hasActiveProduct) {
        return res.status(403).json({ 
            success: false, 
            error: 'Feedback denied: You must have an active membership product attached to your account to submit feedback.' 
        });
    }

    // 4. Unique check: Ensure they haven't already left feedback for this exact class
    const existingFeedback = await Feedback.findOne({ class_id, member_id: member.memberId || member_id });
    if (existingFeedback) {
        return res.status(400).json({ 
            success: false, 
            error: 'You have already submitted feedback for this specific class.' 
        });
    }

    // 5. Create and save the feedback
    const feedback = await Feedback.create({
        class_id,
        member_id: member.memberId || member_id, // Store their resolved ID
        trainer_id,
        rating,
        comment
    });

    res.status(201).json({
        success: true,
        message: 'Feedback submitted successfully',
        data: feedback
    });
}));

// @desc    Get all feedback submitted by a specific member
// @route   GET /api/feedbacks/member/:member_id
// @access  Private (Members/Admin)
router.get('/member/:member_id', protect, asyncHandler(async (req, res) => {
    const { member_id } = req.params;

    // Find all feedback matching the member_id, sorted by newest first
    const feedbacks = await Feedback.find({ member_id }).sort({ date_submitted: -1 });
    
    res.json({
        success: true,
        count: feedbacks.length,
        feedbacks
    });
}));

// @desc    Get all feedback (Optional: for Admin dashboard)
// @route   GET /api/feedbacks
// @access  Private (Admin)
router.get('/', protect, asyncHandler(async (req, res) => {
    const feedbacks = await Feedback.find().sort({ date_submitted: -1 });
    
    res.json({
        success: true,
        count: feedbacks.length,
        data: feedbacks
    });
}));

module.exports = router;