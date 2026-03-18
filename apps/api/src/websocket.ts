import type { APIGatewayProxyResult } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { jwtVerify } from 'jose';
import { getCacheClient } from '@serverless-saas/cache';

// Module-level cache for the SSM parameter
let wsTokenSecret: Uint8Array | undefined;

async function getWsTokenSecret(): Promise<Uint8Array> {
    if (wsTokenSecret) {
        return wsTokenSecret;
    }

    const secretName = '/serverless-saas/dev/ws-token-secret';
    const ssm = new SSMClient({});

    try {
        const command = new GetParameterCommand({
            Name: secretName,
            WithDecryption: true,
        });
        const output = await ssm.send(command);

        const secretValue = output.Parameter?.Value;
        if (!secretValue) {
            throw new Error('SSM parameter value for ws-token-secret is empty.');
        }

        wsTokenSecret = new TextEncoder().encode(secretValue);
        return wsTokenSecret;
    } catch (error) {
        console.error('Failed to fetch ws-token-secret from SSM:', error);
        throw new Error('Could not load WebSocket token secret.');
    }
}

export const handler = async (event: any): Promise<APIGatewayProxyResult> => {
    const routeKey = event.requestContext.routeKey;
    const connectionId = event.requestContext.connectionId;

    console.log('WebSocket event:', { routeKey, connectionId });

    try {
        switch (routeKey) {
            case '$connect':
                return await handleConnect(event, connectionId);

            case '$disconnect':
                return await handleDisconnect(connectionId);

            case '$default':
                return handleDefault(event);

            default:
                console.log('Unknown route key:', routeKey);
                return { statusCode: 400, body: 'Unknown route' };
        }
    } catch (error) {
        console.error('Unhandled error in WebSocket handler:', error);
        return { statusCode: 500, body: 'Internal server error' };
    }
};

async function handleConnect(event: any, connectionId: string): Promise<APIGatewayProxyResult> {
    try {
        const token = event.queryStringParameters?.token;
        if (!token) {
            console.log('Connect failed: Missing token');
            return { statusCode: 401, body: 'Unauthorized' };
        }

        const secret = await getWsTokenSecret();
        const { payload } = await jwtVerify(token, secret);

        const { userId, tenantId } = payload as { userId?: string, tenantId?: string };

        if (!userId || !tenantId) {
            console.log('Connect failed: Invalid token payload', payload);
            return { statusCode: 401, body: 'Unauthorized' };
        }

        const redisKey = `ws:tenant:${tenantId}:user:${userId}`;
        const cache = getCacheClient();

        await cache.sadd(redisKey, connectionId);
        await cache.expire(redisKey, 86400); // 24 hours

        console.log('Client connected and authenticated:', { userId, tenantId, connectionId });
        return { statusCode: 200, body: 'Connected.' };

    } catch (error: any) {
        // Log authentication errors without stack trace for cleaner logs
        if (error.code === 'ERR_JWS_INVALID' || error.code === 'ERR_JWT_EXPIRED') {
            console.log('Connect failed: Invalid or expired token', { error: error.message });
        } else {
            console.error('Connect handler error:', error);
        }
        return { statusCode: 401, body: 'Unauthorized' };
    }
}

async function handleDisconnect(connectionId: string): Promise<APIGatewayProxyResult> {
    try {
        const cache = getCacheClient();
        let cursor: any = 0;

        // TODO: This scan is inefficient and expensive at scale.
        // A reverse lookup table (connectionId -> userKey) would be better.
        do {
            const [nextCursor, keys] = await cache.scan(cursor, 'MATCH', 'ws:tenant:*:user:*', 'COUNT', 100);
            cursor = nextCursor;

            for (const key of keys) {
                if (typeof key !== 'string') continue;
                const isMember = await cache.sismember(key, connectionId);
                if (isMember) {
                    await cache.srem(key, connectionId);
                    console.log('Client disconnected and removed from set:', { connectionId, key });
                    // Found and removed, we can stop.
                    return { statusCode: 200, body: 'Disconnected.' };
                }
            }
        } while (cursor != 0 && cursor != '0');

        console.log('Client disconnected, but was not found in any active set:', { connectionId });

    } catch (error) {
        console.error('Disconnect handler error:', error);
    }

    // Always return 200 on disconnect to prevent noisy logs.
    return { statusCode: 200, body: 'Disconnected.' };
}

function handleDefault(event: any): APIGatewayProxyResult {
    try {
        if (event.body) {
            const body = JSON.parse(event.body);
            if (body.action === 'ping') {
                return { statusCode: 200, body: 'pong' };
            }
        }
        console.log('Received default message:', event.body);
    } catch (error) {
        console.error('Default handler error:', error);
    }

    // Ignore other messages
    return { statusCode: 200, body: 'OK' };
}
