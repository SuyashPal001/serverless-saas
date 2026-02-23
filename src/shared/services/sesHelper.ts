import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'ap-south-1' });

export const sendWelcomeEmail = async (
  toEmail: string,
  userName: string
): Promise<void> => {
  const fromEmail = process.env.FROM_EMAIL || 'noreply@example.com';

  const params = {
    Source: fromEmail,
    Destination: {
      ToAddresses: [toEmail]
    },
    Message: {
      Subject: {
        Data: 'Welcome to Our Platform!',
        Charset: 'UTF-8'
      },
      Body: {
        Html: {
          Data: `
            <html>
              <body>
                <h1>Welcome ${userName}!</h1>
                <p>Thank you for registering with us.</p>
                <p>Please verify your email address to get started.</p>
              </body>
            </html>
          `,
          Charset: 'UTF-8'
        },
        Text: {
          Data: `Welcome ${userName}! Thank you for registering with us. Please verify your email address to get started.`,
          Charset: 'UTF-8'
        }
      }
    }
  };

  try {
    const command = new SendEmailCommand(params);
    await sesClient.send(command);
    console.log(`Welcome email sent to: ${toEmail}`);
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
};
