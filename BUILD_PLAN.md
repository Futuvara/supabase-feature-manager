# Build Plan: Claude CLI Integration with RAG Enhancement

## Project Overview

**Goal:** Integrate Claude CLI into VS Code extension with conversation recording and RAG-enhanced prompts.

**Status:** Planning Phase Complete
**Start Date:** TBD
**Target Completion:** 6 weeks

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    VS Code Extension (Client)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Feature Tab ──┐                                                 │
│  Prompt Tab ───┼──> Execute ──> Claude Tab ──> Claude CLI       │
│                │                     │              ↓            │
│                │                     │         Streaming         │
│                │                     │         Response          │
│                │                     ↓              ↓            │
│                └──────────> Enhance? ────> Display Output        │
│                                 │                                │
│                                 └──> API: /enhance (optional)    │
└─────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Backend API (Server)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  POST /v1/conversations/record ──> Supabase DB (threads/msgs)   │
│                                         ↓                        │
│  POST /v1/conversations/enhance ──> Edge Function               │
│       │                                 ↓                        │
│       │                          Gemini Embeddings              │
│       │                                 ↓                        │
│       └──> Vector Search ──> Gemini Chat ──> Enhanced Prompt    │
│                                                                   │
│  GET  /v1/conversations         ──> List threads                │
│  GET  /v1/conversations/:id     ──> Get messages                │
│  GET  /v1/conversations/:id/stream ──> SSE (optional)           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Team Responsibilities

### Backend Team
- Database schema and migrations
- API endpoints implementation
- Edge Function for embeddings
- Gemini API integration
- Vector search optimization

### Frontend Team (VS Code Extension)
- Claude tab UI implementation
- Claude CLI process management
- API client integration
- State management
- Conversation display

---

## Phase 1: Backend Foundation (Week 1)

### Priority: CRITICAL

#### 1.1 Database Setup

**Owner:** Backend Team
**Duration:** 2-3 days

**Tasks:**
- [ ] Install pgvector extension
- [ ] Create `threads` table with indexes and RLS
- [ ] Create `messages` table with vector(768) column
- [ ] Create `message_context_sources` table
- [ ] Implement weight calculation function
- [ ] Create trigger for auto-weight updates
- [ ] Test RLS policies (users can only access own data)

**Files to Create:**
```
backend/
├── migrations/
│   ├── 001_create_threads_table.sql
│   ├── 002_create_messages_table.sql
│   ├── 003_create_context_sources_table.sql
│   ├── 004_create_weight_functions.sql
│   └── 005_create_rls_policies.sql
└── seeds/
    └── test_data.sql
```

**Acceptance Criteria:**
- ✅ All tables created with correct schema
- ✅ pgvector extension installed (verify with `\dx`)
- ✅ RLS policies prevent cross-user data access
- ✅ Weight calculation returns correct values
- ✅ Sample data can be inserted and queried

**Reference:** [API_REQUIREMENTS.md](API_REQUIREMENTS.md) Section 2

---

#### 1.2 Core Recording Endpoint

**Owner:** Backend Team
**Duration:** 2-3 days

**Tasks:**
- [ ] Implement `POST /api/v1/conversations/record`
- [ ] Handle new thread creation
- [ ] Handle message insertion with context sources
- [ ] Update thread timestamps
- [ ] Return thread_id and message_id
- [ ] Add error handling and validation
- [ ] Write unit tests

**Files to Create:**
```
backend/
├── routes/
│   └── conversations.ts
├── controllers/
│   └── conversationsController.ts
├── services/
│   └── conversationService.ts
└── tests/
    └── conversations.test.ts
```

**API Contract:**
```typescript
POST /api/v1/conversations/record
Body: {
  threadId?: string,
  projectId?: string,
  role: 'user' | 'assistant',
  content: string,
  enhancedContent?: string,
  wasEnhanced: boolean,
  contextSources?: Array<{messageId, similarity, weight}>,
  metadata?: object
}
Response: {
  success: boolean,
  message_id: string,
  thread_id: string,
  weight: number,
  embedding_queued: boolean
}
```

**Acceptance Criteria:**
- ✅ Creates new thread if threadId omitted
- ✅ Inserts message with all fields
- ✅ Returns correct response structure
- ✅ Response time < 200ms
- ✅ Unit tests pass
- ✅ Works with Postman/curl

**Reference:** [API_REQUIREMENTS.md](API_REQUIREMENTS.md) Section 3.2

---

#### 1.3 Conversation Retrieval Endpoints

**Owner:** Backend Team
**Duration:** 1-2 days

**Tasks:**
- [ ] Implement `GET /api/v1/conversations` (list threads)
- [ ] Implement `GET /api/v1/conversations/:threadId` (get messages)
- [ ] Add pagination support
- [ ] Add filtering by project_id
- [ ] Optimize queries with indexes
- [ ] Write unit tests

**API Contracts:**

