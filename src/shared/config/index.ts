import { SystemLogger } from '../utils/systemLogger';
import {
  SecretsManagerClient,
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";
import {
  SSMClient,
  GetParametersCommand
} from "@aws-sdk/client-ssm";

const logger = new SystemLogger('Config');

// TypeScript interfaces for strong typing
interface AppConfig {
  env: string;
  logLevel: string;
  region: string;
  senderEmail: string;
  featureFlags: Record<string, boolean>;
}

interface SsmConfig {
  cognitoClientId: string;
  cognitoClientSecret: string;
  // Add other SSM parameters as needed
}

interface SecretsConfig {
  mongodbUri: string;
  // Add other secrets as needed
}

interface CachedValues {
  ssm: Record<string, string>;
  secrets: Record<string, any>;
}

// Global cache for performance (reused across invocations)
const cachedValues: CachedValues = {
  ssm: {},
  secrets: {}
};

class ConfigLoader {
  private static instance: ConfigLoader;
  private secretsManagerClient: SecretsManagerClient;
  private ssmClient: SSMClient;

  private constructor() {
    this.secretsManagerClient = new SecretsManagerClient({
      region: process.env.AWS_REGION
    });
    this.ssmClient = new SSMClient({
      region: process.env.AWS_REGION
    });
  }

  static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  // Load static configuration from environment variables
  loadStaticConfig(): AppConfig {
    const env = process.env.ENV || 'dev';
    const logLevel = process.env.LOG_LEVEL || 'INFO';
    const region = process.env.AWS_REGION || 'us-east-1';
    const senderEmail = process.env.SES_SENDER_EMAIL || `dev-noreply@yourdomain.com`;
    
    // Feature flags from environment or template
    const featureFlags: Record<string, boolean> = {
      'newUi': process.env.FEATURE_NEW_UI === 'true',
      'emailNotifications': process.env.FEATURE_EMAIL_NOTIFICATIONS === 'true'
    };

    return {
      env,
      logLevel,
      region,
      senderEmail,
      featureFlags
    };
  }

  // Load SSM parameters with caching
  async loadSsmConfig(): Promise<SsmConfig> {
    const env = process.env.ENV || 'dev';
    
    const ssmKeys = [
      `/myapp/${env}/auth/clientId`,
      `/myapp/${env}/auth/clientSecret`
    ];

    // Check cache first
    const missingKeys = ssmKeys.filter(key => !cachedValues.ssm[key]);
    
    if (missingKeys.length > 0) {
      logger.info("Fetching SSM parameters", { parameters: missingKeys });
      
      const command = new GetParametersCommand({
        Names: missingKeys,
        WithDecryption: true
      });
      
      const response = await this.ssmClient.send(command);
      
      response.Parameters?.forEach(param => {
        if (param.Name && param.Value) {
          cachedValues.ssm[param.Name] = param.Value;
        }
      });
    }

    return {
      cognitoClientId: cachedValues.ssm[`/myapp/${env}/auth/clientId`],
      cognitoClientSecret: cachedValues.ssm[`/myapp/${env}/auth/clientSecret`]
    };
  }

  // Load secrets with caching
  async loadSecretsConfig(): Promise<SecretsConfig> {
    const env = process.env.ENV || 'dev';
    const secretId = `myapp/${env}/mongodb`;

    // Check cache first
    if (!cachedValues.secrets[secretId]) {
      logger.info("Fetching secret", { secretId });
      
      const command = new GetSecretValueCommand({ SecretId: secretId });
      const response = await this.secretsManagerClient.send(command);
      const secret = JSON.parse(response.SecretString!);
      
      cachedValues.secrets[secretId] = secret;
    }

    return {
      mongodbUri: cachedValues.secrets[secretId].uri
    };
  }

  // Validate required environment variables
  validateRequiredEnvVars(): void {
    const requiredVars = ['ENV', 'AWS_REGION'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }

  // Main config loading function
  async loadConfig() {
    this.validateRequiredEnvVars();
    
    const staticConfig = this.loadStaticConfig();
    const ssmConfig = await this.loadSsmConfig();
    const secretsConfig = await this.loadSecretsConfig();

    return {
      ...staticConfig,
      ssm: ssmConfig,
      secrets: secretsConfig,
      // Allow direct access to raw values if needed
      raw: {
        env: process.env
      }
    };
  }
}

// Singleton instance
const configLoader = ConfigLoader.getInstance();

// Export the main function
export const loadConfig = async () => {
  return await configLoader.loadConfig();
};

// Export types for external use
export type { AppConfig, SsmConfig, SecretsConfig };
