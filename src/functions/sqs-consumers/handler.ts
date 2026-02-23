import { SystemLogger } from "@/shared/utils/systemLogger";

const logger = new SystemLogger("SQSConsumer");

export const handler = async (event: any): Promise<void> => {
  if (!event.Records) {
    logger.warn("No Records in SQS event", { event });
    return;
  }

  for (const record of event.Records) {
    try {
      // Parse message body
      const body =
        typeof record.body === "string" ? JSON.parse(record.body) : record.body;

      // Extract correlation ID (from message or generate)
      const correlationId = body.correlationId || record.messageId;

      logger.info("Processing SQS message", {
        correlationId,
        queue: record.eventSourceARN,
        body,
      });

      // 🛠️ YOUR BUSINESS LOGIC HERE
      // e.g., send email, update DB, call API
      // If this throws, message will NOT be deleted → retry → DLQ

      // Simulate success
      logger.info("Message processed successfully", { correlationId });

      // ✅ On success, Lambda **automatically deletes** the message
      // (because we don't throw and return normally)
    } catch (error) {
      logger.error("Failed to process SQS message", {
        error,
        messageId: record.messageId,
      });
      // ❌ Throw to prevent deletion → message reappears after VisibilityTimeout
      throw error;
    }
  }
};
