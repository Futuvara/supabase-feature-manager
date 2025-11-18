/**
 * Centralized Authentication Service
 * Manages all authentication, session, and token operations
 */

import * as vscode from 'vscode';
import { SupabaseService } from './supabaseService';
import { AuthState, AuthResult, SessionData, AuthEvent, AuthEventType, AutoLoginConfig } from './types/auth';
import { AuthError, parseAuthError, SessionExpiredError, NetworkError } from './errors/authErrors';

export class AuthService {
    private static instance: AuthService | null = null;
    private context: vscode.ExtensionContext;
    private supabaseService: SupabaseService;

    // State
    private _state: AuthState = {
        isAuthenticated: false,
        user: null,
        session: null,
        lastLoginTime: null,
        error: null
    };

    // Rate limiting
    private loginAttempts: Map<string, number> = new Map();
    private rateLimitReset: Map<string, number> = new Map();
    private readonly MAX_LOGIN_ATTEMPTS = 5;
    private readonly RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

    // Event emitters
    private readonly _onStateChanged = new vscode.EventEmitter<AuthState>();
    private readonly _onSessionExpired = new vscode.EventEmitter<void>();
    private readonly _onAuthEvent = new vscode.EventEmitter<AuthEvent>();

    public readonly onStateChanged = this._onStateChanged.event;
    public readonly onSessionExpired = this._onSessionExpired.event;
    public readonly onAuthEvent = this._onAuthEvent.event;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.supabaseService = SupabaseService.getInstance();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(context?: vscode.ExtensionContext): AuthService {
        if (!AuthService.instance) {
            if (!context) {
                throw new Error('AuthService requires ExtensionContext for first initialization');
            }
            AuthService.instance = new AuthService(context);
        }
        return AuthService.instance;
    }

    /**
     * Get current authentication state
     */
    public get state(): Readonly<AuthState> {
        return { ...this._state };
    }

    /**
     * Check if user is authenticated
     */
    public get isAuthenticated(): boolean {
        return this._state.isAuthenticated;
    }

    /**
     * Get current user
     */
    public get currentUser() {
        return this._state.user;
    }

    /**
     * Initialize auth service and attempt auto-login if configured
     */
    public async initialize(): Promise<void> {
        console.log('[AuthService] Initializing...');

        // Try to restore session from storage
        const restored = await this.restoreSession();

        if (!restored) {
            // Check if auto-login is enabled
            const config = vscode.workspace.getConfiguration('supabaseFeatures');
            if (config.get('autoLogin', false)) {
                await this.autoLogin();
            }
        }
    }

    /**
     * Login with email and password
     */
    public async login(email: string, password: string, withRetry: boolean = true): Promise<AuthResult> {
        console.log(`[AuthService] Login attempt for: ${email}`);

        try {
            // Check rate limiting
            await this.checkRateLimit(email);

            // Attempt login with retry logic
            const result = withRetry
                ? await this.loginWithRetry(email, password)
                : await this.performLogin(email, password);

            if (result.success) {
                // Reset rate limit counters on success
                this.loginAttempts.delete(email);
                this.rateLimitReset.delete(email);

                this.emitEvent(AuthEventType.LOGIN_SUCCESS, { email });
                console.log('[AuthService] Login successful');
            }

            return result;

        } catch (error) {
            // Track failed attempts
            this.incrementLoginAttempts(email);

            const authError = error instanceof AuthError ? error : parseAuthError(error);
            this.emitEvent(AuthEventType.LOGIN_FAILURE, { error: authError.code });

            // Update state with error
            this.setState({ error: authError.userMessage });

            console.error('[AuthService] Login failed:', authError.code, authError.userMessage);
            throw authError;
        }
    }

