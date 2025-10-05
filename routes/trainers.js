const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../middleware/asyncHandler');
const Trainer = require('../models/Trainer');
const Feedback = require('../models/Feedback');

const router = express.Router();

// POST /api/trainers
router.post('/', asyncHandler(async (req, res) => {
  const { name, specialization, is_available, assigned_classes } = req.body;
  if (!name || !specialization) {
    const errors = {};
    if (!name) errors.name = 'Name is required';
    if (!specialization) errors.specialization = 'Specialization is required';
    return res.status(400).json({ success:false, error:'Validation failed', details: errors });
  }

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
  });

  const savedTrainer = await newTrainer.save();
  res.status(201).json({
    success:true, message:'Trainer created successfully',
    data: {
      trainer_id: savedTrainer.trainer_id,
      mongoId: savedTrainer._id,
      name: savedTrainer.name,
      username: savedTrainer.username,
      tempPassword,
      specialization: savedTrainer.specialization,
      is_available: savedTrainer.is_available,
      assigned_classes: savedTrainer.assigned_classes,
      feedback_received: savedTrainer.feedback_received,
      createdAt: savedTrainer.createdAt
    }
  });
}));

// GET /api/trainers
router.get('/', asyncHandler(async (req, res) => {
  const trainers = await Trainer.find().sort({ createdAt: -1 });
  res.json({ success:true, count: trainers.length, data: trainers });
}));

// GET /api/trainers/available
router.get('/available', asyncHandler(async (req, res) => {
  const availableTrainers = await Trainer.findAvailable();
  res.json({ success:true, count: availableTrainers.length, data: availableTrainers });
}));

// GET /api/trainers/:id/feedback
router.get('/:id/feedback', asyncHandler(async (req, res) => {
  const trainer_id = req.params.id;
  const feedback = await Feedback.find({ trainer_id }).populate('class_id', 'class_name').sort({ date_submitted:-1 });
  res.json({ success:true, count: feedback.length, data: feedback });
}));

// GET /api/trainers/:id/rating
router.get('/:id/rating', asyncHandler(async (req, res) => {
  const trainer_id = req.params.id;
  const result = await Feedback.aggregate([
    { $match: { trainer_id } },
    { $group: { _id: null, averageRating: { $avg: '$rating' }, totalFeedback: { $sum: 1 } } }
  ]);
  const averageRating = result.length > 0 ? result[0].averageRating.toFixed(1) : 0;
  const totalFeedback = result.length > 0 ? result[0].totalFeedback : 0;
  res.json({ success:true, data: { averageRating, totalFeedback } });
}));

// POST /api/trainers/update-profile
router.post('/update-profile', asyncHandler(async (req, res) => {
  const { trainer_id, name, username, currentPassword, newPassword } = req.body;

  let trainer;
  if (mongoose.Types.ObjectId.isValid(trainer_id)) {
    trainer = await Trainer.findOne({
      $or: [{ trainer_id }, { _id: trainer_id }]
    });
  } else {
    trainer = await Trainer.findOne({ trainer_id });
  }

  if (!trainer) return res.status(404).json({ success: false, error: 'Trainer not found' });

  const match = await bcrypt.compare(currentPassword, trainer.password);
  if (!match) {
    return res.status(401).json({ success: false, error: 'Incorrect current password.' });
  }
  if (name) trainer.name = name.trim();
  if (username && username !== trainer.username) {
    const existing = await Trainer.findOne({ username: username.trim().toLowerCase(), _id: { $ne: trainer._id } });
    if (existing) {
      return res.status(409).json({ success: false, error: 'Username is already taken.' });
    }
    trainer.username = username.trim().toLowerCase();
  }
  if (newPassword) {
    trainer.password = newPassword;
  }
  await trainer.save();
  res.json({ success: true, message: 'Trainer profile updated.' });
}));


module.exports = router;
