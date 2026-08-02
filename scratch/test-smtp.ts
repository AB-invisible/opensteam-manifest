import { sendBrandedEmail } from '../app/lib/email';
import dotenv from 'dotenv';

dotenv.config();

async function testEmail() {
  const testRecipient = 'pokemongo300@gmail.com'; 
  
  console.log('Attempting to send test branded email to:', testRecipient);
  const success = await sendBrandedEmail(
    testRecipient,
    'SMTP Test - OpenSteam',
    '🚀 SMTP System Live',
    'This is a test email to verify that the SMTP configuration is working correctly. If you received this, the system is fully operational.',
    '#10b981'
  );

  if (success) {
    console.log('✅ Test email sent successfully!');
  } else {
    console.error('❌ Failed to send test email. Check console logs for errors.');
  }
}

testEmail();
