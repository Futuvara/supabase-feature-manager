/**
 * Authentication error classes with user-friendly messages
 */

/**
 * Base authentication error class
 */
export abstract class AuthError extends Error {
    abstract readonly code: string;
    abstract readonly userMessage: string;
    abstract readonly isRetryable: boolean;

    constructor(
        message: string,
        public readonly originalError?: any
    ) {
        super(message);
        this.name = this.constructor.name;

        // Maintain proper stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Invalid credentials error
 */
export class InvalidCredentialsError extends AuthError {
    readonly code = 'AUTH_INVALID_CREDENTIALS';
    readonly userMessage = 'Email or password is incorrect. Please try again.';
    readonly isRetryable = true;

    constructor(originalError?: any) {
        super('Invalid credentials', originalError);
    }
}

/**
 * Network error during authentication
 */
export class NetworkError extends AuthError {
    readonly code = 'AUTH_NETWORK_ERROR';
    readonly userMessage = 'Network connection failed. Please check your internet connection and try again.';
    readonly isRetryable = true;

    constructor(originalError?: any) {
        super('Network error', originalError);
    }
}

/**
 * Session expired error
 */
export class SessionExpiredError extends AuthError {
    readonly code = 'AUTH_SESSION_EXPIRED';
    readonly userMessage = 'Your session has expired. Please login again.';
    readonly isRetryable = false;

    constructor(originalError?: any) {
        super('Session expired', originalError);
    }
}

/**
 * Rate limit exceeded error
 */
export class RateLimitError extends AuthError {
    readonly code = 'AUTH_RATE_LIMITED';
    readonly userMessage: string;
    readonly isRetryable = true;

    constructor(retryAfterMs: number, originalError?: any) {
        const retryMinutes = Math.ceil(retryAfterMs / 60000);
        const message = `Too many login attempts. Please try again in ${retryMinutes} minute${retryMinutes > 1 ? 's' : ''}.`;
        super(message, originalError);
        this.userMessage = message;
    }
}

/**
 * Token refresh failed error
 */
export class TokenRefreshError extends AuthError {
    readonly code = 'AUTH_TOKEN_REFRESH_FAILED';
    readonly userMessage = 'Failed to refresh your session. Please login again.';
    readonly isRetryable = false;

    constructor(originalError?: any) {
        super('Token refresh failed', originalError);
    }
}

/**
 * User not found error
 */
export class UserNotFoundError extends AuthError {
    readonly code = 'AUTH_USER_NOT_FOUND';
    readonly userMessage = 'No account found with this email address.';
    readonly isRetryable = false;

    constructor(originalError?: any) {
        super('User not found', originalError);
    }
}

/**
 * Generic authentication error
 */
export class GenericAuthError extends AuthError {
    readonly code = 'AUTH_ERROR';
    readonly userMessage = 'An error occurred during authentication. Please try again.';
    readonly isRetryable = true;

    constructor(message: string, originalError?: any) {
        super(message, originalError);
    }
}

/**
 * Parse Supabase errors into typed auth errors
 */
export function parseAuthError(error: any): AuthError {
    if (!error) {
        return new GenericAuthError('Unknown error');
    }

    const errorMessage = error.message?.toLowerCase() || '';
    const statusCode = error.status || error.statusCode;

    // Network errors
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || !statusCode) {
        return new NetworkError(error);
    }

    // Rate limiting
    if (statusCode === 429) {
        const retryAfter = parseInt(error.headers?.['retry-after'] || '300') * 1000;
        return new RateLimitError(retryAfter, error);
    }

    // Invalid credentials
    if (errorMessage.includes('invalid') && (errorMessage.includes('password') || errorMessage.includes('credentials'))) {
        return new InvalidCredentialsError(error);
    }

    // User not found
    if (errorMessage.includes('user not found') || errorMessage.includes('no user')) {
        return new UserNotFoundError(error);
    }

    // Session expired
    if (errorMessage.includes('expired') || errorMessage.includes('session missing')) {
        return new SessionExpiredError(error);
    }

    // Token refresh failed
    if (errorMessage.includes('refresh') && errorMessage.includes('failed')) {
        return new TokenRefreshError(error);
    }

    // Generic error
    return new GenericAuthError(error.message || 'Authentication error', error);
}
