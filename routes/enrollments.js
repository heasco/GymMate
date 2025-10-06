const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const Enrollment = require('../models/Enrollment');
const Class = require('../models/Classes');
const Member = require('../models/Member');
const router = express.Router();

// POST /api/enrollments - Create new session enrollment
router.post('/', asyncHandler(async (req, res) => {
  const { class_id, member_id, session_date, session_time, member_name } = req.body;

  // Validate required fields
  if (!class_id || !member_id || !session_date || !session_time) {
    return res.status(400).json({
      success: false,
      error: 'Class ID, Member ID, session date, and session time are required'
    });
  }

  // Check if class exists
  const classData = await Class.findOne({ class_id });
  if (!classData) {
    return res.status(404).json({
      success: false,
      error: 'Class not found'
    });
  }

  // Check if member exists and has combative membership
  const member = await Member.findOne({ 
    $or: [{ memberId: member_id }, { _id: member_id }]
  });
  
  if (!member) {
    return res.status(404).json({
      success: false,
      error: 'Member not found'
    });
  }

  // Check if member has active combative membership with remaining sessions
  const activeCombativeMembership = member.memberships.find(m => 
    m.type === 'combative' && 
    m.status === 'active' && 
    new Date(m.endDate) > new Date() &&
    m.remainingSessions > 0
  );

  if (!activeCombativeMembership) {
    return res.status(400).json({
      success: false,
      error: 'Member has no remaining sessions or active combative membership'
    });
  }

  // Check if member is already enrolled for this specific date and time
  const existingEnrollment = await Enrollment.findOne({
    class_id,
    member_id: member.memberId,
    session_date: new Date(session_date),
    status: 'active'
  });

  if (existingEnrollment) {
    return res.status(409).json({
      success: false,
      error: 'Member is already enrolled for this session date'
    });
  }

  // Create enrollment
  const enrollment = new Enrollment({
    class_id,
    member_id: member.memberId,
    member_name: member_name || member.name,
    session_date: new Date(session_date),
    session_time,
    attendance_status: 'scheduled'
  });

  const savedEnrollment = await enrollment.save();

  // Deduct one session from member's combative membership
  activeCombativeMembership.remainingSessions -= 1;
  await member.save();

  // Update class enrollment count (optional - for general tracking)
  await Class.findOneAndUpdate(
    { class_id },
    {
      $inc: { current_enrollment: 1 },
      $push: {
        enrolled_members: {
          member_id: member.memberId,
          member_name: member.name,
          enrollment_date: new Date(),
          status: 'active'
        }
      }
    }
  );

  res.status(201).json({
    success: true,
    message: 'Member enrolled for session successfully',
    data: savedEnrollment,
    remaining_sessions: activeCombativeMembership.remainingSessions
  });
}));

// GET /api/enrollments/member/:memberId - Get member's upcoming sessions
router.get('/member/:memberId', asyncHandler(async (req, res) => {
  const memberId = req.params.memberId;
  
  const enrollments = await Enrollment.find({
    member_id: memberId,
    status: 'active',
    session_date: { $gte: new Date() }
  })
  .populate('class_id', 'class_name schedule trainer_name')
  .sort({ session_date: 1 });

  res.json({
    success: true,
    count: enrollments.length,
    data: enrollments
  });
}));

// GET /api/enrollments/class/:classId - Get class session enrollments
router.get('/class/:classId', asyncHandler(async (req, res) => {
  const classId = req.params.classId;
  
  const enrollments = await Enrollment.find({
    class_id: classId,
    status: 'active'
  })
  .sort({ session_date: 1, member_name: 1 });

  res.json({
    success: true,
    count: enrollments.length,
    data: enrollments
  });
}));

// PUT /api/enrollments/:id/cancel - Cancel enrollment and refund session
router.put('/:id/cancel', asyncHandler(async (req, res) => {
  const enrollmentId = req.params.id;
  
  const enrollment = await Enrollment.findOne({ 
    $or: [{ enrollment_id: enrollmentId }, { _id: enrollmentId }]
  });

  if (!enrollment) {
    return res.status(404).json({
      success: false,
      error: 'Enrollment not found'
    });
  }

  if (enrollment.status === 'cancelled') {
    return res.status(400).json({
      success: false,
      error: 'Enrollment is already cancelled'
    });
  }

  // Update enrollment status
  enrollment.status = 'cancelled';
  enrollment.cancelled_at = new Date();
  enrollment.attendance_status = 'cancelled';
  await enrollment.save();

  // Refund session to member if not attended
  if (enrollment.attendance_status !== 'attended') {
    const member = await Member.findOne({ memberId: enrollment.member_id });
    if (member) {
      const activeCombativeMembership = member.memberships.find(m => 
        m.type === 'combative' && m.status === 'active'
      );
      if (activeCombativeMembership) {
        activeCombativeMembership.remainingSessions += 1;
        await member.save();
      }
    }
    enrollment.refund_processed = true;
    await enrollment.save();
  }

  // Update class enrollment count
  await Class.findOneAndUpdate(
    { class_id: enrollment.class_id },
    {
      $inc: { current_enrollment: -1 },
      $set: { 'enrolled_members.$[elem].status': 'cancelled' }
    },
    { arrayFilters: [{ 'elem.member_id': enrollment.member_id }] }
  );

  res.json({
    success: true,
    message: 'Enrollment cancelled successfully',
    data: enrollment,
    refund_processed: enrollment.refund_processed
  });
}));

// PUT /api/enrollments/:id/attendance - Mark attendance
router.put('/:id/attendance', asyncHandler(async (req, res) => {
  const enrollmentId = req.params.id;
  const { attendance_status } = req.body;

  if (!['attended', 'missed'].includes(attendance_status)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid attendance status. Must be "attended" or "missed"'
    });
  }

  const enrollment = await Enrollment.findOne({ 
    $or: [{ enrollment_id: enrollmentId }, { _id: enrollmentId }]
  });

  if (!enrollment) {
    return res.status(404).json({
      success: false,
      error: 'Enrollment not found'
    });
  }

  enrollment.attendance_status = attendance_status;
  if (attendance_status === 'attended') {
    enrollment.attended_at = new Date();
    enrollment.status = 'completed';
  } else if (attendance_status === 'missed') {
    // Optionally refund missed sessions
    const member = await Member.findOne({ memberId: enrollment.member_id });
    if (member) {
      const activeCombativeMembership = member.memberships.find(m => 
        m.type === 'combative' && m.status === 'active'
      );
      if (activeCombativeMembership) {
        activeCombativeMembership.remainingSessions += 1;
        await member.save();
      }
    }
    enrollment.refund_processed = true;
  }

  await enrollment.save();

  res.json({
    success: true,
    message: `Attendance marked as ${attendance_status}`,
    data: enrollment
  });
}));

module.exports = router;
