/**
 * ClaudeSession manages a Claude CLI process for conversation interactions
 * Handles streaming responses, message recording, and RAG enhancement
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import { exec } from 'child_process';
import { PromptApiClient } from './promptApiClient';
import {
    MessageRole,
    ClaudeMessage,
    ClaudeSessionEvents,
    SessionState,
    ContextSource
} from './types/conversations';

const execAsync = promisify(exec);

export class ClaudeSession extends EventEmitter {
    private process: ChildProcess | null = null;
    private threadId: string;
    private projectId?: string;
    private featureId?: string;
    private apiClient: PromptApiClient;
    private state: SessionState = 'idle';

    // Response handling
    private responseBuffer: string = '';
    private isReceivingResponse: boolean = false;
    private currentResponse: string = '';
    private responseStartTime: number = 0;

    // Message tracking
    private lastUserMessage: string = '';
    private lastEnhancedMessage?: string;
    private lastContextSources: ContextSource[] = [];

    constructor(
        threadId: string,
        apiClient: PromptApiClient,
        projectId?: string,
        featureId?: string
    ) {
        super();
        this.threadId = threadId;
        this.apiClient = apiClient;
        this.projectId = projectId;
        this.featureId = featureId;

        console.log('[ClaudeSession] Created session:', {
            threadId,
            projectId,
            featureId
        });
    }

    /**
     * Start the Claude CLI process
     */
    public async start(): Promise<void> {
        if (this.process) {
            console.log('[ClaudeSession] Session already running');
            return;
        }

        this.state = 'starting';
        console.log('[ClaudeSession] Starting Claude CLI...');

        try {
            const claudePath = await this.findClaudeCLI();
            if (!claudePath) {
                throw new Error('Claude CLI not found in PATH. Please install Claude CLI from https://claude.ai/cli');
            }

            console.log('[ClaudeSession] Found Claude CLI at:', claudePath);

            // Spawn Claude process
            this.process = spawn(claudePath, [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env }
            });

            // Handle stdout (Claude's responses)
            this.process.stdout?.on('data', (chunk: Buffer) => {
                const text = chunk.toString();
                this.handleClaudeOutput(text);
            });

            // Handle stderr (errors and status)
            this.process.stderr?.on('data', (chunk: Buffer) => {
                const errorText = chunk.toString();
                console.error('[ClaudeSession] stderr:', errorText);
                this.emit('error', errorText);
            });

            // Handle process exit
            this.process.on('exit', (code) => {
                console.log('[ClaudeSession] Process exited with code:', code);
                this.state = 'stopped';
                this.process = null;
                this.emit('exit', code);
            });

            // Handle process errors
            this.process.on('error', (error) => {
                console.error('[ClaudeSession] Process error:', error);
                this.state = 'error';
                this.emit('error', error.message);
            });

            this.state = 'running';
            this.emit('started');
            console.log('[ClaudeSession] Claude CLI started successfully');

        } catch (error: any) {
            console.error('[ClaudeSession] Failed to start:', error);
            this.state = 'error';
            throw error;
        }
    }

    /**
     * Send a message to Claude CLI
     * @param prompt User's message
     * @param useEnhancement Whether to enhance with RAG before sending
     */
    public async sendMessage(prompt: string, useEnhancement: boolean = false): Promise<void> {
        if (!this.process) {
            console.log('[ClaudeSession] Process not running, starting...');
            await this.start();
        }

        if (this.state === 'error' || this.state === 'stopped') {
            throw new Error('Claude session is not running');
        }

        console.log('[ClaudeSession] Sending message:', {
            promptLength: prompt.length,
            useEnhancement,
            threadId: this.threadId
        });

        let finalPrompt = prompt;
        let enhancedPrompt: string | undefined;
        let contextSources: ContextSource[] = [];

        // Step 1: Optionally enhance with RAG
        if (useEnhancement) {
            this.state = 'enhancing';
            this.emit('enhancing');

            try {
                console.log('[ClaudeSession] Calling enhancement API...');
                const enhancementResult = await this.apiClient.enhancePrompt({
                    prompt,
                    threadId: this.threadId,
                    projectId: this.projectId,
                    featureId: this.featureId,
                    topK: 5,
                    minWeight: 0.3
                });

                if (enhancementResult.success) {
                    enhancedPrompt = enhancementResult.enhanced_prompt;
                    finalPrompt = enhancedPrompt;
                    contextSources = enhancementResult.context_sources;

                    console.log('[ClaudeSession] Enhancement successful:', {
                        sourcesCount: contextSources.length,
                        processingTime: enhancementResult.processing_time_ms
                    });

                    this.emit('enhanced', {
                        original: prompt,
                        enhanced: enhancedPrompt,
                        sources: contextSources
                    });
                } else {
                    console.warn('[ClaudeSession] Enhancement failed:', enhancementResult.error);
                    this.emit('enhancementFailed', new Error(enhancementResult.error || 'Enhancement failed'));
                    // Continue with original prompt
                }
            } catch (error: any) {
                console.error('[ClaudeSession] Enhancement error:', error);
                this.emit('enhancementFailed', error);
                // Continue with original prompt
            }
        }

        // Store for recording later
        this.lastUserMessage = prompt;
        this.lastEnhancedMessage = enhancedPrompt;
        this.lastContextSources = contextSources;

        // Step 2: Record user message to API (non-blocking)
        this.recordUserMessage(prompt, enhancedPrompt, useEnhancement, contextSources)
            .catch(err => {
                console.error('[ClaudeSession] Failed to record user message:', err);
                // Don't throw - recording failure shouldn't block interaction
            });

        // Step 3: Send to Claude CLI
        this.state = 'sending';
        this.emit('sending', { prompt: finalPrompt, enhanced: useEnhancement });

        console.log('[ClaudeSession] Writing to Claude CLI stdin...');
        this.process!.stdin?.write(finalPrompt + '\n');

        this.isReceivingResponse = true;
        this.currentResponse = '';
        this.responseStartTime = Date.now();
    }

    /**
     * Handle output from Claude CLI
     */
    private handleClaudeOutput(text: string): void {
        // Stream chunks to UI in real-time
        this.emit('streamChunk', text);

        if (this.isReceivingResponse) {
            this.responseBuffer += text;
            this.currentResponse += text;

            // Check if response is complete
            // This is a heuristic - adjust based on actual Claude CLI behavior
            if (this.isResponseComplete(this.responseBuffer)) {
                this.finalizeResponse();
            }
        }
    }

    /**
     * Detect if Claude's response is complete
     * This is a heuristic based on common patterns
     */
    private isResponseComplete(buffer: string): boolean {
        // Common end-of-response indicators:
        // 1. Double newline after substantive content
        // 2. Return to prompt (e.g., "User: " or "> ")
        // 3. Specific end markers (adjust based on actual CLI output)

        // Check for double newline (common end pattern)
        if (buffer.endsWith('\n\n')) {
            return true;
        }

        // Check for prompt indicators
        if (buffer.includes('\nUser: ') || buffer.includes('\n> ')) {
            return true;
        }

        // Check if we've received substantial content and there's a pause
        // (This is approximate - in production, you might use a timeout)
        if (buffer.length > 100 && buffer.endsWith('\n')) {
            return true;
        }

        return false;
    }

    /**
     * Finalize the assistant's response and record it
     */
    private async finalizeResponse(): Promise<void> {
        if (!this.isReceivingResponse) {
            return;
        }

        this.isReceivingResponse = false;
        const response = this.currentResponse.trim();
        const responseTime = Date.now() - this.responseStartTime;

        console.log('[ClaudeSession] Response complete:', {
            length: response.length,
            responseTime: `${responseTime}ms`
        });

        this.state = 'running';
        this.emit('responseComplete', response);

        const message: ClaudeMessage = {
            role: 'assistant',
            content: response,
            wasEnhanced: false,
            timestamp: Date.now()
        };

        this.emit('messageComplete', message);

        // Record assistant message to API (non-blocking)
        this.recordAssistantMessage(response)
            .catch(err => {
                console.error('[ClaudeSession] Failed to record assistant message:', err);
                // Don't throw - recording failure shouldn't block interaction
            });

        // Reset buffers
        this.responseBuffer = '';
        this.currentResponse = '';
    }

    /**
     * Record user message to API
     */
    private async recordUserMessage(
        original: string,
        enhanced: string | undefined,
        wasEnhanced: boolean,
        contextSources: ContextSource[]
    ): Promise<void> {
        try {
            console.log('[ClaudeSession] Recording user message...');

            const result = await this.apiClient.recordMessage({
                threadId: this.threadId,
                projectId: this.projectId,
                featureId: this.featureId,
                role: 'user',
                content: original,
                enhancedContent: enhanced,
                wasEnhanced,
                contextSources: contextSources.map(s => ({
                    messageId: s.message_id,
                    similarity: s.similarity,
                    weight: s.weight
                })),
                metadata: {
                    source: 'vscode_claude_cli',
                    timestamp: Date.now(),
                    enhanced: wasEnhanced,
                    contextSourcesCount: contextSources.length
                }
            });

            if (result.success) {
                // Update threadId if a new thread was created
                if (result.thread_id && result.thread_id !== this.threadId) {
                    console.log('[ClaudeSession] Thread created:', result.thread_id);
                    this.threadId = result.thread_id;
                    this.emit('threadCreated', result.thread_id);
                }

                console.log('[ClaudeSession] User message recorded:', {
                    messageId: result.message_id,
                    threadId: result.thread_id,
                    weight: result.weight
                });
            } else {
                console.warn('[ClaudeSession] Failed to record user message:', result.error);
            }
        } catch (error: any) {
            console.error('[ClaudeSession] Recording error:', error);
            // Don't throw - we want to continue even if recording fails
        }
    }

    /**
     * Record assistant message to API
     */
    private async recordAssistantMessage(content: string): Promise<void> {
        try {
            console.log('[ClaudeSession] Recording assistant message...');

            const result = await this.apiClient.recordMessage({
                threadId: this.threadId,
                projectId: this.projectId,
                featureId: this.featureId,
                role: 'assistant',
                content,
                wasEnhanced: false, // Assistant messages are not enhanced
                metadata: {
                    source: 'claude_cli',
                    model: 'claude-sonnet-4', // Adjust based on actual CLI model
                    timestamp: Date.now(),
                    charCount: content.length
                }
            });

            if (result.success) {
                console.log('[ClaudeSession] Assistant message recorded:', {
                    messageId: result.message_id,
                    weight: result.weight
                });
            } else {
                console.warn('[ClaudeSession] Failed to record assistant message:', result.error);
            }
        } catch (error: any) {
            console.error('[ClaudeSession] Recording error:', error);
            // Don't throw - we want to continue even if recording fails
        }
    }

    /**
     * Find Claude CLI executable in PATH
     */
    private async findClaudeCLI(): Promise<string | null> {
        const possiblePaths = [
            'claude',
            'claude-code',
            '/usr/local/bin/claude',
            '/opt/homebrew/bin/claude',
            '/usr/bin/claude'
        ];

        for (const path of possiblePaths) {
            try {
                await execAsync(`which ${path}`);
                console.log('[ClaudeSession] Found Claude CLI:', path);
                return path;
            } catch {
                // Try next path
                continue;
            }
        }

        // Try direct execution as fallback
        for (const path of ['claude', 'claude-code']) {
            try {
                await execAsync(`${path} --version`);
                console.log('[ClaudeSession] Found Claude CLI via direct execution:', path);
                return path;
            } catch {
                // Try next
                continue;
            }
        }

        console.error('[ClaudeSession] Claude CLI not found in PATH');
        return null;
    }

    /**
     * Stop the Claude CLI process
     */
    public stop(): void {
        if (this.process) {
            console.log('[ClaudeSession] Stopping Claude CLI process...');
            this.process.kill('SIGTERM');
            this.process = null;
            this.state = 'stopped';
            this.emit('stopped');
        }
    }

    /**
     * Get current session state
     */
    public getState(): SessionState {
        return this.state;
    }

    /**
     * Get current thread ID
     */
    public getThreadId(): string {
        return this.threadId;
    }

    /**
     * Check if session is running
     */
    public isRunning(): boolean {
        return this.process !== null && this.state === 'running';
    }

    /**
     * Type-safe event emitter methods
     */
    public emit<K extends keyof ClaudeSessionEvents>(
        event: K,
        ...args: ClaudeSessionEvents[K]
    ): boolean {
        return super.emit(event, ...args);
    }

    public on<K extends keyof ClaudeSessionEvents>(
        event: K,
        listener: (...args: any[]) => void
    ): this {
        return super.on(event, listener);
    }

    public once<K extends keyof ClaudeSessionEvents>(
        event: K,
        listener: (...args: any[]) => void
    ): this {
        return super.once(event, listener);
    }

    public off<K extends keyof ClaudeSessionEvents>(
        event: K,
        listener: (...args: any[]) => void
    ): this {
        return super.off(event, listener);
    }
}