    /**
     * Logout and clear all session data
     */
    public async logout(): Promise<void> {
        console.log('[AuthService] Logging out...');

        try {
            // Sign out from Supabase
            await this.supabaseService.signOut();

            // Clear stored session
            await this.context.secrets.delete('supabase_session');

            // Clear auto-login config
            await this.context.globalState.update('autoLoginConfig', undefined);

            // Reset state
            this.setState({
                isAuthenticated: false,
                user: null,
                session: null,
                lastLoginTime: null,
                error: null
            });

            this.emitEvent(AuthEventType.LOGOUT);

            vscode.window.showInformationMessage('Logged out successfully');
            console.log('[AuthService] Logout complete');

        } catch (error) {
            console.error('[AuthService] Logout error:', error);
            vscode.window.showErrorMessage('Error during logout. Please try again.');
        }
    }

    /**
     * Refresh the current session
     */
    public async refreshSession(): Promise<boolean> {
        console.log('[AuthService] Refreshing session...');

        try {
            const sessionData = await this.getStoredSession();

            if (!sessionData) {
                console.log('[AuthService] No session to refresh');
                return false;
            }

            // Use Supabase refresh token
            const { data, error } = await this.supabaseService.getSupabaseClient().auth.refreshSession({
                refresh_token: sessionData.refresh_token
            });

            if (error) {
                throw error;
            }

            if (data.session) {
                // Store refreshed session
                await this.storeSession({
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token,
                    expires_at: new Date(data.session.expires_at!).getTime(),
                    user: data.session.user
                });

                this.setState({
                    isAuthenticated: true,
                    user: data.session.user,
                    session: {
                        access_token: data.session.access_token,
                        refresh_token: data.session.refresh_token,
                        expires_at: new Date(data.session.expires_at!).getTime(),
                        user: data.session.user
                    }
                });

                this.emitEvent(AuthEventType.SESSION_REFRESHED);
                console.log('[AuthService] Session refreshed successfully');
                return true;
            }

            return false;

        } catch (error) {
            console.error('[AuthService] Session refresh failed:', error);

            // Session refresh failed - require re-login
            this.handleSessionExpired();
            return false;
        }
    }

    /**
     * Validate current session
     */
    public async validateSession(): Promise<boolean> {
        const sessionData = await this.getStoredSession();

        if (!sessionData) {
            return false;
        }

        // Check if token is expired
        if (this.isTokenExpired(sessionData.expires_at)) {
            console.log('[AuthService] Token expired, attempting refresh...');
            return await this.refreshSession();
        }

        return true;
    }

    /**
     * Auto-login using stored session
     */
    public async autoLogin(): Promise<boolean> {
        console.log('[AuthService] Attempting auto-login...');

        try {
            const sessionData = await this.getStoredSession();

            if (!sessionData) {
                console.log('[AuthService] No stored session for auto-login');
                return false;
            }

            // Check if session is still valid or can be refreshed
            const isValid = await this.validateSession();

            if (isValid) {
                vscode.window.showInformationMessage('Welcome back! Logged in automatically.');
                return true;
            }

            console.log('[AuthService] Auto-login failed - session invalid');
            return false;

        } catch (error) {
            console.error('[AuthService] Auto-login error:', error);
            return false;
        }
    }

    /**
     * Perform actual login operation
     */
    private async performLogin(email: string, password: string): Promise<AuthResult> {
        const { data, error } = await this.supabaseService.getSupabaseClient().auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            throw parseAuthError(error);
        }

        if (data.session && data.user) {
            // Store session securely
            await this.storeSession({
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
                expires_at: new Date(data.session.expires_at!).getTime(),
                user: data.user
            });

            // Update state
            this.setState({
                isAuthenticated: true,
                user: data.user,
                session: {
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token,
                    expires_at: new Date(data.session.expires_at!).getTime(),
                    user: data.user
                },
                lastLoginTime: Date.now(),
                error: null
            });

            return {
                success: true,
                user: data.user
            };
        }

