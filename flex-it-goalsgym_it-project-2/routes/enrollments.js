const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const Enrollment = require('../models/Enrollment');
const Class = require('../models/Classes'); // Assumes Class uses class_id
const Member = require('../models/Member');

const router = express.Router();

// Helper: resolve member by either custom memberId (e.g., MEM-0008) or Mongo _id
async function findMemberByFlexibleId(id) {
    if (!id) return null;

    // If it's a valid ObjectId, try that first
    if (mongoose.Types.ObjectId.isValid(id)) {
        const byObjectId = await Member.findOne({ _id: new mongoose.Types.ObjectId(id) });
        if (byObjectId) return byObjectId;
    }

    // Fallback to memberId, and then username (optional)
    const byMemberId = await Member.findOne({ memberId: id });
    if (byMemberId) return byMemberId;

    const byUsername = await Member.findOne({ username: id.toLowerCase() });
    if (byUsername) return byUsername;

    return null;
}

// POST /api/enrollments - Create new session enrollment
router.post('/', asyncHandler(async (req, res) => {
    const { classid, memberid, sessiondate, sessiontime, membername } = req.body; // Frontend no-underscore
    console.log('Enrollment POST received:', { classid, memberid, sessiondate, sessiontime, membername }); // Debug log

    // Validate required fields (no-underscore vars)
    if (!classid || !memberid || !sessiondate || !sessiontime) {
        console.log('Validation failed: Missing fields'); // Debug log
        return res.status(400).json({
            success: false,
            error: 'Class ID, Member ID, session date, and session time are required'
        });
    }

    // Check class (query by class_id in DB)
    const classData = await Class.findOne({ class_id: classid });
    if (!classData) {
        console.log(`Class not found for ID: ${classid}`); // Debug log
        return res.status(404).json({ success: false, error: 'Class not found' });
    }
    if (classData.current_enrollment >= classData.capacity) {
        console.log(`Class full: ${classid}, current: ${classData.current_enrollment}, capacity: ${classData.capacity}`); // Debug log
        return res.status(400).json({ success: false, error: 'Class is full' });
    }

    // Resolve member
    const member = await findMemberByFlexibleId(memberid);
    if (!member) {
        console.log(`Member not found for ID: ${memberid}`); // Debug log
        return res.status(404).json({ success: false, error: 'Member not found' });
    }
    const canonicalMemberId = member.memberId;

    // Verify active combative membership
    const activeCombativeMembership = member.memberships?.find(m =>
        m.type === 'combative' &&
        m.status === 'active' &&
        new Date(m.endDate) > new Date() &&
        (typeof m.remainingSessions === 'number' ? m.remainingSessions : 0) > 0
    );

    if (!activeCombativeMembership) {
        console.log(`No remaining sessions for member: ${canonicalMemberId}, memberships:`, member.memberships); // Debug log
        return res.status(400).json({
            success: false,
            error: 'Member has no remaining sessions or active combative membership'
        });
    }

    // Prevent duplicate (query with schema underscore keys)
    const existingEnrollment = await Enrollment.findOne({
        class_id: classid,
        member_id: canonicalMemberId,
        session_date: new Date(sessiondate),
        status: 'active'
    });
    if (existingEnrollment) {
        console.log(`Duplicate enrollment for ${canonicalMemberId} in ${classid} on ${sessiondate}`); // Debug log
        return res.status(409).json({
            success: false,
            error: 'Member is already enrolled for this session date'
        });
    }

    // Create enrollment document - MAP to schema underscore keys
    const enrollmentData = {
        class_id: classid,
        member_id: canonicalMemberId,
        member_name: membername || member.name,
        session_date: new Date(sessiondate),
        session_time: sessiontime,
        attendance_status: 'scheduled',
        status: 'active'
    };
    console.log('Creating enrollment with data:', enrollmentData); // Debug: Log mapped object

    const enrollment = new Enrollment(enrollmentData);
    const savedEnrollment = await enrollment.save();

    // Deduct one session
    activeCombativeMembership.remainingSessions = (activeCombativeMembership.remainingSessions || 0) - 1;
    await member.save();

    // Update class (query by class_id, push to enrolled_members with schema keys)
    await Class.findOneAndUpdate(
        { class_id: classid },
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

    console.log(`Enrollment successful for ${canonicalMemberId} in ${classid}`); // Debug log
    return res.status(201).json({
        success: true,
        message: 'Member enrolled for session successfully',
        data: savedEnrollment,
        remaining_sessions: activeCombativeMembership.remainingSessions
    });
}));

// GET /api/enrollments/member/:memberId - Member’s upcoming and finished sessions
router.get('/member/:memberId', asyncHandler(async (req, res) => {
    const memberId = req.params.memberId;
    const enrollments = await Enrollment.find({
        member_id: memberId, // Schema key
        attendance_status: { $in: ['attended', 'completed', 'scheduled'] }
    }).sort({ session_date: -1 }); // Schema key
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
        class_id: classId, // Schema key
        status: 'active'
    }).sort({ session_date: 1, member_name: 1 }); // Schema keys

    return res.json({
        success: true,
        count: enrollments.length,
        data: enrollments
    });
}));

// PUT /api/enrollments/:id/cancel - Cancel enrollment and refund session
router.put('/:id/cancel', asyncHandler(async (req, res) => {
    const enrollmentId = req.params.id;

    // Resolve by _id or enrollment_id (schema key)
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

    // Update
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

    // Update class
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

    // Resolve
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
        // Refund
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
