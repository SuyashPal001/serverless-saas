import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import * as crypto from "crypto";

// Import from Lambda Layers
import { getCredentials } from "@/shared/services/cognitoHelper";
import { connect } from "@/shared/services/mongoHelper";
import { sendWelcomeEmail } from "@/shared/services/sesHelper";
import { success, error } from "@/shared/utils/responseBuilder";
import { Logger } from "@/shared/utils/logger";

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || "ap-south-1",
});

interface RegisterRequest {
  email: string;
  password: string;
  givenName: string;
  familyName: string;
}

interface UserDocument {
  cognitoId: string;
  email: string;
  givenName: string;
  familyName: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Calculate SECRET_HASH for Cognito
 */
function calculateSecretHash(
  username: string,
  clientId: string,
  clientSecret: string
): string {
  return crypto
    .createHmac("SHA256", clientSecret)
    .update(username + clientId)
    .digest("base64");
}

/**
 * User Registration Lambda Handler
 * Best practices:
 * - Uses native MongoDB driver (not Mongoose)
 * - Connection reuse via caching
 * - Proper error handling
 * - Async non-blocking email
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const correlationId = event.headers?.["x-correlation-id"];
  const logger = new Logger(
    context.awsRequestId,
    context.functionName,
    process.env.ENV || "dev",
    correlationId as string
  );

  try {
    // Parse and validate request
    if (!event.body) {
      logger.error("Request body is required");
      return error("Request body is required", 400);
    }

    const { email, password, givenName, familyName }: RegisterRequest =
      JSON.parse(event.body);

    // Validate required fields
    if (!email || !password || !givenName || !familyName) {
      logger.error("Missing required fields", { email, givenName, familyName });
      return error(
        "Email, password, givenName, and familyName are required",
        400
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      logger.error("Invalid email format", { email });
      return error("Invalid email format", 400);
    }

    // Validate password strength
    if (password.length < 8) {
      logger.error("Password too short");
      return error("Password must be at least 8 characters long", 400);
    }

    logger.info(`Starting registration for user: ${email}`);

    // Get Cognito credentials
    const credentials = await getCredentials();

    // Generate a unique username (since email is used as alias)
    const username = `user_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;

    // Calculate SECRET_HASH (required when client has a secret)
    const secretHash = calculateSecretHash(
      username,
      credentials.clientId,
      credentials.clientSecret
    );

    // Register user in Cognito
    const signUpCommand = new SignUpCommand({
      ClientId: credentials.clientId,
      Username: username,
      Password: password,
      SecretHash: secretHash,
      UserAttributes: [
        {
          Name: "email",
          Value: email,
        },
        {
          Name: "given_name",
          Value: givenName,
        },
        {
          Name: "family_name",
          Value: familyName,
        },
      ],
    });

    const signUpResponse = await cognitoClient.send(signUpCommand);
    logger.info("User registered in Cognito", {
      userSub: signUpResponse.UserSub,
    });

    // Connect to MongoDB (uses connection caching)
    const db = await connect();
    const usersCollection = db.collection<UserDocument>("users");

    // Create user document
    const userDocument: UserDocument = {
      cognitoId: signUpResponse.UserSub!,
      email,
      givenName,
      familyName,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to MongoDB with duplicate key handling
    try {
      await usersCollection.insertOne(userDocument);
      logger.info("User saved to MongoDB");
    } catch (dbError: any) {
      // Handle duplicate key error
      if (dbError.code === 11000) {
        logger.error("User already exists in database", { email });
        return error("User already exists", 409);
      }
      throw dbError;
    }

    // Send welcome email (non-blocking - don't fail registration if email fails)
    sendWelcomeEmail(email, givenName).catch((emailError) => {
      logger.error("Failed to send welcome email (non-critical):", emailError);
    });

    return success(
      {
        message:
          "Registration successful. Please check your email to verify your account.",
        userId: signUpResponse.UserSub,
        email,
      },
      201
    );
  } catch (err: any) {
    logger.error("Registration error:", err);

    // Handle specific Cognito errors
    if (err.name === "UsernameExistsException") {
      return error("User with this email already exists", 409);
    }

    if (err.name === "InvalidPasswordException") {
      return error("Password does not meet requirements", 400);
    }

    if (err.name === "InvalidParameterException") {
      return error("Invalid registration parameters", 400);
    }

    return error(`Registration failed: ${err.message || "Unknown error"}`, 500);
  }
};
