import { Request } from 'express';
import fs from 'fs';
import ejs from 'ejs';
import path from 'path';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import logger from '../utils/loggerNew'// Import the logger
import { Shootmail, type ShootMailConfig } from "shootmail";

// Initialize the SES client
const sesClient = new SESClient({ region: 'ap-south-1' });

/**
 * This function sends an email with a verification link to the provided email address
 * @param email The email address to send the email to
 * @param token The token to use for email verification
 * @param req The request object from Express, used to get the host name
 * @returns Promise<void>
 */
export const sendVerificationEmail = async (email: string, token: string, req: Request): Promise<void> => {
    const source = process.env.SES_SOURCE_EMAIL;
    // Define __dirname manually
    const currentDir = process.cwd();
    // Determine the stage based on NODE_ENV
    const isLocal = process.env.NODE_ENV === 'development';
    const stage = isLocal ? '' : 'dev'; // No stage for local development
    const protocol = isLocal ? 'http' : 'https';
    // Determine the views directory based on environment
    const viewsDir = isLocal ? path.join(currentDir, 'src', 'views') : path.join(currentDir, 'dist', 'views');
    // Correctly calculate the path to the EJS template file
    const templatePath = path.join(viewsDir, 'verifyEmail.ejs');
    // Ensure the file exists
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Email template file not found at ${templatePath}`);
    }
    const template = fs.readFileSync(templatePath, 'utf-8');
    // const verificationLink = `${protocol}://${req.headers.host}/${stage ? stage + '/' : ''}api/myapp/web/users/newsletter-verify?token=${token}&email=${email}`;
    const isLocalhost = req.headers?.host?.includes('localhost');
    const baseUrl = isLocalhost
        ? 'http://localhost:9000'
        : (stage === 'dev'
            ? 'https://iwojpgsdff.execute-api.ap-south-1.amazonaws.com/dev'
            : 'https://thapo6b978.execute-api.ap-south-1.amazonaws.com/prod');

    const verificationLink = `${baseUrl}/api/myapp/web/users/newsletter-verify?token=${token}&email=${email}`;

    // Render the email content with the verification link and other variables
    const emailContent = ejs.render(template, {
        verificationUrl: verificationLink,
        logo: process.env.LOGO,
        playStore: process.env.GOOGLE_PLAYSTORE,
        appleStore: process.env.APPLE_STORE,
    });

    // Prepare the email parameters
    const params = {
        Destination: {
            ToAddresses: [email],
        },
        Message: {
            Body: {
                Html: {
                    Data: emailContent,
                },
            },
            Subject: {
                Charset: 'UTF-8',
                Data: 'Email Verification',
            },
        },
        Source: source, // Replace with your SES verified email
    };

    try {
        // Send the email using AWS SES
        await sesClient.send(new SendEmailCommand(params));
    } catch (error) {
        logger.error('AWS SES Error', {
            message: 'Error sending email',
            errorCode: 500,
            errorString: 'Internal server Error',
            type: 'sendVerificationEmailError',
        });
    }
};

/**
 * This function sends a confirmation email to the provided email address.
 * It uses Amazon SES to send the email.
 *
 * @param {string} email - The email address to send the email to.
 * @return {Promise<void>} A promise that resolves when the email is sent successfully,
 *                         or rejects with an error if there is an issue sending the email.
 */
export const sendConfirmationEmail = async (email: string): Promise<void> => {
    const source = process.env.SES_SOURCE_EMAIL
    // Use process.cwd() to get the current working directory
    const currentDir = process.cwd();
    // Read the template file for the verification email
    const templatePath = path.join(currentDir, 'dist', 'views', 'confirmSubscription.ejs');
    const template = fs.readFileSync(templatePath, 'utf-8');

    // Render the email content with the logo, play store, and apple store variables
    const emailContent = ejs.render(template, {
        logo: process.env.LOGO, // Logo URL
        playStore: process.env.GOOGLE_PLAYSTORE, // Google Play Store URL
        appleStore: process.env.APPLE_STORE, // Apple Store URL
        unsubscribeUrl: `${process.env.REDIECT_URL}unsubscribe-email`,
    });

    // Prepare the email parameters
    const params = {
        Destination: {
            ToAddresses: [email], // The email address to send the email to
        },
        Message: {
            Body: {
                Html: {
                    Data: emailContent, // The HTML content of the email
                },
            },
            Subject: {
                Charset: 'UTF-8', // The character set of the email subject
                Data: 'Email Verification', // The subject of the email
            },
        },
        Source: source, // The sender's email address (replace with your SES verified email)
    };

    try {
        // Send the email using AWS SES
        await sesClient.send(new SendEmailCommand(params));
    } catch (error: any) {
        // Log any errors that occur
        logger.error('AWS SES Error', {
            message: 'Error sending email confirmation mail template',
            errorCode: 500,
            errorString: 'Internal server Error' + error.message,
            type: 'sendConfirmationEmailError',
        });
    }
};

