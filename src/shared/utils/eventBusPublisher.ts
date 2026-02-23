import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SystemLogger } from './systemLogger';

const logger = new SystemLogger('EventBusPublisher');
const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });

export interface AppEvent {
  source: string;
  detailType: string;
  data: Record<string, any>;  // Fixed: was "unknown"
  correlationId: string;
}

export const publishToAppEventBus = async (
  event: AppEvent,
  eventBusArn: string
): Promise<void> => {
  const entry = {
    Source: event.source,
    DetailType: event.detailType,
    Detail: JSON.stringify({
      ...event.data,
      env: process.env.ENV || 'dev',  // Fixed: removed configLoader
      correlationId: event.correlationId,
      timestamp: new Date().toISOString(),
    }),
    EventBusName: eventBusArn,
  };

  try {
    await eventBridgeClient.send(new PutEventsCommand({ Entries: [entry] }));
    logger.info('Event published to bus', {
      source: event.source,
      detailType: event.detailType,
      correlationId: event.correlationId,
    });
  } catch (error) {
    logger.error('Failed to publish event to bus', {
      source: event.source,
      correlationId: event.correlationId,
      error,
    });
    throw error;
  }
};
