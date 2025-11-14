const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const Enrollment = require('../models/Enrollment');
const Class = require('../models/Classes');
const Member = require('../models/Member');

const router = express.Router();

async function findMemberByFlexibleId(id) {
  if (!id) return null;

  if (mongoose.Types.ObjectId.isValid(id)) {
    const byObjectId = await Member.findOne({ _id: new mongoose.Types.ObjectId(id) });
    if (byObjectId) return byObjectId;
  }

  const byMemberId = await Member.findOne({ memberId: id });
  if (byMemberId) return byMemberId;

  const byUsername = await Member.findOne({ username: id.toLowerCase() });
  if (byUsername) return byUsername;

  return null;
}

// POST /api/enrollments - Create new session enrollment
router.post('/', asyncHandler(async (req, res) => {
  const { class_id, member_id, session_date, session_time, member_name } = req.body;


  if (!class_id || !member_id || !session_date || !session_time) {
    return res.status(400).json({
      success: false,
      error: 'Class ID, Member ID, session date, and session time are required'
    });
  }

  // Check class
  const classData = await Class.findOne({ class_id });
  if (!classData) {
    return res.status(404).json({ success: false, error: 'Class not found' });
  }
  if (classData.current_enrollment >= classData.capacity) {
    return res.status(400).json({ success: false, error: 'Class is full' });
  }

  // Resolve member by either memberId or _id, normalize to canonical member.memberId
  const member = await findMemberByFlexibleId(member_id);
  if (!member) {
    return res.status(404).json({ success: false, error: 'Member not found' });
  }
  const canonicalMemberId = member.memberId;

  // Verify active combative membership with remaining sessions
  const activeCombativeMembership = member.memberships?.find(m =>
    m.type === 'combative' &&
    m.status === 'active' &&
    new Date(m.endDate) > new Date() &&
    (typeof m.remainingSessions === 'number' ? m.remainingSessions : 0) > 0
  );

  if (!activeCombativeMembership) {
    return res.status(400).json({
      success: false,
      error: 'Member has no remaining sessions or active combative membership'
    });
  }

  // Prevent duplicate booking for same class+member+date
  const existingEnrollment = await Enrollment.findOne({
    class_id,
    member_id: canonicalMemberId,
    session_date: new Date(session_date),
    status: 'active'
  });
  if (existingEnrollment) {
    return res.status(409).json({
      success: false,
      error: 'Member is already enrolled for this session date'
    });
  }

  // Create enrollment document
  const enrollment = new Enrollment({
    class_id,
    member_id: canonicalMemberId,            // store canonical string ID
    member_name: member_name || member.name, // redundancy for reporting
    session_date: new Date(session_date),
    session_time,
    attendance_status: 'scheduled',
    status: 'active'
  });

  const savedEnrollment = await enrollment.save();

  // Deduct one session
  activeCombativeMembership.remainingSessions = (activeCombativeMembership.remainingSessions || 0) - 1;
  await member.save();

  // Update class counters and embedded list (optional, for dashboard views)
  await Class.findOneAndUpdate(
    { class_id },
    {
      $inc: { current_enrollment: 1 },
      $push: {
        enrolled_members: {
          member_id: canonicalMemberId,
          member_name: member.name || '',
          enrollment_date: new Date(),
          status: 'active'
        }
      }
    }
  );

  return res.status(201).json({
    success: true,
    message: 'Member enrolled for session successfully',
    data: savedEnrollment,
    remaining_sessions: activeCombativeMembership.remainingSessions
  });
}));

// ============================================
// NEW ROUTE: Get attended classes for feedback
// ============================================
router.get('/member/:memberId/attended', asyncHandler(async (req, res) => {
  const memberId = req.params.memberId;

  // Get only ATTENDED sessions (past classes)
  const enrollments = await Enrollment.find({
    member_id: memberId,
    attendance_status: 'attended',  // Only attended
    status: 'completed'             // Completed sessions
  })
  .sort({ attended_at: -1 });  // Most recently attended first

  return res.json({
    success: true,
    count: enrollments.length,
    data: enrollments
  });
}));

// GET /api/enrollments/member/:memberId - Member's upcoming sessions (KEEP ORIGINAL)
router.get('/member/:memberId', asyncHandler(async (req, res) => {
  const memberId = req.params.memberId;

  const enrollments = await Enrollment.find({
    member_id: memberId,
    status: 'active',
    session_date: { $gte: new Date() }
  })
  .sort({ session_date: 1 });

  return res.json({
    success: true,
    count: enrollments.length,
    data: enrollments
  });
}));

// GET /api/enrollments/class/:classId - Class session enrollments
router.get('/class/:classId', asyncHandler(async (req, res) => {
  const classId = req.params.classId;

  const enrollments = await Enrollment.find({
    class_id: classId,
    status: 'active'
  }).sort({ session_date: 1, member_name: 1 });

  return res.json({
    success: true,
    count: enrollments.length,
    data: enrollments
  });
}));

