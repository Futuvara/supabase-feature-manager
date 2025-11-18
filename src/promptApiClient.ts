import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';

export interface PromptResponse {
    success: boolean;
    data?: {
        input_text: string;
        output_text: string;
        prompt_id?: string;
        model_used?: string;
        tokens_used?: number;
        processing_time_ms?: number;
    };
    error?: string;
    message?: string;
}

export interface InstructionTemplate {
    id: string;
    name: string;
    content: string;
    is_default?: boolean;
}

export interface PromptTemplate {
    id: string;
    name: string;
    template_content: string;
}

export class PromptApiClient {
    private api: AxiosInstance;
    private apiToken: string | undefined;
    private baseUrl: string;
    private supabaseAccessToken: string | undefined;

    constructor(private context: vscode.ExtensionContext) {
        // Read API URL from settings
        const config = vscode.workspace.getConfiguration('supabaseFeatures');
        this.baseUrl = config.get('apiBaseUrl') || 'https://requ.futuvara.com/api';

        console.log('[PromptApiClient] Initializing with API URL:', this.baseUrl);

        this.api = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 15000, // 15 second timeout for production API
            validateStatus: (status) => status < 500 // Don't reject on 4xx errors
        });

        this.loadApiToken();
    }

    private async loadApiToken() {
        // Try to get API token from secure storage (for /prompts endpoints only)
        this.apiToken = await this.context.secrets.get('prompt_api_token');
    }

    /**
     * Set Supabase access token for API authentication
     * This is the primary authentication method for the API
     */
    public setSupabaseAccessToken(accessToken: string) {
        this.supabaseAccessToken = accessToken;
        // Supabase token takes precedence over API token
        this.api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
        console.log('[PromptApiClient] Supabase access token set for API requests');
    }

    /**
     * Set API token (rqm_*) for specific prompt endpoints
     */
    public async setApiToken(token: string) {
        this.apiToken = token;
        await this.context.secrets.store('prompt_api_token', token);

        // Only use API token if no Supabase token is set
        if (!this.supabaseAccessToken) {
            this.api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        }
    }

    public async improvePrompt(
        inputText: string,
        projectId?: string,
        instructionTemplate?: string,
        saveToHistory: boolean = true
    ): Promise<PromptResponse> {
        try {
            const response = await this.api.post('/prompts/improve', {
                input_text: inputText,
                project_id: projectId,
                instruction_template: instructionTemplate,
                save_to_history: saveToHistory
            });

            return response.data;
        } catch (error: any) {
            if (error.response) {
                return {
                    success: false,
                    error: error.response.data.error || 'API Error',
                    message: error.response.data.message || 'Failed to improve prompt'
                };
            }

            return {
                success: false,
                error: 'Network Error',
                message: error.message
            };
        }
    }

    public async listPrompts(
        projectId?: string,
        status?: string,
        limit: number = 50,
        offset: number = 0
    ) {
        try {
            const params: any = { limit, offset };
            if (projectId) params.project_id = projectId;
            if (status) params.status = status;

            const response = await this.api.get('/prompts', { params });
            return response.data;
        } catch (error: any) {
            console.error('Failed to list prompts:', error);
            return null;
        }
    }

    public hasApiToken(): boolean {
        return !!this.apiToken;
    }

    public async getInstructionTemplates(): Promise<InstructionTemplate[]> {
        try {
            const response = await this.api.get('/instruction-templates');
            console.log('[PromptApiClient] Instruction templates response:', response.status, response.data);

            if (response.data && Array.isArray(response.data)) {
                // Direct array response
                return response.data.map(t => ({
                    id: t.id,
                    name: t.name,
                    content: t.content,
                    is_default: t.is_default
                }));
            } else if (response.data && response.data.success) {
                // Wrapped in success object
                return response.data.data || [];
            }
            return [];
        } catch (error: any) {
            console.error('Failed to fetch instruction templates:', error.message);
            throw new Error('API connection failed: ' + (error.message || 'Unable to reach server'));
        }
    }

    public async getPromptTemplates(projectId?: string): Promise<PromptTemplate[]> {
        // Prompt templates require a project ID - return empty if none selected
        if (!projectId) {
            console.log('[PromptApiClient] No project selected, skipping prompt templates');
            return [];
        }

        try {
            const params = { project_id: projectId };
            const response = await this.api.get('/global-prompt-templates', { params });
            console.log('[PromptApiClient] Prompt templates response:', response.status, response.data);

            if (response.data && Array.isArray(response.data)) {
                // Direct array response
                return response.data.map(t => ({
                    id: t.id,
                    name: t.name,
                    template_content: t.template_content || t.content
                }));
            } else if (response.data && response.data.success) {
                // Wrapped in success object
                return response.data.data || [];
            }
            return [];
        } catch (error: any) {
            console.error('Failed to fetch prompt templates:', error.message);
            throw new Error('API connection failed: ' + (error.message || 'Unable to reach server'));
        }
    }

    public async getProjects(): Promise<any[]> {
        try {
            const response = await this.api.get('/projects');
            if (response.data && response.data.success) {
                return response.data.data || [];
            }
            return [];
        } catch (error: any) {
            console.error('Failed to fetch projects:', error);
            return [];
        }
    }
}