const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../middleware/asyncHandler');
const Trainer = require('../models/Trainer');
const Feedback = require('../models/Feedback');
const nodemailer = require('../utils/nodemailer');
// const resend = require('../utils/resend');

const router = express.Router();

// Helper: send trainer welcome email
async function sendTrainerWelcomeEmail({ name, email, username, tempPassword }) {
  if (!email) return;
  const subject = 'Welcome to GOALS Gym - Trainer Account Details';
  const text = `
Hi ${name},

You have been added as a trainer at GOALS Gym.
Your account details are:

Username: ${username}
Temporary Password: ${tempPassword}

Please log in and change your password as soon as possible.

Best,
GOALS Gym Team
  `;
  await nodemailer.sendMail({
    from: '"GOALS Gym" <admin@goalsgymbaguio.run.place>',
    to: email,
    subject,
    text,
  });
}

// PUT /api/trainers/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  // Try by MongoDB _id or by trainer_id
  let trainer;
  if (mongoose.Types.ObjectId.isValid(id)) {
    trainer = await Trainer.findById(id);
  }
  if (!trainer) {
    trainer = await Trainer.findOne({ trainer_id: id });
  }
  if (!trainer) {
    return res.status(404).json({ success: false, error: "Trainer not found." });
  }
  // Accept both is_available and isavailable
  if (typeof req.body.is_available !== "undefined") {
    trainer.is_available = req.body.is_available;
  } else if (typeof req.body.isavailable !== "undefined") {
    trainer.is_available = req.body.isavailable;
  }
  if (typeof req.body.name === "string") trainer.name = req.body.name.trim();
  if (typeof req.body.email === "string") trainer.email = req.body.email.trim().toLowerCase();
  if (typeof req.body.specialization === "string") trainer.specialization = req.body.specialization.trim();
  await trainer.save();

  res.json({
    success: true,
    message: "Trainer updated successfully.",
    data: {
      trainer_id: trainer.trainer_id,
      mongoId: trainer._id,
      name: trainer.name,
      specialization: trainer.specialization,
      email: trainer.email,
      is_available: trainer.is_available,
      assigned_classes: trainer.assigned_classes,
      updatedAt: trainer.updatedAt,
      feedback_received: trainer.feedback_received
    }
  });
}));

// GET /api/trainers/search?query=...
router.get('/search', asyncHandler(async (req, res) => {
  const query = req.query.query?.toLowerCase() || "";
  if (!query) {
    const trainers = await Trainer.find().sort({ createdAt: -1 });
    return res.json({ success: true, data: trainers });
  }
  const trainers = await Trainer.find({
    $or: [
      { trainer_id: { $regex: query, $options: "i" } },
      { name: { $regex: query, $options: "i" } }
    ]
  });
  res.json({ success: true, data: trainers });
}));

// POST /api/trainers
router.post('/', asyncHandler(async (req, res) => {
  const { name, specialization, is_available, assigned_classes, email, send_email } = req.body;

  if (!name || !specialization) {
    const errors = {};
    if (!name) errors.name = 'Name is required';
    if (!specialization) errors.specialization = 'Specialization is required';
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
  }

  // ALL WEEKS/DAYS/TIMES available by default
  const defaultWeeklyAvailability = {
    monday:    ['morning', 'afternoon', 'evening'],
    tuesday:   ['morning', 'afternoon', 'evening'],
    wednesday: ['morning', 'afternoon', 'evening'],
    thursday:  ['morning', 'afternoon', 'evening'],
    friday:    ['morning', 'afternoon', 'evening'],
    saturday:  ['morning', 'afternoon', 'evening'],
    sunday:    ['morning', 'afternoon', 'evening']
  };

  const nameParts = name.trim().split(/\s+/);
  const firstName = nameParts[0].toLowerCase();
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1].toLowerCase() : '';
  const firstLetterLastName = lastName.charAt(0) || '';
  let usernameBase = `trainer${firstName}${firstLetterLastName}`;
  let username = usernameBase;
  let suffix = 0;
  while (await Trainer.findOne({ username })) {
    suffix++;
    username = `${usernameBase}${suffix}`;
  }
  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  const tempPassword = firstName + randomDigits;

  const newTrainer = new Trainer({
    name: name.trim(),
    username,
    password: tempPassword,
    specialization: specialization.trim(),
    is_available: is_available !== undefined ? Boolean(is_available) : true,
    assigned_classes: Array.isArray(assigned_classes) ? assigned_classes : [],
    email: email ? email.trim().toLowerCase() : undefined,
    weeklyAvailability: defaultWeeklyAvailability // <----- HERE IS THE DEFAULT
  });

  const savedTrainer = await newTrainer.save();

  if (send_email) {
    try {
      await sendTrainerWelcomeEmail({
        name: savedTrainer.name,
        email: savedTrainer.email,
        username: savedTrainer.username,
        tempPassword
      });
      console.log('Email sent');
    } catch (err) {
      console.error('Error sending trainer welcome email:', err);
    }
  } else {
    console.log('Email sending skipped (send_email = false)');
  }

  res.status(201).json({
    success: true, message: 'Trainer created successfully',
    data: {
      trainer_id: savedTrainer.trainer_id,
      mongoId: savedTrainer._id,
      name: savedTrainer.name,
      username: savedTrainer.username,
      tempPassword,
      specialization: savedTrainer.specialization,
      is_available: savedTrainer.is_available,
      assigned_classes: savedTrainer.assigned_classes,
      weeklyAvailability: savedTrainer.weeklyAvailability,
      feedback_received: savedTrainer.feedback_received,
      createdAt: savedTrainer.createdAt
    }
  });
}));