// GET /api/enrollments/member/:memberId/enhanced - Enhanced member enrollments with class names
router.get('/member/:memberId/enhanced', asyncHandler(async (req, res) => {
    const memberId = req.params.memberId;

    try {
        console.log('Getting enhanced enrollments for member:', memberId);

        // Get enrollments for the member
        const enrollments = await Enrollment.find({
            member_id: memberId,
            status: 'active'
        }).lean();

        console.log('Raw enrollments found:', enrollments.length);

        // Get all classes once to avoid multiple queries
        const allClasses = await Class.find({}).lean();
        const classMap = {};
        allClasses.forEach(cls => {
            classMap[cls.class_id] = {
                class_name: cls.class_name,
                trainer_name: cls.trainer_name,
                schedule: cls.schedule
            };
        });

        console.log('Classes map created with', Object.keys(classMap).length, 'classes');

        // Match enrollments with classes
        const enhancedEnrollments = await Promise.all(
            enrollments.map(async (enrollment) => {
                const classInfo = classMap[enrollment.class_id];
                
                return {
                    ...enrollment,
                    class_name: classInfo ? classInfo.class_name : 'Class Not Found',
                    class_trainer: classInfo ? classInfo.trainer_name : 'Unknown Trainer',
                    class_schedule: classInfo ? classInfo.schedule : 'Unknown Schedule'
                };
            })
        );

        console.log('Enhanced enrollments processed:', enhancedEnrollments.length);

        return res.json({
            success: true,
            count: enhancedEnrollments.length,
            data: enhancedEnrollments
        });

    } catch (error) {
        console.error('Error in enhanced enrollments route:', error);
        return res.status(500).json({
            success: false,
            message: 'Error loading enhanced enrollments',
            error: error.message
        });
    }
}));

// PUT /api/enrollments/:id/cancel - Cancel enrollment and refund session
router.put('/:id/cancel', asyncHandler(async (req, res) => {
  const enrollmentId = req.params.id;

  // Resolve enrollment by enrollment_id (string) or _id (ObjectId)
  let enrollment = null;
  if (mongoose.Types.ObjectId.isValid(enrollmentId)) {
    enrollment = await Enrollment.findOne({ _id: new mongoose.Types.ObjectId(enrollmentId) });
  }
  if (!enrollment) {
    enrollment = await Enrollment.findOne({ enrollment_id: enrollmentId });
  }

  if (!enrollment) {
    return res.status(404).json({ success: false, error: 'Enrollment not found' });
  }

  if (enrollment.status === 'cancelled') {
    return res.status(400).json({ success: false, error: 'Enrollment is already cancelled' });
  }

  // Update enrollment state
  enrollment.status = 'cancelled';
  enrollment.cancelled_at = new Date();
  enrollment.attendance_status = 'cancelled';
  await enrollment.save();

  // Refund if not attended
  if (enrollment.attendance_status !== 'attended') {
    const member = await Member.findOne({ memberId: enrollment.member_id });
    if (member) {
      const activeCombativeMembership = member.memberships?.find(m => m.type === 'combative' && m.status === 'active');
      if (activeCombativeMembership) {
        activeCombativeMembership.remainingSessions = (activeCombativeMembership.remainingSessions || 0) + 1;
        await member.save();
      }
    }
    enrollment.refund_processed = true;
    await enrollment.save();
  }

  // Decrement class counter and mark embedded entry as cancelled
  await Class.findOneAndUpdate(
    { class_id: enrollment.class_id },
    {
      $inc: { current_enrollment: -1 },
      $set: { 'enrolled_members.$[elem].status': 'cancelled' }
    },
    { arrayFilters: [{ 'elem.member_id': enrollment.member_id }] }
  );

  return res.json({
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

  // Resolve enrollment by either _id or enrollment_id
  let enrollment = null;
  if (mongoose.Types.ObjectId.isValid(enrollmentId)) {
    enrollment = await Enrollment.findOne({ _id: new mongoose.Types.ObjectId(enrollmentId) });
  }
  if (!enrollment) {
    enrollment = await Enrollment.findOne({ enrollment_id: enrollmentId });
  }

  if (!enrollment) {
    return res.status(404).json({ success: false, error: 'Enrollment not found' });
  }

  enrollment.attendance_status = attendance_status;
  if (attendance_status === 'attended') {
    enrollment.attended_at = new Date();
    enrollment.status = 'completed';
  } else if (attendance_status === 'missed') {
    // Refund missed session
    const member = await Member.findOne({ memberId: enrollment.member_id });
    if (member) {
      const activeCombativeMembership = member.memberships?.find(m => m.type === 'combative' && m.status === 'active');
      if (activeCombativeMembership) {
        activeCombativeMembership.remainingSessions = (activeCombativeMembership.remainingSessions || 0) + 1;
        await member.save();
      }
    }
    enrollment.refund_processed = true;
  }

  await enrollment.save();

  return res.json({
    success: true,
    message: `Attendance marked as ${attendance_status}`,
    data: enrollment
  });
}));

module.exports = router;
