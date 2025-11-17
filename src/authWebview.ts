import * as vscode from 'vscode';
import { SupabaseService } from './supabaseService';

export class AuthWebviewProvider {
    private panel: vscode.WebviewPanel | undefined;
    private supabaseService: SupabaseService;

    constructor(private context: vscode.ExtensionContext) {
        this.supabaseService = SupabaseService.getInstance();
    }

    public async show() {
        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'supabaseAuth',
                'Supabase Login',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.panel.webview.html = this.getWebviewContent();

            this.panel.webview.onDidReceiveMessage(
                async (message) => {
                    switch (message.command) {
                        case 'login':
                            await this.handleLogin(message.email, message.password);
                            break;
                    }
                },
                undefined,
                this.context.subscriptions
            );

            this.panel.onDidDispose(
                () => {
                    this.panel = undefined;
                },
                undefined,
                this.context.subscriptions
            );
        }
    }

    private async handleLogin(email: string, password: string) {
        try {
            const data = await this.supabaseService.signIn(email, password);
            if (data) {
                vscode.window.showInformationMessage('Successfully logged in!');
                // Store credentials in secure storage
                await this.context.secrets.store('supabase_email', email);
                await this.context.secrets.store('supabase_password', password);

                if (this.panel) {
                    this.panel.dispose();
                }

                // Refresh the tree view
                vscode.commands.executeCommand('my-first-extension.refreshFeatures');

                // Show the main feature view
                vscode.commands.executeCommand('my-first-extension.showFeatures');
            }
        } catch (error: any) {
            if (this.panel) {
                this.panel.webview.postMessage({
                    command: 'loginError',
                    error: error.message
                });
            }
        }
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Supabase Login</title>
            <style>
                body {
                    padding: 20px;
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                .container {
                    max-width: 400px;
                    margin: 0 auto;
                }
                h1 {
                    color: var(--vscode-editor-foreground);
                    text-align: center;
                }
                .form-group {
                    margin-bottom: 15px;
                }
                label {
                    display: block;
                    margin-bottom: 5px;
                    color: var(--vscode-editor-foreground);
                }
                input {
                    width: 100%;
                    padding: 8px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 2px;
                }
                button {
                    width: 100%;
                    padding: 10px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 14px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .error {
                    color: var(--vscode-errorForeground);
                    margin-top: 10px;
                    padding: 10px;
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    border-radius: 2px;
                    display: none;
                }
                .info {
                    margin-top: 20px;
                    padding: 10px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    border-radius: 2px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Login to Supabase</h1>
                <form id="loginForm">
                    <div class="form-group">
                        <label for="email">Email:</label>
                        <input type="email" id="email" name="email" required>
                    </div>
                    <div class="form-group">
                        <label for="password">Password:</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <button type="submit">Login</button>
                </form>
                <div id="error" class="error"></div>
                <div class="info">
                    <p>Please enter your Supabase credentials to access projects and features.</p>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const loginForm = document.getElementById('loginForm');
                const errorDiv = document.getElementById('error');

                loginForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const email = document.getElementById('email').value;
                    const password = document.getElementById('password').value;

                    vscode.postMessage({
                        command: 'login',
                        email: email,
                        password: password
                    });
                });

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'loginError':
                            errorDiv.textContent = message.error;
                            errorDiv.style.display = 'block';
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }
}