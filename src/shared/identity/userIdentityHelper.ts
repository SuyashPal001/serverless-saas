import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";
import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from "@aws-sdk/client-cognito-identity";
import axios from "axios";
import { config } from "dotenv";
import crypto from "crypto";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { AwsCredentialIdentity } from "@aws-sdk/types";

config();

export enum UploadContext {
  COACH = "coach",
  USER = "user",
  ADMIN = "admin",
  STUDIO = "studio",
}

export interface AuthenticatedRequest extends Request {
  token?: string;
  awsCredentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  };
}

// const client = jwksRsa({
//   jwksUri: process.env.AWS_JWKS_URI!,
// });

// Determine upload context from request
export function getUploadContext(req: Request): UploadContext {
  if (req.path.includes("/coach")) return UploadContext.COACH;
  if (req.path.includes("/admin")) return UploadContext.ADMIN;
  if (req.path.includes("/studio")) return UploadContext.STUDIO;
  return UploadContext.USER;
}

// Get JWKS client based on context
function getJWKSClient(context: UploadContext) {
  let jwksUri: string;

  switch (context) {
    case UploadContext.COACH:
      jwksUri = process.env.AWS_COACH_JWKS_URI as string;
      //  console.log('jwksUri coach', jwksUri);
      break;
    case UploadContext.STUDIO:
      jwksUri = process.env.AWS_STUDIO_JWKS_URI as string;
      break;
    /*     case UploadContext.USER:
      jwksUri = process.env.AWS_USER_JWKS_URI!;
      break; */
    case UploadContext.ADMIN:
    default:
      jwksUri = process.env.AWS_JWKS_URI!;
      break;
  }

  return jwksRsa({
    jwksUri,
    cache: true,
    rateLimit: true,
  });
}

// Create key resolver
function getKeyByContext(context: UploadContext) {
  const client = getJWKSClient(context);
  //console.log('client', context);
  return (header: any, callback: any) => {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err);
      const signingKey = key?.getPublicKey?.();
      if (!signingKey) return callback(new Error("Failed to get signing key"));
      callback(null, signingKey);
    });
  };
}

// ✅ Default is now ADMIN
export function verifyIdToken(
  idToken: string,
  context: UploadContext = UploadContext.ADMIN
): Promise<any> {
  return new Promise((resolve, reject) => {
    const getKey = getKeyByContext(context);
    jwt.verify(idToken, getKey, { algorithms: ["RS256"] }, (err, decoded) => {
      if (err) {
        if (err.name === "TokenExpiredError") {
          return reject(new Error("TokenExpired"));
        }
        return reject(err);
      }
      resolve(decoded);
    });
  });
}

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

export async function refreshIdToken(
  refreshToken: string,
  username: string,
  uploadContext: UploadContext
): Promise<string> {
  let clientId: string;
  let clientSecret: string | undefined;

  switch (uploadContext) {
    case UploadContext.COACH:
      clientId = process.env.COACH_AWS_COGNITO_APP_CLIENT_ID!;
      clientSecret = process.env.COACH_AWS_COGNITO_CLIENT_SECRET; // may be undefined
      break;
    case UploadContext.STUDIO:
      clientId = process.env.STUDIO_AWS_COGNITO_APP_CLIENT_ID as string;
      clientSecret = process.env.COACH_AWS_COGNITO_CLIENT_SECRET; // may be undefined
      break;
    case UploadContext.USER:
      clientId = process.env.USER_AWS_COGNITO_APP_CLIENT_ID!;
      clientSecret = process.env.USER_AWS_COGNITO_CLIENT_SECRET!;
      break;
    case UploadContext.ADMIN:
    default:
      clientId = process.env.AWS_COGNITO_APP_CLIENT_ID!;
      clientSecret = process.env.AWS_COGNITO_CLIENT_SECRET!;
      break;
  }

  try {
    const authParams: Record<string, string> = {
      REFRESH_TOKEN: refreshToken,
    };

    if (clientSecret) {
      authParams.SECRET_HASH = calculateSecretHash(
        username,
        clientId,
        clientSecret
      );
    }

    //console.log(`[${uploadContext}] Attempting to refresh token with:`, refreshToken.substring(0, 10) + '...');

    const response = await axios.post(
      `https://cognito-idp.${process.env.FITNEARN_AWS_REGION}.amazonaws.com/`,
      {
        AuthParameters: authParams,
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: clientId,
      },
      {
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
        },
      }
    );

    console.log(
      `[${uploadContext}] Refresh token response:`,
      JSON.stringify(response.data, null, 2)
    );

    const idToken = response.data?.AuthenticationResult?.IdToken;
    if (idToken) {
      return idToken;
    } else {
      throw new Error("Unexpected response structure from Cognito");
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorCode = error.response?.data?.__type;
      const errorMessage = error.response?.data?.message;

      if (
        errorCode === "NotAuthorizedException" &&
        errorMessage?.includes("Refresh Token has been revoked")
      ) {
        throw new Error("RefreshTokenRevoked");
      }
    }
    throw new Error("Failed to refresh token");
  }
}

