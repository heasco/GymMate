const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');

const Class = require('../models/Classes');
const Enrollment = require('../models/Enrollment');
const Feedback = require('../models/Feedback');
const Trainer = require('../models/Trainer');
const Member = require('../models/Member');
const transporter = require('../utils/nodemailer');

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

  // EMAIL NOTIFICATION TO TRAINER
  let emailNotice = "";
  try {
    const trainer = await Trainer.findOne({ trainer_id: savedClass.trainer_id });
    if (trainer && trainer.email) {
      await transporter.sendMail({
        from: `"GOALS Gym" <${process.env.EMAIL_USER}>`,
        to: trainer.email,
        subject: 'New Class Assigned',
        html: `<h2>Hello ${trainer.name},</h2>
          <p>You have been assigned to the following class at GOALS Gym:</p>
          <ul>
            <li><b>Class Name:</b> ${savedClass.class_name}</li>
            <li><b>Schedule:</b> ${savedClass.schedule}</li>
          </ul>
          <p>Please log in to your trainer account for details.</p>`
      });
      emailNotice = "Email notification sent to trainer.";
      console.log('Email notification sent to trainer:', trainer.email);
    } else {
      emailNotice = "Trainer not found or no email set, email not sent.";
      console.log('Trainer not found or no email set!');
    }
  } catch (err) {
    emailNotice = "Error sending email notification to trainer.";
    console.error('Error sending trainer notification:', err);
  }

  res.status(201).json({
    success:true, message:'Class created successfully',
    emailNotice,
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
    query = { $or: [{ class_id: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  }

  // Get the original class BEFORE updating
  const previousClass = await Class.findOne(query);
  if (!previousClass) return res.status(404).json({ success: false, error: 'Class not found' });
  const prevTrainerId = previousClass.trainer_id;
  const prevSchedule = previousClass.schedule;

  // Grab updated fields from body
  const { class_name, description, schedule, trainer_id, capacity } = req.body;

  // Update the class document
  const updatedClass = await Class.findOneAndUpdate(query, { class_name, description, schedule, trainer_id, capacity }, { new: true, runValidators: true });
  if (!updatedClass) return res.status(404).json({ success: false, error: 'Class not found' });

  let emailNotice = [];
  let newTrainer = null; // FIX: declare outside block

  // Notify new trainer if changed/assigned
  if (trainer_id && trainer_id !== prevTrainerId) {
    newTrainer = await Trainer.findOne({ trainer_id });
    if (newTrainer && newTrainer.email) {
      try {
        await transporter.sendMail({
          from: `"GOALS Gym" <${process.env.EMAIL_USER}>`,
          to: newTrainer.email,
          subject: 'New Class Assignment',
          html: `<h2>Hello ${newTrainer.name},</h2>
            <p>You have been <b>assigned</b> to a class:</p>
            <ul>
              <li><b>Class Name:</b> ${updatedClass.class_name}</li>
              <li><b>Schedule:</b> ${updatedClass.schedule}</li>
            </ul>
            <p>Please log in to your trainer account for more details.</p>`
        });
        emailNotice.push("Email notification sent to new trainer.");
      } catch (err) {
        emailNotice.push("Error sending email to new trainer.");
        console.error("Error sending new trainer notification:", err);
      }
    }
  }

  // Notify previous trainer if replaced
  if (trainer_id && trainer_id !== prevTrainerId && prevTrainerId) {
    const prevTrainer = await Trainer.findOne({ trainer_id: prevTrainerId });
    if (prevTrainer && prevTrainer.email) {
      try {
        await transporter.sendMail({
          from: `"GOALS Gym" <${process.env.EMAIL_USER}>`,
          to: prevTrainer.email,
          subject: 'Class Assignment Update',
          html: `<h2>Hello ${prevTrainer.name},</h2>
            <p>Your class assignment has been <b>changed</b>:</p>
            <ul>
              <li><b>Class Name:</b> ${updatedClass.class_name}</li>
              <li><b>Previous Schedule:</b> ${prevSchedule}</li>
              <li><b>New Trainer:</b> ${newTrainer ? newTrainer.name : "N/A"}</li>
            </ul>
            <p>Please check your account for details.</p>`
        });
        emailNotice.push("Email notification sent to previous trainer.");
      } catch (err) {
        emailNotice.push("Error sending email to previous trainer.");
        console.error("Error sending previous trainer notification:", err);
      }
    }
  }

  // Notify trainer if schedule is changed (but trainer remains the same)
  if (schedule && schedule !== prevSchedule && trainer_id === prevTrainerId) {
    const trainer = await Trainer.findOne({ trainer_id });
    if (trainer && trainer.email) {
      try {
        await transporter.sendMail({
          from: `"GOALS Gym" <${process.env.EMAIL_USER}>`,
          to: trainer.email,
          subject: 'Class Schedule Updated',
          html: `<h2>Hello ${trainer.name},</h2>
            <p>The schedule for your assigned class has been <b>updated</b>:</p>
            <ul>
              <li><b>Class Name:</b> ${updatedClass.class_name}</li>
              <li><b>Old Schedule:</b> ${prevSchedule}</li>
              <li><b>New Schedule:</b> ${updatedClass.schedule}</li>
            </ul>
            <p>Please check your trainer account for details.</p>`
        });
        emailNotice.push("Email notification sent for schedule update.");
      } catch (err) {
        emailNotice.push("Error sending email for schedule update.");
        console.error("Error sending schedule update notification:", err);
      }
    }
  }

  res.json({ success: true, message: 'Class updated successfully.', emailNotice, data: updatedClass });
}));



// DELETE /api/classes/:id
router.delete('/:id', asyncHandler(async (req, res) => {
    const id = req.params.id;
    let query = { class_id: id };
    if (mongoose.Types.ObjectId.isValid(id)) {
        query = { $or: [{ class_id: id }, { _id: new mongoose.Types.ObjectId(id) }] };
    }

    const deletedClass = await Class.findOne(query);
    if (!deletedClass) {
        return res.status(404).json({ success: false, error: 'Class not found' });
    }

    const classId = deletedClass.class_id;

    // Find all enrollments for this class
    const enrollments = await Enrollment.find({ class_id: classId });

    // Refund sessions to members
    for (const enrollment of enrollments) {
        const member = await Member.findOne({ member_id: enrollment.member_id });
        if (member) {
            // Logic to determine how many sessions to refund
            // This is a placeholder. You might need a more sophisticated way to track used sessions.
            const sessionsToRefund = 1; // Assuming 1 session per enrollment
            member.classSessions += sessionsToRefund;
            await member.save();
        }
    }

    // Delete all enrollments for the class
    await Enrollment.deleteMany({ class_id: classId });

    // Delete the class itself
    await Class.findByIdAndDelete(deletedClass._id);

    res.json({ success: true, message: 'Class deleted successfully and member sessions refunded.' });
}));

// GET /returns only classes for a given trainer
router.get('/', asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.trainerid) {
        filter.trainerid = req.query.trainerid;
    }
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

// GET /api/classes/member/:memberId/enrolled
router.get('/member/:memberId/enrolled', asyncHandler(async (req, res) => {
    const memberId = req.params.memberId;
    const classes = await Class.find({ 
        'enrolled_members': { 
            $elemMatch: { member_id: memberId, status: 'active' }
        }
    });
    res.json({ success: true, count: classes.length, data: classes });
}));

// GET /api/classes/:id/schedule - Get class schedule details for enrollment
router.get('/:id/schedule', asyncHandler(async (req, res) => {
  const classId = req.params.id;
  const classData = await Class.findOne({ class_id: classId });
  if (!classData) {
    return res.status(404).json({
      success: false,
      error: 'Class not found'
    });
  }
  const schedule = classData.schedule;
  const timeSlots = parseScheduleToTimeSlots(schedule);
  res.json({
    success: true,
    data: {
      class_id: classData.class_id,
      class_name: classData.class_name,
      schedule: classData.schedule,
      time_slots: timeSlots
    }
  });
}));

// Helper: parse schedule to times
function parseScheduleToTimeSlots(schedule) {
  const timeMatch = schedule.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/);
  if (timeMatch) {
    return [`${timeMatch[1]} - ${timeMatch[2]}`];
  }
  return [
    '9:00 AM - 10:00 AM',
    '10:00 AM - 11:00 AM',
    '11:00 AM - 12:00 PM',
    '2:00 PM - 3:00 PM',
    '3:00 PM - 4:00 PM',
    '4:00 PM - 5:00 PM'
  ];
}

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