        throw new Error('No session returned from Supabase');
    }

    /**
     * Login with retry logic for network errors
     */
    private async loginWithRetry(
        email: string,
        password: string,
        maxRetries: number = 3
    ): Promise<AuthResult> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await this.performLogin(email, password);
            } catch (error) {
                const authError = error instanceof AuthError ? error : parseAuthError(error);

                // Only retry network errors
                if (!(authError instanceof NetworkError) || attempt === maxRetries - 1) {
                    throw authError;
                }

                // Exponential backoff: 1s, 2s, 4s
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`[AuthService] Retry attempt ${attempt + 1} after ${delay}ms`);
                await this.sleep(delay);
            }
        }

        throw new Error('Login retry failed');
    }

    /**
     * Store session in secure storage
     */
    private async storeSession(sessionData: SessionData): Promise<void> {
        await this.context.secrets.store('supabase_session', JSON.stringify(sessionData));
    }

    /**
     * Retrieve session from secure storage
     */
    private async getStoredSession(): Promise<SessionData | null> {
        try {
            const sessionJson = await this.context.secrets.get('supabase_session');
            if (sessionJson) {
                return JSON.parse(sessionJson);
            }
        } catch (error) {
            console.error('[AuthService] Failed to parse stored session:', error);
        }
        return null;
    }

    /**
     * Restore session from storage
     */
    private async restoreSession(): Promise<boolean> {
        const sessionData = await this.getStoredSession();

        if (sessionData) {
            // Validate and potentially refresh the session
            const isValid = await this.validateSession();

            if (isValid) {
                console.log('[AuthService] Session restored successfully');
                return true;
            }
        }

        return false;
    }

    /**
     * Check if token is expired
     */
    private isTokenExpired(expiresAt: number): boolean {
        // Add 5 minute buffer
        const buffer = 5 * 60 * 1000;
        return Date.now() >= (expiresAt - buffer);
    }

    /**
     * Handle session expiration
     */
    private handleSessionExpired(): void {
        this.setState({
            isAuthenticated: false,
            user: null,
            session: null,
            error: 'Session expired'
        });

        this._onSessionExpired.fire();
        this.emitEvent(AuthEventType.SESSION_EXPIRED);

        vscode.window.showWarningMessage(
            'Your session has expired',
            'Login Again'
        ).then(action => {
            if (action === 'Login Again') {
                vscode.commands.executeCommand('supabaseFeatures.showLogin');
            }
        });
    }

    /**
     * Check rate limiting
     */
    private async checkRateLimit(email: string): Promise<void> {
        const attempts = this.loginAttempts.get(email) || 0;

        if (attempts >= this.MAX_LOGIN_ATTEMPTS) {
            const resetTime = this.rateLimitReset.get(email) || 0;

            if (Date.now() < resetTime) {
                const waitMs = resetTime - Date.now();
                throw parseAuthError({ status: 429, headers: { 'retry-after': Math.ceil(waitMs / 1000) } });
            } else {
                // Reset counter after window expires
                this.loginAttempts.delete(email);
                this.rateLimitReset.delete(email);
            }
        }
    }

    /**
     * Increment login attempts for rate limiting
     */
    private incrementLoginAttempts(email: string): void {
        const attempts = (this.loginAttempts.get(email) || 0) + 1;
        this.loginAttempts.set(email, attempts);

        if (attempts >= this.MAX_LOGIN_ATTEMPTS) {
            this.rateLimitReset.set(email, Date.now() + this.RATE_LIMIT_WINDOW_MS);
        }
    }

    /**
     * Update authentication state
     */
    private setState(newState: Partial<AuthState>): void {
        this._state = { ...this._state, ...newState };
        this._onStateChanged.fire(this._state);
        this.emitEvent(AuthEventType.STATE_CHANGED, this._state);
    }

    /**
     * Emit auth event
     */
    private emitEvent(type: AuthEventType, data?: any): void {
        this._onAuthEvent.fire({
            type,
            timestamp: Date.now(),
            data
        });
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Dispose and cleanup
     */
    public dispose(): void {
        this._onStateChanged.dispose();
        this._onSessionExpired.dispose();
        this._onAuthEvent.dispose();
    }
}
