import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import axios from 'axios';
import { CoachOTP, StudioOTP } from '@fit-earn-meditate/backend-shared-models';

import 'dotenv/config';

const region = process.env.FITNEARN_AWS_REGION || 'ap-south-1';
const accessKeyId = process.env.FITNEARN_AWS_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.FITNEARN_AWS_SECRET_ACCESS_KEY || '';
// const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN || '';

export function generateRandomNumber(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min) + min);
}

export function generateTokenExpiry(): Date {
    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + 10);
    return expiry;
}

export async function generateAndSendOTP(mobileNumber: string) {
    console.log('Sending notification via SNS (v3):');
    try {
        // const coach = await ProfileModel.findOne({ coachId });
        const otp = generateRandomNumber(1000, 9999);
        const params: any = {
            Message: `Your OTP code is: ${otp}`, // Generate a 6-digit OTP code
            PhoneNumber: mobileNumber, // Recipient's phone number from environment variables
            MessageAttributes: {
                'AWS.SNS.SMS.SenderID': {
                    DataType: 'String',
                    StringValue: 'String',
                },
            },
        };

        const sns = new SNSClient({
            region: region, // AWS region from environment variables
            credentials: {
                accessKeyId: accessKeyId, // AWS access key from environment variables
                secretAccessKey: secretAccessKey, // AWS secret key from environment variables
            },
        });

        // Create a new PublishCommand with the specified parameters
        const command = new PublishCommand(params);
        // Send the SMS message using the SNS client and the created command
        const message = await sns.send(command);
        const expiry = generateTokenExpiry();
        const coachOTP = await CoachOTP.findOneAndUpdate(
            { mobileNumber },
            {
                otp: otp,
                expiresAt: expiry,
            },
            {
                new: true,
                upsert: true,
            },
        );

        await coachOTP.save();
        console.log('Message published to SNS successfully: ', message);
        return coachOTP;
    } catch (error) {
        console.error('Failed to publish to SNS:', error);
        throw error;
    }
}
export async function generateAndSendOTPForStudio(mobileNumber: string) {
    console.log('Sending notification via FASTSMS (v3) on : ', mobileNumber);
    try {
        // const coach = await ProfileModel.findOne({ coachId });
        const otp = generateRandomNumber(1000, 9999);

        const expiry = generateTokenExpiry();
        const studioOTP = await StudioOTP.findOneAndUpdate(
            { mobileNumber },
            {
                otp: otp,
                expiresAt: expiry,
            },
            {
                new: true,
                upsert: true,
            },
        );

        await studioOTP.save();
        return studioOTP;
    } catch (error) {
        console.error('Failed to publish to SNS:', error);
        throw error;
    }
}

export async function sendSMS(number: string, otp: number, action = 'register') {
    try {
        // const otp = generateRandomNumber(1000, 9999);
        const language = 'english';
        const message = action === 'register' ? 164709 : 164708;
        const apiKey = process.env.FAST2SMS_API_KEY;
        const response = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
            params: {
                authorization: apiKey,
                message: message,
                language: language,
                route: 'dlt',
                numbers: number,
                sender_id: 'FITEAN',
                variables_values: otp,
                flash: 0,
            },
            headers: {
                'cache-control': 'no-cache',
            },
        });
        console.log('SMS sent successfully: ', response.data);

        return response.data; // Return the raw response data (JSON parsed by Axios)
    } catch (error: any) {
        // Handle errors from axios.  Provides more useful error details.
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('Fast2SMS Error (Status):', error.response.status);
            console.error('Fast2SMS Error (Data):', error.response.data); // Useful for debugging API issues
            throw new Error(
                `Fast2SMS API error: Status ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`,
            ); //Include data in error message
        } else if (error.request) {
            // The request was made but no response was received
            console.error('Fast2SMS Error (No Response):', error.request);
            throw new Error('Fast2SMS API error: No response received from server.');
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Fast2SMS Error (Request Setup):', error.message);
            throw new Error(`Fast2SMS API error: Request setup failed - ${error.message}`);
        }
    }
}

export async function sendSMSToStudio(number: string, otp: number, action = 'register', hashCode?: string) {
    try {
        // const otp = generateRandomNumber(1000, 9999);
        const language = 'english';

        const message = action === 'register' ? 198599 : 198588;

        // Prepare variables_values based on template
        const variables_values = hashCode ? `${otp}|${hashCode}` : `${otp}`;

        const apiKey = process.env.FAST2SMS_API_KEY;
        const response = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
            params: {
                authorization: apiKey,
                message: message,
                language: language,
                route: 'dlt',
                numbers: number,
                sender_id: 'FITEAN',
                variables_values: variables_values,
                flash: 0,
            },
            headers: {
                'cache-control': 'no-cache',
            },
        });
        console.log('OTP sent successfully: ', otp);
        return response.data; // Return the raw response data (JSON parsed by Axios)
    } catch (error: any) {
        // Handle errors from axios.  Provides more useful error details.
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('Fast2SMS Error (Status):', error.response.status);
            console.error('Fast2SMS Error (Data):', error.response.data); // Useful for debugging API issues
            throw new Error(
                `Fast2SMS API error: Status ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`,
            ); //Include data in error message
        } else if (error.request) {
            // The request was made but no response was received
            console.error('Fast2SMS Error (No Response):', error.request);
            throw new Error('Fast2SMS API error: No response received from server.');
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Fast2SMS Error (Request Setup):', error.message);
            throw new Error(`Fast2SMS API error: Request setup failed - ${error.message}`);
        }
    }
}
