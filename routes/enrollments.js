const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const Enrollment = require('../models/Enrollment');
const Class = require('../models/Classes');

const router = express.Router();

// POST /api/enrollments
router.post('/', asyncHandler(async (req, res) => {
  const { class_id, member_id } = req.body;
  if (!class_id || !member_id) return res.status(400).json({ success:false, error:'Class ID and Member ID are required' });

  const classData = await Class.findOne({ class_id });
  if (!classData) return res.status(404).json({ success:false, error:'Class not found' });

  if (classData.current_enrollment >= classData.capacity) return res.status(400).json({ success:false, error:'Class is full' });

  const existingEnrollment = await Enrollment.findOne({ class_id, member_id, status: 'active' });
  if (existingEnrollment) return res.status(409).json({ success:false, error:'Member is already enrolled in this class' });

  const enrollment = new Enrollment({ class_id, member_id });
  const savedEnrollment = await enrollment.save();

  await Class.findOneAndUpdate({ class_id }, {
    $inc: { current_enrollment: 1 },
    $push: {
      enrolled_members: {
        member_id,
        enrollment_date: new Date(),
        status: 'active'
      }
    }
  });

  res.status(201).json({ success:true, message:'Member enrolled successfully', data: savedEnrollment });
}));

// PUT /api/enrollments/:id/cancel
router.put('/:id/cancel', asyncHandler(async (req, res) => {
  const enrollment_id = req.params.id;
  const enrollment = await Enrollment.findOne({ enrollment_id });
  if (!enrollment) return res.status(404).json({ success:false, error:'Enrollment not found' });
  if (enrollment.status === 'cancelled') return res.status(400).json({ success:false, error:'Enrollment is already cancelled' });

  enrollment.status = 'cancelled';
  await enrollment.save();

  await Class.findOneAndUpdate({ class_id: enrollment.class_id }, {
    $inc: { current_enrollment: -1 },
    $set: { 'enrolled_members.$[elem].status': 'cancelled' }
  }, { arrayFilters: [{ 'elem.member_id': enrollment.member_id }] });

  res.json({ success:true, message:'Enrollment cancelled successfully', data: enrollment });
}));

module.exports = router;
