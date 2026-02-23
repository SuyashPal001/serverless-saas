import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";

const ssmClient = new SSMClient({
  region: process.env.AWS_REGION || "ap-south-1",
});

interface CognitoCredentials {
  clientId: string;
  clientSecret: string;
  userPoolId: string;
}

let cachedCredentials: CognitoCredentials | null = null;

export const getCredentials = async (): Promise<CognitoCredentials> => {
  // Return cached credentials if available
  if (cachedCredentials) {
    console.log("Using cached Cognito credentials");
    return cachedCredentials;
  }

  console.log("Retrieving Cognito credentials from Parameter Store...");

  const clientIdPath = process.env.COGNITO_CLIENT_ID_PATH;
  const clientSecretPath = process.env.COGNITO_CLIENT_SECRET_PATH;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;

  if (!clientIdPath || !clientSecretPath || !userPoolId) {
    throw new Error("Cognito configuration environment variables not set");
  }

  const command = new GetParametersCommand({
    Names: [clientIdPath, clientSecretPath],
    WithDecryption: true,
  });

  const response = await ssmClient.send(command);

  if (!response.Parameters || response.Parameters.length < 2) {
    throw new Error(
      "Failed to retrieve Cognito credentials from Parameter Store"
    );
  }

  const clientId = response.Parameters.find(
    (p) => p.Name === clientIdPath
  )?.Value;
  const clientSecret = response.Parameters.find(
    (p) => p.Name === clientSecretPath
  )?.Value;

  if (!clientId || !clientSecret) {
    throw new Error("Cognito credentials incomplete");
  }

  cachedCredentials = {
    clientId,
    clientSecret,
    userPoolId,
  };

  console.log("Cognito credentials retrieved and cached successfully");
  return cachedCredentials;
};

export const clearCache = (): void => {
  cachedCredentials = null;
};

import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  DescribeUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { Logger } from "../utils/logger";

interface TestAuthResult {
  success: boolean;
  error?: string;
}

export const testAuth = async (
  logger: Logger,
  clientId: string
): Promise<TestAuthResult> => {
  try {
    const region = process.env.AWS_REGION || "ap-south-1";
    const userPoolId = process.env.COGNITO_USER_POOL_ID;

    if (!userPoolId) {
      throw new Error("COGNITO_USER_POOL_ID not set");
    }

    const cognito = new CognitoIdentityProviderClient({ region });

    logger.info("Validating Cognito User Pool...");
    await cognito.send(
      new DescribeUserPoolCommand({
        UserPoolId: userPoolId,
      })
    );

    logger.info("Validating Cognito App Client...");
    await cognito.send(
      new DescribeUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientId: clientId,
      })
    );

    logger.info("Cognito connectivity verified successfully");
    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Cognito error";

    logger.error("Cognito testAuth failed", { error: message });

    return {
      success: false,
      error: message,
    };
  }
};
