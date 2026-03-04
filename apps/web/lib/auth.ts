import { Amplify } from 'aws-amplify';
import {
    signIn as amplifySignIn,
    signOut as amplifySignOut,
    getCurrentUser as amplifyGetCurrentUser,
    fetchAuthSession,
    type SignInInput
} from 'aws-amplify/auth';

/**
 * Custom strictly-in-memory storage for Amplify
 * This prevents Amplify from storing any tokens in localStorage, sessionStorage, or cookies.
 */
class InMemoryStorage {
    private store: Map<string, string> = new Map();

    async setItem(key: string, value: string): Promise<void> {
        this.store.set(key, value);
    }

    async getItem(key: string): Promise<string | null> {
        return this.store.get(key) || null;
    }

    async removeItem(key: string): Promise<void> {
        this.store.delete(key);
    }

    async clear(): Promise<void> {
        this.store.clear();
    }
}

const memoryStorage = new InMemoryStorage();

export function configureAmplify() {
    Amplify.configure({
        Auth: {
            Cognito: {
                userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '',
                userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '',
            }
        }
    }, {
        Auth: {
            // @ts-ignore - explicitly overriding internal storage
            storage: memoryStorage
        }
    });
}

export async function signIn(input: SignInInput) {
    const result = await amplifySignIn(input);
    return result;
}

export async function signOut() {
    await amplifySignOut();
    // We must also call our own API endpoint to clear the httpOnly cookie
    if (typeof window !== 'undefined') {
        try {
            await fetch('/api/auth/session', { method: 'DELETE' });
        } catch (e) {
            console.error('Failed to clear cookie session', e);
        }
        window.location.href = '/auth/login';
    }
}

export async function getCurrentUser() {
    try {
        return await amplifyGetCurrentUser();
    } catch (err) {
        return null;
    }
}

export async function getAccessToken() {
    try {
        const session = await fetchAuthSession();
        return session.tokens?.accessToken?.toString() || null;
    } catch (err) {
        return null;
    }
}

export async function refreshSession() {
    try {
        const session = await fetchAuthSession({ forceRefresh: true });
        return session;
    } catch (err) {
        return null;
    }
}
