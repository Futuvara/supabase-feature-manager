import * as vscode from 'vscode';
import { SupabaseService, Project, Feature } from './supabaseService';
import { PromptApiClient, InstructionTemplate, PromptTemplate } from './promptApiClient';
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
        private readonly context: vscode.ExtensionContext
    ) {
        this.supabaseService = SupabaseService.getInstance();
        this.promptApiClient = new PromptApiClient(context);
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
                    await this.handleLogin();
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

    private async handleLogin() {
        vscode.commands.executeCommand('my-first-extension.login');
    }

    private async handleLogout() {
        try {
            await this.supabaseService.signOut();
            await this.context.secrets.delete('supabase_email');
            await this.context.secrets.delete('supabase_password');

            this.projects = [];
            this.features = [];
            this.currentProjectId = undefined;

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
        // Load templates from API
        try {
            // Fetch instruction templates from API
            this.instructionTemplates = await this.promptApiClient.getInstructionTemplates();

            // Fetch prompt templates from API (optionally filtered by project)
            this.promptTemplates = await this.promptApiClient.getPromptTemplates(this.currentProjectId);

            // Send templates to webview
            this.sendMessage('updatePromptTemplates', { templates: this.promptTemplates });
            this.sendMessage('updateInstructionTemplates', { templates: this.instructionTemplates });
        } catch (error: any) {
            console.error('Failed to load templates:', error);

            // Use fallback templates if API fails
            this.instructionTemplates = [
                { id: '1', name: 'Default Improvement', content: 'Improve the grammar and clarity of the following prompt. Make it more professional and detailed.' },
                { id: '2', name: 'Technical Spec', content: 'Transform this into a detailed technical specification with acceptance criteria, architecture considerations, and testing requirements.' },
                { id: '3', name: 'User Story', content: 'Convert this into a user story format with clear acceptance criteria and definition of done.' }
            ];

            this.promptTemplates = [
                { id: '1', name: 'Bug Report', template_content: 'I found a bug in [component]. When I [action], it [unexpected behavior] instead of [expected behavior].' },
                { id: '2', name: 'Feature Request', template_content: 'Add [feature] to [component] that allows users to [capability].' },
                { id: '3', name: 'Code Review', template_content: 'Review the [component/file] for [specific concerns like performance, security, best practices].' }
            ];

            this.sendMessage('updatePromptTemplates', { templates: this.promptTemplates });
            this.sendMessage('updateInstructionTemplates', { templates: this.instructionTemplates });
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

        // Process with API if token is configured
        if (this.promptApiClient.hasApiToken()) {
            const instruction = this.currentInstruction?.content ||
                'Improve the grammar and clarity of the following prompt. Make it more professional and detailed.';

            const response = await this.promptApiClient.improvePrompt(
                message,
                this.currentProjectId,
                instruction,
                true
            );

            if (response.success && response.data) {
                const assistantMessage: ChatMessage = {
                    role: 'assistant',
                    content: response.data.output_text,
                    timestamp: new Date()
                };
                this.chatMessages.push(assistantMessage);
                this.sendMessage('addChatMessage', { message: assistantMessage });
                this.sendMessage('updateCurrentOutput', { output: response.data.output_text });
            } else {
                vscode.window.showErrorMessage(`Failed to improve prompt: ${response.message}`);
            }
        } else {
            vscode.window.showWarningMessage('API token not configured. Please configure in settings.');
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

        // This would integrate with your Supabase features table
        vscode.window.showInformationMessage('Feature added successfully');
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

                    .login-container {
                        display: none;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        height: 100%;
                        text-align: center;
                        padding: 20px;
                    }

                    .login-container.active {
                        display: flex;
                    }

                    .main-container {
                        display: flex;
                        flex-direction: column;
                        height: 100%;
                    }

                    .main-container.hidden {
                        display: none;
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
                    <p style="margin-bottom: 20px;">Please login to access your projects and features</p>
                    <button onclick="login()">Login to Supabase</button>
                </div>

                <div class="main-container hidden" id="mainContainer">
                    <!-- Tab buttons -->
                    <div class="tabs-container">
                        <button class="tab active" id="featureTab" onclick="switchTab('feature')">Feature</button>
                        <button class="tab" id="promptTab" onclick="switchTab('prompt')">Prompt</button>
                    </div>

                    <!-- Feature Tab -->
                    <div class="tab-panel active" id="featurePanel">
                        <div class="feature-section">
                            <div class="section-label">Project</div>
                            <select id="projectSelect" onchange="selectProject()">
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

                        <button class="primary" id="executeFeatureButton" onclick="executeFeaturePrompt()" disabled>
                            Execute on code
                        </button>
                    </div>

                    <!-- Prompt Tab -->
                    <div class="tab-panel" id="promptPanel">
                        <button class="new-chat-button" onclick="newChat()">New chat</button>

                        <div id="apiWarning" class="warning-banner" style="display: none;">
                            ⚠️ API token not configured. <a href="#" onclick="configureApiToken()">Configure now</a>
                        </div>

                        <div class="prompt-control-section">
                            <div class="section-label">Project</div>
                            <select id="promptProjectSelect" onchange="selectPromptProject()">
                                <option value="">Select a project...</option>
                            </select>
                        </div>

                        <div class="prompt-control-section">
                            <div class="section-label">Instruction</div>
                            <select id="instructionSelect" onchange="selectInstruction()">
                                <option value="">Select instruction template...</option>
                            </select>
                        </div>

                        <div class="prompt-control-section">
                            <div class="section-label">Prompt Template</div>
                            <select id="promptTemplateSelect" onchange="selectPromptTemplate()">
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
                                onkeypress="handleMessageKeypress(event)"
                            />
                            <button class="send-button primary" onclick="sendMessage()">Send</button>
                        </div>

                        <div class="button-row">
                            <button class="secondary" onclick="addFeature()">+ Add feature</button>
                            <button class="primary" onclick="executeOnCode()">Execute on code</button>
                        </div>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let currentTab = 'feature';
                    let selectedFeatureId = null;
                    let currentFeatureName = '';

                    // Send ready message
                    vscode.postMessage({ type: 'ready' });

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
                    function login() {
                        vscode.postMessage({ type: 'login' });
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

                    function configureApiToken() {
                        vscode.postMessage({ type: 'configureApiToken' });
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
                                document.getElementById('loginContainer').classList.add('active');
                                document.getElementById('mainContainer').classList.add('hidden');
                                break;

                            case 'updateProjects':
                                document.getElementById('loginContainer').classList.remove('active');
                                document.getElementById('mainContainer').classList.remove('hidden');

                                // Update both project dropdowns
                                const featureSelect = document.getElementById('projectSelect');
                                const promptSelect = document.getElementById('promptProjectSelect');

                                featureSelect.innerHTML = '<option value="">Select a project...</option>';
                                promptSelect.innerHTML = '<option value="">Select a project...</option>';

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
                                    promptSelect.appendChild(promptOption);
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
                                const instructionSelect = document.getElementById('instructionSelect');
                                instructionSelect.innerHTML = '<option value="">Select instruction template...</option>';
                                message.templates.forEach(template => {
                                    const option = document.createElement('option');
                                    option.value = template.id;
                                    option.textContent = template.name;
                                    instructionSelect.appendChild(option);
                                });
                                break;

                            case 'updatePromptTemplates':
                                const promptSelect = document.getElementById('promptTemplateSelect');
                                promptSelect.innerHTML = '<option value="">Select prompt template...</option>';
                                message.templates.forEach(template => {
                                    const option = document.createElement('option');
                                    option.value = template.id;
                                    option.textContent = template.name;
                                    promptSelect.appendChild(option);
                                });
                                break;

                            case 'promptTemplateSelected':
                                if (message.template) {
                                    document.getElementById('messageInput').value = message.template.template_content;
                                }
                                break;

                            case 'addChatMessage':
                                const chatContainer = document.getElementById('chatContainer');
                                if (chatContainer.querySelector('.empty-state')) {
                                    chatContainer.innerHTML = '';
                                }

                                const msgDiv = document.createElement('div');
                                msgDiv.className = 'chat-message ' + message.message.role;
                                msgDiv.innerHTML = \`
                                    <div class="chat-role">\${message.message.role === 'user' ? 'You' : 'Assistant'}</div>
                                    <div>\${message.message.content}</div>
                                \`;
                                chatContainer.appendChild(msgDiv);
                                chatContainer.scrollTop = chatContainer.scrollHeight;
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