/**
 * Type definitions for Claude conversation recording and RAG enhancement
 * Based on API_REQUIREMENTS.md specifications
 */

/**
 * Message role types
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Message record in database
 */
export interface Message {
    id: string;
    thread_id: string;
    role: MessageRole;
    content: string;
    enhanced_content?: string;
    was_enhanced: boolean;
    weight: number;
    recency_score: number;
    feedback_score: number;
    ai_importance_score: number;
    created_at: string;
    metadata: Record<string, any>;
}

/**
 * Conversation thread
 */
export interface Thread {
    id: string;
    user_id: string;
    project_id?: string;
    feature_id?: string;
    title: string;
    created_at: string;
    updated_at: string;
    metadata: Record<string, any>;
}

/**
 * Context source from RAG enhancement
 */
export interface ContextSource {
    message_id: string;
    content: string;
    full_content: string;
    role: MessageRole;
    weight: number;
    similarity: number;
    created_at: string;
    thread_id: string;
    thread_title: string;
    from_current_thread: boolean;
}

/**
 * Request: Record a message
 */
export interface RecordMessageRequest {
    threadId?: string;
    projectId?: string;
    featureId?: string;
    role: MessageRole;
    content: string;
    enhancedContent?: string;
    wasEnhanced: boolean;
    contextSources?: Array<{
        messageId: string;
        similarity: number;
        weight: number;
    }>;
    metadata?: Record<string, any>;
}

/**
 * Response: Record a message
 */
export interface RecordMessageResponse {
    success: boolean;
    message_id: string;
    thread_id: string;
    weight: number;
    embedding_queued: boolean;
    thread_title?: string;
    error?: string;
    message?: string;
}

/**
 * Request: Enhance prompt with RAG
 */
export interface EnhancePromptRequest {
    prompt: string;
    threadId?: string;
    projectId?: string;
    featureId?: string;
    topK?: number;
    minWeight?: number;
}

/**
 * Response: Enhanced prompt with context
 */
export interface EnhancePromptResponse {
    success: boolean;
    enhanced_prompt: string;
    original_prompt: string;
    context_sources: ContextSource[];
    processing_time_ms: number;
    embedding_model: string;
    enhancement_model: string;
    error?: string;
    message?: string;
}

/**
 * Request: Get conversation thread
 */
export interface GetThreadRequest {
    threadId: string;
    page?: number;
    limit?: number;
    include_enhanced?: boolean;
}

/**
 * Response: Conversation thread with messages
 */
export interface GetThreadResponse {
    success: boolean;
    thread: {
        id: string;
        title: string;
        project_id?: string;
        feature_id?: string;
        created_at: string;
        updated_at: string;
        message_count: number;
    };
    messages: Array<{
        id: string;
        role: MessageRole;
        content: string;
        enhanced_content?: string;
        was_enhanced: boolean;
        weight: number;
        created_at: string;
    }>;
    total: number;
    page: number;
    limit: number;
    has_more: boolean;
    error?: string;
    message?: string;
}

/**
 * Thread summary for list view
 */
export interface ThreadSummary {
    id: string;
    title: string;
    project_id?: string;
    message_count: number;
    last_message_preview: string;
    last_message_at: string;
    created_at: string;
    updated_at: string;
}

/**
 * Request: List conversation threads
 */
export interface ListThreadsRequest {
    projectId?: string;
    limit?: number;
    offset?: number;
}

/**
 * Response: List of conversation threads
 */
export interface ListThreadsResponse {
    success: boolean;
    threads: ThreadSummary[];
    total: number;
    error?: string;
    message?: string;
}

/**
 * Claude session state
 */
export type SessionState = 'idle' | 'starting' | 'running' | 'enhancing' | 'sending' | 'error' | 'stopped';

/**
 * Claude session events
 */
export interface ClaudeSessionEvents {
    started: [];
    enhancing: [];
    enhanced: [{ original: string; enhanced: string; sources: ContextSource[] }];
    enhancementFailed: [Error];
    sending: [{ prompt: string; enhanced: boolean }];
    streamChunk: [string];
    responseComplete: [string];
    messageComplete: [{ role: MessageRole; content: string; timestamp: number }];
    threadCreated: [string];
    error: [string];
    exit: [number | null];
    stopped: [];
}

/**
 * Claude message for internal use
 */
export interface ClaudeMessage {
    role: MessageRole;
    content: string;
    enhancedContent?: string;
    wasEnhanced: boolean;
    timestamp: number;
}

/**
 * Metadata for prompts executed from Feature/Prompt tabs
 */
export interface PromptMetadata {
    source: 'feature_tab' | 'prompt_tab' | 'claude_tab';
    featureName?: string;
    projectId?: string;
    featureId?: string;
}
