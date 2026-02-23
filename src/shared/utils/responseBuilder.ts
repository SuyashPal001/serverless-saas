// Types
interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

interface ErrorDetails {
  message: string;
  code?: string;
  details?: any;
}

/**
 * Standard headers for API responses
 */
const getStandardHeaders = (additionalHeaders?: Record<string, string>): Record<string, string> => {
  return {
    'Content-Type': 'application/json',
    'X-Response-Time': new Date().toISOString(),
    ...additionalHeaders
  };
};

/**
 * Creates a successful response (200 OK)
 * @param data - Response data to return
 * @param statusCode - HTTP status code (default: 200)
 * @param additionalHeaders - Optional additional headers
 */
export const success = (
  data: any,
  statusCode: number = 200,
  additionalHeaders?: Record<string, string>
): ApiResponse => {
  return {
    statusCode,
    headers: getStandardHeaders(additionalHeaders),
    body: JSON.stringify(data)
  };
};

/**
 * Creates an error response
 * @param message - Error message
 * @param statusCode - HTTP status code (default: 500)
 * @param details - Additional error details (optional)
 */
export const error = (
  message: string,
  statusCode: number = 500,
  details?: any
): ApiResponse => {
  const errorResponse: ErrorDetails = {
    message,
    ...(details && { details })
  };

  return {
    statusCode,
    headers: getStandardHeaders(),
    body: JSON.stringify({
      error: errorResponse,
      timestamp: new Date().toISOString()
    })
  };
};

/**
 * Creates a bad request response (400)
 */
export const badRequest = (message: string, details?: any): ApiResponse => {
  return error(message, 400, details);
};

/**
 * Creates an unauthorized response (401)
 */
export const unauthorized = (message: string = 'Unauthorized'): ApiResponse => {
  return error(message, 401);
};

/**
 * Creates a forbidden response (403)
 */
export const forbidden = (message: string = 'Forbidden'): ApiResponse => {
  return error(message, 403);
};

/**
 * Creates a not found response (404)
 */
export const notFound = (message: string = 'Resource not found'): ApiResponse => {
  return error(message, 404);
};

/**
 * Creates a conflict response (409)
 */
export const conflict = (message: string, details?: any): ApiResponse => {
  return error(message, 409, details);
};

/**
 * Creates a service unavailable response (503)
 */
export const serviceUnavailable = (message: string = 'Service temporarily unavailable'): ApiResponse => {
  return error(message, 503);
};

/**
 * Creates a created response (201)
 */
export const created = (data: any, additionalHeaders?: Record<string, string>): ApiResponse => {
  return success(data, 201, additionalHeaders);
};

/**
 * Creates a no content response (204)
 */
export const noContent = (): ApiResponse => {
  return {
    statusCode: 204,
    headers: getStandardHeaders(),
    body: ''
  };
};

// Default export for convenience
export default {
  success,
  error,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  serviceUnavailable,
  created,
  noContent
};
