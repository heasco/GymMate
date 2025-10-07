// utils/nodemailer.js

const nodemailer = require('nodemailer');

// Use environment variables or paste your credentials here for testing only
const transporter = nodemailer.createTransport({
  service: 'gmail', // For Gmail; change if using Outlook, Yahoo, etc.
  auth: {
    user: process.env.EMAIL_USER, // set this in your .env, e.g. 'your-email@gmail.com'
    pass: process.env.EMAIL_PASS  // set this in your .env (app password is best)
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
