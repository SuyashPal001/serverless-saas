import { SystemLogger } from "@/shared/utils/systemLogger";
import { publishToAppEventBus } from "@/shared/utils/eventBusPublisher";

const logger = new SystemLogger("EventBusPublisherFunction");

export const handler = async (
  event: any
): Promise<{ statusCode: number; body?: string }> => {
  const correlationId =
    event.headers?.["x-correlation-id"] || "test-" + Date.now().toString(36);

  try {
    await publishToAppEventBus(
      {
        source: "myapp.test",
        detailType: "TestEventPublished",
        data: { message: "EventBridge test message" },
        correlationId,
      },
      process.env.EVENT_BUS_NAME!
    );
    logger.info("Test event published successfully", { correlationId });
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Event published", correlationId }),
    };
  } catch (error) {
    logger.error("Failed to publish test event", { error });
    return { statusCode: 500 };
  }
};