export async function getAWSTemporaryCredentials(
  identityId: string,
  idToken: string,
  uploadContext: UploadContext
) {
  const cognitoIdentityClient = new CognitoIdentityClient({
    region: process.env.FITNEARN_AWS_REGION || "ap-south-1",
  });

  let identityPoolId;
  let userPoolId;

  switch (uploadContext) {
    case UploadContext.COACH:
      identityPoolId = process.env.COACH_AWS_COGNITO_IDENTITY_POOL_ID;
      userPoolId = process.env.COACH_AWS_COGNITO_USER_POOL_ID;
      break;
    case UploadContext.STUDIO:
      identityPoolId = process.env
        .STUDIO_AWS_COGNITO_IDENTITY_POOL_ID as string;
      userPoolId = process.env.STUDIO_AWS_COGNITO_USER_POOL_ID as string;
      break;
    default:
      identityPoolId = process.env.AWS_COGNITO_IDENTITY_POOL_ID!;
      userPoolId = process.env.AWS_COGNITO_USER_POOL_ID!;
      break;
  }
  //   uploadContext === UploadContext.COACH
  //     ? process.env.COACH_AWS_COGNITO_IDENTITY_POOL_ID
  //     : process.env.AWS_COGNITO_IDENTITY_POOL_ID;

  // const userPoolId =
  //   uploadContext === UploadContext.COACH
  //     ? process.env.COACH_AWS_COGNITO_USER_POOL_ID
  //     : process.env.AWS_COGNITO_USER_POOL_ID;

  if (!identityPoolId || !userPoolId) {
    throw new Error(
      "Required Cognito identity or user pool ID is not set in the environment variables"
    );
  }

  const getIdParams = {
    IdentityPoolId: identityPoolId,
    Logins: {
      [`cognito-idp.${process.env.FITNEARN_AWS_REGION}.amazonaws.com/${userPoolId}`]:
        idToken,
    },
  };

  try {
    const { IdentityId } = await cognitoIdentityClient.send(
      new GetIdCommand(getIdParams)
    );

    if (!IdentityId) {
      throw new Error("Failed to get Identity ID");
    }

    const getCredentialsParams = {
      IdentityId: IdentityId,
      Logins: {
        [`cognito-idp.${process.env.FITNEARN_AWS_REGION}.amazonaws.com/${userPoolId}`]:
          idToken,
      },
    };

    const credentialsData = await cognitoIdentityClient.send(
      new GetCredentialsForIdentityCommand(getCredentialsParams)
    );

    if (
      credentialsData.Credentials?.AccessKeyId &&
      credentialsData.Credentials?.SecretKey &&
      credentialsData.Credentials?.SessionToken
    ) {
      //  console.log('sessionToken', credentialsData.Credentials.SessionToken);
      return {
        accessKeyId: credentialsData.Credentials.AccessKeyId,
        secretAccessKey: credentialsData.Credentials.SecretKey,
        sessionToken: credentialsData.Credentials.SessionToken,
      };
    } else {
      throw new Error("Failed to get AWS credentials from Cognito.");
    }
  } catch (error) {
    const err = error as Error;
    console.error("Error getting AWS credentials:", err.message);
    throw err;
  }
}

export const authenticateCognitoUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.header("Authorization");
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: "Access denied, no token provided.",
    });
  }

  const idToken = authHeader.replace("Bearer ", "");
  if (!idToken) {
    return res.status(401).json({
      success: false,
      message: "Access denied, invalid token format.",
    });
  }

  const uploadContext = req.path.includes("/coach")
    ? UploadContext.COACH
    : req.path.includes("/admin")
    ? UploadContext.ADMIN
    : req.path.includes("/studio")
    ? UploadContext.STUDIO
    : UploadContext.USER;
  console.log("uploadContext", uploadContext);
  try {
    const decoded = await verifyIdToken(idToken, uploadContext);
    req.token = idToken;

    const credentials = await getAWSTemporaryCredentials(
      decoded.sub as string,
      idToken,
      uploadContext
    );

    req.awsCredentials = credentials;
    return next();
  } catch (error) {
    if (error instanceof Error && error.message === "TokenExpired") {
      try {
        const refreshToken = req.header("x-refresh-token");
        const username = req.header("x-username");

        if (!refreshToken || !username) {
          return res.status(401).json({
            success: false,
            message: "Access denied, refresh token and username required.",
          });
        }

        const newIdToken = await refreshIdToken(
          refreshToken,
          username,
          uploadContext
        );
        const decoded = await verifyIdToken(newIdToken, uploadContext);

        const credentials = await getAWSTemporaryCredentials(
          decoded.sub as string,
          newIdToken,
          uploadContext
        );

        req.token = newIdToken;
        req.awsCredentials = credentials;

        res.setHeader("token", newIdToken);

        return next();
      } catch (refreshError) {
        if (refreshError instanceof Error) {
          if (refreshError.message === "RefreshTokenRevoked") {
            return res.status(401).json({
              success: false,
              message: "Your session has expired. Please log in again.",
            });
          }
        }

        console.error("Error refreshing token:", refreshError);
        return res.status(401).json({
          success: false,
          message: "Invalid refresh token.",
        });
      }
    }

    console.error("Error verifying token:", error);
    return res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }
};

export async function assumeRole(
  roleArn: string,
  sessionName: string,
  region: string,
  baseCredentials: AwsCredentialIdentity
) {
  const client = new STSClient({
    region: region,
    credentials: baseCredentials,
  });

  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: sessionName,
  });

  try {
    const response = await client.send(command);
    return {
      accessKeyId: response.Credentials!.AccessKeyId!,
      secretAccessKey: response.Credentials!.SecretAccessKey!,
      sessionToken: response.Credentials!.SessionToken,
    };
  } catch (error) {
    console.error("Error assuming role:", error);
    throw error;
  }
}
