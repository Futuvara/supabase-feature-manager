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

    constructor(private context: vscode.ExtensionContext) {
        this.baseUrl = 'http://localhost:3000/api/v1'; // Default, can be configured
        this.api = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        this.loadApiToken();
    }

    private async loadApiToken() {
        // Try to get token from secure storage
        this.apiToken = await this.context.secrets.get('prompt_api_token');

        if (this.apiToken) {
            this.api.defaults.headers.common['Authorization'] = `Bearer ${this.apiToken}`;
        }
    }

    public async setApiToken(token: string) {
        this.apiToken = token;
        await this.context.secrets.store('prompt_api_token', token);
        this.api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
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
            const response = await this.api.get('/templates/instructions');
            if (response.data && response.data.success) {
                return response.data.data || [];
            }
            return [];
        } catch (error: any) {
            console.error('Failed to fetch instruction templates:', error);
            // Return default templates as fallback
            return [
                {
                    id: '1',
                    name: 'Default Improvement',
                    content: 'Improve the grammar and clarity of the following prompt. Make it more professional and detailed.',
                    is_default: true
                },
                {
                    id: '2',
                    name: 'Technical Spec',
                    content: 'Transform this into a detailed technical specification with acceptance criteria, architecture considerations, and testing requirements.'
                },
                {
                    id: '3',
                    name: 'User Story',
                    content: 'Convert this into a user story format with clear acceptance criteria and definition of done.'
                }
            ];
        }
    }

    public async getPromptTemplates(projectId?: string): Promise<PromptTemplate[]> {
        try {
            const params = projectId ? { project_id: projectId } : {};
            const response = await this.api.get('/templates/prompts', { params });
            if (response.data && response.data.success) {
                return response.data.data || [];
            }
            return [];
        } catch (error: any) {
            console.error('Failed to fetch prompt templates:', error);
            // Return default templates as fallback
            return [
                {
                    id: '1',
                    name: 'Bug Report',
                    template_content: 'I found a bug in [component]. When I [action], it [unexpected behavior] instead of [expected behavior].'
                },
                {
                    id: '2',
                    name: 'Feature Request',
                    template_content: 'Add [feature] to [component] that allows users to [capability].'
                },
                {
                    id: '3',
                    name: 'Code Review',
                    template_content: 'Review the [component/file] for [specific concerns like performance, security, best practices].'
                }
            ];
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