**List Threads:**
```typescript
GET /api/v1/conversations?project_id=xxx&limit=20&offset=0
Response: {
  success: boolean,
  threads: Array<{
    id, title, project_id, message_count,
    last_message_preview, last_message_at, created_at, updated_at
  }>,
  total: number
}
```

**Get Thread:**
```typescript
GET /api/v1/conversations/:threadId?page=1&limit=50&include_enhanced=false
Response: {
  success: boolean,
  thread: { id, title, project_id, created_at, updated_at, message_count },
  messages: Array<{
    id, role, content, enhanced_content?, was_enhanced, weight, created_at
  }>,
  total: number,
  page: number,
  has_more: boolean
}
```

**Acceptance Criteria:**
- ✅ List returns user's threads only
- ✅ Pagination works correctly
- ✅ Filtering by project works
- ✅ Response time < 300ms
- ✅ Unit tests pass

**Reference:** [API_REQUIREMENTS.md](API_REQUIREMENTS.md) Sections 3.4, 3.5

---

## Phase 2: Edge Function & Embeddings (Week 1-2)

### Priority: HIGH

#### 2.1 Gemini Embeddings Edge Function

**Owner:** Backend Team
**Duration:** 2-3 days

**Tasks:**
- [ ] Create Supabase Edge Function: `generate-embeddings`
- [ ] Integrate Gemini text-embedding-004 API
- [ ] Implement AI importance scoring with gemini-2.5-flash
- [ ] Update message record with embedding and score
- [ ] Add retry logic (3 attempts, exponential backoff)
- [ ] Add error handling and logging
- [ ] Deploy to Supabase
- [ ] Set environment variables

**Files to Create:**
```
supabase/
└── functions/
    └── generate-embeddings/
        ├── index.ts
        └── README.md
```

**Implementation:**
```typescript
// Key steps:
1. Receive { message_id, content }
2. Call Gemini embedding API (768-dim vector)
3. Call Gemini chat to rate importance (0-1)
4. Update messages table with embedding + ai_importance_score
5. Return success/failure
```

**Environment Variables:**
```bash
GEMINI_API_KEY=AIza...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**Acceptance Criteria:**
- ✅ Function deploys successfully
- ✅ Generates 768-dimension embeddings
- ✅ AI importance score between 0-1
- ✅ Updates database correctly
- ✅ Retry logic works on failures
- ✅ Processing time < 2 seconds
- ✅ Logs all operations

**Reference:** [API_REQUIREMENTS.md](API_REQUIREMENTS.md) Section 4

---

#### 2.2 Test Embeddings & Vector Search

**Owner:** Backend Team
**Duration:** 1 day

**Tasks:**
- [ ] Insert test messages with embeddings
- [ ] Test vector similarity queries
- [ ] Verify pgvector index performance
- [ ] Test weight calculation with real data
- [ ] Benchmark query performance (< 100ms)

**Test Queries:**
```sql
-- Similarity search
SELECT id, content,
  (embedding <=> '[0.1, 0.2, ...]'::vector) as distance
FROM messages
WHERE thread_id IN (SELECT id FROM threads WHERE user_id = 'xxx')
  AND embedding IS NOT NULL
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 5;

-- Weight-based retrieval
SELECT * FROM messages
WHERE weight > 0.3
ORDER BY weight DESC
LIMIT 10;
```

**Acceptance Criteria:**
- ✅ Vector search returns relevant results
- ✅ Query time < 100ms for 10k messages
- ✅ Weight ranking works correctly
- ✅ Cosine similarity scores reasonable (0-1)

---

## Phase 3: RAG Enhancement API (Week 2)

### Priority: HIGH

#### 3.1 Enhancement Endpoint

**Owner:** Backend Team
**Duration:** 3-4 days

**Tasks:**
- [ ] Implement `POST /api/v1/conversations/enhance`
- [ ] Generate embedding for user's prompt
- [ ] Query vector DB for similar messages (topK)
- [ ] Include current thread's recent messages
- [ ] Build context for LLM
- [ ] Call Gemini gemini-2.5-flash for enhancement
- [ ] Return enhanced prompt + context sources
- [ ] Add caching for embeddings (optional)
- [ ] Write unit tests

**API Contract:**
```typescript
POST /api/v1/conversations/enhance
Body: {
  prompt: string,
  threadId?: string,
  projectId?: string,
  topK?: number,  // default: 5
  minWeight?: number  // default: 0.3
}
Response: {
  success: boolean,
  enhanced_prompt: string,
  original_prompt: string,
  context_sources: Array<{
    message_id, content, full_content, role, weight,
    similarity, created_at, thread_id, thread_title,
    from_current_thread: boolean
  }>,
  processing_time_ms: number,
  embedding_model: string,
  enhancement_model: string
}
```

**Enhancement Logic:**
```typescript
1. Generate embedding for prompt (Gemini)
2. Vector search: SELECT * FROM messages
   WHERE weight >= minWeight
   ORDER BY embedding <=> prompt_embedding
   LIMIT topK * 2
