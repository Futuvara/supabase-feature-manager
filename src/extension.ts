// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { AuthService } from './authService';
import { EnhancedSidebarProvider } from './enhancedSidebarProvider';

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
    console.log('Supabase Features extension is now active!');

    // Initialize AuthService
    const authService = AuthService.getInstance(context);

    // Initialize sidebar provider with auth service
    const sidebarProvider = new EnhancedSidebarProvider(context.extensionUri, context, authService);

    // Register webview provider
    const sidebarView = vscode.window.registerWebviewViewProvider(
        EnhancedSidebarProvider.viewType,
        sidebarProvider
    );

    // Subscribe to auth state changes
    authService.onStateChanged((state) => {
        console.log('[Extension] Auth state changed:', state.isAuthenticated);
        if (state.isAuthenticated) {
            sidebarProvider.handleAuthSuccess();
        } else {
            sidebarProvider.handleAuthRequired();
        }
    });

    // Subscribe to session expiration
    authService.onSessionExpired(() => {
        console.log('[Extension] Session expired');
        sidebarProvider.handleAuthRequired();
    });

    // Register refresh command
    let refreshCommand = vscode.commands.registerCommand('my-first-extension.refreshFeatures', () => {
        sidebarProvider.refresh();
    });

    // Register show login command (for session expiration prompts)
    let showLoginCommand = vscode.commands.registerCommand('supabaseFeatures.showLogin', () => {
        sidebarProvider.focusLoginInput();
    });

    context.subscriptions.push(sidebarView);
    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(showLoginCommand);
    context.subscriptions.push(authService);

    // Initialize auth service (handles auto-login if configured)
    await authService.initialize();
}

// This method is called when your extension is deactivated
export function deactivate() {}