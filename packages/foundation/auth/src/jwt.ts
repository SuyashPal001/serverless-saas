import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import type { JwtClaims } from '@serverless-saas/types';

let jwksClientInstance: jwksClient.JwksClient | null = null;

export interface JwtConfig {
  jwksUri: string;
  issuer: string;
  audience?: string;
}

export const initJwt = (config: JwtConfig): void => {
  jwksClientInstance = jwksClient({
    jwksUri: config.jwksUri,
    cache: true,
    cacheMaxAge: 600000, // 10 minutes
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });
};

const getSigningKey = async (kid: string): Promise<string> => {
  if (!jwksClientInstance) {
    throw new Error('JWT not initialized. Call initJwt() first.');
  }
  const key = await jwksClientInstance.getSigningKey(kid);
  return key.getPublicKey();
};

export const verifyToken = async (token: string): Promise<JwtClaims> => {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || !decoded.header.kid) {
    throw new Error('Invalid token: missing kid header');
  }

  const publicKey = await getSigningKey(decoded.header.kid);

  return new Promise((resolve, reject) => {
    jwt.verify(token, publicKey, { algorithms: ['RS256'] }, (err, payload) => {
      if (err) return reject(err);
      resolve(payload as unknown as JwtClaims);
    });
  });
};

export const decodeToken = (token: string): JwtClaims | null => {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string') return null;
  return decoded as unknown as JwtClaims;
};

export const extractBearerToken = (authHeader: string | undefined): string | null => {
  if (!authHeader) return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
};

export const isTokenExpired = (claims: JwtClaims): boolean => {
  return Date.now() >= claims.exp * 1000;
};

export const resetJwt = (): void => {
  jwksClientInstance = null;
};
