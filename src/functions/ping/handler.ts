// import serverlessExpress from "@vendia/serverless-express";
// import { createApp } from "./app";

// export const handler = serverlessExpress({ app: createApp() });

// import { getCredentials, testAuth } from "shared/services/cognitoHelper";
// import { Logger, success } from "shared/utils";
// import { serviceUnavailable } from "shared/utils/responseBuilder";
// import {
//   APIGatewayProxyEvent,
//   APIGatewayProxyResult,
//   Context,
// } from "aws-lambda";
// import { connect, ping } from "shared/services/mongoHelper";

// export const handler = async (
//   event: APIGatewayProxyEvent,
//   context: Context
// ): Promise<APIGatewayProxyResult> => {
//   const correlationId = event.headers?.["x-correlation-id"];
//   const logger = new Logger(
//     context.awsRequestId,
//     context.functionName,
//     process.env.ENV || "local",
//     correlationId as string
//   );

//   const startTime = Date.now();

//   // MongoDB Health Check
//   let dbConnected = false;
//   let dbError: string | undefined;

//   try {
//     logger.info("Checking MongoDB connection...");
//     await connect();
//     const pingResult = await ping();

//     dbConnected = pingResult.success;
//     dbError = pingResult.error;
//   } catch (error) {
//     dbError = error instanceof Error ? error.message : "Unknown MongoDB error";
//     logger.error("MongoDB health check failed:", { error: dbError });
//   }

//   // Cognito Health Check
//   let cognitoConnected = false;
//   let cognitoError: string | undefined;

//   try {
//     logger.info("Checking Cognito connectivity...");
//     const credentials = await getCredentials();
//     const authResult = await testAuth(logger, credentials.clientId);

//     cognitoConnected = authResult.success;
//     cognitoError = authResult.error;
//   } catch (error) {
//     cognitoError =
//       error instanceof Error ? error.message : "Unknown Cognito error";
//     logger.error("Cognito health check failed:", { error: cognitoError });
//   }

//   const responseTime = Date.now() - startTime;
//   const isHealthy = dbConnected && cognitoConnected;

//   const responseData = {
//     status: isHealthy ? "healthy" : "degraded",
//     message: isHealthy ? "pong v2.0" : "Service partially available",
//     version: "2.0.0",
//     env: process.env.ENV || "unknown",
//     services: {
//       mongodb: { connected: dbConnected, ...(dbError && { error: dbError }) },
//       cognito: {
//         connected: cognitoConnected,
//         ...(cognitoError && { error: cognitoError }),
//       },
//     },
//     responseTimeMs: responseTime,
//     timestamp: new Date().toISOString(),
//     requestId: context.awsRequestId,
//     correlationId: logger.getCorrelationId(),
//   };

//   if (isHealthy) {
//     return success(responseData);
//   } else {
//     return serviceUnavailable();
//   }
// };
