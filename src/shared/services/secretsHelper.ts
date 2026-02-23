import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'ap-south-1'
});

const cachedSecrets: Map<string, any> = new Map();

export const getSecret = async (secretId: string): Promise<any> => {
  if (cachedSecrets.has(secretId)) {
    console.log(`Using cached secret: ${secretId}`);
    return cachedSecrets.get(secretId);
  }

  console.log(`Retrieving secret from Secrets Manager: ${secretId}`);
  
  try {
    const command = new GetSecretValueCommand({ SecretId: secretId });
    const response = await client.send(command);

    let secret: any;
    
    if (response.SecretString) {
      try {
        secret = JSON.parse(response.SecretString);
      } catch {
        secret = response.SecretString;
      }
    } else if (response.SecretBinary) {
      const buff = Buffer.from(response.SecretBinary);
      secret = buff.toString('ascii');
    } else {
      throw new Error('Secret value not found');
    }

    cachedSecrets.set(secretId, secret);
    console.log(`Secret cached: ${secretId}`);
    
    return secret;
  } catch (error: any) {
    console.error(`Error retrieving secret ${secretId}:`, error);
    throw new Error(`Failed to retrieve secret: ${error.message}`);
  }
};

export const clearCache = (): void => {
  cachedSecrets.clear();
};
