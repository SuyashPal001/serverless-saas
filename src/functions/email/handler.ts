import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { sendWelcomeEmail } from "@/shared/services/sesHelper";
import { success, error } from "@/shared/utils/responseBuilder";
import { Logger } from "@/shared/utils/logger";

interface WelcomeEmailRequest {
  email: string;
  name: string;
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const correlationId = event.headers?.["x-correlation-id"];
  const logger = new Logger(
    context.awsRequestId,
    context.functionName,
    process.env.ENV || "local",
    correlationId as string
  );

  try {
    if (!event.body) {
      logger.error("Request body is required");
      return error("Request body is required", 400);
    }

    const body: WelcomeEmailRequest = JSON.parse(event.body);

    if (!body.email || !body.name) {
      logger.error("Email and name are required", {
        email: body.email,
        name: body.name,
      });
      return error("Email and name are required fields", 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      logger.error("Invalid email format", { email: body.email });
      return error("Invalid email format", 400);
    }

    logger.info("Sending welcome email", { email: body.email });

    await sendWelcomeEmail(body.email, body.name);

    logger.info("Welcome email sent successfully", { email: body.email });

    return success({
      message: "Welcome email sent successfully",
      email: body.email,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error("Error in welcome email handler", err);
    return error(`Failed to process request: ${err.message}`, 500);
  }
};
