const sgMail = require('@sendgrid/mail');
require('dotenv').config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendOTPEmail(email, otp, username) {
  const msg = {
    to: email,
    from: process.env.FROM_EMAIL,
    subject: 'Your OTP Verification Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; padding: 20px;">
        <h2 style="color: #667eea;">Email Verification</h2>
        <p>Hello <strong>${username}</strong>,</p>
        <p>Your OTP verification code is:</p>
        <div style="font-size: 32px; font-weight: bold; color: #764ba2; padding: 15px; background: #f0f0f0; text-align: center; border-radius: 8px;">
          ${otp}
        </div>
        <p>This code expires in <strong>${process.env.OTP_VALIDATION_TIME} seconds</strong>.</p>
        <p>If you didn't request this, please ignore this email.</p>
      </div>
    `,
    text: `Your OTP code is: ${otp}. Valid for ${process.env.OTP_VALIDATION_TIME} seconds.`
  };

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    let errorMessage = error.message;
    
    if (error.response && error.response.body && error.response.body.errors) {
      errorMessage = error.response.body.errors.map(e => e.message).join(' | ');
    }
    
    console.error('❌ SendGrid Service Error:', errorMessage);
    
    return { 
      success: false, 
      error: errorMessage
    };
  }
}

module.exports = { sendOTPEmail };