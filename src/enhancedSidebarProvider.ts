import * as vscode from 'vscode';
import { SupabaseService, Project, Feature } from './supabaseService';
import { PromptApiClient, InstructionTemplate, PromptTemplate } from './promptApiClient';
import { AuthService } from './authService';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export class EnhancedSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'supabaseFeatures.enhancedSidebar';

    private _view?: vscode.WebviewView;
    private supabaseService: SupabaseService;
    private promptApiClient: PromptApiClient;
    private authService: AuthService;

    // Feature tab data
    private projects: Project[] = [];
    private features: Feature[] = [];
    private currentProjectId?: string;

    // Prompt tab data
    private instructionTemplates: InstructionTemplate[] = [
        { id: '1', name: 'Default Improvement', content: 'Improve the grammar and clarity of the following prompt. Make it more professional and detailed.' },
        { id: '2', name: 'Technical Spec', content: 'Transform this into a detailed technical specification with acceptance criteria, architecture considerations, and testing requirements.' },
        { id: '3', name: 'User Story', content: 'Convert this into a user story format with clear acceptance criteria and definition of done.' }
    ];

    private promptTemplates: PromptTemplate[] = [];
    private chatMessages: ChatMessage[] = [];
    private currentInstruction?: InstructionTemplate;
    private currentPromptTemplate?: PromptTemplate;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext,
        authService: AuthService
    ) {
        this.supabaseService = SupabaseService.getInstance();
        this.promptApiClient = new PromptApiClient(context);
        this.authService = authService;
    }

    /**
     * Handle successful authentication
     */
    public async handleAuthSuccess(): Promise<void> {
        console.log('[EnhancedSidebarProvider] Handling auth success');

        // Set Supabase access token for API requests
        const session = this.authService.state.session;
        if (session && session.access_token) {
            this.promptApiClient.setSupabaseAccessToken(session.access_token);
            console.log('[EnhancedSidebarProvider] API client configured with Supabase token (from handleAuthSuccess)');
        }

        await this.initialize();
    }

    /**
     * Handle authentication required (logout or session expired)
     */
    public handleAuthRequired(): void {
        console.log('[EnhancedSidebarProvider] Auth required');
        this.projects = [];
        this.features = [];
        this.currentProjectId = undefined;

        if (this._view) {
            this._view.webview.postMessage({ type: 'requireLogin' });
        }
    }

    /**
     * Focus the login input field
     */
    public focusLoginInput(): void {
        if (this._view) {
            this._view.show(true); // true = preserve focus
            this._view.webview.postMessage({ type: 'focusLogin' });
        }
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
                // Common actions
                case 'ready':
                    await this.initialize();
                    break;
                case 'switchTab':
                    this.handleTabSwitch(data.tab);
                    break;

                // Feature tab actions
                case 'login':
                    await this.handleLogin(data.email, data.password);
                    break;
                case 'logout':
                    await this.handleLogout();
                    break;
                case 'selectProject':
                    await this.loadFeatures(data.projectId);
                    break;
                case 'selectPromptProject':
                    // Update current project and reload templates for this project
                    this.currentProjectId = data.projectId;
                    await this.loadPromptTemplates();
                    break;
                case 'selectFeature':
                    this.showFeaturePrompt(data.featureId);
                    break;
                case 'executePrompt':
                    await this.executePrompt(data.prompt, data.featureName);
                    break;

                // Prompt tab actions
                case 'selectInstruction':
                    this.selectInstruction(data.instructionId);
                    break;
                case 'selectPromptTemplate':
                    this.selectPromptTemplate(data.templateId);
                    break;
                case 'sendMessage':
                    await this.handleChatMessage(data.message);
                    break;
                case 'newChat':
                    this.startNewChat();
                    break;
                case 'addFeature':
                    await this.addFeatureFromPrompt(data.content);
                    break;
                case 'executeOnCode':
                    await this.executePromptOnCode(data.content);
                    break;
                case 'configureApiToken':
                    await this.configureApiToken();
                    break;
                case 'saveApiToken':
                    await this.saveApiToken(data.token);
                    break;
                case 'testApiToken':
                    await this.testApiConnection();
                    break;
            }
        });

        // Initialize on load
        this.initialize();
    }

    private async initialize() {
        console.log('[EnhancedSidebarProvider] Initializing...');

        // Check auth state from AuthService
        if (this.authService.isAuthenticated) {
            console.log('[EnhancedSidebarProvider] User is authenticated, loading projects');
            await this.loadProjects();
        } else {
            console.log('[EnhancedSidebarProvider] User not authenticated, showing login');
            // Show login state
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'requireLogin'
                });
            }
        }

        // Always load prompt templates (they work with or without login)
        await this.loadPromptTemplates();

        // Check if API token is configured and load API projects
        if (this.promptApiClient.hasApiToken()) {
            await this.loadApiProjects();
        } else {
            this.sendMessage('showApiTokenWarning', {});
        }
    }

    private handleTabSwitch(tab: string) {
        // Tab switching is handled in the UI
        // Could add analytics or state management here
    }

    private async handleLogin(email: string, password: string) {
        console.log('[EnhancedSidebarProvider] handleLogin called for:', email);

        // Show loading state
        if (this._view) {
            this._view.webview.postMessage({
                type: 'loginLoading',
                loading: true
            });
        }

        try {
            // Use AuthService to login
            const result = await this.authService.login(email, password);

            if (result.success && result.user) {
                console.log('[EnhancedSidebarProvider] Login successful');

                // Get Supabase access token and configure API client
                const session = this.authService.state.session;
                if (session && session.access_token) {
                    this.promptApiClient.setSupabaseAccessToken(session.access_token);
                    console.log('[EnhancedSidebarProvider] API client configured with Supabase token');
                }

                // Show success message
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'loginSuccess'
                    });
                }

                // Immediately load projects after successful login
                await this.loadProjects();
                await this.loadPromptTemplates();

                console.log('[EnhancedSidebarProvider] Projects loaded after login');
            }
        } catch (error: any) {
            console.error('[EnhancedSidebarProvider] Login error:', error);

            // Send error to webview
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'loginError',
                    error: error.userMessage || error.message || 'Login failed. Please try again.'
                });
            }
        } finally {
            // Hide loading state
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'loginLoading',
                    loading: false
                });
            }
        }
    }

    private async handleLogout() {
        console.log('[EnhancedSidebarProvider] handleLogout called');

        try {
            // Use AuthService to logout (handles session cleanup)
            await this.authService.logout();

            // Clear all local state
            this.projects = [];
            this.features = [];
            this.currentProjectId = undefined;
            this.chatMessages = [];
            this.currentInstruction = undefined;
            this.currentPromptTemplate = undefined;

            // Optionally clear API token (ask user)
            const clearApiToken = await vscode.window.showQuickPick(
                ['Yes', 'No'],
                {
                    placeHolder: 'Also clear AI API token?',
                    ignoreFocusOut: true
                }
            );

            if (clearApiToken === 'Yes') {
                await this.context.secrets.delete('prompt_api_token');
                this.promptApiClient = new PromptApiClient(this.context);
            }

            // Send message to webview to reset all UI state
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'resetAllState'
                });
            }

        } catch (error: any) {
            console.error('[EnhancedSidebarProvider] Logout error:', error);
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

    private async loadApiProjects() {
        try {
            // Try to load projects from the API as well
            const apiProjects = await this.promptApiClient.getProjects();

            // Merge with existing projects or use API projects
            if (apiProjects && apiProjects.length > 0) {
                // If we have API projects, merge them with Supabase projects
                // Remove duplicates based on project name
                const mergedProjects = [...this.projects];
                apiProjects.forEach(apiProject => {
                    if (!mergedProjects.find(p => p.name === apiProject.name)) {
                        mergedProjects.push(apiProject);
                    }
                });

                this.projects = mergedProjects;

                // Update the UI with merged projects
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'updateProjects',
                        projects: this.projects
                    });
                }
            }
        } catch (error: any) {
            console.log('Could not load API projects:', error.message);
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

        // Reload prompt templates for this specific project
        await this.loadPromptTemplates();
    }

    private async loadPromptTemplates() {
        console.log('[EnhancedSidebarProvider] Loading prompt templates...');

        // Load templates from API
        try {
            // Fetch instruction templates from API
            this.instructionTemplates = await this.promptApiClient.getInstructionTemplates();
            console.log('[EnhancedSidebarProvider] Instruction templates loaded:', this.instructionTemplates.length);

            // Fetch prompt templates from API (optionally filtered by project)
            this.promptTemplates = await this.promptApiClient.getPromptTemplates(this.currentProjectId);
            console.log('[EnhancedSidebarProvider] Prompt templates loaded:', this.promptTemplates.length);

            // Send templates to webview
            this.sendMessage('updatePromptTemplates', { templates: this.promptTemplates });
            this.sendMessage('updateInstructionTemplates', { templates: this.instructionTemplates });
            console.log('[EnhancedSidebarProvider] Templates sent to webview');
        } catch (error: any) {
            console.error('[EnhancedSidebarProvider] Failed to load templates from API:', error.message);

            // Show error to user - don't hide API issues with fallbacks
            const errorMessage = error.message || 'Unable to connect to API server';

            vscode.window.showErrorMessage(
                `Failed to load templates: ${errorMessage}. Please check your API configuration in settings.`,
                'Open Settings',
                'Dismiss'
            ).then(action => {
                if (action === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'supabaseFeatures');
                }
            });

            // Send empty templates to clear dropdowns
            this.instructionTemplates = [];
            this.promptTemplates = [];

            this.sendMessage('updatePromptTemplates', { templates: [] });
            this.sendMessage('updateInstructionTemplates', { templates: [] });

            // Show API configuration error in UI
            this.sendMessage('showApiError', {
                message: 'API server unreachable. Configure API settings or check your connection.'
            });
        }
    }

    private showFeaturePrompt(featureId: string) {
        const feature = this.features.find(f => f.id === featureId);
        if (feature && this._view) {
            this._view.webview.postMessage({
                type: 'showPrompt',
                prompt: feature.description,
                featureName: feature.title
            });
        }
    }

    private selectInstruction(instructionId: string) {
        this.currentInstruction = this.instructionTemplates.find(t => t.id === instructionId);
        this.sendMessage('instructionSelected', { instruction: this.currentInstruction });
    }

    private selectPromptTemplate(templateId: string) {
        this.currentPromptTemplate = this.promptTemplates.find(t => t.id === templateId);
        this.sendMessage('promptTemplateSelected', { template: this.currentPromptTemplate });
    }

    private async handleChatMessage(message: string) {
        // Add user message
        const userMessage: ChatMessage = {
            role: 'user',
            content: message,
            timestamp: new Date()
        };
        this.chatMessages.push(userMessage);
        this.sendMessage('addChatMessage', { message: userMessage });

        // Process with API (Supabase token is automatically set after login)
        try {
            const instruction = this.currentInstruction?.content ||
                'Improve the grammar and clarity of the following prompt. Make it more professional and detailed.';

            console.log('[EnhancedSidebarProvider] Improving prompt with instruction:', instruction);

            const response = await this.promptApiClient.improvePrompt(
                message,
                this.currentProjectId,
                instruction,
                true
            );

            console.log('[EnhancedSidebarProvider] Prompt improvement response:', response);

            if (response.success && response.data) {
                const assistantMessage: ChatMessage = {
                    role: 'assistant',
                    content: response.data.output_text,
                    timestamp: new Date()
                };
                this.chatMessages.push(assistantMessage);
                this.sendMessage('addChatMessage', { message: assistantMessage });
                this.sendMessage('updateCurrentOutput', { output: response.data.output_text });

                // Notify about auto-created features
                if (response.data.features_created && response.data.features_created > 0) {
                    vscode.window.showInformationMessage(
                        `Prompt improved! ${response.data.features_created} feature(s) automatically created.`
                    );

                    // Reload features for current project to show new ones
                    if (this.currentProjectId) {
                        await this.loadFeatures(this.currentProjectId);
                    }
                } else {
                    vscode.window.showInformationMessage('Prompt improved successfully!');
                }
            } else {
                const errorMsg = response.error || response.message || 'Unknown error';
                console.error('[EnhancedSidebarProvider] Prompt improvement failed:', errorMsg);
                vscode.window.showErrorMessage(`Failed to improve prompt: ${errorMsg}`);

                // Add error message to chat
                const errorMessage: ChatMessage = {
                    role: 'assistant',
                    content: `❌ Error: ${errorMsg}`,
                    timestamp: new Date()
                };
                this.chatMessages.push(errorMessage);
                this.sendMessage('addChatMessage', { message: errorMessage });
            }
        } catch (error: any) {
            const errorMsg = error.message || 'Unknown error occurred';
            console.error('[EnhancedSidebarProvider] Exception during prompt improvement:', error);
            vscode.window.showErrorMessage(`Failed to improve prompt: ${errorMsg}`);

            // Add error message to chat
            const errorMessage: ChatMessage = {
                role: 'assistant',
                content: `❌ Error: ${errorMsg}. Check console for details.`,
                timestamp: new Date()
            };
            this.chatMessages.push(errorMessage);
            this.sendMessage('addChatMessage', { message: errorMessage });
        }
    }

    private startNewChat() {
        this.chatMessages = [];
        this.sendMessage('clearChat', {});
        this.sendMessage('updateCurrentOutput', { output: '' });
    }

    private async addFeatureFromPrompt(content: string) {
        if (!this.currentProjectId) {
            vscode.window.showErrorMessage('Please select a project first');
            return;
        }

        if (!content || content.trim().length === 0) {
            vscode.window.showErrorMessage('No content to add as feature');
            return;
        }

        try {
            // Ask user for feature title
            const title = await vscode.window.showInputBox({
                prompt: 'Enter a title for this feature',
                placeHolder: 'e.g., User Authentication System',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Title cannot be empty';
                    }
                    return null;
                }
            });

            if (!title) {
                return; // User cancelled
            }

            // Copy feature to clipboard (RLS prevents direct insert)
            const featureText = `Title: ${title}\n\nDescription:\n${content}`;
            await vscode.env.clipboard.writeText(featureText);

            vscode.window.showInformationMessage(
                `Feature content copied to clipboard! Features are automatically created when you improve prompts.`,
                'OK'
            );

        } catch (error: any) {
            console.error('[EnhancedSidebarProvider] Exception adding feature:', error);
            vscode.window.showErrorMessage(`Failed to add feature: ${error.message}`);
        }
    }

    private async executePromptOnCode(content: string) {
        await this.executePrompt(content, 'Prompt Execution');
    }

    private async executePrompt(prompt: string, featureName: string) {
        const outputChannel = vscode.window.createOutputChannel('Feature Execution');
        outputChannel.show();
        outputChannel.appendLine(`=== Executing: ${featureName} ===`);
        outputChannel.appendLine(`Prompt: ${prompt}`);
        outputChannel.appendLine('');
        outputChannel.appendLine('Sending to Claude Code...');

        try {
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

                vscode.window.showInformationMessage(`"${featureName}" executed successfully!`);
            } else {
                outputChannel.appendLine('\nClaude Code CLI not found.');
                outputChannel.appendLine('Please execute the following prompt manually:');
                outputChannel.appendLine('\n---');
                outputChannel.appendLine(prompt);
                outputChannel.appendLine('---');

                await vscode.env.clipboard.writeText(prompt);
                vscode.window.showInformationMessage(
                    `Prompt copied to clipboard! Please paste it in Claude Code.`,
                    'OK'
                );
            }
        } catch (error: any) {
            outputChannel.appendLine(`\nError: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to execute: ${error.message}`);
        }
    }

    private async configureApiToken() {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter your Requirements Management API token',
            placeHolder: 'rqm_your_token_here',
            password: true,
            validateInput: (value) => {
                if (!value.startsWith('rqm_')) {
                    return 'Token should start with "rqm_"';
                }
                return null;
            }
        });

        if (token) {
            await this.promptApiClient.setApiToken(token);
            vscode.window.showInformationMessage('API token configured successfully');
            this.sendMessage('apiTokenConfigured', {});

            // Load API projects and templates after token is configured
            await this.loadApiProjects();
            await this.loadPromptTemplates();
        }
    }

    private async saveApiToken(token: string) {
        console.log('[EnhancedSidebarProvider] Saving API token');

        try {
            // Validate token format
            if (!token.startsWith('rqm_')) {
                this.sendMessage('apiTokenTestResult', {
                    success: false,
                    message: 'Invalid token format. Token should start with "rqm_"'
                });
                return;
            }

            // Save token
            await this.promptApiClient.setApiToken(token);

            // Reload templates and projects with new token
            await this.loadPromptTemplates();
            await this.loadApiProjects();

            vscode.window.showInformationMessage('API token saved successfully');
            this.sendMessage('apiTokenSaved', { success: true });

            // Hide warning banner if shown
            this.sendMessage('hideApiWarning', {});

        } catch (error: any) {
            console.error('[EnhancedSidebarProvider] Error saving API token:', error);
            this.sendMessage('apiTokenTestResult', {
                success: false,
                message: 'Failed to save token: ' + error.message
            });
        }
    }

    private async testApiConnection() {
        console.log('[EnhancedSidebarProvider] Testing API connection');

        try {
            // Try to load templates to test connection
            const templates = await this.promptApiClient.getInstructionTemplates();

            if (templates && templates.length > 0) {
                this.sendMessage('apiTokenTestResult', {
                    success: true,
                    message: `✓ Connection successful! Found ${templates.length} instruction templates.`
                });
                vscode.window.showInformationMessage('API connection successful!');
            } else {
                this.sendMessage('apiTokenTestResult', {
                    success: false,
                    message: 'Connection successful but no templates found. Check API configuration.'
                });
            }
        } catch (error: any) {
            console.error('[EnhancedSidebarProvider] API connection test failed:', error);
            this.sendMessage('apiTokenTestResult', {
                success: false,
                message: 'Connection failed: ' + (error.message || 'Unknown error')
            });
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

    private sendMessage(type: string, data: any) {
        if (this._view) {
            this._view.webview.postMessage({ type, ...data });
        }
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
                <title>Supabase Features & Prompts</title>
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
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                        overflow: hidden;
                    }

                    /* Tabs */
                    .tabs-container {
                        display: flex;
                        background-color: var(--vscode-editor-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        flex-shrink: 0;
                    }

                    .tab {
                        flex: 1;
                        padding: 8px 6px;
                        text-align: center;
                        cursor: pointer;
                        background-color: var(--vscode-tab-inactiveBackground);
                        color: var(--vscode-tab-inactiveForeground);
                        border: none;
                        border-bottom: 2px solid transparent;
                        transition: all 0.2s;
                        font-size: 12px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }

                    .tab:hover {
                        background-color: var(--vscode-tab-hoverBackground);
                    }

                    .tab.active {
                        background-color: var(--vscode-tab-activeBackground);
                        color: var(--vscode-tab-activeForeground);
                        border-bottom-color: var(--vscode-focusBorder);
                    }

                    /* Tab panels */
                    .tab-panel {
                        display: none;
                        flex: 1;
                        padding: 8px;
                        overflow-y: auto;
                        overflow-x: hidden;
                        min-height: 0;
                    }

                    .tab-panel.active {
                        display: flex;
                        flex-direction: column;
                    }

                    /* Feature panel specific layout */
                    #featurePanel {
                        display: none;
                    }

                    #featurePanel.active {
                        display: flex;
                        flex-direction: column;
                        overflow: hidden;
                    }

                    .feature-section {
                        flex-shrink: 0;
                    }

                    .prompt-section {
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        min-height: 0;
                        overflow: hidden;
                    }

                    .prompt-section .section-label {
                        flex-shrink: 0;
                    }

                    #featurePromptTextarea {
                        flex: 1;
                        min-height: 200px;
                        max-height: none;
                        resize: none;
                        overflow-y: auto;
                    }

                    #executeFeatureButton {
                        flex-shrink: 0;
                    }

                    /* Prompt panel specific layout */
                    #promptPanel {
                        display: none;
                    }

                    #promptPanel.active {
                        display: flex;
                        flex-direction: column;
                        overflow: hidden;
                    }

                    .new-chat-button,
                    .warning-banner,
                    .prompt-control-section {
                        flex-shrink: 0;
                    }

                    /* Make Current Output section expand */
                    .output-section {
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        min-height: 0;
                        overflow: hidden;
                    }

                    .output-section .section-label {
                        flex-shrink: 0;
                    }

                    #currentOutputTextarea {
                        flex: 1;
                        min-height: 80px;
                        max-height: none;
                        resize: none;
                        overflow-y: auto;
                    }

                    /* Make Conversation section expand */
                    .conversation-section {
                        flex: 2;
                        display: flex;
                        flex-direction: column;
                        min-height: 0;
                        overflow: hidden;
                    }

                    .conversation-section .section-label {
                        flex-shrink: 0;
                    }

                    .chat-container {
                        flex: 1;
                        min-height: 100px;
                        max-height: none !important;
                        overflow-y: auto;
                    }

                    .message-input-container,
                    .button-row {
                        flex-shrink: 0;
                    }

                    /* Common styles */
                    .section-label {
                        font-size: 11px;
                        text-transform: uppercase;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 4px;
                        font-weight: 600;
                    }

                    select {
                        width: 100%;
                        padding: 5px 6px;
                        background-color: var(--vscode-dropdown-background);
                        color: var(--vscode-dropdown-foreground);
                        border: 1px solid var(--vscode-dropdown-border);
                        border-radius: 2px;
                        font-size: 12px;
                        cursor: pointer;
                        margin-bottom: 10px;
                    }

                    .features-container {
                        flex: 0 0 auto;
                        min-height: 80px;
                        max-height: 30vh;
                        overflow-y: auto;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 2px;
                        background-color: var(--vscode-editor-background);
                        margin-bottom: 10px;
                    }

                    .feature-item {
                        padding: 6px 8px;
                        cursor: pointer;
                        border-bottom: 1px solid var(--vscode-panel-border);
                        font-size: 12px;
                        transition: background-color 0.1s;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
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

                    textarea {
                        width: 100%;
                        padding: 8px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 2px;
                        font-family: var(--vscode-editor-font-family);
                        font-size: 12px;
                        resize: vertical;
                        min-height: 100px;
                        margin-bottom: 8px;
                    }

                    textarea:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        outline-offset: -1px;
                    }

                    button {
                        width: 100%;
                        padding: 6px 10px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 2px;
                        font-size: 12px;
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

                    button.primary {
                        background-color: #007ACC;
                        margin-bottom: 8px;
                    }

                    button.primary:hover:not(:disabled) {
                        background-color: #005a9e;
                    }

                    button.secondary {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }

                    .button-row {
                        display: flex;
                        gap: 8px;
                        flex-shrink: 0;
                    }

                    .button-row button {
                        flex: 1;
                    }

                    /* Chat styles */
                    .chat-container {
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 2px;
                        background-color: var(--vscode-editor-background);
                        margin-bottom: 8px;
                        padding: 8px;
                        overflow-y: auto;
                    }

                    .chat-message {
                        margin-bottom: 10px;
                        padding: 8px;
                        border-radius: 4px;
                    }

                    .chat-message.user {
                        background-color: var(--vscode-input-background);
                        margin-left: 20px;
                    }

                    .chat-message.assistant {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        margin-right: 20px;
                    }

                    .chat-role {
                        font-weight: bold;
                        font-size: 11px;
                        margin-bottom: 4px;
                        color: var(--vscode-descriptionForeground);
                    }

                    .message-input-container {
                        display: flex;
                        gap: 5px;
                        margin-bottom: 10px;
                    }

                    .message-input {
                        flex: 1;
                        padding: 6px 8px;
                    }

                    .send-button {
                        width: auto;
                        padding: 6px 15px;
                    }

                    .new-chat-button {
                        background-color: #d32f2f;
                        margin-bottom: 10px;
                    }

                    .new-chat-button:hover {
                        background-color: #c62828;
                    }

                    .empty-state {
                        padding: 20px;
                        text-align: center;
                        color: var(--vscode-descriptionForeground);
                        font-size: 12px;
                    }

                    .warning-banner {
                        padding: 8px;
                        background-color: var(--vscode-inputValidation-warningBackground);
                        border: 1px solid var(--vscode-inputValidation-warningBorder);
                        border-radius: 2px;
                        margin-bottom: 10px;
                        font-size: 12px;
                    }

                    .settings-section {
                        margin-bottom: 15px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 2px;
                        padding: 0;
                    }

                    .settings-header {
                        padding: 8px 12px;
                        background-color: var(--vscode-sideBar-background);
                        cursor: pointer;
                        user-select: none;
                        font-size: 12px;
                        font-weight: 500;
                        list-style: none;
                    }

                    .settings-header:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }

                    .settings-header::-webkit-details-marker {
                        display: none;
                    }

                    .settings-content {
                        padding: 12px;
                        background-color: var(--vscode-editor-background);
                    }

                    .input-with-button {
                        display: flex;
                        gap: 8px;
                        align-items: stretch;
                    }

                    .input-with-button input {
                        flex: 1;
                    }

                    .input-with-button button {
                        flex-shrink: 0;
                        min-width: 60px;
                    }

                    .status-message {
                        padding: 8px;
                        border-radius: 2px;
                        font-size: 12px;
                        margin-top: 10px;
                    }

                    .status-message.success {
                        background-color: var(--vscode-testing-iconPassed);
                        color: var(--vscode-editor-background);
                    }

                    .status-message.error {
                        background-color: var(--vscode-inputValidation-errorBackground);
                        border: 1px solid var(--vscode-inputValidation-errorBorder);
                        color: var(--vscode-inputValidation-errorForeground);
                    }

                    .login-container {
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        height: 100%;
                        padding: 20px;
                        max-width: 400px;
                        margin: 0 auto;
                    }

                    .login-container.hidden {
                        display: none !important;
                    }

                    #loginForm {
                        width: 100%;
                    }

                    .form-group {
                        margin-bottom: 15px;
                        text-align: left;
                        width: 100%;
                    }

                    .form-group label {
                        display: block;
                        margin-bottom: 5px;
                        font-weight: 500;
                        color: var(--vscode-foreground);
                        font-size: 12px;
                    }

                    .form-group input {
                        width: 100%;
                        padding: 8px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 2px;
                        font-size: 13px;
                        box-sizing: border-box;
                    }

                    .form-group input:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        outline-offset: -1px;
                    }

                    .error-message {
                        background-color: var(--vscode-inputValidation-errorBackground);
                        border: 1px solid var(--vscode-inputValidation-errorBorder);
                        color: var(--vscode-inputValidation-errorForeground);
                        padding: 8px;
                        margin-bottom: 15px;
                        border-radius: 2px;
                        font-size: 12px;
                        text-align: left;
                    }

                    .help-text {
                        text-align: center;
                        font-size: 11px;
                        color: var(--vscode-descriptionForeground);
                        line-height: 1.4;
                    }

                    #loginButton {
                        width: 100%;
                        position: relative;
                        padding: 10px;
                    }

                    #loginButton .spinner {
                        margin-left: 8px;
                    }

                    #loginButton:disabled {
                        opacity: 0.6;
                        cursor: not-allowed;
                    }

                    .main-container {
                        display: none;
                        flex-direction: column;
                        height: 100%;
                    }

                    .main-container.active {
                        display: flex;
                    }

                    /* Make chat messages responsive */
                    .chat-content {
                        font-size: 12px;
                        line-height: 1.4;
                        word-wrap: break-word;
                        overflow-wrap: break-word;
                    }

                    /* Responsive text areas and inputs */
                    .output-area {
                        background-color: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 2px;
                        padding: 8px;
                        margin-bottom: 10px;
                        font-family: var(--vscode-editor-font-family);
                        font-size: 11px;
                        min-height: 60px;
                        max-height: 25vh;
                        overflow-y: auto;
                        word-wrap: break-word;
                        overflow-wrap: break-word;
                    }

                    /* Responsive layout for narrow sidebars */
                    @media (max-width: 350px) {
                        .tab {
                            padding: 6px 4px;
                            font-size: 11px;
                        }

                        .button-row {
                            flex-direction: column;
                        }

                        .button-row button {
                            margin-bottom: 4px;
                        }

                        .chat-message.user,
                        .chat-message.assistant {
                            margin-left: 8px;
                            margin-right: 8px;
                        }

                        .section-label {
                            font-size: 10px;
                        }

                        select, button, textarea, input {
                            font-size: 11px;
                        }
                    }

                    /* Handle very tall viewports */
                    @media (min-height: 800px) {
                        .features-container {
                            max-height: 40vh;
                        }

                        textarea:not(#featurePromptTextarea) {
                            min-height: 150px;
                        }

                        .chat-container {
                            max-height: 45vh;
                        }

                        .output-area {
                            max-height: 35vh;
                        }
                    }

                    /* Handle very short viewports */
                    @media (max-height: 400px) {
                        .features-container {
                            max-height: 25vh;
                        }

                        textarea:not(#featurePromptTextarea) {
                            min-height: 60px;
                            max-height: 30vh;
                        }

                        #featurePromptTextarea {
                            min-height: 100px;
                        }

                        .chat-container {
                            min-height: 60px;
                            max-height: 25vh;
                        }

                        .output-area {
                            min-height: 40px;
                            max-height: 20vh;
                        }
                    }

                    /* Scrollbar styling */
                    ::-webkit-scrollbar {
                        width: 6px;
                        height: 6px;
                    }

                    ::-webkit-scrollbar-track {
                        background: var(--vscode-scrollbarSlider-background);
                    }

                    ::-webkit-scrollbar-thumb {
                        background: var(--vscode-scrollbarSlider-hoverBackground);
                        border-radius: 3px;
                    }

                    ::-webkit-scrollbar-thumb:hover {
                        background: var(--vscode-scrollbarSlider-activeBackground);
                    }

                    /* Ensure content doesn't overflow horizontally */
                    * {
                        max-width: 100%;
                    }

                    pre, code {
                        overflow-x: auto;
                        white-space: pre-wrap;
                        word-wrap: break-word;
                    }
                </style>
            </head>
            <body>
                <div class="login-container" id="loginContainer">
                    <h3 style="margin-top: 0; margin-bottom: 20px;">Login to Supabase</h3>

                    <form id="loginForm">
                        <div class="form-group">
                            <label for="emailInput">Email</label>
                            <input
                                type="email"
                                id="emailInput"
                                placeholder="your.email@example.com"
                                required
                                autocomplete="email"
                            />
                        </div>

                        <div class="form-group">
                            <label for="passwordInput">Password</label>
                            <input
                                type="password"
                                id="passwordInput"
                                placeholder="Enter your password"
                                required
                                autocomplete="current-password"
                            />
                        </div>

                        <div id="loginError" class="error-message" style="display: none;"></div>

                        <button type="submit" id="loginButton" class="primary">
                            <span class="button-text">Login</span>
                            <span class="spinner" style="display: none;">⏳</span>
                        </button>
                    </form>

                    <p class="help-text" style="margin-top: 15px; font-size: 11px; color: var(--vscode-descriptionForeground);">
                        Your credentials are stored securely using VS Code's encrypted storage.
                    </p>
                </div>

                <div class="main-container hidden" id="mainContainer">
                    <!-- Tab buttons -->
                    <div class="tabs-container">
                        <button class="tab active" id="featureTab">Feature</button>
                        <button class="tab" id="promptTab">Prompt</button>
                    </div>

                    <!-- Feature Tab -->
                    <div class="tab-panel active" id="featurePanel">
                        <div class="feature-section">
                            <div class="section-label">Project</div>
                            <select id="projectSelect">
                                <option value="">Select a project...</option>
                            </select>
                        </div>

                        <div class="feature-section">
                            <div class="section-label">Features</div>
                            <div class="features-container" id="featuresContainer">
                                <div class="empty-state">Select a project to view features</div>
                            </div>
                        </div>

                        <div class="prompt-section">
                            <div class="section-label">Prompt</div>
                            <textarea
                                id="featurePromptTextarea"
                                placeholder="Select a feature to view and edit its prompt..."
                            ></textarea>
                        </div>

                        <button class="primary" id="executeFeatureButton" disabled>
                            Execute on code
                        </button>
                    </div>

                    <!-- Prompt Tab -->
                    <div class="tab-panel" id="promptPanel">
                        <button class="new-chat-button" id="newChatButton">New chat</button>

                        <div id="apiWarning" class="warning-banner" style="display: none;">
                            ⚠️ API token not configured. <a href="#" id="configureApiLink">Configure now</a>
                        </div>

                        <details class="settings-section">
                            <summary class="settings-header">⚙️ API Settings</summary>
                            <div class="settings-content">
                                <div class="form-group">
                                    <label for="apiTokenInput">Requirements Management API Token</label>
                                    <div class="input-with-button">
                                        <input
                                            type="password"
                                            id="apiTokenInput"
                                            placeholder="rqm_your_token_here"
                                            autocomplete="off"
                                        />
                                        <button type="button" id="saveApiTokenButton" class="secondary">Save</button>
                                    </div>
                                    <p class="help-text" style="margin-top: 5px; font-size: 10px;">
                                        Token (format: rqm_...) is required for AI prompt improvements via /v1/prompts/improve endpoint.
                                        Stored securely in VS Code secrets.
                                    </p>
                                </div>
                                <div class="form-group">
                                    <button type="button" id="testApiTokenButton" class="secondary" style="width: 100%;">
                                        Test API Connection
                                    </button>
                                </div>
                                <div id="apiTokenStatus" class="status-message" style="display: none;"></div>
                            </div>
                        </details>

                        <div class="prompt-control-section">
                            <div class="section-label">Project</div>
                            <select id="promptProjectSelect">
                                <option value="">Select a project...</option>
                            </select>
                        </div>

                        <div class="prompt-control-section">
                            <div class="section-label">Instruction</div>
                            <select id="instructionSelect">
                                <option value="">Select instruction template...</option>
                            </select>
                        </div>

                        <div class="prompt-control-section">
                            <div class="section-label">Prompt Template</div>
                            <select id="promptTemplateSelect">
                                <option value="">Select prompt template...</option>
                            </select>
                        </div>

                        <div class="output-section">
                            <div class="section-label">Current output</div>
                            <textarea
                                id="currentOutputTextarea"
                                placeholder="AI-improved prompt will appear here..."
                                readonly
                            ></textarea>
                        </div>

                        <div class="conversation-section">
                            <div class="section-label">Conversation</div>
                            <div class="chat-container" id="chatContainer">
                                <div class="empty-state">Start a new conversation...</div>
                            </div>
                        </div>

                        <div class="message-input-container">
                            <input
                                type="text"
                                id="messageInput"
                                class="message-input"
                                placeholder="Type your message..."
                            />
                            <button class="send-button primary" id="sendButton">Send</button>
                        </div>

                        <div class="button-row">
                            <button class="secondary" id="addFeatureButton">+ Add feature</button>
                            <button class="primary" id="executeOnCodeButton">Execute on code</button>
                        </div>
                    </div>
                </div>

                <script>
                    console.log('Webview script starting...');
                    const vscode = acquireVsCodeApi();
                    console.log('VS Code API acquired:', vscode);
                    let currentTab = 'feature';
                    let selectedFeatureId = null;
                    let currentFeatureName = '';

                    // Setup event listeners immediately (no DOMContentLoaded needed in webviews)
                    function setupEventListeners() {
                        console.log('Setting up event listeners...');

                        // Attach event listeners to buttons
                        // Login form submission
                        const loginForm = document.getElementById('loginForm');
                        if (loginForm) {
                            loginForm.addEventListener('submit', (e) => {
                                e.preventDefault();
                                console.log('[Webview] Login form submitted');

                                const emailInput = document.getElementById('emailInput');
                                const passwordInput = document.getElementById('passwordInput');

                                if (emailInput && passwordInput) {
                                    const email = emailInput.value.trim();
                                    const password = passwordInput.value;

                                    if (email && password) {
                                        login(email, password);
                                    }
                                }
                            });
                            console.log('[Webview] Login form listener attached');
                        } else {
                            console.error('[Webview] Login form not found!');
                        }

                        const featureTabBtn = document.getElementById('featureTab');
                        if (featureTabBtn) {
                            featureTabBtn.addEventListener('click', () => switchTab('feature'));
                        }

                        const promptTabBtn = document.getElementById('promptTab');
                        if (promptTabBtn) {
                            promptTabBtn.addEventListener('click', () => switchTab('prompt'));
                        }

                        const executeBtn = document.getElementById('executeFeatureButton');
                        if (executeBtn) {
                            executeBtn.addEventListener('click', () => executeFeaturePrompt());
                        }

                        const projectSelectEl = document.getElementById('projectSelect');
                        if (projectSelectEl) {
                            projectSelectEl.addEventListener('change', () => selectProject());
                        }

                        const promptProjectSelect = document.getElementById('promptProjectSelect');
                        if (promptProjectSelect) {
                            promptProjectSelect.addEventListener('change', () => selectPromptProject());
                        }

                        const instructionSelect = document.getElementById('instructionSelect');
                        if (instructionSelect) {
                            instructionSelect.addEventListener('change', () => selectInstruction());
                        }

                        const promptTemplateSelect = document.getElementById('promptTemplateSelect');
                        if (promptTemplateSelect) {
                            promptTemplateSelect.addEventListener('change', () => selectPromptTemplate());
                        }

                        const sendBtn = document.getElementById('sendButton');
                        if (sendBtn) {
                            sendBtn.addEventListener('click', () => sendMessage());
                        }

                        const addFeatureBtn = document.getElementById('addFeatureButton');
                        if (addFeatureBtn) {
                            addFeatureBtn.addEventListener('click', () => addFeature());
                        }

                        const executeOnCodeBtn = document.getElementById('executeOnCodeButton');
                        if (executeOnCodeBtn) {
                            executeOnCodeBtn.addEventListener('click', () => executeOnCode());
                        }

                        const newChatBtn = document.getElementById('newChatButton');
                        if (newChatBtn) {
                            newChatBtn.addEventListener('click', () => newChat());
                        }

                        const configureApiLink = document.getElementById('configureApiLink');
                        if (configureApiLink) {
                            configureApiLink.addEventListener('click', (e) => {
                                e.preventDefault();
                                const settingsSection = document.querySelector('.settings-section');
                                if (settingsSection) {
                                    settingsSection.open = true;
                                    document.getElementById('apiTokenInput')?.focus();
                                }
                            });
                        }

                        const saveApiTokenBtn = document.getElementById('saveApiTokenButton');
                        if (saveApiTokenBtn) {
                            saveApiTokenBtn.addEventListener('click', () => saveApiToken());
                        }

                        const testApiTokenBtn = document.getElementById('testApiTokenButton');
                        if (testApiTokenBtn) {
                            testApiTokenBtn.addEventListener('click', () => testApiToken());
                        }

                        const messageInput = document.getElementById('messageInput');
                        if (messageInput) {
                            messageInput.addEventListener('keypress', (e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    sendMessage();
                                }
                            });
                        }

                        console.log('Event listeners attached');
                    }

                    // Call setup after a tiny delay to ensure DOM is ready
                    setTimeout(setupEventListeners, 0);

                    // Send ready message
                    console.log('Sending ready message...');
                    vscode.postMessage({ type: 'ready' });
                    console.log('Ready message sent');

                    function switchTab(tab) {
                        currentTab = tab;

                        // Update tab buttons
                        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                        document.getElementById(tab + 'Tab').classList.add('active');

                        // Update panels
                        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                        document.getElementById(tab + 'Panel').classList.add('active');

                        vscode.postMessage({ type: 'switchTab', tab });
                    }

                    // Feature tab functions
                    function login(email, password) {
                        console.log('[Webview] Login function called for:', email);

                        // Clear any previous errors
                        const errorDiv = document.getElementById('loginError');
                        if (errorDiv) {
                            errorDiv.style.display = 'none';
                            errorDiv.textContent = '';
                        }

                        // Send login message with credentials
                        vscode.postMessage({
                            type: 'login',
                            email: email,
                            password: password
                        });
                        console.log('[Webview] Login message sent');
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
                            document.getElementById('featurePromptTextarea').value = '';
                            document.getElementById('executeFeatureButton').disabled = true;
                        }
                    }

                    function selectFeature(featureId) {
                        document.querySelectorAll('.feature-item').forEach(item => {
                            item.classList.remove('selected');
                        });

                        const selectedItem = document.getElementById('feature-' + featureId);
                        if (selectedItem) {
                            selectedItem.classList.add('selected');
                            selectedFeatureId = featureId;
                        }

                        vscode.postMessage({
                            type: 'selectFeature',
                            featureId: featureId
                        });
                    }

                    function executeFeaturePrompt() {
                        const prompt = document.getElementById('featurePromptTextarea').value.trim();
                        if (prompt) {
                            vscode.postMessage({
                                type: 'executePrompt',
                                prompt: prompt,
                                featureName: currentFeatureName
                            });
                        }
                    }

                    // Prompt tab functions
                    function newChat() {
                        vscode.postMessage({ type: 'newChat' });
                    }

                    function saveApiToken() {
                        const input = document.getElementById('apiTokenInput');
                        const statusDiv = document.getElementById('apiTokenStatus');

                        if (input && input.value.trim()) {
                            console.log('[Webview] Saving API token');

                            vscode.postMessage({
                                type: 'saveApiToken',
                                token: input.value.trim()
                            });

                            // Show success message
                            if (statusDiv) {
                                statusDiv.textContent = '✓ API token saved successfully';
                                statusDiv.className = 'status-message success';
                                statusDiv.style.display = 'block';

                                // Hide after 3 seconds
                                setTimeout(() => {
                                    statusDiv.style.display = 'none';
                                }, 3000);
                            }

                            // Clear input for security
                            input.value = '';
                        }
                    }

                    function testApiToken() {
                        console.log('[Webview] Testing API token');

                        const statusDiv = document.getElementById('apiTokenStatus');
                        if (statusDiv) {
                            statusDiv.textContent = 'Testing API connection...';
                            statusDiv.className = 'status-message';
                            statusDiv.style.display = 'block';
                        }

                        vscode.postMessage({ type: 'testApiToken' });
                    }

                    function configureApiToken() {
                        // Open settings section
                        const settingsSection = document.querySelector('.settings-section');
                        if (settingsSection) {
                            settingsSection.open = true;
                            document.getElementById('apiTokenInput')?.focus();
                        }
                        return false; // Prevent link navigation
                    }

                    function selectPromptProject() {
                        const select = document.getElementById('promptProjectSelect');
                        const projectId = select.value;
                        if (projectId) {
                            vscode.postMessage({
                                type: 'selectPromptProject',
                                projectId: projectId
                            });
                        }
                    }

                    function selectInstruction() {
                        const select = document.getElementById('instructionSelect');
                        const instructionId = select.value;
                        if (instructionId) {
                            vscode.postMessage({
                                type: 'selectInstruction',
                                instructionId: instructionId
                            });
                        }
                    }

                    function selectPromptTemplate() {
                        const select = document.getElementById('promptTemplateSelect');
                        const templateId = select.value;
                        if (templateId) {
                            vscode.postMessage({
                                type: 'selectPromptTemplate',
                                templateId: templateId
                            });
                        }
                    }

                    function sendMessage() {
                        const input = document.getElementById('messageInput');
                        const message = input.value.trim();
                        if (message) {
                            vscode.postMessage({
                                type: 'sendMessage',
                                message: message
                            });
                            input.value = '';
                        }
                    }

                    function handleMessageKeypress(event) {
                        if (event.key === 'Enter') {
                            sendMessage();
                        }
                    }

                    function addFeature() {
                        const output = document.getElementById('currentOutputTextarea').value.trim();
                        if (output) {
                            vscode.postMessage({
                                type: 'addFeature',
                                content: output
                            });
                        }
                    }

                    function executeOnCode() {
                        const output = document.getElementById('currentOutputTextarea').value.trim();
                        if (output) {
                            vscode.postMessage({
                                type: 'executeOnCode',
                                content: output
                            });
                        }
                    }

                    // Handle messages from extension
                    window.addEventListener('message', event => {
                        const message = event.data;

                        switch (message.type) {
                            case 'requireLogin':
                                const loginCont = document.getElementById('loginContainer');
                                const mainCont = document.getElementById('mainContainer');

                                if (loginCont) {
                                    loginCont.classList.remove('hidden');
                                    console.log('[Webview] Login container shown');
                                }

                                if (mainCont) {
                                    mainCont.classList.remove('active');
                                    mainCont.classList.add('hidden');
                                    console.log('[Webview] Main container hidden');
                                }
                                break;

                            case 'loginLoading':
                                const loginBtn = document.getElementById('loginButton');
                                const spinner = loginBtn?.querySelector('.spinner');
                                const buttonText = loginBtn?.querySelector('.button-text');

                                if (message.loading) {
                                    loginBtn.disabled = true;
                                    if (spinner) spinner.style.display = 'inline';
                                    if (buttonText) buttonText.textContent = 'Logging in...';
                                } else {
                                    loginBtn.disabled = false;
                                    if (spinner) spinner.style.display = 'none';
                                    if (buttonText) buttonText.textContent = 'Login';
                                }
                                break;

                            case 'loginError':
                                const errorDiv = document.getElementById('loginError');
                                if (errorDiv) {
                                    errorDiv.textContent = message.error;
                                    errorDiv.style.display = 'block';
                                }
                                break;

                            case 'loginSuccess':
                                // Clear form
                                const emailInput = document.getElementById('emailInput');
                                const passwordInput = document.getElementById('passwordInput');
                                if (emailInput) emailInput.value = '';
                                if (passwordInput) passwordInput.value = '';

                                // Hide error if shown
                                const errorMsg = document.getElementById('loginError');
                                if (errorMsg) errorMsg.style.display = 'none';
                                break;

                            case 'resetAllState':
                                // Clear all form inputs
                                document.querySelectorAll('input, textarea').forEach(input => {
                                    if (input.type !== 'submit') {
                                        input.value = '';
                                    }
                                });

                                // Reset dropdowns
                                document.querySelectorAll('select').forEach(select => {
                                    select.selectedIndex = 0;
                                });

                                // Clear chat messages
                                const chatContainer = document.getElementById('chatMessages');
                                if (chatContainer) {
                                    chatContainer.innerHTML = '';
                                }

                                // Clear output
                                const outputArea = document.getElementById('currentOutputTextarea');
                                if (outputArea) {
                                    outputArea.value = '';
                                }

                                // Show login screen
                                const resetLoginContainer = document.getElementById('loginContainer');
                                const resetMainContainer = document.getElementById('mainContainer');

                                if (resetLoginContainer) {
                                    resetLoginContainer.classList.remove('hidden');
                                }

                                if (resetMainContainer) {
                                    resetMainContainer.classList.remove('active');
                                    resetMainContainer.classList.add('hidden');
                                }
                                break;

                            case 'focusLogin':
                                const emailField = document.getElementById('emailInput');
                                if (emailField) {
                                    emailField.focus();
                                }
                                break;

                            case 'updateProjects':
                                console.log('[Webview] updateProjects received:', {
                                    projectCount: message.projects?.length,
                                    projects: message.projects
                                });

                                const loginContainer = document.getElementById('loginContainer');
                                const mainContainer = document.getElementById('mainContainer');

                                console.log('[Webview] Containers found:', {
                                    loginContainer: !!loginContainer,
                                    mainContainer: !!mainContainer
                                });

                                if (loginContainer) {
                                    loginContainer.classList.add('hidden');
                                    console.log('[Webview] Login container hidden');
                                }

                                if (mainContainer) {
                                    mainContainer.classList.remove('hidden'); // Remove hidden class
                                    mainContainer.classList.add('active');    // Add active class
                                    console.log('[Webview] Main container shown (removed hidden, added active)');
                                }

                                // Update both project dropdowns
                                const featureSelect = document.getElementById('projectSelect');
                                const promptProjectSelect = document.getElementById('promptProjectSelect');

                                if (featureSelect && promptProjectSelect) {
                                    featureSelect.innerHTML = '<option value="">Select a project...</option>';
                                    promptProjectSelect.innerHTML = '<option value="">Select a project...</option>';

                                    message.projects.forEach(project => {
                                        // Add to Feature tab dropdown
                                        const featureOption = document.createElement('option');
                                        featureOption.value = project.id;
                                        featureOption.textContent = project.name;
                                        featureSelect.appendChild(featureOption);

                                        // Add to Prompt tab dropdown
                                        const promptOption = document.createElement('option');
                                        promptOption.value = project.id;
                                        promptOption.textContent = project.name;
                                        promptProjectSelect.appendChild(promptOption);
                                    });

                                    console.log('[Webview] Project dropdowns updated with', message.projects.length, 'projects');
                                } else {
                                    console.error('[Webview] Project dropdowns not found!', {
                                        featureSelect: !!featureSelect,
                                        promptProjectSelect: !!promptProjectSelect
                                    });
                                }
                                break;

                            case 'updateFeatures':
                                const container = document.getElementById('featuresContainer');

                                if (message.features.length === 0) {
                                    container.innerHTML = '<div class="empty-state">No features found for this project</div>';
                                } else {
                                    container.innerHTML = message.features.map(feature =>
                                        \`<div class="feature-item" id="feature-\${feature.id}" data-feature-id="\${feature.id}">
                                            \${feature.title}
                                        </div>\`
                                    ).join('');

                                    // Attach click handlers to feature items
                                    container.querySelectorAll('.feature-item').forEach(item => {
                                        item.addEventListener('click', () => {
                                            const featureId = item.getAttribute('data-feature-id');
                                            selectFeature(featureId);
                                        });
                                    });
                                }

                                document.getElementById('featurePromptTextarea').value = '';
                                document.getElementById('executeFeatureButton').disabled = true;
                                selectedFeatureId = null;
                                break;

                            case 'showPrompt':
                                document.getElementById('featurePromptTextarea').value = message.prompt;
                                document.getElementById('executeFeatureButton').disabled = false;
                                currentFeatureName = message.featureName;
                                break;

                            case 'updateInstructionTemplates':
                                console.log('[Webview] updateInstructionTemplates received:', message.templates?.length, 'templates');
                                const instructionSelect = document.getElementById('instructionSelect');

                                if (instructionSelect) {
                                    instructionSelect.innerHTML = '<option value="">Select instruction template...</option>';
                                    message.templates.forEach(template => {
                                        const option = document.createElement('option');
                                        option.value = template.id;
                                        option.textContent = template.name;
                                        instructionSelect.appendChild(option);
                                    });
                                    console.log('[Webview] Instruction templates populated:', message.templates.length);
                                } else {
                                    console.error('[Webview] instructionSelect element not found!');
                                }
                                break;

                            case 'updatePromptTemplates':
                                console.log('[Webview] updatePromptTemplates received:', message.templates?.length, 'templates');
                                const promptSelect = document.getElementById('promptTemplateSelect');

                                if (promptSelect) {
                                    promptSelect.innerHTML = '<option value="">Select prompt template...</option>';
                                    message.templates.forEach(template => {
                                        const option = document.createElement('option');
                                        option.value = template.id;
                                        option.textContent = template.name;
                                        promptSelect.appendChild(option);
                                    });
                                    console.log('[Webview] Prompt templates populated:', message.templates.length);
                                } else {
                                    console.error('[Webview] promptTemplateSelect element not found!');
                                }
                                break;

                            case 'promptTemplateSelected':
                                if (message.template) {
                                    document.getElementById('messageInput').value = message.template.template_content;
                                }
                                break;

                            case 'addChatMessage':
                                const chatContainerEl = document.getElementById('chatContainer');
                                if (chatContainerEl && chatContainerEl.querySelector('.empty-state')) {
                                    chatContainerEl.innerHTML = '';
                                }

                                const msgDiv = document.createElement('div');
                                msgDiv.className = 'chat-message ' + message.message.role;
                                msgDiv.innerHTML = \`
                                    <div class="chat-role">\${message.message.role === 'user' ? 'You' : 'Assistant'}</div>
                                    <div>\${message.message.content}</div>
                                \`;
                                if (chatContainerEl) {
                                    chatContainerEl.appendChild(msgDiv);
                                    chatContainerEl.scrollTop = chatContainerEl.scrollHeight;
                                }
                                break;

                            case 'clearChat':
                                document.getElementById('chatContainer').innerHTML =
                                    '<div class="empty-state">Start a new conversation...</div>';
                                break;

                            case 'updateCurrentOutput':
                                document.getElementById('currentOutputTextarea').value = message.output;
                                break;

                            case 'showApiTokenWarning':
                                document.getElementById('apiWarning').style.display = 'block';
                                break;

                            case 'apiTokenConfigured':
                                document.getElementById('apiWarning').style.display = 'none';
                                break;

                            case 'hideApiWarning':
                                const warningEl = document.getElementById('apiWarning');
                                if (warningEl) {
                                    warningEl.style.display = 'none';
                                }
                                break;

                            case 'apiTokenTestResult':
                                const statusDiv = document.getElementById('apiTokenStatus');
                                if (statusDiv) {
                                    statusDiv.textContent = message.message;
                                    statusDiv.className = 'status-message ' + (message.success ? 'success' : 'error');
                                    statusDiv.style.display = 'block';

                                    // Hide after 5 seconds if successful
                                    if (message.success) {
                                        setTimeout(() => {
                                            statusDiv.style.display = 'none';
                                        }, 5000);
                                    }
                                }
                                break;

                            case 'showApiError':
                                // Show API error banner in Prompt tab
                                const apiWarningBanner = document.getElementById('apiWarning');
                                if (apiWarningBanner) {
                                    apiWarningBanner.innerHTML = '⚠️ ' + message.message + ' <a href="#" id="configureApiLinkError">Configure API Settings</a>';
                                    apiWarningBanner.style.display = 'block';

                                    // Re-attach click handler
                                    const newLink = apiWarningBanner.querySelector('#configureApiLinkError');
                                    if (newLink) {
                                        newLink.addEventListener('click', (e) => {
                                            e.preventDefault();
                                            const settingsSection = document.querySelector('.settings-section');
                                            if (settingsSection) {
                                                settingsSection.open = true;
                                                document.getElementById('apiTokenInput')?.focus();
                                            }
                                        });
                                    }
                                }
                                break;
                        }
                    });

                    // Enable/disable buttons based on content
                    document.getElementById('featurePromptTextarea').addEventListener('input', (e) => {
                        document.getElementById('executeFeatureButton').disabled =
                            !e.target.value.trim() || !selectedFeatureId;
                    });
                </script>
            </body>
            </html>`;
    }
}