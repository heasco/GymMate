const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');

const Class = require('../models/Classes');
const Enrollment = require('../models/Enrollment');
const Feedback = require('../models/Feedback');

const router = express.Router();

// POST /api/classes
router.post('/', asyncHandler(async (req, res) => {
  const { class_name, description, schedule, trainer_id, capacity } = req.body;
  if (!class_name || !schedule || !trainer_id || !capacity) {
    const errors = {};
    if (!class_name) errors.class_name = 'Class name is required';
    if (!schedule) errors.schedule = 'Schedule is required';
    if (!trainer_id) errors.trainer_id = 'Trainer ID is required';
    if (!capacity) errors.capacity = 'Capacity is required';
    return res.status(400).json({ success:false, error:'Validation failed', details: errors });
  }

  const newClass = new Class({
    class_name: class_name.trim(),
    description: description ? description.trim() : '',
    schedule: schedule.trim(),
    trainer_id: trainer_id.trim(),
    capacity: parseInt(capacity, 10)
  });

  const savedClass = await newClass.save();
  res.status(201).json({
    success:true, message:'Class created successfully',
    data: {
      class_id: savedClass.class_id,
      mongoId: savedClass._id,
      class_name: savedClass.class_name,
      description: savedClass.description,
      schedule: savedClass.schedule,
      trainer_id: savedClass.trainer_id,
      capacity: savedClass.capacity,
      createdAt: savedClass.createdAt
    }
  });
}));

// GET /api/classes
router.get('/', asyncHandler(async (req, res) => {
  const classes = await Class.find().sort({ createdAt: -1 });
  res.json({ success:true, count: classes.length, data: classes });
}));

// GET /api/classes/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  let query = { class_id: id };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [ { class_id: id }, { _id: new mongoose.Types.ObjectId(id) } ] };
  }
  const classData = await Class.findOne(query);
  if (!classData) return res.status(404).json({ success:false, error: 'Class not found' });
  res.json({ success:true, data: classData });
}));

// PUT /api/classes/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  let query = { class_id: id };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [ { class_id: id }, { _id: new mongoose.Types.ObjectId(id) } ] };
  }
  const { class_name, description, schedule, trainer_id, capacity } = req.body;
  const updatedClass = await Class.findOneAndUpdate(query, { class_name, description, schedule, trainer_id, capacity }, { new: true, runValidators: true });
  if (!updatedClass) return res.status(404).json({ success:false, error:'Class not found' });
  res.json({ success:true, message:'Class updated successfully', data: updatedClass });
}));

// DELETE /api/classes/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  let query = { class_id: id };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [ { class_id: id }, { _id: new mongoose.Types.ObjectId(id) } ] };
  }
  const deletedClass = await Class.findOneAndDelete(query);
  if (!deletedClass) return res.status(404).json({ success:false, error:'Class not found' });
  res.json({ success:true, message: 'Class deleted successfully' });
}));

// GET /returns only classes for a given trainer
router.get('/', asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.trainerid) {
        filter.trainerid = req.query.trainerid;
    }
    // Supports both original and filtered (append your original code after this)
    const classes = await Class.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: classes.length, data: classes });
}));


// GET /api/classes/:id/enrollments
router.get('/:id/enrollments', asyncHandler(async (req, res) => {
  const class_id = req.params.id;
  const enrollments = await Enrollment.find({ class_id }).sort({ enrollment_date: -1 });
  res.json({ success:true, count: enrollments.length, data: enrollments });
}));

// GET /api/classes/:id/feedback
router.get('/:id/feedback', asyncHandler(async (req, res) => {
  const class_id = req.params.id;
  const feedback = await Feedback.find({ class_id }).sort({ date_submitted: -1 });
  res.json({ success:true, count: feedback.length, data: feedback });
}));

// GET /api/classes/:id/enrolled-members
router.get('/:id/enrolled-members', asyncHandler(async (req, res) => {
  const id = req.params.id;
  let query = { class_id: id };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [ { class_id: id }, { _id: new mongoose.Types.ObjectId(id) } ] };
  }
  const classData = await Class.findOne(query);
  if (!classData) return res.status(404).json({ success:false, error:'Class not found' });
  res.json({ success:true, count: classData.enrolled_members.filter(m => m.status === 'active').length, data: classData.enrolled_members.filter(m => m.status === 'active') });
}));

// DELETE /api/classes/:classId/enrollments/:memberId
router.delete('/:classId/enrollments/:memberId', asyncHandler(async (req, res) => {
  const { classId, memberId } = req.params;
  const classData = await Class.findOne({ class_id: classId });
  if (!classData) return res.status(404).json({ success:false, error:'Class not found' });

  const enrollmentIndex = classData.enrolled_members.findIndex(
    enrollment => enrollment.member_id.toString() === memberId.toString() && enrollment.status === 'active'
  );
  if (enrollmentIndex === -1) return res.status(404).json({ success:false, error:'Enrollment not found' });

  classData.enrolled_members[enrollmentIndex].status = 'cancelled';
  classData.current_enrollment -= 1;
  await classData.save();
  res.json({ success:true, message: 'Member removed from class successfully' });
}));

// POST /api/classes/:classId/enroll
router.post('/:classId/enroll', asyncHandler(async (req, res) => {
  const { classId } = req.params;
  const { member_id } = req.body;
  if (!member_id) return res.status(400).json({ success:false, error: 'Member ID is required' });

  const classData = await Class.findOne({ class_id: classId });
  if (!classData) return res.status(404).json({ success:false, error:'Class not found' });

  // find member in db directly (members collection)
  const member = await require('mongoose').connection.db.collection('members').findOne(
    mongoose.Types.ObjectId.isValid(member_id) ? { _id: new mongoose.Types.ObjectId(member_id) } :
    member_id.startsWith('MEM-') ? { memberId: member_id } :
    { member_id: member_id }
  );

  if (!member) return res.status(404).json({ success:false, error:'Member not found' });

  const hasCombativeMembership = member.memberships && Array.isArray(member.memberships) &&
    member.memberships.some(m => m.type === 'combative' && m.status === 'active' && new Date(m.endDate) > new Date());

  if (!hasCombativeMembership) return res.status(400).json({ success:false, error:'Cannot enroll: Member must have an active combative membership' });

  if (classData.current_enrollment >= classData.capacity) return res.status(400).json({ success:false, error:'Class is full' });

  const alreadyEnrolled = classData.enrolled_members.some(
    enrolledMember => {
      const enrolledMemberId = enrolledMember.member_id;
      const currentMemberId = member.memberId || member.member_id || member._id.toString();
      return enrolledMemberId === currentMemberId && enrolledMember.status === 'active';
    }
  );

  if (alreadyEnrolled) return res.status(409).json({ success:false, error:'Member is already enrolled in this class' });

  const actualMemberId = member.memberId || member.member_id || member._id.toString();

  classData.enrolled_members.push({
    member_id: actualMemberId,
    member_name: member.name,
    enrollment_date: new Date(),
    status: 'active'
  });

  classData.current_enrollment += 1;
  await classData.save();

  res.status(200).json({
    success:true,
    message:'Member enrolled successfully',
    data: {
      class_id: classData.class_id,
      class_name: classData.class_name,
      member_id: actualMemberId,
      member_name: member.name,
      enrollment_date: new Date()
    }
  });
}));

module.exports = router;
