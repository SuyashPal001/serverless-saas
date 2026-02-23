import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SystemLogger } from '../utils/systemLogger';

const logger = new SystemLogger('SNSHelper');
const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'ap-south-1' });

export interface SNSMessagePayload {
  correlationId: string;
  env: string;
  timestamp: string;
  eventType: string;
  data: Record<string, any>;
}

/**
 * Publish structured message to app-scoped SNS topic
 */
export const publishToAppEventsTopic = async (
  topicArn: string,
  eventType: string,
  data: Record<string, any>,
  correlationId: string
): Promise<void> => {
  const message: SNSMessagePayload = {
    correlationId,
    env: process.env.ENV || 'dev',
    timestamp: new Date().toISOString(),
    eventType,
    data
  };

  const params = {
    TopicArn: topicArn,
    Message: JSON.stringify(message)
  };

  try {
    await snsClient.send(new PublishCommand(params));
    logger.info('SNS message published', { topicArn, eventType, correlationId });
  } catch (error: any) {
    logger.error('Failed to publish SNS message', { topicArn, eventType, correlationId, error: error.message });
    throw error;
  }
};
