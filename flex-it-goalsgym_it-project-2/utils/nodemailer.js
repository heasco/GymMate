// utils/nodemailer.js

const nodemailer = require('nodemailer');

// Use environment variables or paste your credentials here for testing only
const transporter = nodemailer.createTransport({
  service: 'gmail', 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS 
  }
});

// Optional: Verify connection on startup
transporter.verify(function(error, success) {
  if (error) {
    console.error('Nodemailer connection error:', error);
  } else {
    console.log('Nodemailer is ready to send emails');
  }
});

module.exports = transporter;
