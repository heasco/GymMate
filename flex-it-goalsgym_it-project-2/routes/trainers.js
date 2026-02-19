const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../middleware/asyncHandler');
const Trainer = require('../models/Trainer');
const Classes = require('../models/Classes');
const Feedback = require('../models/Feedback');
const nodemailer = require('../utils/nodemailer');

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
    from: '"GOALS Gym" <no-reply@goalsgym.com>',
    to: email,
    subject,
    text,
  });
}

// ============================================
// SPECIFIC ROUTES FIRST (before /:id routes)
// ============================================

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

// GET /api/trainers/available
router.get('/available', asyncHandler(async (req, res) => {
  const availableTrainers = await Trainer.findAvailable();
  res.json({ success: true, count: availableTrainers.length, data: availableTrainers });
}));

// POST /api/trainers/check-availability
router.post('/check-availability', asyncHandler(async (req, res) => {
    const { trainer_id, scheduleType, days, date, startTime, endTime, classIdToExclude } = req.body;

    if (!trainer_id || !scheduleType || !startTime || !endTime) {
        return res.status(400).json({ success: false, error: 'Missing required fields for availability check.' });
    }

    const trainerClasses = await Classes.find({
        trainer_id,
        _id: { $ne: classIdToExclude } // Exclude the class being edited
    });

    const newStartTime = new Date(`1970-01-01T${startTime}`);
    const newEndTime = new Date(`1970-01-01T${endTime}`);

    let isConflict = false;
    let conflictingClass = null;

    for (const existingClass of trainerClasses) {
        const scheduleParts = existingClass.schedule.match(/(One-time|Weekly|Monthly)\s+([^,]+),\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (!scheduleParts) continue;

        const [, existingType, existingDetails, existingStartStr, existingEndStr] = scheduleParts;

        const existingStartTime = new Date(`1970-01-01T${to24h(existingStartStr)}`);
        const existingEndTime = new Date(`1970-01-01T${to24h(existingEndStr)}`);

        // Check for time overlap
        const timeOverlap = newStartTime < existingEndTime && newEndTime > existingStartTime;

        if (!timeOverlap) continue;

        if (scheduleType === 'one-time' && existingType.toLowerCase() === 'one-time') {
            const existingDate = existingDetails.trim();
            if (date === existingDate) {
                isConflict = true;
            }
        } else if (scheduleType === 'weekly' && (existingType.toLowerCase() === 'weekly' || existingType.toLowerCase() === 'monthly')) {
            const existingDays = existingDetails.split(',').map(d => d.trim());
            if (days.some(day => existingDays.includes(day))) {
                isConflict = true;
            }
        } else if (scheduleType === 'one-time' && (existingType.toLowerCase() === 'weekly' || existingType.toLowerCase() === 'monthly')) {
            const oneTimeDateDay = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
            const existingDays = existingDetails.split(',').map(d => d.trim());
            if (existingDays.includes(oneTimeDateDay)) {
                isConflict = true;
            }
        } else if ((scheduleType === 'weekly' || scheduleType === 'monthly') && existingType.toLowerCase() === 'one-time') {
            const existingDateDay = new Date(existingDetails.trim()).toLocaleDateString('en-US', { weekday: 'long' });
            if (days.includes(existingDateDay)) {
                isConflict = true;
            }
        }
        
        if (isConflict) {
            conflictingClass = existingClass;
            break;
        }
    }

    res.json({ isConflict, conflictingClass });
}));


// GET /api/trainers (get all trainers)
router.get('/', asyncHandler(async (req, res) => {
  const trainers = await Trainer.find().sort({ createdAt: -1 });
  res.json({ success: true, count: trainers.length, data: trainers });
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

  const defaultWeeklyAvailability = {
    monday: ['morning', 'afternoon', 'evening'],
    tuesday: ['morning', 'afternoon', 'evening'],
    wednesday: ['morning', 'afternoon', 'evening'],
    thursday: ['morning', 'afternoon', 'evening'],
    friday: ['morning', 'afternoon', 'evening'],
    saturday: ['morning', 'afternoon', 'evening'],
    sunday: ['morning', 'afternoon', 'evening']
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
    weeklyAvailability: defaultWeeklyAvailability
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

function extractTrainerId(req) {
  return req.user?.trainer_id || req.user?.trainerid ||
    req.body?.trainer_id || req.body?.trainerid ||
    req.query?.trainer_id || req.query?.trainerid ||
    null;
}

router.post('/set-availability', async (req, res) => {
  const trainerId = extractTrainerId(req);
  const weeklyAvailability = req.body.availability;
  try {
    const trainer = await Trainer.findOne({
      $or: [{ trainer_id: trainerId }, { trainerid: trainerId }]
    });
    if (!trainer) return res.json({ success: false, error: 'Trainer not found.' });
    trainer.weeklyAvailability = weeklyAvailability;
    await trainer.save();
    res.json({ success: true, message: 'Availability saved.' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.get('/get-availability', async (req, res) => {
  const trainerId = extractTrainerId(req);
  try {
    const trainer = await Trainer.findOne({
      $or: [{ trainer_id: trainerId }, { trainerid: trainerId }]
    });
    if (!trainer) return res.json({ success: false, error: 'Trainer not found.' });
    res.json({ success: true, availability: trainer.weeklyAvailability || {} });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/mark-leave', async (req, res) => {
  const trainerId = extractTrainerId(req);
  const date = req.body.date;
  const reason = req.body.reason || '';
  try {
    const trainer = await Trainer.findOne({
      $or: [{ trainer_id: trainerId }, { trainerid: trainerId }]
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

router.get('/get-leave', async (req, res) => {
  const trainerId = extractTrainerId(req);
  try {
    const trainer = await Trainer.findOne({
      $or: [{ trainer_id: trainerId }, { trainerid: trainerId }]
    });
    if (!trainer) return res.json({ success: false, error: 'Trainer not found.' });
    const today = new Date().toISOString().split("T")[0];
    const upcomingLeaves = (trainer.leaveRecords || []).filter(l => l.date >= today);
    res.json({ success: true, leaves: upcomingLeaves });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Update profile - NO CURRENT PASSWORD REQUIRED
router.post('/update-profile', asyncHandler(async (req, res) => {
  const { trainer_id, username, phone, email, newPassword } = req.body;

  if (!trainer_id) {
    return res.status(400).json({ success: false, error: 'Trainer ID is required' });
  }

  let trainer;
  if (mongoose.Types.ObjectId.isValid(trainer_id)) {
    trainer = await Trainer.findOne({
      $or: [{ trainer_id }, { _id: trainer_id }]
    });
  } else {
    trainer = await Trainer.findOne({ trainer_id });
  }

  if (!trainer) {
    return res.status(404).json({ success: false, error: 'Trainer not found' });
  }

  // UPDATE USERNAME (if provided and changed)
  if (username && username.trim() !== '' && username !== trainer.username) {
    const existing = await Trainer.findOne({
      username: username.trim().toLowerCase(),
      _id: { $ne: trainer._id }
    });

    if (existing) {
      return res.status(409).json({ success: false, error: 'Username is already taken.' });
    }

    trainer.username = username.trim().toLowerCase();
  }

  // UPDATE EMAIL (if provided and changed)
  if (typeof email !== 'undefined' && email !== trainer.email) {
    if (email && email.trim() !== '') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email address' });
      }

      const existingEmail = await Trainer.findOne({
        email: email.trim().toLowerCase(),
        _id: { $ne: trainer._id }
      });

      if (existingEmail) {
        return res.status(409).json({ success: false, error: 'Email is already taken.' });
      }

      trainer.email = email.trim().toLowerCase();
    } else {
      trainer.email = '';
    }
  }

  // UPDATE PHONE (if provided and changed)
  if (typeof phone !== 'undefined' && phone !== trainer.phone) {
    if (phone && phone.trim() !== '') {
      if (!/^\+63\d{10}$/.test(phone)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Philippine phone format. Use +63XXXXXXXXXX'
        });
      }
      trainer.phone = phone.trim();
    } else {
      trainer.phone = '';
    }
  }

  // UPDATE PASSWORD (if provided)
  if (newPassword && newPassword.trim() !== '') {
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }
    trainer.password = newPassword;
  }

  await trainer.save({ validateModifiedOnly: true });

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: {
      trainer_id: trainer.trainer_id,
      username: trainer.username,
      email: trainer.email,
      phone: trainer.phone
    }
  });
}));

// ✅ PUT /api/trainers/:id - Update trainer by ID (SINGLE ROUTE - NO DUPLICATE)
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Remove fields that shouldn't be updated directly
  delete updates.trainer_id;
  delete updates._id;
  delete updates.createdAt;
  delete updates.updatedAt;

  // Lowercase email and username if provided
  if (updates.email) {
    updates.email = updates.email.toLowerCase().trim();
  }
  if (updates.username) {
    updates.username = updates.username.toLowerCase().trim();
  }

  // Find trainer
  let trainer;
  if (mongoose.Types.ObjectId.isValid(id)) {
    trainer = await Trainer.findOne({ $or: [{ trainer_id: id }, { _id: id }] });
  } else {
    trainer = await Trainer.findOne({ trainer_id: id });
  }

  if (!trainer) {
    return res.status(404).json({ success: false, error: 'Trainer not found' });
  }

  // CHECK EMAIL UNIQUENESS (if email is being changed)
  if (updates.email && updates.email !== trainer.email) {
    const existingEmail = await Trainer.findOne({
      email: updates.email,
      _id: { $ne: trainer._id }
    });

    if (existingEmail) {
      return res.status(409).json({ success: false, error: 'Email is already taken' });
    }
  }

  // CHECK USERNAME UNIQUENESS (if username is being changed)
  if (updates.username && updates.username !== trainer.username) {
    const existingUsername = await Trainer.findOne({
      username: updates.username,
      _id: { $ne: trainer._id }
    });

    if (existingUsername) {
      return res.status(409).json({ success: false, error: 'Username is already taken' });
    }
  }

  // Accept both is_available and isavailable
  if (typeof updates.is_available !== "undefined") {
    trainer.is_available = updates.is_available;
  } else if (typeof updates.isavailable !== "undefined") {
    trainer.is_available = updates.isavailable;
  }

  // Apply other updates
  if (typeof updates.name === "string") trainer.name = updates.name.trim();
  if (typeof updates.email === "string") trainer.email = updates.email;
  if (typeof updates.phone === "string") trainer.phone = updates.phone;
  if (typeof updates.specialization === "string") trainer.specialization = updates.specialization.trim();

  // BYPASS EMAIL VALIDATION for updates
  await trainer.save({ validateModifiedOnly: true });

  // Send email notification if email was updated
  const email = trainer.email;
  if (email) {
    try {
      const subject = 'Your GOALS Gym Trainer Profile Has Been Updated';
      const text = `Hi ${trainer.name},\n\nYour trainer profile has been updated.\n\nIf you did not make this change, please contact the gym administrator immediately.\n\nBest,\nGOALS Gym Team`;
      await nodemailer.sendMail({
        from: '"GOALS Gym" <no-reply@goalsgym.com>',
        to: email,
        subject,
        text
      });
      console.log('Email notification sent to trainer:', email);
    } catch (emailError) {
      console.error('Failed to send email:', emailError.message);
    }
  }

  res.json({
    success: true,
    message: 'Trainer updated successfully',
    data: {
      trainer_id: trainer.trainer_id,
      mongoId: trainer._id,
      name: trainer.name,
      username: trainer.username,
      email: trainer.email,
      phone: trainer.phone,
      specialization: trainer.specialization,
      is_available: trainer.is_available,
      updatedAt: trainer.updatedAt
    }
  });
}));

// GET /api/trainers/:id/feedback
router.get('/:id/feedback', asyncHandler(async (req, res) => {
  const trainer_id = req.params.id;
  const feedback = await Feedback.find({ trainer_id }).populate('class_id', 'class_name').sort({ date_submitted: -1 });
  res.json({ success: true, count: feedback.length, data: feedback });
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
  res.json({ success: true, data: { averageRating, totalFeedback } });
}));

// GET /api/trainers/:id - MUST BE LAST
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  let trainer;

  if (mongoose.Types.ObjectId.isValid(id)) {
    trainer = await Trainer.findOne({ $or: [{ trainer_id: id }, { _id: id }] });
  } else {
    trainer = await Trainer.findOne({ trainer_id: id });
  }

  if (!trainer) {
    return res.status(404).json({ success: false, error: 'Trainer not found' });
  }

  res.json({
    success: true,
    data: {
      trainer_id: trainer.trainer_id,
      mongoId: trainer._id,
      name: trainer.name,
      username: trainer.username,
      email: trainer.email,
      phone: trainer.phone,
      specialization: trainer.specialization,
      is_available: trainer.is_available,
      assigned_classes: trainer.assigned_classes,
      weeklyAvailability: trainer.weeklyAvailability,
      leaveRecords: trainer.leaveRecords,
      feedback_received: trainer.feedback_received,
      createdAt: trainer.createdAt,
      updatedAt: trainer.updatedAt
    }
  });
}));

function to24h(s) {
    if (!s) return '';
    let [hm, ampm] = s.split(/ /);
    if (!ampm) return hm; // Already 24h
    let [h, m] = hm.split(':');
    h = +h;
    if (ampm.toUpperCase().startsWith('P') && h < 12) h += 12;
    if (ampm.toUpperCase().startsWith('A') && h == 12) h = 0;
    return `${(h + '').padStart(2, '0')}:${m}`;
}

module.exports = router;
