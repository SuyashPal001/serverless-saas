import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

export async function sendEmail({ to, subject, html }: {
    to: string;
    subject: string;
    html: string;
}): Promise<void> {
    const from = process.env.FROM_EMAIL;
    if (!from) throw new Error('FROM_EMAIL environment variable is not set');

    await ses.send(new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [to] },
        Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Html: { Data: html, Charset: 'UTF-8' } },
        },
    }));
}
