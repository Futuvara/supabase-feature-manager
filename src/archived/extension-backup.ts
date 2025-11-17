// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { AuthWebviewProvider } from './authWebview';
import { FeaturesWebviewProvider } from './featuresWebview';
import { SupabaseService, Feature } from './supabaseService';
import { FeaturesTreeDataProvider, FeatureSidebarProvider } from './sidebarProvider';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Supabase Features extension is now active!');

    // Initialize providers
    const authProvider = new AuthWebviewProvider(context);
    const featuresProvider = new FeaturesWebviewProvider(context);
    const supabaseService = SupabaseService.getInstance();

    // Initialize sidebar providers
    const treeDataProvider = new FeaturesTreeDataProvider();
    const sidebarProvider = new FeatureSidebarProvider(context.extensionUri);

    // Register tree view
    vscode.window.createTreeView('supabaseFeatures.treeView', {
        treeDataProvider: treeDataProvider,
        showCollapseAll: true
    });

    // Register webview provider
    vscode.window.registerWebviewViewProvider(
        FeatureSidebarProvider.viewType,
        sidebarProvider
    );

    // Register login command
    let loginCommand = vscode.commands.registerCommand('my-first-extension.login', async () => {
        await authProvider.show();
        // Refresh tree after login
        treeDataProvider.refresh();
    });

    // Register show features command
    let featuresCommand = vscode.commands.registerCommand('my-first-extension.showFeatures', async () => {
        await featuresProvider.show();
    });

    // Register main command (checks auth and shows appropriate view)
    let mainCommand = vscode.commands.registerCommand('my-first-extension.start', async () => {
        // Check if user has stored credentials
        const email = await context.secrets.get('supabase_email');
        const password = await context.secrets.get('supabase_password');

        if (email && password) {
            // Try to auto-login
            try {
                await supabaseService.signIn(email, password);
                await featuresProvider.show();
            } catch (error) {
                // Auto-login failed, show login screen
                await authProvider.show();
            }
        } else {
            // No stored credentials, show login screen
            await authProvider.show();
        }
    });

    // Register logout command
    let logoutCommand = vscode.commands.registerCommand('my-first-extension.logout', async () => {
        await supabaseService.signOut();
        await context.secrets.delete('supabase_email');
        await context.secrets.delete('supabase_password');
        vscode.window.showInformationMessage('Logged out successfully');
        treeDataProvider.clearCache();
        sidebarProvider.clearView();
    });

    // Register refresh command
    let refreshCommand = vscode.commands.registerCommand('my-first-extension.refreshFeatures', () => {
        treeDataProvider.clearCache();
        treeDataProvider.refresh();
    });

    // Register show feature details command
    let showFeatureDetailsCommand = vscode.commands.registerCommand('my-first-extension.showFeatureDetails', (feature: Feature) => {
        sidebarProvider.showFeature(feature);
    });

    // Register execute feature command
    let executeFeatureCommand = vscode.commands.registerCommand('my-first-extension.executeFeature', async (feature: Feature) => {
        if (!feature) {
            vscode.window.showErrorMessage('No feature selected');
            return;
        }

        // Show the prompt to the user
        const promptMessage = `Executing Feature: ${feature.name}\n\nPrompt:\n${feature.prompt}`;
        vscode.window.showInformationMessage(promptMessage, { modal: false });

        // Create output channel to show progress
        const outputChannel = vscode.window.createOutputChannel('Feature Execution');
        outputChannel.show();
        outputChannel.appendLine(`=== Executing Feature: ${feature.name} ===`);
        outputChannel.appendLine(`Prompt: ${feature.prompt}`);
        outputChannel.appendLine('');
        outputChannel.appendLine('Sending to Claude Code...');

        try {
            // Check if Claude Code CLI is available
            const claudePath = await findClaudeCodePath();

            if (claudePath) {
                // Execute using Claude Code CLI
                outputChannel.appendLine('Claude Code found, executing prompt...');

                // Prepare the prompt for Claude Code
                const escapedPrompt = feature.prompt.replace(/'/g, "'\\''");
                const command = `echo '${escapedPrompt}' | ${claudePath}`;

                const { stdout, stderr } = await execAsync(command, {
                    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
                });

                if (stdout) {
                    outputChannel.appendLine('\n=== Claude Code Response ===');
                    outputChannel.appendLine(stdout);
                }

                if (stderr) {
                    outputChannel.appendLine('\n=== Errors ===');
                    outputChannel.appendLine(stderr);
                }

                vscode.window.showInformationMessage(`Feature "${feature.name}" executed successfully!`);
            } else {
                // Fallback: Just show the prompt for manual execution
                outputChannel.appendLine('\nClaude Code CLI not found.');
                outputChannel.appendLine('Please execute the following prompt manually in Claude Code:');
                outputChannel.appendLine('\n---');
                outputChannel.appendLine(feature.prompt);
                outputChannel.appendLine('---');

                // Copy prompt to clipboard
                await vscode.env.clipboard.writeText(feature.prompt);
                vscode.window.showInformationMessage(
                    `Prompt copied to clipboard! Please paste it in Claude Code to execute.`,
                    'OK'
                );
            }
        } catch (error: any) {
            outputChannel.appendLine(`\nError: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to execute feature: ${error.message}`);
        }
    });

    context.subscriptions.push(loginCommand);
    context.subscriptions.push(featuresCommand);
    context.subscriptions.push(mainCommand);
    context.subscriptions.push(logoutCommand);
    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(showFeatureDetailsCommand);
    context.subscriptions.push(executeFeatureCommand);

    // Auto-login on activation if credentials are stored
    (async () => {
        const email = await context.secrets.get('supabase_email');
        const password = await context.secrets.get('supabase_password');

        if (email && password) {
            try {
                await supabaseService.signIn(email, password);
                treeDataProvider.refresh();
            } catch (error) {
                // Silent fail - user can login manually
            }
        }
    })();
}

async function findClaudeCodePath(): Promise<string | null> {
    // Try to find Claude Code CLI in common locations
    const possiblePaths = [
        'claude',
        'claude-code',
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        '~/.local/bin/claude'
    ];

    for (const path of possiblePaths) {
        try {
            await execAsync(`which ${path}`);
            return path;
        } catch {
            // Path not found, continue to next
        }
    }

    return null;
}

// This method is called when your extension is deactivated
export function deactivate() {}