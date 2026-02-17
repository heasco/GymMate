const express = require('express');
const router = express.Router();
const Member = require('../models/Member');
const Trainer = require('../models/Trainer');
const Announcement = require('../models/Announcement');
const transporter = require('../utils/nodemailer');


// @desc    Get all members and trainers for recipient list
// @route   GET /api/announcements/recipients
// @access  Private/Admin
router.get('/recipients', async (req, res) => {
  try {
    const members = await Member.find({}, 'name email');
    const trainers = await Trainer.find({}, 'name email');

    const recipients = [
      ...members.map(m => ({ name: m.name, email: m.email, role: 'member' })),
      ...trainers.map(t => ({ name: t.name, email: t.email, role: 'trainer' }))
    ];

    res.json({ success: true, data: recipients });
  } catch (error) {
    console.error('Error fetching recipients:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Get announcement history
// @route   GET /api/announcements/history
// @access  Private/Admin
router.get('/history', async (req, res) => {
  try {
    console.log('Fetching announcement history...');
    const history = await Announcement.find().sort({ createdAt: -1 });
    console.log('Found history:', history);
    res.json({ success: true, data: history });
  } catch (error) {
    console.error('Error fetching announcement history:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Send announcement email
// @route   POST /api/announcements/send
// @access  Private/Admin
router.post('/send', async (req, res) => {
  const { subject, body, recipients } = req.body;

  if (!subject || !body || !recipients || recipients.length === 0) {
    return res.status(400).json({ success: false, error: 'Please provide subject, body, and recipients' });
  }

  try {
    // Save announcement to DB
    const announcement = new Announcement({
      subject,
      body,
      recipients,
      sentBy: req.user.id,
    });
    await announcement.save();

    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipients.join(','),
      subject: subject,
      html: body,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Error sending email:', error);
        // Even if email fails, the announcement is saved.
        // In a real app, you might want a more robust retry mechanism.
      } else {
        console.log('Email sent: ' + info.response);
      }
    });

    res.status(201).json({ success: true, message: 'Announcement sent and saved.' });
  } catch (error) {
    console.error('Error sending announcement:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
