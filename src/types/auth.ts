/**
 * Authentication type definitions for Supabase Feature Manager
 */

import { User } from '@supabase/supabase-js';

/**
 * Authentication state representation
 */
export interface AuthState {
    isAuthenticated: boolean;
    user: User | null;
    session: SessionData | null;
    lastLoginTime: number | null;
    error: string | null;
}

/**
 * Session data stored in secure storage
 */
export interface SessionData {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    user: User;
}

/**
 * Result of authentication attempt
 */
export interface AuthResult {
    success: boolean;
    user?: User;
    error?: string;
    errorCode?: string;
}

/**
 * Login credentials
 */
export interface LoginCredentials {
    email: string;
    password: string;
}

/**
 * Auto-login configuration
 */
export interface AutoLoginConfig {
    enabled: boolean;
    lastAttempt: number | null;
    failureCount: number;
}

/**
 * Auth event types
 */
export enum AuthEventType {
    LOGIN_SUCCESS = 'login_success',
    LOGIN_FAILURE = 'login_failure',
    LOGOUT = 'logout',
    SESSION_EXPIRED = 'session_expired',
    SESSION_REFRESHED = 'session_refreshed',
    STATE_CHANGED = 'state_changed'
}

/**
 * Auth event payload
 */
export interface AuthEvent {
    type: AuthEventType;
    timestamp: number;
    data?: any;
}
