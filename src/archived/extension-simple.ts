// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { AuthWebviewProvider } from './authWebview';
import { UnifiedSidebarProvider } from './unifiedSidebarProvider';
import { SupabaseService } from './supabaseService';

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    console.log('Supabase Features extension is now active!');

    // Initialize providers
    const authProvider = new AuthWebviewProvider(context);
    const supabaseService = SupabaseService.getInstance();
    const sidebarProvider = new UnifiedSidebarProvider(context.extensionUri, context);

    // Register webview provider
    const sidebarView = vscode.window.registerWebviewViewProvider(
        UnifiedSidebarProvider.viewType,
        sidebarProvider
    );

    // Register login command
    let loginCommand = vscode.commands.registerCommand('my-first-extension.login', async () => {
        await authProvider.show();
        // After successful login, the auth provider will refresh the sidebar
        setTimeout(() => {
            sidebarProvider.refresh();
        }, 1000);
    });

    // Register refresh command
    let refreshCommand = vscode.commands.registerCommand('my-first-extension.refreshFeatures', () => {
        sidebarProvider.refresh();
    });

    context.subscriptions.push(sidebarView);
    context.subscriptions.push(loginCommand);
    context.subscriptions.push(refreshCommand);

    // Auto-login on activation if credentials are stored
    (async () => {
        const email = await context.secrets.get('supabase_email');
        const password = await context.secrets.get('supabase_password');

        if (email && password) {
            try {
                await supabaseService.signIn(email, password);
                sidebarProvider.refresh();
            } catch (error) {
                // Silent fail - user can login manually
            }
        }
    })();
}

// This method is called when your extension is deactivated
export function deactivate() {}