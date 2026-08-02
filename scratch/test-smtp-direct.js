
const nodemailer = require('nodemailer');

async function testEmail() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM 

  console.log('SMTP Config Check:');
  console.log('Host:', smtpHost);
  console.log('Port:', smtpPort);
  console.log('User:', smtpUser);
  console.log('Pass:', smtpPass ? '••••••••' : 'MISSING');

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.error('❌ Missing environment variables. Please check your .env file or container environment.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(smtpPort || '587', 10),
    secure: smtpPort === '465',
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  try {
    console.log('Attempting to send test email...');
    await transporter.sendMail({
      from: smtpFrom,
      to: 'pokemongo300@gmail.com',
      subject: 'SMTP System Test',
      html: '<h1>SMTP Working</h1><p>This is a direct test using nodemailer to verify your environment variables.</p>'
    });
    console.log('✅ Test email sent successfully!');
  } catch (error) {
    console.error('❌ SMTP Error:', error.message);
  }
}

testEmail();
