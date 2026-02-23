import serverlessExpress from "@vendia/serverless-express";
import app from "./app";

console.log("Ping Lambda initializing");

export const handler = serverlessExpress({ app });

// import {
//   APIGatewayProxyEvent,
//   APIGatewayProxyResult,
//   Context,
// } from "aws-lambda";
// import { success } from "@/shared/utils/responseBuilder";
// import { Logger } from "@/shared/utils/logger";

// export const handler = async (
//   event: APIGatewayProxyEvent,
//   context: Context
// ): Promise<APIGatewayProxyResult> => {
//   const correlationId = event.headers?.["x-correlation-id"];
//   const logger = new Logger(
//     context.awsRequestId,
//     context.functionName,
//     process.env.ENV || "dev",
//     correlationId as string
//   );

//   const startTime = Date.now();

//   try {
//     logger.info("Health check initiated");

//     const response = {
//       status: "healthy",
//       message: "Service is running",
//       version: "2.0.0",
//       env: process.env.ENV || "local",
//       timestamp: new Date().toISOString(),
//       responseTimeMs: Date.now() - startTime,
//     };

//     logger.info("Health check completed", { status: "healthy" });
//     return success(response);
//   } catch (error: any) {
//     logger.error("Health check failed", error);

//     return success(
//       {
//         status: "unhealthy",
//         message: "Service encountered an error",
//         error: error.message,
//         timestamp: new Date().toISOString(),
//         responseTimeMs: Date.now() - startTime,
//       },
//       503
//     );
//   }
// };
