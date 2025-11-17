import * as vscode from 'vscode';
import { SupabaseService, Project, Feature } from './supabaseService';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class FeaturesWebviewProvider {
    private panel: vscode.WebviewPanel | undefined;
    private supabaseService: SupabaseService;
    private currentProjects: Project[] = [];
    private currentFeatures: Feature[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.supabaseService = SupabaseService.getInstance();
    }

    public async show() {
        // Check if user is authenticated
        const user = await this.supabaseService.getCurrentUser();
        if (!user) {
            vscode.window.showErrorMessage('Please login first');
            vscode.commands.executeCommand('my-first-extension.login');
            return;
        }

        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'supabaseFeatures',
                'Project Features',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            await this.updateWebview();

            this.panel.webview.onDidReceiveMessage(
                async (message) => {
                    switch (message.command) {
                        case 'selectProject':
                            await this.handleProjectSelection(message.projectId);
                            break;
                        case 'executeFeature':
                            await this.handleFeatureExecution(message.featureId);
                            break;
                        case 'logout':
                            await this.handleLogout();
                            break;
                        case 'refresh':
                            await this.updateWebview();
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

    private async updateWebview() {
        if (!this.panel) return;

        this.currentProjects = await this.supabaseService.getProjects();
        this.panel.webview.html = this.getWebviewContent();

        // Send projects data to webview
        this.panel.webview.postMessage({
            command: 'updateProjects',
            projects: this.currentProjects
        });
    }

    private async handleProjectSelection(projectId: string) {
        if (!this.panel) return;

        this.currentFeatures = await this.supabaseService.getFeatures(projectId);

        this.panel.webview.postMessage({
            command: 'updateFeatures',
            features: this.currentFeatures
        });
    }

    private async handleFeatureExecution(featureId: string) {
        const feature = this.currentFeatures.find(f => f.id === featureId);
        if (!feature) {
            vscode.window.showErrorMessage('Feature not found');
            return;
        }

        // Show the prompt to the user
        const promptMessage = `Executing Feature: ${feature.name}\\n\\nPrompt:\\n${feature.prompt}`;
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
            const claudePath = await this.findClaudeCodePath();

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
                    outputChannel.appendLine('\\n=== Claude Code Response ===');
                    outputChannel.appendLine(stdout);
                }

                if (stderr) {
                    outputChannel.appendLine('\\n=== Errors ===');
                    outputChannel.appendLine(stderr);
                }

                vscode.window.showInformationMessage(`Feature "${feature.name}" executed successfully!`);
            } else {
                // Fallback: Just show the prompt for manual execution
                outputChannel.appendLine('\\nClaude Code CLI not found.');
                outputChannel.appendLine('Please execute the following prompt manually in Claude Code:');
                outputChannel.appendLine('\\n---');
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
            outputChannel.appendLine(`\\nError: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to execute feature: ${error.message}`);
        }

        // Update panel to show execution status
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'featureExecuted',
                featureId: featureId
            });
        }
    }

    private async findClaudeCodePath(): Promise<string | null> {
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

    private async handleLogout() {
        await this.supabaseService.signOut();
        await this.context.secrets.delete('supabase_email');
        await this.context.secrets.delete('supabase_password');

        if (this.panel) {
            this.panel.dispose();
        }

        vscode.window.showInformationMessage('Logged out successfully');
        vscode.commands.executeCommand('my-first-extension.login');
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Project Features</title>
            <style>
                * {
                    box-sizing: border-box;
                }
                body {
                    padding: 20px;
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                .container {
                    max-width: 800px;
                    margin: 0 auto;
                }
                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    padding-bottom: 10px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                h1 {
                    color: var(--vscode-editor-foreground);
                    margin: 0;
                }
                .controls {
                    display: flex;
                    gap: 10px;
                }
                .project-selector {
                    margin-bottom: 20px;
                }
                label {
                    display: block;
                    margin-bottom: 5px;
                    font-weight: bold;
                }
                select {
                    width: 100%;
                    padding: 8px;
                    background-color: var(--vscode-dropdown-background);
                    color: var(--vscode-dropdown-foreground);
                    border: 1px solid var(--vscode-dropdown-border);
                    border-radius: 2px;
                    font-size: 14px;
                }
                .features-container {
                    max-height: 500px;
                    overflow-y: auto;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 10px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                }
                .feature-item {
                    padding: 15px;
                    margin-bottom: 10px;
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .feature-item:hover {
                    background-color: var(--vscode-list-hoverBackground);
                    border-color: var(--vscode-focusBorder);
                }
                .feature-item.selected {
                    background-color: var(--vscode-list-activeSelectionBackground);
                    border-color: var(--vscode-focusBorder);
                }
                .feature-name {
                    font-weight: bold;
                    margin-bottom: 5px;
                    color: var(--vscode-editor-foreground);
                }
                .feature-description {
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                    margin-bottom: 10px;
                }
                .feature-prompt {
                    padding: 10px;
                    background-color: var(--vscode-textBlockQuote-background);
                    border-left: 3px solid var(--vscode-textBlockQuote-border);
                    font-family: var(--vscode-editor-font-family);
                    font-size: 12px;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    margin-top: 10px;
                }
                button {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 13px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button.secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                button.secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .execute-button {
                    margin-top: 10px;
                    width: 100%;
                }
                .empty-state {
                    text-align: center;
                    padding: 40px;
                    color: var(--vscode-descriptionForeground);
                }
                .loading {
                    text-align: center;
                    padding: 20px;
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Project Features</h1>
                    <div class="controls">
                        <button onclick="refresh()" class="secondary">Refresh</button>
                        <button onclick="logout()" class="secondary">Logout</button>
                    </div>
                </div>

                <div class="project-selector">
                    <label for="projectSelect">Select Project:</label>
                    <select id="projectSelect" onchange="selectProject()">
                        <option value="">-- Select a project --</option>
                    </select>
                </div>

                <div class="features-container" id="featuresContainer">
                    <div class="empty-state">
                        Select a project to view its features
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentFeatures = [];
                let selectedFeatureId = null;

                function selectProject() {
                    const select = document.getElementById('projectSelect');
                    const projectId = select.value;

                    if (projectId) {
                        document.getElementById('featuresContainer').innerHTML = '<div class="loading">Loading features...</div>';
                        vscode.postMessage({
                            command: 'selectProject',
                            projectId: projectId
                        });
                    } else {
                        document.getElementById('featuresContainer').innerHTML = '<div class="empty-state">Select a project to view its features</div>';
                    }
                }

                function executeFeature(featureId) {
                    vscode.postMessage({
                        command: 'executeFeature',
                        featureId: featureId
                    });
                }

                function selectFeature(featureId) {
                    // Remove previous selection
                    document.querySelectorAll('.feature-item').forEach(item => {
                        item.classList.remove('selected');
                    });

                    // Add selection to clicked item
                    const selectedItem = document.getElementById('feature-' + featureId);
                    if (selectedItem) {
                        selectedItem.classList.add('selected');
                        selectedFeatureId = featureId;
                    }
                }

                function refresh() {
                    vscode.postMessage({ command: 'refresh' });
                }

                function logout() {
                    if (confirm('Are you sure you want to logout?')) {
                        vscode.postMessage({ command: 'logout' });
                    }
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'updateProjects':
                            const select = document.getElementById('projectSelect');
                            select.innerHTML = '<option value="">-- Select a project --</option>';
                            message.projects.forEach(project => {
                                const option = document.createElement('option');
                                option.value = project.id;
                                option.textContent = project.name;
                                select.appendChild(option);
                            });
                            break;

                        case 'updateFeatures':
                            currentFeatures = message.features;
                            const container = document.getElementById('featuresContainer');

                            if (currentFeatures.length === 0) {
                                container.innerHTML = '<div class="empty-state">No features found for this project</div>';
                            } else {
                                container.innerHTML = currentFeatures.map(feature => \`
                                    <div class="feature-item" id="feature-\${feature.id}" onclick="selectFeature('\${feature.id}')">
                                        <div class="feature-name">\${feature.name}</div>
                                        \${feature.description ? \`<div class="feature-description">\${feature.description}</div>\` : ''}
                                        <div class="feature-prompt">Prompt: \${feature.prompt}</div>
                                        <button class="execute-button" onclick="event.stopPropagation(); executeFeature('\${feature.id}')">
                                            Execute with Claude Code
                                        </button>
                                    </div>
                                \`).join('');
                            }
                            break;

                        case 'featureExecuted':
                            const executedItem = document.getElementById('feature-' + message.featureId);
                            if (executedItem) {
                                executedItem.style.borderColor = 'var(--vscode-notificationsInfoIcon-foreground)';
                                setTimeout(() => {
                                    executedItem.style.borderColor = '';
                                }, 2000);
                            }
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }
}