3. If threadId: Add last 10 messages from current thread
4. Deduplicate and rank by similarity + weight
5. Build context string for LLM
6. Call Gemini: "Enhance this prompt with context..."
7. Return enhanced prompt + sources
```

**Acceptance Criteria:**
- ✅ Returns enhanced prompt with context
- ✅ Context sources include similarity scores
- ✅ Marks current thread messages
- ✅ Response time < 3 seconds (target < 2s)
- ✅ Handles empty context gracefully
- ✅ Unit tests pass

**Reference:** [API_REQUIREMENTS.md](API_REQUIREMENTS.md) Section 3.3

---

#### 3.2 Test RAG Quality

**Owner:** Backend Team + Product
**Duration:** 1-2 days

**Tasks:**
- [ ] Create test dataset (50+ conversations)
- [ ] Run enhancement on sample prompts
- [ ] Evaluate relevance of retrieved context
- [ ] Measure improvement in prompt quality
- [ ] Adjust topK and minWeight if needed
- [ ] Document enhancement examples

**Quality Metrics:**
- Context relevance (manual review)
- Enhancement improves specificity
- No irrelevant context injected
- Processing time acceptable

---

## Phase 4: VS Code Extension - Claude Tab UI (Week 2-3)

### Priority: HIGH

#### 4.1 Add Claude Tab to Webview

**Owner:** Frontend Team
**Duration:** 2-3 days

**Tasks:**
- [ ] Add "Claude" tab button to existing tabs
- [ ] Create Claude tab HTML structure
- [ ] Add conversation history display area
- [ ] Add message input textarea
- [ ] Add "Enhance with context" checkbox
- [ ] Add "Run" button
- [ ] Add context sources panel (hidden by default)
- [ ] Add status indicator
- [ ] Style with VSCode theme variables
- [ ] Handle tab switching

**Files to Modify:**
```
src/
└── enhancedSidebarProvider.ts
    ├── _getHtmlForWebview() - Add Claude tab HTML
    ├── CSS styles - Message bubbles, status
    └── JavaScript - Event listeners
```

**UI Components:**
```html
<div class="tab-content" id="claudeTab">
  <!-- Thread selector -->
  <select id="claudeThreadSelector">...</select>

  <!-- Conversation history -->
  <div id="claudeConversationContainer">
    <!-- Messages appear here dynamically -->
  </div>

  <!-- Input area -->
  <textarea id="claudeMessageInput"></textarea>

  <!-- Enhancement toggle -->
  <input type="checkbox" id="enhanceWithRAG" />

  <!-- Context sources (shown after enhancement) -->
  <div id="contextSourcesPanel" style="display:none">...</div>

  <!-- Buttons -->
  <button id="sendToClaudeButton">Run</button>
</div>
```

**Acceptance Criteria:**
- ✅ Tab appears and switches correctly
- ✅ UI matches VSCode theme
- ✅ Input textarea is editable
- ✅ Buttons are clickable
- ✅ Checkbox works
- ✅ Empty state shows placeholder text

**Reference:** Plan document Section "Part 4: VS Code Extension Changes"

---

#### 4.2 Conversation Display & State

**Owner:** Frontend Team
**Duration:** 1-2 days

**Tasks:**
- [ ] Implement message bubble rendering
- [ ] Add auto-scroll to bottom
- [ ] Display user vs assistant messages differently
- [ ] Show "enhanced" indicator on messages
- [ ] Store active conversation in workspace state
- [ ] Load conversation history on tab open
- [ ] Handle empty conversation state

**Message Rendering:**
```javascript
function addMessageToUI(message) {
  const bubble = document.createElement('div');
  bubble.className = `message-bubble message-${message.role}`;
  if (message.was_enhanced) {
    bubble.classList.add('message-enhanced');
    bubble.title = 'Enhanced with RAG';
  }
  bubble.textContent = message.content;
  container.appendChild(bubble);
  scrollToBottom();
}
```

**Acceptance Criteria:**
- ✅ Messages display correctly
- ✅ User/assistant messages styled differently
- ✅ Auto-scrolls on new message
- ✅ Enhanced messages have visual indicator
- ✅ Conversation state persists

---

## Phase 5: Claude CLI Integration (Week 3)

### Priority: CRITICAL

#### 5.1 Claude Session Manager

**Owner:** Frontend Team
**Duration:** 3-4 days

**Tasks:**
- [ ] Create `src/claudeSession.ts` file
- [ ] Implement ClaudeSession class
- [ ] Find Claude CLI path on system
- [ ] Spawn Claude process with stdin/stdout pipes
- [ ] Handle streaming output chunks
- [ ] Detect response completion
- [ ] Emit events for UI updates
- [ ] Handle process errors and crashes
- [ ] Implement session cleanup

**Files to Create:**
```
src/
├── claudeSession.ts (new)
└── types/
    └── claudeSession.ts (new)
