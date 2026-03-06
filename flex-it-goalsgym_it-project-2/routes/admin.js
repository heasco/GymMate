// routes/admins.js
const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const asyncHandler = require('../middleware/asyncHandler');

// @desc    Get current logged-in admin's profile
// @route   GET /api/admins/me
router.get('/me', asyncHandler(async (req, res) => {
    // req.user is set by your protect middleware
    const admin = await Admin.findById(req.user.id || req.user._id).select('-password');
    if (!admin) return res.status(404).json({ success: false, error: 'Admin not found' });
    res.json({ success: true, data: admin });
}));

// @desc    Update current admin's profile
// @route   PUT /api/admins/me
router.put('/me', asyncHandler(async (req, res) => {
    const { name, email } = req.body;
    
    const admin = await Admin.findByIdAndUpdate(
        req.user.id || req.user._id, 
        { name, email }, 
        { new: true, runValidators: true }
    ).select('-password');

    res.json({ success: true, data: admin });
}));

// @desc    Add a new admin user
// @route   POST /api/admins
router.post('/', asyncHandler(async (req, res) => {
    const { name, username, email, password, role } = req.body;

    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
        return res.status(400).json({ success: false, error: 'Username already exists' });
    }

    const newAdmin = await Admin.create({
        name,
        username,
        email,
        password,
        role: role || 'admin'
    });

    res.status(201).json({ success: true, message: 'Admin created successfully' });
}));

module.exports = router;