/**
 * This function sends a newsletter email to multiple recipients.
 * It uses Amazon SES to send the email.
 *
 * @param {string[]} email - An array of email addresses to send the email to.
 * @return {Promise<void>} A promise that resolves when the email is sent successfully,
 *                         or rejects with an error if there is an issue sending the email.
 */
export const broadcastMail = async (email: string[]): Promise<void> => {
    const source = process.env.SES_SOURCE_EMAIL
    // Prepare the email parameters
    const broadcastParams = {
        Source: source, // The sender's email address (replace with your SES verified email)
        Destination: {
            ToAddresses: email,
        },
        Message: {
            Body: {
                Html: {
                    Charset: 'UTF-8',
                    Data: '<h1>FitnEarn Newsletter</h1><p>Thank you for being a valued subscriber!</p>',
                },
                Text: {
                    Charset: 'UTF-8',
                    Data: 'Thank you for being a valued subscriber!',
                },
            },
            Subject: {
                Charset: 'UTF-8',
                Data: 'FitnEarn Newsletter',
            },
        },
    };

    try {
        // Send the email using AWS SES
        await sesClient.send(new SendEmailCommand(broadcastParams));
    } catch (error) {
        // Log any errors that occur
        logger.error('AWS SES Error', {
            message: 'Error sending broadcast email',
            errorCode: 500,
            errorString: error,
            type: 'broadcastMailError',
        });
    }
};

export const bookingConfirmation = async (email: string, emailData: any, emailType?: string): Promise<void> => {
    const source = process.env.SES_SOURCE_EMAIL
    // Use process.cwd() to get the current working directory
    const currentDir = process.cwd();
    if (emailType === 'verified') {
        // Read the template file for the verification email
        const templatePath = path.join(currentDir, 'dist', 'views', 'addUserToBooking.ejs');
        const template = fs.readFileSync(templatePath, 'utf-8');
        // Render the email content with the logo, play store, and apple store variables

        const emailContent = ejs.render(template, {
            logo: process.env.LOGO, // Logo URL
            playStore: process.env.GOOGLE_PLAYSTORE, // Google Play Store URL
            appleStore: process.env.APPLE_STORE, // Apple Store URL       
            image: emailData.userProfileImage,
            name: emailData.userName,
            connectionUrl: 'https://dev.example.com/live_session/upcoming_session',
        });
        // Prepare the email parameters
        const params = {
            Destination: {
                ToAddresses: [email], // The email address to send the email to
            },
            Message: {
                Body: {
                    Html: {
                        Data: emailContent, // The HTML content of the email
                    },
                },
                Subject: {
                    Charset: 'UTF-8', // The character set of the email subject
                    Data: 'New Booking Confirmation', // The subject of the email
                },
            },
            Source: source, // The sender's email address (replace with your SES verified email)
        };
        try {
            // Send the email using AWS SES
            await sesClient.send(new SendEmailCommand(params));
        } catch (error) {
            // Log any errors that occur
            logger.error('AWS SES Error', {
                message: 'Error sending email confirmation mail template',
                errorCode: 500,
                errorString: 'Internal server Error',
                type: 'sendConfirmationEmailError',
            });
        }
    } else if (emailType === 'invited') {
        // Read the template file for the verification email
        const templatePath = path.join(currentDir, 'dist', 'views', 'inviteUserToBooking.ejs');
        const template = fs.readFileSync(templatePath, 'utf-8');
        // Render the email content with the logo, play store, and apple store variables
        const emailContent = ejs.render(template, {
            logo: process.env.LOGO, // Logo URL
            playStore: process.env.GOOGLE_PLAYSTORE, // Google Play Store URL
            appleStore: process.env.APPLE_STORE, // Apple Store URL
            profilePic: emailData.userProfileImage,
            friendName: emailData.userName,
            invitationUrl: emailData.inviteUrl,
        });
        // Prepare the email parameters
        const params = {
            Destination: {
                ToAddresses: [email], // The email address to send the email to
            },
            Message: {
                Body: {
                    Html: {
                        Data: emailContent, // The HTML content of the email
                    },
                },
                Subject: {
                    Charset: 'UTF-8', // The character set of the email subject
                    Data: 'You Have Been Invited', // The subject of the email
                },
            },
            Source: source, // The sender's email address (replace with your SES verified email)
        };
        try {
            // Send the email using AWS SES
            await sesClient.send(new SendEmailCommand(params));
        } catch (error) {
            // Log any errors that occur
            logger.error('AWS SES Error', {
                message: 'Error sending email confirmation mail template',
                errorCode: 500,
                errorString: 'Internal server Error',
                type: 'sendConfirmationEmailError',
            });
        }
    } else if (emailType === 'invoice') {
        // Read the template file for the verification email
        //  const templatePath = path.join(currentDir, 'src', 'views', 'bookingPaymentInvoice.ejs');
        const templatePath = path.join(currentDir, 'dist', 'views', 'invoice.ejs');
        const template = fs.readFileSync(templatePath, 'utf-8');
        // Render the email content with the logo, play store, and apple store variables
        const emailContent = ejs.render(template, {
            logo: process.env.LOGO, // Logo URL
            playStore: process.env.GOOGLE_PLAYSTORE, // Google Play Store URL
            appleStore: process.env.APPLE_STORE, // Apple Store URL
            total: emailData.total,
            subTotal: emailData.subTotal,
            discount: emailData.discount,
            planPrice: emailData.planPrice,
            planPeriod: emailData.planPeriod,
            userPlan: emailData.userPlan,
            customerName: emailData.userName,
            bookingId: emailData.bookingId,
            orderLink: 'dev.example.com',
            websiteLink: 'dev.example.com',
            orderNumber: 'orderNumber'
            //  profilePic: emailData.userProfileImage,
            //  friendName: emailData.userName,
            //  invitationUrl: 'dev.example.com',
        });
        // Prepare the email parameters
        const params = {
            Destination: {
                ToAddresses: [email], // The email address to send the email to
            },
            Message: {
                Body: {
                    Html: {
                        Data: emailContent, // The HTML content of the email
                    },
                },
                Subject: {
                    Charset: 'UTF-8', // The character set of the email subject
                    Data: 'Booking Invoice', // The subject of the email
                },
            },
            Source: source, // The sender's email address (replace with your SES verified email)
        };
        try {
            // Send the email using AWS SES
            await sesClient.send(new SendEmailCommand(params));
        } catch (error) {
            // Log any errors that occur
            logger.error('AWS SES Error', {
                message: 'Error sending email confirmation mail template',
                errorCode: 500,
                errorString: 'Internal server Error',
                type: 'sendConfirmationEmailError',
            });
        }
    } else {
        console.log('\n\t Wrong EmailType');
        throw Error('Wrong emailType');
    }
}