// ============ AVAILABILITY & LEAVE ROUTES ============

// Universal trainer id lookup helper
function extractTrainerId(req) {
  return req.user?.trainer_id || req.user?.trainerid ||
         req.body?.trainer_id || req.body?.trainerid ||
         req.query?.trainer_id || req.query?.trainerid ||
         null;
}

// Set weekly availability
router.post('/set-availability', async (req, res) => {
  const trainerId = extractTrainerId(req);
  const weeklyAvailability = req.body.availability;
  try {
    const trainer = await Trainer.findOne({
      $or: [
        { trainer_id: trainerId },
        { trainerid: trainerId }
      ]
    });
    if (!trainer) return res.json({ success: false, error: 'Trainer not found.' });
    trainer.weeklyAvailability = weeklyAvailability;
    await trainer.save();
    res.json({ success: true, message: 'Availability saved.' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Get current weekly availability
router.get('/get-availability', async (req, res) => {
  const trainerId = extractTrainerId(req);
  try {
    const trainer = await Trainer.findOne({
      $or: [
        { trainer_id: trainerId },
        { trainerid: trainerId }
      ]
    });
    if (!trainer) return res.json({ success: false, error: 'Trainer not found.' });
    res.json({ success: true, availability: trainer.weeklyAvailability || {} });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Mark a leave/unavailability day
router.post('/mark-leave', async (req, res) => {
  const trainerId = extractTrainerId(req);
  const date = req.body.date;
  const reason = req.body.reason || '';
  try {
    const trainer = await Trainer.findOne({
      $or: [
        { trainer_id: trainerId },
        { trainerid: trainerId }
      ]
    });
    if (!trainer) return res.json({ success: false, error: 'Trainer not found.' });
    trainer.leaveRecords = trainer.leaveRecords || [];
    trainer.leaveRecords.push({ date, reason });
    await trainer.save();
    res.json({ success: true, message: 'Leave recorded.' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Get all upcoming leave/unavailability days
router.get('/get-leave', async (req, res) => {
  const trainerId = extractTrainerId(req);
  try {
    const trainer = await Trainer.findOne({
      $or: [
        { trainer_id: trainerId },
        { trainerid: trainerId }
      ]
    });
    if (!trainer) return res.json({ success: false, error: 'Trainer not found.' });
    const today = new Date().toISOString().split("T")[0];
    const upcomingLeaves = (trainer.leaveRecords || []).filter(l => l.date >= today);
    res.json({ success: true, leaves: upcomingLeaves });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// =======================================================================

// GET all trainers
router.get('/', asyncHandler(async (req, res) => {
  const trainers = await Trainer.find().sort({ createdAt: -1 });
  res.json({ success: true, count: trainers.length, data: trainers });
}));

router.get('/available', asyncHandler(async (req, res) => {
  const availableTrainers = await Trainer.findAvailable();
  res.json({ success: true, count: availableTrainers.length, data: availableTrainers });
}));

router.get('/:id/feedback', asyncHandler(async (req, res) => {
  const trainer_id = req.params.id;
  const feedback = await Feedback.find({ trainer_id }).populate('class_id', 'class_name').sort({ date_submitted: -1 });
  res.json({ success: true, count: feedback.length, data: feedback });
}));

router.get('/:id/rating', asyncHandler(async (req, res) => {
  const trainer_id = req.params.id;
  const result = await Feedback.aggregate([
    { $match: { trainer_id } },
    { $group: { _id: null, averageRating: { $avg: '$rating' }, totalFeedback: { $sum: 1 } } }
  ]);
  const averageRating = result.length > 0 ? result[0].averageRating.toFixed(1) : 0;
  const totalFeedback = result.length > 0 ? result[0].totalFeedback : 0;
  res.json({ success: true, data: { averageRating, totalFeedback } });
}));

router.post('/update-profile', asyncHandler(async (req, res) => {
  const { trainer_id, username, phone, email, currentPassword, newPassword } = req.body;
  let trainer;
  if (mongoose.Types.ObjectId.isValid(trainer_id)) {
    trainer = await Trainer.findOne({
      $or: [{ trainer_id }, { _id: trainer_id }]
    });
  } else {
    trainer = await Trainer.findOne({ trainer_id });
  }
  if (!trainer) return res.status(404).json({ success: false, error: 'Trainer not found' });

  if (typeof currentPassword === 'string' && currentPassword.length > 0) {
    const match = await bcrypt.compare(currentPassword, trainer.password);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Incorrect current password.' });
    }
  }
  if (username && username !== trainer.username) {
    const existing = await Trainer.findOne({ username: username.trim().toLowerCase(), _id: { $ne: trainer._id } });
    if (existing) {
      return res.status(409).json({ success: false, error: 'Username is already taken.' });
    }
    trainer.username = username.trim().toLowerCase();
  }
  if (typeof email !== 'undefined' && email !== trainer.email) {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email address' });
    }
    trainer.email = email ? email.trim().toLowerCase() : '';
  }
  if (typeof phone !== 'undefined' && phone !== trainer.phone) {
    if (phone && phone !== '' && !/^\+63\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, error: 'Invalid Philippine phone format. Use +63XXXXXXXXXX' });
    }
    trainer.phone = phone ? phone.trim() : '';
  }
  if (newPassword) {
    trainer.password = newPassword;
  }
  await trainer.save();
  res.json({ success: true, message: 'Trainer profile updated.' });
}));

module.exports = router;
