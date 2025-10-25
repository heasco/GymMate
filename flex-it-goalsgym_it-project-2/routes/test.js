const transporter = require('../utils/nodemailer'); // Make sure this at the top already

async function sendTrainerWelcomeEmail(params) {
  console.log('Attempting to send email:', params.email);
  try {
    await transporter.sendMail({
      from: `"GOALS Gym" <${process.env.EMAIL_USER}>`,
      to: params.email,
      subject: 'Test Mail',
      text: 'This is a test email.'
    });
    console.log('MAIL SENT SUCCESSFULLY');
  } catch(err) {
    console.error('ERROR SENDING MAIL:', err);
  }
}
