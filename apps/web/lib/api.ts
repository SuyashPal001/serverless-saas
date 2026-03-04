const BASE_URL = process.env.NEXT_PUBLIC_API_URL;

export class ApiError extends Error {
    constructor(public status: number, public data: any) {
        super(`API Error: ${status}`);
        this.name = 'ApiError';
    }
}

async function request<T>(
    path: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${BASE_URL}${path}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
        // Attach JWT from httpOnly cookie automatically
        credentials: 'include',
    });

    if (!response.ok) {
        let errorData;
        try {
            errorData = await response.json();
        } catch {
            errorData = { message: 'An unknown error occurred' };
        }
        throw new ApiError(response.status, errorData);
    }

    // Handle 204 No Content
    if (response.status === 204) {
        return {} as T;
    }

    return response.json();
}

export const api = {
    get: <T>(path: string, options?: RequestInit) =>
        request<T>(path, { ...options, method: 'GET' }),

    post: <T>(path: string, data?: any, options?: RequestInit) =>
        request<T>(path, {
            ...options,
            method: 'POST',
            body: JSON.stringify(data)
        }),

    put: <T>(path: string, data?: any, options?: RequestInit) =>
        request<T>(path, {
            ...options,
            method: 'PUT',
            body: JSON.stringify(data)
        }),

    patch: <T>(path: string, data?: any, options?: RequestInit) =>
        request<T>(path, {
            ...options,
            method: 'PATCH',
            body: JSON.stringify(data)
        }),

    del: <T>(path: string, options?: RequestInit) =>
        request<T>(path, { ...options, method: 'DELETE' }),
};
