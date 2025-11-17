import * as vscode from 'vscode';
import { SupabaseService, Project, Feature } from './supabaseService';

export class FeatureTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: 'project' | 'feature',
        public readonly data?: Project | Feature,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);

        if (itemType === 'project') {
            this.iconPath = new vscode.ThemeIcon('folder');
            this.contextValue = 'project';
        } else {
            this.iconPath = new vscode.ThemeIcon('symbol-method');
            this.contextValue = 'feature';
            this.tooltip = (data as Feature)?.prompt || '';
        }
    }
}

export class FeaturesTreeDataProvider implements vscode.TreeDataProvider<FeatureTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FeatureTreeItem | undefined | null | void> = new vscode.EventEmitter<FeatureTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FeatureTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private supabaseService: SupabaseService;
    private projects: Project[] = [];
    private featuresMap: Map<string, Feature[]> = new Map();

    constructor() {
        this.supabaseService = SupabaseService.getInstance();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FeatureTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FeatureTreeItem): Promise<FeatureTreeItem[]> {
        if (!element) {
            // Root level - show projects
            const user = await this.supabaseService.getCurrentUser();
            if (!user) {
                return [new FeatureTreeItem('Click to login', vscode.TreeItemCollapsibleState.None, 'feature', undefined, {
                    command: 'my-first-extension.login',
                    title: 'Login'
                })];
            }

            this.projects = await this.supabaseService.getProjects();

            if (this.projects.length === 0) {
                return [new FeatureTreeItem('No projects found', vscode.TreeItemCollapsibleState.None, 'feature')];
            }

            return this.projects.map(project =>
                new FeatureTreeItem(
                    project.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'project',
                    project
                )
            );
        } else if (element.itemType === 'project' && element.data) {
            // Project level - show features
            const project = element.data as Project;
            let features = this.featuresMap.get(project.id);

            if (!features) {
                features = await this.supabaseService.getFeatures(project.id);
                this.featuresMap.set(project.id, features);
            }

            if (features.length === 0) {
                return [new FeatureTreeItem('No features', vscode.TreeItemCollapsibleState.None, 'feature')];
            }

            return features.map(feature =>
                new FeatureTreeItem(
                    feature.name,
                    vscode.TreeItemCollapsibleState.None,
                    'feature',
                    feature,
                    {
                        command: 'my-first-extension.showFeatureDetails',
                        title: 'Show Feature Details',
                        arguments: [feature]
                    }
                )
            );
        }

        return [];
    }

    clearCache(): void {
        this.featuresMap.clear();
        this.projects = [];
        this.refresh();
    }
}

export class FeatureSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'supabaseFeatures.sidebar';

    private _view?: vscode.WebviewView;
    private currentFeature?: Feature;
    private supabaseService: SupabaseService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
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

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'executeFeature':
                    if (this.currentFeature) {
                        vscode.commands.executeCommand('my-first-extension.executeFeature', this.currentFeature);
                    }
                    break;
                case 'copyPrompt':
                    if (this.currentFeature) {
                        await vscode.env.clipboard.writeText(this.currentFeature.prompt);
                        vscode.window.showInformationMessage('Prompt copied to clipboard!');
                    }
                    break;
            }
        });
    }

    public showFeature(feature: Feature) {
        this.currentFeature = feature;
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage({
                type: 'showFeature',
                feature: feature
            });
        }
    }

    public clearView() {
        this.currentFeature = undefined;
        if (this._view) {
            this._view.webview.postMessage({
                type: 'clear'
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Feature Details</title>
                <style>
                    body {
                        padding: 10px;
                        font-family: var(--vscode-font-family);
                    }
                    .welcome {
                        text-align: center;
                        color: var(--vscode-descriptionForeground);
                        padding: 20px;
                    }
                    .feature-details {
                        display: none;
                    }
                    .feature-details.active {
                        display: block;
                    }
                    h2 {
                        color: var(--vscode-editor-foreground);
                        font-size: 16px;
                        margin-bottom: 10px;
                        padding-bottom: 5px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .description {
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 15px;
                        font-size: 13px;
                    }
                    .prompt-section {
                        margin-bottom: 15px;
                    }
                    .prompt-label {
                        font-weight: bold;
                        margin-bottom: 5px;
                        font-size: 12px;
                        text-transform: uppercase;
                        color: var(--vscode-descriptionForeground);
                    }
                    .prompt-content {
                        padding: 10px;
                        background-color: var(--vscode-textBlockQuote-background);
                        border-left: 3px solid var(--vscode-textBlockQuote-border);
                        font-family: var(--vscode-editor-font-family);
                        font-size: 12px;
                        white-space: pre-wrap;
                        word-wrap: break-word;
                        border-radius: 3px;
                    }
                    button {
                        width: 100%;
                        padding: 8px 12px;
                        margin-bottom: 8px;
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
                    .actions {
                        margin-top: 15px;
                    }
                </style>
            </head>
            <body>
                <div class="welcome" id="welcome">
                    <p>Select a feature from the tree to view details</p>
                </div>
                <div class="feature-details" id="featureDetails">
                    <h2 id="featureName"></h2>
                    <div class="description" id="featureDescription"></div>
                    <div class="prompt-section">
                        <div class="prompt-label">Prompt:</div>
                        <div class="prompt-content" id="featurePrompt"></div>
                    </div>
                    <div class="actions">
                        <button onclick="executeFeature()">Execute with Claude Code</button>
                        <button class="secondary" onclick="copyPrompt()">Copy Prompt</button>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    function executeFeature() {
                        vscode.postMessage({ type: 'executeFeature' });
                    }

                    function copyPrompt() {
                        vscode.postMessage({ type: 'copyPrompt' });
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'showFeature':
                                const feature = message.feature;
                                document.getElementById('welcome').style.display = 'none';
                                document.getElementById('featureDetails').classList.add('active');
                                document.getElementById('featureName').textContent = feature.name;
                                document.getElementById('featureDescription').textContent = feature.description || 'No description available';
                                document.getElementById('featurePrompt').textContent = feature.prompt;
                                break;
                            case 'clear':
                                document.getElementById('welcome').style.display = 'block';
                                document.getElementById('featureDetails').classList.remove('active');
                                break;
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}