/**
 * Send newsletter email directly via SES
 * @param options Email options
 */
export const sendNewsletterEmail = async (options: {
    toAddresses: string[];
    subject: string;
    htmlBody: string;
    sourceEmail?: string; // Optional custom source email
}): Promise<void> => {
    // Use custom sourceEmail if provided, otherwise fall back to env variable
    const source = options.sourceEmail || process.env.SES_SOURCE_EMAIL;

    if (!source) {
        throw new Error('Source email not provided and SES_SOURCE_EMAIL environment variable not set');
    }

    const params = {
        Source: source,
        Destination: {
            ToAddresses: options.toAddresses,
        },
        Message: {
            Body: {
                Html: {
                    Charset: 'UTF-8',
                    Data: options.htmlBody,
                },
            },
            Subject: {
                Charset: 'UTF-8',
                Data: options.subject,
            },
        },
    };
    console.log("params", params)
    try {
        await sesClient.send(new SendEmailCommand(params));
        console.log('Newsletter email sent successfully to:', options.toAddresses, 'from:', source);
    } catch (error) {
        console.error('Failed to send newsletter email:', error);
        throw error;
    }
};

//-------------------------------------ShootMail----------------------------------------------

export const shootMail = async (templateId: string, emailData: any) => {
    // console.log('\n\t inside shootmail: ', templateId, '\n\n', emailData);
    //configuring shootmail
    const shootmailConfig: ShootMailConfig = {
        shootmailApiKey: process.env.SHOOTMAIL_API_KEY,
        providers: [{
            provider: "aws-ses",
            apiKey: {
                accessKeyId: process.env.SHOOTMAIL_AWS_ACCESS_KEY_ID as string,
                secretAccessKey: process.env.SHOOTMAIL_AWS_SECRET_ACCESS_KEY as string,
                region: process.env.FITNEARN_AWS_REGION as string
            }
        }],
    };
    const shootmail = new Shootmail(shootmailConfig);
    try {
        const emails = emailData.email.map((email: string) => ({ email }))
        // console.log('\n\t attempting send')
        const response = await shootmail.shoot({
            preHeader: emailData.preHeader,
            templateId: templateId,
            from: {
                name: "FitnEarn",
                email: process.env.SES_SOURCE_EMAIL as string,  //email registered on email service provider like SES
            },
            provider: "aws-ses",
            to: emails,
            subject: emailData.subject,
            data: emailData.variableData,
            // data: {
            //     user: emailData.user,
            //     verificationLink: emailData.verificationLink
            // },
        });
        console.log("\n\n\t--------------\n\tresponse: ", response);
        return response;
    } catch (error: any) {
        logger.error('Error sending mail', {
            message: 'Error sending mail',
            errorCode: 500,
            errorString: error.message,
            type: 'shootMailError',
        });
        console.log("\n\n\t-----------\n\terror: ", error.message);
        return error.message;
    }
}