```

**Class Structure:**
```typescript
export class ClaudeSession extends EventEmitter {
  private process: ChildProcess | null = null;
  private threadId: string;
  private apiClient: PromptApiClient;

  constructor(threadId, apiClient, projectId?, featureId?) {}

  async start(): Promise<void> {
    // Find Claude CLI, spawn process
  }

  async sendMessage(prompt: string, useEnhancement: boolean): Promise<void> {
    // 1. Optionally enhance with RAG
    // 2. Record user message to API
    // 3. Send to Claude CLI stdin
    // 4. Stream response
    // 5. Record assistant message
  }

  private handleClaudeOutput(text: string): void {
    // Emit streamChunk events
  }

  stop(): void {
    // Kill process
  }

  // Events: started, enhancing, enhanced, sending,
  //         streamChunk, responseComplete, error, exit
}
```

**Claude CLI Detection:**
```typescript
async findClaudeCLI(): Promise<string | null> {
  const paths = [
    'claude',
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    '~/.local/bin/claude'
  ];

  for (const path of paths) {
    try {
      await execAsync(`which ${path}`);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}
```

**Acceptance Criteria:**
- ✅ Finds Claude CLI on system
- ✅ Spawns process successfully
- ✅ Sends messages to Claude
- ✅ Receives streaming responses
- ✅ Detects response completion
- ✅ Emits events correctly
- ✅ Handles errors gracefully
- ✅ Cleans up on exit

**Reference:** Plan document Section "4.2 Create `claudeSession.ts`"

---

#### 5.2 Integrate Session with UI

**Owner:** Frontend Team
**Duration:** 2 days

**Tasks:**
- [ ] Add `claudeSession` property to EnhancedSidebarProvider
- [ ] Create `startClaudeSession()` method
- [ ] Create `sendClaudeMessage()` method
- [ ] Create `stopClaudeSession()` method
- [ ] Wire up event listeners to webview messages
- [ ] Handle session lifecycle (start/stop/restart)
- [ ] Update UI based on session events
- [ ] Handle streaming chunks to UI

**Integration Points:**
```typescript
// In enhancedSidebarProvider.ts

private claudeSession: ClaudeSession | null = null;
private currentThreadId: string | null = null;

private async startClaudeSession(threadId, projectId) {
  this.claudeSession = new ClaudeSession(threadId, this.apiClient, projectId);

  // Wire up events
  this.claudeSession.on('streamChunk', (chunk) => {
    this._view?.webview.postMessage({
      type: 'claudeStreamChunk',
      chunk
    });
  });

  this.claudeSession.on('responseComplete', (response) => {
    this._view?.webview.postMessage({
      type: 'claudeResponseComplete',
      response
    });
  });

  // More events...

  await this.claudeSession.start();
}

private async sendClaudeMessage(message, useEnhancement) {
  if (!this.claudeSession) {
    await this.startClaudeSession(this.currentThreadId, this.currentProjectId);
  }

  await this.claudeSession.sendMessage(message, useEnhancement);
}
```

**Acceptance Criteria:**
- ✅ Session starts on first message
- ✅ Messages sent to Claude CLI
- ✅ Responses stream to UI in real-time
- ✅ Session stops on extension deactivate
- ✅ Errors displayed to user
- ✅ No memory leaks

---

## Phase 6: API Client Integration (Week 3-4)

### Priority: HIGH

#### 6.1 Add API Methods to Client

**Owner:** Frontend Team
**Duration:** 1-2 days

**Tasks:**
- [ ] Add `recordMessage()` method to PromptApiClient
- [ ] Add `enhancePrompt()` method
- [ ] Add `getThread()` method
- [ ] Add `listThreads()` method
- [ ] Add error handling for each method
- [ ] Add TypeScript types for all responses
- [ ] Test with mock API responses

**Files to Modify:**
```
src/
├── promptApiClient.ts (add methods)
└── types/
    └── api.ts (add response types)
```

**New Methods:**
```typescript
class PromptApiClient {
  async recordMessage(params: {
    threadId?, projectId?, role, content,
    enhancedContent?, wasEnhanced, contextSources?, metadata?
  }): Promise<RecordMessageResponse> {
    const response = await this.api.post('/v1/conversations/record', params);
    return response.data;
  }

  async enhancePrompt(params: {
    prompt, threadId?, projectId?, topK?, minWeight?
  }): Promise<EnhanceResponse> {
    const response = await this.api.post('/v1/conversations/enhance', params);
    return response.data;
  }

  async getThread(threadId: string, page = 1): Promise<ThreadResponse> {
    const response = await this.api.get(`/v1/conversations/${threadId}`, {
      params: { page, include_enhanced: true }
    });
    return response.data;
  }

  async listThreads(projectId?: string): Promise<ThreadListResponse> {
    const response = await this.api.get('/v1/conversations', {
      params: { project_id: projectId }
    });
    return response.data;
  }
}
```

**Acceptance Criteria:**
- ✅ All methods implemented
- ✅ TypeScript types defined
- ✅ Error handling works
- ✅ Methods tested with real API (once available)

**Reference:** Plan document Section "6.1 Add New API Methods"

---

#### 6.2 Integrate Recording in Session

**Owner:** Frontend Team
**Duration:** 1 day

**Tasks:**
- [ ] Call `recordMessage()` when user sends message
- [ ] Call `recordMessage()` when Claude responds
- [ ] Handle recording failures gracefully (don't block UX)
- [ ] Store threadId from first recording
- [ ] Update threadId if new thread created
- [ ] Log recording errors to console

**Recording Flow:**
```typescript
// In ClaudeSession.sendMessage()

async sendMessage(prompt: string, useEnhancement: boolean) {
  let enhancedPrompt = prompt;
  let contextSources = [];

  // Step 1: Optionally enhance
  if (useEnhancement) {
    this.emit('enhancing');
    try {
      const result = await this.apiClient.enhancePrompt({
        prompt,
        threadId: this.threadId,
        projectId: this.projectId
      });
      enhancedPrompt = result.enhanced_prompt;
      contextSources = result.context_sources;
      this.emit('enhanced', { original: prompt, enhanced: enhancedPrompt, sources: contextSources });
    } catch (error) {
      console.error('Enhancement failed:', error);
      // Continue with original prompt
    }
  }

  // Step 2: Record user message (non-blocking)
  this.recordUserMessage(prompt, enhancedPrompt, useEnhancement, contextSources)
    .catch(err => console.error('Failed to record user message:', err));

  // Step 3: Send to Claude CLI
  this.process.stdin.write(enhancedPrompt + '\n');

  // Step 4: Stream response (handled in handleClaudeOutput)
  // Step 5: Record assistant message (in finalizeResponse)
}

private async recordUserMessage(original, enhanced, wasEnhanced, sources) {
  const result = await this.apiClient.recordMessage({
    threadId: this.threadId,
    projectId: this.projectId,
    role: 'user',
    content: original,
    enhancedContent: enhanced !== original ? enhanced : undefined,
    wasEnhanced,
    contextSources: sources.map(s => ({
      messageId: s.message_id,
      similarity: s.similarity,
      weight: s.weight
    })),
    metadata: { source: 'vscode_claude_cli' }
  });

  // Update threadId if new
  if (result.thread_id !== this.threadId) {
    this.threadId = result.thread_id;
    this.emit('threadCreated', result.thread_id);
  }
}
```

**Acceptance Criteria:**
- ✅ User messages recorded before sending to Claude
- ✅ Assistant messages recorded after completion
- ✅ Recording failures don't block conversation
- ✅ ThreadId updated correctly
- ✅ Context sources recorded when enhanced

---

#### 6.3 Implement Enhancement Flow

**Owner:** Frontend Team
**Duration:** 1-2 days

**Tasks:**
- [ ] Check enhancement checkbox state before sending
- [ ] Call `/enhance` API if checked
- [ ] Show "Enhancing..." status in UI
- [ ] Display context sources after enhancement
- [ ] Show context panel with sources
- [ ] Hide context panel after sending
- [ ] Handle enhancement errors gracefully

**UI Flow:**
```javascript
// Webview JavaScript

document.getElementById('sendToClaudeButton').addEventListener('click', async () => {
  const message = document.getElementById('claudeMessageInput').value;
  const useEnhancement = document.getElementById('enhanceWithRAG').checked;

  vscode.postMessage({
    type: 'sendClaudeMessage',
    message,
    useEnhancement
  });
});

// Handle enhancement event
window.addEventListener('message', event => {
  const message = event.data;

  switch (message.type) {
    case 'claudeStatus':
      showStatus(message.status, message.message);
      break;

    case 'claudeEnhanced':
      showContextSources(message.sources);
      break;

    case 'claudeStreamChunk':
      appendToConversation(message.chunk);
      break;

    case 'claudeResponseComplete':
      finalizeMessage();
      clearInput();
      hideStatus();
      break;
  }
});

function showContextSources(sources) {
  const panel = document.getElementById('contextSourcesPanel');
  const list = document.getElementById('contextSourcesList');

  list.innerHTML = sources.map(s => `
    <div class="context-source-item">
      <div class="context-source-header">
        <span>${s.from_current_thread ? '🔄 Current' : '📂 ' + s.thread_title}</span>
        <span>Similarity: ${(s.similarity * 100).toFixed(0)}%</span>
      </div>
      <div class="context-source-preview">"${s.content}"</div>
    </div>
  `).join('');

  panel.style.display = 'block';
}
```

**Acceptance Criteria:**
- ✅ Enhancement checkbox toggles feature
- ✅ "Enhancing..." status shows during API call
- ✅ Context sources displayed with similarity scores
- ✅ Panel shows/hides correctly
- ✅ Enhancement errors don't break UI

---

## Phase 7: Execute Button Integration (Week 4)

### Priority: HIGH

#### 7.1 Modify Execute Buttons

**Owner:** Frontend Team
**Duration:** 1 day

**Tasks:**
- [ ] Modify `executePrompt()` method (Feature tab)
- [ ] Modify `executePromptOnCode()` method (Prompt tab)
- [ ] Send prompt to Claude tab instead of direct execution
- [ ] Switch to Claude tab automatically
- [ ] Populate Claude input with prompt
- [ ] Carry over project/feature context

**Implementation:**
```typescript
// In enhancedSidebarProvider.ts

private async executePrompt(prompt: string, featureName: string) {
  // OLD: Direct Claude CLI execution
  // await this.executeClaudeCLI(prompt);

  // NEW: Send to Claude tab
  this._view?.webview.postMessage({
    type: 'loadPromptInClaudeTab',
    prompt: prompt,
    metadata: {
      source: 'feature_tab',
      featureName: featureName,
      projectId: this.currentProjectId
    }
  });
}

private async executePromptOnCode(content: string) {
  // NEW: Send to Claude tab
  this._view?.webview.postMessage({
    type: 'loadPromptInClaudeTab',
    prompt: content,
    metadata: {
      source: 'prompt_tab',
      projectId: this.currentProjectId
    }
  });
}
```

**Webview Handler:**
```javascript
// Webview JavaScript

window.addEventListener('message', event => {
  const message = event.data;

  if (message.type === 'loadPromptInClaudeTab') {
    // Switch to Claude tab
    switchTab('claude');

    // Populate input
    document.getElementById('claudeMessageInput').value = message.prompt;

    // Store metadata
    claudeTabMetadata = message.metadata;

    // Scroll into view
    document.getElementById('claudeMessageInput').scrollIntoView({
      behavior: 'smooth'
    });

    // Optional: Auto-check enhancement for feature prompts
    if (message.metadata.source === 'feature_tab') {
      document.getElementById('enhanceWithRAG').checked = true;
    }
  }
});
```

**Acceptance Criteria:**
- ✅ Feature tab execute → Claude tab
- ✅ Prompt tab execute → Claude tab
- ✅ Tab switches automatically
- ✅ Input populated with prompt
- ✅ User can edit before running
- ✅ Project context carried over

**Reference:** Plan document Section "4.4 Modify Execute Button Behavior"

---

## Phase 8: Testing & Polish (Week 5)

### Priority: MEDIUM

#### 8.1 End-to-End Testing

**Owner:** Both Teams
**Duration:** 3 days

**Test Scenarios:**

**Scenario 1: New Conversation**
1. User selects feature in Feature tab
2. Clicks "Execute on code"
3. Switches to Claude tab
4. Prompt appears in input
5. User clicks "Run" (no enhancement)
6. Claude responds
7. Message recorded to API
8. Conversation appears in thread list

**Scenario 2: Enhanced Conversation**
1. User types message in Claude tab
2. Checks "Enhance with context"
3. Clicks "Run"
4. Status shows "Enhancing..."
5. Context sources appear
6. Enhanced prompt sent to Claude
7. Claude responds with context
8. Both messages recorded

**Scenario 3: Continue Conversation**
1. User loads existing thread from dropdown
2. Previous messages display
3. User sends new message
4. Claude responds in context
5. Messages appended to thread

**Scenario 4: Error Handling**
1. API down → Recording fails but Claude works
2. Claude CLI not found → Error shown
3. Enhancement fails → Falls back to original
4. Invalid thread → Error shown

**Test Checklist:**
- [ ] All scenarios pass
- [ ] No memory leaks
- [ ] No blocking errors
- [ ] Performance acceptable
- [ ] UI responsive

---

#### 8.2 Performance Optimization

**Owner:** Backend Team
**Duration:** 2 days

**Tasks:**
- [ ] Add database indexes if missing
- [ ] Optimize vector search queries
- [ ] Add caching for embeddings (optional)
- [ ] Optimize API response sizes
- [ ] Test with 10k+ messages
- [ ] Test with 100+ concurrent users
- [ ] Monitor API response times

**Performance Targets:**
- Record message: < 200ms
- Enhance prompt: < 3s (target < 2s)
- Vector search: < 100ms
- List threads: < 300ms
- Get thread: < 200ms

---

#### 8.3 Error Handling & Edge Cases

**Owner:** Both Teams
**Duration:** 2 days

**Error Scenarios:**
- [ ] Claude CLI not installed
- [ ] Claude CLI crashes mid-response
- [ ] API authentication fails
- [ ] API rate limit exceeded
- [ ] Gemini API quota exceeded
- [ ] Network timeout
- [ ] Invalid thread ID
- [ ] Empty conversation
- [ ] Very long messages (truncation)

**Edge Cases:**
- [ ] First-time user (no conversations)
- [ ] Very long conversation (1000+ messages)
- [ ] Multiple concurrent sessions
- [ ] Extension reload during conversation
- [ ] Rapid successive messages

---

#### 8.4 UI Polish

**Owner:** Frontend Team
**Duration:** 1-2 days

**Tasks:**
- [ ] Add loading spinners
- [ ] Add empty states with helpful text
- [ ] Add error messages with recovery actions
- [ ] Add tooltips for complex features
- [ ] Test with dark/light themes
- [ ] Responsive layout for small panels
- [ ] Keyboard shortcuts (Enter to send, etc.)
- [ ] Accessibility (ARIA labels, focus management)

**UX Improvements:**
- [ ] Auto-scroll to new messages
- [ ] Show typing indicator during response
- [ ] Show character count in input
- [ ] Ctrl+Enter to send
- [ ] Clear input after send
- [ ] Confirm before clearing conversation
- [ ] Show last updated time on threads

---

## Phase 9: Documentation & Deployment (Week 6)

### Priority: LOW

#### 9.1 User Documentation

**Owner:** Product/Frontend Team
**Duration:** 2 days

**Documents to Create:**
- [ ] User guide: How to use Claude tab
- [ ] User guide: Understanding RAG enhancement
- [ ] User guide: Managing conversations
- [ ] FAQ: Common issues
- [ ] Video: Quick start tutorial

**Files to Create:**
```
docs/
├── user-guide.md
├── rag-enhancement.md
├── troubleshooting.md
└── videos/
    └── quickstart.mp4
```

---

#### 9.2 Developer Documentation

**Owner:** Both Teams
**Duration:** 2 days

**Documents to Create:**
- [ ] Architecture overview
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Database schema diagram (ERD)
- [ ] Deployment guide
- [ ] Development setup guide
- [ ] Contributing guide

**Files to Create:**
```
docs/
├── architecture.md
├── api-reference.md
├── database-schema.md
├── deployment.md
└── development.md
```

---

#### 9.3 Deployment

**Owner:** Backend Team
**Duration:** 2 days

**Deployment Checklist:**

**Backend:**
- [ ] Run database migrations on production
- [ ] Deploy Edge Function to Supabase
- [ ] Set environment variables (GEMINI_API_KEY, etc.)
- [ ] Enable Supabase Realtime (if using SSE)
- [ ] Configure rate limiting
- [ ] Set up monitoring and alerts
- [ ] Test all endpoints in production
- [ ] Verify RLS policies

**Frontend:**
- [ ] Update extension version in package.json
- [ ] Update CHANGELOG.md
- [ ] Build extension: `vsce package`
- [ ] Test .vsix locally
- [ ] Publish to VS Code Marketplace
- [ ] Update README with new features
- [ ] Create GitHub release

**Post-Deployment:**
- [ ] Monitor error rates
- [ ] Monitor API usage
- [ ] Monitor Gemini API costs
- [ ] Check user feedback
- [ ] Fix critical bugs within 24h

---

## Phase 10: Advanced Features (Future)

### Priority: LOW (Optional)

**Features to Consider:**

#### 10.1 Real-Time Updates (SSE)
- [ ] Implement `GET /api/v1/conversations/:id/stream`
- [ ] Subscribe to conversation updates
- [ ] Multi-device sync
- [ ] Real-time collaboration

#### 10.2 Conversation Management
- [ ] Rename threads
- [ ] Delete threads
- [ ] Archive old threads
- [ ] Export conversations
- [ ] Search across conversations
- [ ] Tag conversations

#### 10.3 Analytics Dashboard
- [ ] Message count over time
- [ ] Enhancement usage rate
- [ ] Most active projects
- [ ] Average messages per thread
- [ ] Top context sources

#### 10.4 User Feedback
- [ ] Rate message importance (feedback_score)
- [ ] Flag irrelevant context
- [ ] Report issues
- [ ] Suggest improvements

---

## Dependencies & Prerequisites

### Backend Requirements
- PostgreSQL 15+ with pgvector extension
- Supabase account with Edge Functions enabled
- Gemini API key (with text-embedding-004 and gemini-2.5-flash access)
- Node.js 18+ (for API server)

### Frontend Requirements
- VS Code 1.85+
- Node.js 18+
- TypeScript 5.0+
- Existing Supabase client setup
- Claude CLI installed on user's system

### Development Tools
- Git
- Postman/Insomnia (API testing)
- pgAdmin/DBeaver (database management)
- VS Code extensions: ESLint, Prettier

---

## Risk Management

### High-Risk Items

**1. Claude CLI Availability**
- **Risk:** Users don't have Claude CLI installed
- **Mitigation:** Clear error message with installation link
- **Fallback:** Manual copy-paste workflow

**2. Gemini API Quotas**
- **Risk:** Exceed rate limits or quotas
- **Mitigation:** Monitor usage, implement rate limiting
- **Fallback:** Cache embeddings, reduce enhancement calls

**3. Vector Search Performance**
- **Risk:** Slow queries with large datasets
- **Mitigation:** Proper indexing, pagination, caching
- **Fallback:** Reduce topK, increase minWeight

**4. API Recording Failures**
- **Risk:** Network issues prevent recording
- **Mitigation:** Non-blocking recording, retry logic
- **Fallback:** Queue for later sync

### Medium-Risk Items

**1. Session Management**
- **Risk:** Memory leaks from long-running sessions
- **Mitigation:** Proper cleanup, process monitoring
- **Fallback:** Restart session on errors

**2. Cost Overruns**
- **Risk:** Gemini API costs exceed budget
- **Mitigation:** Monitor costs, set alerts
- **Fallback:** Disable auto-embedding, reduce enhancement usage

**3. User Experience**
- **Risk:** Feature too complex for users
- **Mitigation:** Clear documentation, onboarding
- **Fallback:** Simplify UI, hide advanced features

---

## Success Metrics

### Technical Metrics
- [ ] API response time p95 < 3s
- [ ] Vector search < 100ms
- [ ] Zero data loss (all messages recorded)
- [ ] < 1% error rate
- [ ] < 5s end-to-end latency (user send → Claude response)

### Business Metrics
- [ ] 50+ active users in first month
- [ ] 80%+ user satisfaction
- [ ] 30%+ enhancement usage rate
- [ ] 10+ conversations per user
- [ ] < $50/month API costs

### User Experience Metrics
- [ ] < 2 clicks to start conversation
- [ ] < 5s to see first response
- [ ] 90%+ message recording success rate
- [ ] < 3% enhancement failure rate

---

## Communication Plan

### Daily Standups
- Time: 9:00 AM
- Duration: 15 minutes
- Format: What did you do? What will you do? Any blockers?

### Weekly Reviews
- Time: Friday 3:00 PM
- Duration: 1 hour
- Format: Demo progress, discuss blockers, plan next week

### Communication Channels
- Slack: #claude-integration (general discussion)
- Slack: #claude-integration-dev (technical issues)
- GitHub: Issues for bugs, PRs for code review
- Google Docs: Shared planning documents

### Code Review Process
- All PRs require 1 approval before merge
- Backend PRs reviewed by backend team
- Frontend PRs reviewed by frontend team
- Cross-functional PRs reviewed by both

---

## Timeline Summary

| Phase | Week | Owner | Status |
|-------|------|-------|--------|
| 1. Backend Foundation | 1 | Backend | Not Started |
| 2. Edge Function & Embeddings | 1-2 | Backend | Not Started |
| 3. RAG Enhancement API | 2 | Backend | Not Started |
| 4. Claude Tab UI | 2-3 | Frontend | Not Started |
| 5. Claude CLI Integration | 3 | Frontend | Not Started |
| 6. API Client Integration | 3-4 | Frontend | Not Started |
| 7. Execute Button Integration | 4 | Frontend | Not Started |
| 8. Testing & Polish | 5 | Both | Not Started |
| 9. Documentation & Deployment | 6 | Both | Not Started |
| 10. Advanced Features | Future | Both | Optional |

**Total Duration:** 6 weeks (core features)

---

## Next Steps

### Immediate Actions (This Week)
1. [ ] Backend team: Set up development database with pgvector
2. [ ] Backend team: Create first migration (threads table)
3. [ ] Frontend team: Review existing code structure
4. [ ] Frontend team: Create feature branch: `feature/claude-integration`
5. [ ] Both teams: Set up Gemini API keys in development
6. [ ] Product: Create test dataset (sample conversations)

### Week 1 Goals
- [ ] Database schema complete
- [ ] POST /record endpoint working
- [ ] GET /conversations endpoints working
- [ ] Claude tab UI visible in extension

### Questions to Resolve
- [ ] Who has access to production Gemini API key?
- [ ] What's the Supabase project URL for production?
- [ ] Do we need approval for VS Code Marketplace publishing?
- [ ] What's the budget for Gemini API costs?

---

## Appendix

### A. Quick Reference Links
- [API Requirements](API_REQUIREMENTS.md)
- [API Changelog](API_REQUIREMENTS_CHANGELOG.md)
- [Existing Codebase](src/)
- [Gemini API Docs](https://ai.google.dev/)
- [Supabase Docs](https://supabase.com/docs)
- [pgvector Docs](https://github.com/pgvector/pgvector)

### B. Contact Information
- Backend Lead: [Name] - [Email]
- Frontend Lead: [Name] - [Email]
- Product Owner: [Name] - [Email]
- DevOps: [Name] - [Email]

### C. Environment Variables Reference

**Backend (.env):**
```bash
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GEMINI_API_KEY=AIza...
NODE_ENV=development
PORT=3000
```

**Edge Function (Supabase Secrets):**
```bash
GEMINI_API_KEY=AIza...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**VS Code Extension (User Settings):**
```json
{
  "supabaseFeatures.apiBaseUrl": "https://requ.futuvara.com/api"
}
```

---

**Document Version:** 1.0
**Last Updated:** 2025-11-18
**Next Review:** Weekly during implementation
