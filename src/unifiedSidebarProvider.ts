import * as vscode from 'vscode';
import { SupabaseService, Project, Feature } from './supabaseService';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class UnifiedSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'supabaseFeatures.unifiedSidebar';

    private _view?: vscode.WebviewView;
    private supabaseService: SupabaseService;
    private projects: Project[] = [];
    private features: Feature[] = [];
    private currentProjectId?: string;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext
    ) {
        this.supabaseService = SupabaseService.getInstance();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'ready':
                    await this.initialize();
                    break;
                case 'login':
                    await this.handleLogin();
                    break;
                case 'logout':
                    await this.handleLogout();
                    break;
                case 'selectProject':
                    await this.loadFeatures(data.projectId);
                    break;
                case 'selectFeature':
                    this.showFeaturePrompt(data.featureId);
                    break;
                case 'executePrompt':
                    await this.executePrompt(data.prompt, data.featureName);
                    break;
                case 'refresh':
                    await this.refresh();
                    break;
            }
        });

        // Initialize on load
        this.initialize();
    }

    private async initialize() {
        const user = await this.supabaseService.getCurrentUser();

        if (user) {
            await this.loadProjects();
        } else {
            // Show login state
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'requireLogin'
                });
            }
        }
    }

    private async handleLogin() {
        vscode.commands.executeCommand('my-first-extension.login');
        // The login command will refresh this view when complete
    }

    private async handleLogout() {
        try {
            // Sign out from Supabase
            await this.supabaseService.signOut();

            // Clear stored credentials
            await this.context.secrets.delete('supabase_email');
            await this.context.secrets.delete('supabase_password');

            // Clear local data
            this.projects = [];
            this.features = [];
            this.currentProjectId = undefined;

            // Update UI to show login state
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'requireLogin'
                });
            }

            vscode.window.showInformationMessage('Logged out successfully');
        } catch (error: any) {
            console.error('Logout error:', error);
            vscode.window.showErrorMessage(`Failed to logout: ${error.message}`);
        }
    }

    private async loadProjects() {
        this.projects = await this.supabaseService.getProjects();

        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateProjects',
                projects: this.projects
            });
        }
    }

    private async loadFeatures(projectId: string) {
        this.currentProjectId = projectId;
        this.features = await this.supabaseService.getFeatures(projectId);

        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateFeatures',
                features: this.features
            });
        }
    }

    private showFeaturePrompt(featureId: string) {
        const feature = this.features.find(f => f.id === featureId);
        if (feature && this._view) {
            this._view.webview.postMessage({
                type: 'showPrompt',
                prompt: feature.description,  // description contains the prompt
                featureName: feature.title     // title is the feature name
            });
        }
    }

    private async executePrompt(prompt: string, featureName: string) {
        // Create output channel to show progress
        const outputChannel = vscode.window.createOutputChannel('Feature Execution');
        outputChannel.show();
        outputChannel.appendLine(`=== Executing Feature: ${featureName} ===`);
        outputChannel.appendLine(`Prompt: ${prompt}`);
        outputChannel.appendLine('');
        outputChannel.appendLine('Sending to Claude Code...');

        try {
            // Check if Claude Code CLI is available
            const claudePath = await this.findClaudeCodePath();

            if (claudePath) {
                outputChannel.appendLine('Claude Code found, executing prompt...');

                const escapedPrompt = prompt.replace(/'/g, "'\\''");
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

                vscode.window.showInformationMessage(`Feature "${featureName}" executed successfully!`);
            } else {
                outputChannel.appendLine('\nClaude Code CLI not found.');
                outputChannel.appendLine('Please execute the following prompt manually in Claude Code:');
                outputChannel.appendLine('\n---');
                outputChannel.appendLine(prompt);
                outputChannel.appendLine('---');

                await vscode.env.clipboard.writeText(prompt);
                vscode.window.showInformationMessage(
                    `Prompt copied to clipboard! Please paste it in Claude Code to execute.`,
                    'OK'
                );
            }
        } catch (error: any) {
            outputChannel.appendLine(`\nError: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to execute feature: ${error.message}`);
        }
    }

    private async findClaudeCodePath(): Promise<string | null> {
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
                continue;
            }
        }

        return null;
    }

    public async refresh() {
        await this.initialize();
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Supabase Features</title>
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }

                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-sideBar-background);
                        padding: 10px;
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                    }

                    .login-container {
                        display: none;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        height: 100%;
                        text-align: center;
                    }

                    .login-container.active {
                        display: flex;
                    }

                    .main-container {
                        display: flex;
                        flex-direction: column;
                        height: 100%;
                        gap: 10px;
                    }

                    .main-container.hidden {
                        display: none;
                    }

                    .section-label {
                        font-size: 11px;
                        text-transform: uppercase;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 5px;
                        font-weight: 600;
                    }

                    .dropdown-container {
                        margin-bottom: 15px;
                    }

                    select {
                        width: 100%;
                        padding: 6px 8px;
                        background-color: var(--vscode-dropdown-background);
                        color: var(--vscode-dropdown-foreground);
                        border: 1px solid var(--vscode-dropdown-border);
                        border-radius: 2px;
                        font-size: 13px;
                        cursor: pointer;
                    }

                    select:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        outline-offset: -1px;
                    }

                    .features-container {
                        flex: 0 0 auto;
                        max-height: 200px;
                        overflow-y: auto;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 2px;
                        background-color: var(--vscode-editor-background);
                    }

                    .feature-item {
                        padding: 8px 10px;
                        cursor: pointer;
                        border-bottom: 1px solid var(--vscode-panel-border);
                        font-size: 13px;
                        transition: background-color 0.1s;
                    }

                    .feature-item:last-child {
                        border-bottom: none;
                    }

                    .feature-item:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }

                    .feature-item.selected {
                        background-color: var(--vscode-list-activeSelectionBackground);
                        color: var(--vscode-list-activeSelectionForeground);
                    }

                    .prompt-container {
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        margin-top: 10px;
                    }

                    .prompt-textarea {
                        flex: 1;
                        width: 100%;
                        padding: 10px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 2px;
                        font-family: var(--vscode-editor-font-family);
                        font-size: 12px;
                        resize: none;
                        min-height: 200px;
                    }

                    .prompt-textarea:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        outline-offset: -1px;
                    }

                    .prompt-textarea::placeholder {
                        color: var(--vscode-input-placeholderForeground);
                    }

                    .button-container {
                        margin-top: 10px;
                    }

                    button {
                        width: 100%;
                        padding: 8px 12px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 2px;
                        font-size: 13px;
                        font-weight: 500;
                        cursor: pointer;
                        transition: background-color 0.1s;
                    }

                    button:hover:not(:disabled) {
                        background-color: var(--vscode-button-hoverBackground);
                    }

                    button:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }

                    button.send-button {
                        background-color: #007ACC;
                    }

                    button.send-button:hover:not(:disabled) {
                        background-color: #005a9e;
                    }

                    .empty-state {
                        padding: 20px;
                        text-align: center;
                        color: var(--vscode-descriptionForeground);
                        font-size: 12px;
                    }

                    .toolbar {
                        display: flex;
                        justify-content: flex-end;
                        margin-bottom: 10px;
                        gap: 5px;
                    }

                    .icon-button {
                        width: auto;
                        padding: 4px 8px;
                        font-size: 11px;
                        background-color: transparent;
                        color: var(--vscode-foreground);
                        border: 1px solid var(--vscode-panel-border);
                    }

                    .icon-button:hover {
                        background-color: var(--vscode-toolbar-hoverBackground);
                    }

                    ::-webkit-scrollbar {
                        width: 10px;
                    }

                    ::-webkit-scrollbar-track {
                        background: transparent;
                    }

                    ::-webkit-scrollbar-thumb {
                        background: var(--vscode-scrollbarSlider-background);
                        border-radius: 5px;
                    }

                    ::-webkit-scrollbar-thumb:hover {
                        background: var(--vscode-scrollbarSlider-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="login-container" id="loginContainer">
                    <p style="margin-bottom: 20px;">Please login to access your projects</p>
                    <button onclick="login()">Login to Supabase</button>
                </div>

                <div class="main-container hidden" id="mainContainer">
                    <div class="toolbar">
                        <button class="icon-button" onclick="refresh()">↻ Refresh</button>
                        <button class="icon-button" onclick="logout()">Logout</button>
                    </div>

                    <div class="dropdown-container">
                        <div class="section-label">Project</div>
                        <select id="projectSelect" onchange="selectProject()">
                            <option value="">Select a project...</option>
                        </select>
                    </div>

                    <div>
                        <div class="section-label">Features</div>
                        <div class="features-container" id="featuresContainer">
                            <div class="empty-state">Select a project to view features</div>
                        </div>
                    </div>

                    <div class="prompt-container">
                        <div class="section-label">Prompt</div>
                        <textarea
                            class="prompt-textarea"
                            id="promptTextarea"
                            placeholder="Select a feature to view and edit its prompt..."
                        ></textarea>
                    </div>

                    <div class="button-container">
                        <button class="send-button" id="sendButton" onclick="executePrompt()" disabled>
                            Send to Claude Code
                        </button>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let currentFeatureName = '';
                    let selectedFeatureId = null;

                    // Send ready message
                    vscode.postMessage({ type: 'ready' });

                    function login() {
                        vscode.postMessage({ type: 'login' });
                    }

                    function logout() {
                        if (confirm('Are you sure you want to logout?')) {
                            vscode.postMessage({ type: 'logout' });
                        }
                    }

                    function refresh() {
                        vscode.postMessage({ type: 'refresh' });
                    }

                    function selectProject() {
                        const select = document.getElementById('projectSelect');
                        const projectId = select.value;

                        if (projectId) {
                            vscode.postMessage({
                                type: 'selectProject',
                                projectId: projectId
                            });
                        } else {
                            document.getElementById('featuresContainer').innerHTML =
                                '<div class="empty-state">Select a project to view features</div>';
                            document.getElementById('promptTextarea').value = '';
                            document.getElementById('sendButton').disabled = true;
                        }
                    }

                    function selectFeature(featureId) {
                        // Update UI selection
                        document.querySelectorAll('.feature-item').forEach(item => {
                            item.classList.remove('selected');
                        });

                        const selectedItem = document.getElementById('feature-' + featureId);
                        if (selectedItem) {
                            selectedItem.classList.add('selected');
                            selectedFeatureId = featureId;
                        }

                        // Request prompt from extension
                        vscode.postMessage({
                            type: 'selectFeature',
                            featureId: featureId
                        });
                    }

                    function executePrompt() {
                        const prompt = document.getElementById('promptTextarea').value.trim();
                        if (prompt) {
                            vscode.postMessage({
                                type: 'executePrompt',
                                prompt: prompt,
                                featureName: currentFeatureName
                            });
                        }
                    }

                    // Handle messages from extension
                    window.addEventListener('message', event => {
                        const message = event.data;

                        switch (message.type) {
                            case 'requireLogin':
                                document.getElementById('loginContainer').classList.add('active');
                                document.getElementById('mainContainer').classList.add('hidden');
                                break;

                            case 'updateProjects':
                                document.getElementById('loginContainer').classList.remove('active');
                                document.getElementById('mainContainer').classList.remove('hidden');

                                const select = document.getElementById('projectSelect');
                                select.innerHTML = '<option value="">Select a project...</option>';

                                message.projects.forEach(project => {
                                    const option = document.createElement('option');
                                    option.value = project.id;
                                    option.textContent = project.name;
                                    select.appendChild(option);
                                });
                                break;

                            case 'updateFeatures':
                                const container = document.getElementById('featuresContainer');

                                if (message.features.length === 0) {
                                    container.innerHTML = '<div class="empty-state">No features found for this project</div>';
                                } else {
                                    container.innerHTML = message.features.map(feature =>
                                        \`<div class="feature-item" id="feature-\${feature.id}" onclick="selectFeature('\${feature.id}')">
                                            \${feature.title}
                                        </div>\`
                                    ).join('');
                                }

                                // Clear prompt when new features load
                                document.getElementById('promptTextarea').value = '';
                                document.getElementById('sendButton').disabled = true;
                                selectedFeatureId = null;
                                break;

                            case 'showPrompt':
                                document.getElementById('promptTextarea').value = message.prompt;
                                document.getElementById('sendButton').disabled = false;
                                currentFeatureName = message.featureName;
                                break;
                        }
                    });

                    // Enable/disable send button based on prompt content
                    document.getElementById('promptTextarea').addEventListener('input', (e) => {
                        document.getElementById('sendButton').disabled =
                            !e.target.value.trim() || !selectedFeatureId;
                    });

                    // Add keyboard shortcut for send (Ctrl/Cmd + Enter)
                    document.getElementById('promptTextarea').addEventListener('keydown', (e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            if (!document.getElementById('sendButton').disabled) {
                                executePrompt();
                            }
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}