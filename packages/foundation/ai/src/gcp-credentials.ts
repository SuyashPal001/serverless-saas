import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export interface GcpCredentials {
    project_id: string;
    [key: string]: unknown;
}

// Module-level cache — survives warm Lambda invocations, fetches once per cold start.
let cached: GcpCredentials | null = null;

/**
 * Return GCP service account credentials.
 *
 * Resolution order:
 *  1. Module cache (warm invocation — free)
 *  2. GCP_SA_KEY env var — inline JSON, used for local dev
 *  3. GCP_SA_KEY_SECRET_ARN — reads from Secrets Manager at runtime (Lambda prod path)
 */
export async function getGcpCredentials(): Promise<GcpCredentials> {
    if (cached) return cached;

    const inline = process.env.GCP_SA_KEY;
    if (inline) {
        cached = JSON.parse(inline) as GcpCredentials;
        return cached;
    }

    const arn = process.env.GCP_SA_KEY_SECRET_ARN;
    if (!arn) throw new Error('Neither GCP_SA_KEY nor GCP_SA_KEY_SECRET_ARN is set');

    const client = new SecretsManagerClient({
        region: process.env.AWS_REGION ?? 'ap-south-1',
    });
    const resp = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    if (!resp.SecretString) throw new Error('GCP SA key secret is empty');

    cached = JSON.parse(resp.SecretString) as GcpCredentials;
    return cached;
}
