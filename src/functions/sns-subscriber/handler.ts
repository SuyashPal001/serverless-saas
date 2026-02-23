// src/functions/sns-subscriber/handler.ts

import { SystemLogger } from "@/shared/utils/systemLogger";

const logger = new SystemLogger("SNSSubscriber");

export const snsEventHandler = async (event: any): Promise<void> => {
  if (!event.Records) {
    logger.warn("No Records in SNS event", { event });

    return;
  }

  for (const record of event.Records) {
    try {
      const message =
        typeof record.Sns.Message === "string"
          ? JSON.parse(record.Sns.Message)
          : record.Sns.Message;

      logger.info("Processed SNS message", {
        correlationId: message.correlationId,

        env: message.env,

        data: message.data,

        timestamp: message.timestamp,
      });
    } catch (error) {
      logger.error("Failed to process SNS message", { error, record });

      throw error;
    }
  }
};
