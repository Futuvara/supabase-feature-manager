# API Requirements for Claude Conversation Recording & RAG Enhancement

## Document Information
- **Version:** 1.1
- **Date:** 2025-11-18
- **Target API Base URL:** `https://requ.futuvara.com/api`
- **Client:** VS Code Extension (Supabase Feature Manager)
- **Purpose:** Enable conversation recording and RAG-enhanced prompt generation for Claude CLI integration
- **AI Provider:** Google Gemini (text-embedding-004, gemini-2.5-flash)

---

## 1. Executive Summary

The VS Code extension needs backend API support for:
1. **Recording conversations** with Claude AI CLI to build a knowledge base
2. **RAG-enhanced prompt generation** using past conversation context
3. **Conversation thread management** (create, list, retrieve)
4. **Asynchronous embedding generation** for semantic search
5. **Server-Sent Events (SSE)** for real-time conversation updates (optional)

### Key Principles
- **Transparent recording**: All Claude CLI interactions automatically saved
- **Optional enhancement**: User chooses whether to use RAG via checkbox
- **Non-blocking**: API failures must not interrupt Claude CLI interaction
- **Composite weighting**: Messages ranked by recency + feedback + AI importance

### AI Provider: Google Gemini

**This implementation uses Google Gemini instead of OpenAI:**

- **Embedding Model**: `text-embedding-004` (768-dim) instead of OpenAI text-embedding-3-small (1536-dim)
- **Enhancement LLM**: `gemini-2.5-flash` instead of GPT-4o-mini
- **Rationale**: Already integrated in existing codebase via `GeminiService`, no new API dependency needed
- **Cost Impact**: Embeddings ~6x more expensive, but chat 50% cheaper. Net: ~4% higher cost ($5.20/mo vs $5/mo for 1k users)
- **API Key**: Requires `GEMINI_API_KEY` environment variable

---

## 2. Database Schema Requirements

### 2.1 New Tables

#### Table: `threads`
Conversation threads linking to projects/features.

```sql
CREATE TABLE threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  feature_id UUID REFERENCES features(id) ON DELETE SET NULL,
  title TEXT NOT NULL,  -- Auto-generated from first message (max 100 chars)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_threads_user_project ON threads(user_id, project_id);
CREATE INDEX idx_threads_updated ON threads(updated_at DESC);
CREATE INDEX idx_threads_user_updated ON threads(user_id, updated_at DESC);

-- RLS Policies
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own threads" ON threads
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own threads" ON threads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own threads" ON threads
  FOR UPDATE USING (auth.uid() = user_id);
```

**Field Descriptions:**
- `id`: Unique thread identifier
- `user_id`: Owner of the conversation (from Supabase auth)
- `project_id`: Optional link to project context
- `feature_id`: Optional link to feature context
- `title`: Auto-generated from first message (e.g., "Implement user authentication...")
- `metadata`: JSON object for extensibility (e.g., `{ source: 'vscode', version: '1.0' }`)

---

#### Table: `messages`
Individual messages within conversation threads.

```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,  -- Original message content
  enhanced_content TEXT,  -- RAG-enhanced version (NULL if not enhanced)
  embedding vector(768),  -- Gemini text-embedding-004 (generated async)
  weight DECIMAL NOT NULL DEFAULT 1.0,  -- Composite weight for retrieval
  recency_score DECIMAL NOT NULL DEFAULT 1.0,  -- e^(-days_old/30)
  feedback_score DECIMAL DEFAULT 0.0,  -- User rating (0-1, default 0)
  ai_importance_score DECIMAL DEFAULT 0.0,  -- AI-assessed importance (0-1)
  was_enhanced BOOLEAN NOT NULL DEFAULT false,  -- Flag if RAG was used
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb  -- { source, model, tokenCount, etc }
);

-- Indexes
CREATE INDEX idx_messages_thread_created ON messages(thread_id, created_at DESC);
CREATE INDEX idx_messages_weight ON messages(weight DESC);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
CREATE INDEX idx_messages_enhanced ON messages(was_enhanced) WHERE was_enhanced = true;

-- pgvector index (requires pgvector extension)
-- NOTE: Run 'CREATE EXTENSION IF NOT EXISTS vector;' first
CREATE INDEX idx_messages_embedding ON messages
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RLS Policies
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view messages in own threads" ON messages
  FOR SELECT USING (
    thread_id IN (SELECT id FROM threads WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert messages in own threads" ON messages
  FOR INSERT WITH CHECK (
    thread_id IN (SELECT id FROM threads WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own messages" ON messages
  FOR UPDATE USING (
    thread_id IN (SELECT id FROM threads WHERE user_id = auth.uid())
  );
```

**Field Descriptions:**
- `content`: Original user message or Claude's response
- `enhanced_content`: If user enabled RAG, this contains the enhanced prompt sent to Claude
- `embedding`: 768-dimension vector (Gemini text-embedding-004)
- `weight`: Composite score = (recency * 0.4) + (feedback * 0.3) + (ai_importance * 0.3)
- `was_enhanced`: Tracks if this user message was enhanced with RAG
- `metadata`: JSON for extra info (e.g., `{ source: 'vscode_claude_cli', model: 'claude-sonnet-4', tokenCount: 1234 }`)

---

#### Table: `message_context_sources`
Tracks which past messages influenced RAG enhancement.

```sql
CREATE TABLE message_context_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enhanced_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  source_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  similarity_score DECIMAL NOT NULL,  -- Cosine similarity (0-1)
  weight_at_retrieval DECIMAL NOT NULL,  -- Weight of source when retrieved
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_context_sources_enhanced ON message_context_sources(enhanced_message_id);
CREATE INDEX idx_context_sources_source ON message_context_sources(source_message_id);

-- RLS Policies
ALTER TABLE message_context_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view context sources for own messages" ON message_context_sources
  FOR SELECT USING (
    enhanced_message_id IN (
      SELECT m.id FROM messages m
      JOIN threads t ON m.thread_id = t.id
      WHERE t.user_id = auth.uid()
    )
  );
```

**Purpose:** Audit trail for RAG enhancement, allows showing "which past conversations influenced this prompt"

---

### 2.2 Database Functions

#### Function: `calculate_message_weight`
Composite weighting formula.

```sql
CREATE OR REPLACE FUNCTION calculate_message_weight(
  days_old INTEGER,
  feedback DECIMAL,
  ai_importance DECIMAL
) RETURNS DECIMAL AS $$
BEGIN
  RETURN (
    (EXP(-days_old::DECIMAL / 30.0) * 0.4) +  -- Recency (40%)
    (COALESCE(feedback, 0.0) * 0.3) +          -- Feedback (30%)
    (COALESCE(ai_importance, 0.0) * 0.3)       -- AI importance (30%)
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

**Weighting Formula Breakdown:**
- **Recency (40%)**: Exponential decay over 30 days
  - Day 0: 1.0
  - Day 30: 0.368
  - Day 60: 0.135
- **Feedback (30%)**: User rating (0-1, default 0)
- **AI Importance (30%)**: AI-assessed relevance (0-1, generated async)

---

#### Trigger: `update_message_weight`
Auto-update weight on insert/update.

```sql
CREATE OR REPLACE FUNCTION update_message_weight()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate recency score
  NEW.recency_score := EXP(
    -EXTRACT(EPOCH FROM (NOW() - NEW.created_at)) / (30.0 * 86400.0)
  );

  -- Calculate composite weight
  NEW.weight := calculate_message_weight(
    EXTRACT(DAY FROM (NOW() - NEW.created_at))::INTEGER,
    COALESCE(NEW.feedback_score, 0.0),
    COALESCE(NEW.ai_importance_score, 0.0)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_weight_update
  BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_message_weight();
```

---

### 2.3 Prerequisites

**Required Extensions:**
```sql
CREATE EXTENSION IF NOT EXISTS vector;  -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- For text search (optional)
```

**Required Permissions:**
- Service role key for Edge Functions (to bypass RLS)
- Supabase Auth JWT validation configured

---

## 3. API Endpoints Specification

### 3.1 Authentication

**Method:** Supabase JWT Token (Bearer)

All endpoints require:
```
Authorization: Bearer <supabase_access_token>
```

**Token Source:**
- User logs in via Supabase Auth (email/password)
- Access token obtained from session: `session.access_token`
- Token includes `user_id` claim for RLS enforcement

**Error Response (401 Unauthorized):**
```json
{
  "success": false,
  "error": "Unauthorized",
  "message": "Invalid or missing access token"
}
```

---

### 3.2 POST `/api/v1/conversations/record`

**Purpose:** Record a message (user or assistant) to a conversation thread.

#### Request

**Headers:**
```
Authorization: Bearer <supabase_access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "threadId": "uuid | optional",
  "projectId": "uuid | optional",
  "featureId": "uuid | optional",
  "role": "user | assistant",
  "content": "string (required)",
  "enhancedContent": "string | optional",
  "wasEnhanced": "boolean (required)",
  "contextSources": [
    {
      "messageId": "uuid",
      "similarity": 0.85,
      "weight": 0.72
    }
  ],
  "metadata": {
    "source": "vscode_claude_cli",
    "model": "claude-sonnet-4",
    "tokenCount": 1234
  }
}
```

**Field Validations:**
- `role`: Must be `"user"` or `"assistant"`
- `content`: Required, min length 1, max length 100,000
- `enhancedContent`: Optional, max length 100,000
- `wasEnhanced`: Required boolean
- `contextSources`: Optional array, only relevant if `wasEnhanced = true`
- `threadId`: If omitted, creates new thread
- `projectId` / `featureId`: Optional context links

#### Response (201 Created)

```json
{
  "success": true,
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "thread_id": "660e8400-e29b-41d4-a716-446655440000",
  "weight": 0.92,
  "embedding_queued": true,
  "thread_title": "Implement user authentication for..."
}
```

**Response Fields:**
- `message_id`: UUID of created message
- `thread_id`: UUID of thread (new or existing)
- `weight`: Initial composite weight (recency = 1.0 if new)
- `embedding_queued`: Always `true` (Edge Function invoked)
- `thread_title`: Only returned if new thread created

#### Error Responses

**400 Bad Request:**
```json
{
  "success": false,
  "error": "Invalid input",
  "message": "Field 'content' is required"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": "Thread not found",
  "message": "Thread with id '...' does not exist or you don't have access"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Database error",
  "message": "Failed to insert message"
}
```

#### Backend Logic

1. **Extract user_id** from JWT token
2. **Validate thread ownership** (if threadId provided)
3. **Create thread if needed:**
   - Generate title from first 100 chars of `content`
   - Insert into `threads` table with `user_id`, `project_id`, `feature_id`
4. **Insert message:**
   - Store `content`, `enhanced_content`, `role`, `was_enhanced`
   - Set initial `recency_score = 1.0`
   - Trigger calculates initial `weight`
5. **Record context sources** (if `wasEnhanced = true` and `contextSources` provided):
   - Insert into `message_context_sources` for each source
6. **Update thread timestamp:**
   - Set `threads.updated_at = NOW()`
7. **Trigger async embedding generation:**
   - Call Supabase Edge Function: `generate-embeddings`
   - Pass `{ message_id, content }`
   - Don't wait for completion
8. **Return response**

**Performance Notes:**
- Embedding generation is async (non-blocking)
- Total response time should be < 200ms
- Use database connection pooling

---

### 3.3 POST `/api/v1/conversations/enhance`

**Purpose:** Enhance user's prompt with RAG (queries past conversations + current thread).

#### Request

**Headers:**
```
Authorization: Bearer <supabase_access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "prompt": "string (required)",
  "threadId": "uuid | optional",
  "projectId": "uuid | optional",
  "featureId": "uuid | optional",
  "topK": 5,
  "minWeight": 0.3
}
```

**Field Descriptions:**
- `prompt`: User's original message to enhance
- `threadId`: Current conversation (to include its history)
- `projectId`: Filter context by project
- `featureId`: Filter by feature
- `topK`: Number of context messages to retrieve (default: 5, max: 20)
- `minWeight`: Minimum weight threshold (default: 0.3)

#### Response (200 OK)

```json
{
  "success": true,
  "enhanced_prompt": "Based on your previous work with user authentication...",
  "original_prompt": "How do I implement login?",
  "context_sources": [
    {
      "message_id": "550e8400-e29b-41d4-a716-446655440000",
      "content": "Previously, you implemented JWT authentication using...",
      "full_content": "Previously, you implemented JWT authentication using Supabase Auth with email/password login. The tokens are stored in session state and refreshed automatically every hour.",
      "role": "assistant",
      "weight": 0.89,
      "similarity": 0.92,
      "created_at": "2025-11-15T14:23:00Z",
      "thread_id": "660e8400-e29b-41d4-a716-446655440000",
      "thread_title": "Authentication implementation",
      "from_current_thread": true
    },
    {
      "message_id": "770e8400-e29b-41d4-a716-446655440000",
      "content": "I need to add password reset functionality...",
      "full_content": "I need to add password reset functionality to the authentication system",
      "role": "user",
      "weight": 0.75,
      "similarity": 0.78,
      "created_at": "2025-11-10T09:15:00Z",
      "thread_id": "880e8400-e29b-41d4-a716-446655440000",
      "thread_title": "User management features",
      "from_current_thread": false
    }
  ],
  "processing_time_ms": 1847,
  "embedding_model": "text-embedding-004",
  "enhancement_model": "gemini-2.5-flash"
}
```

**Response Fields:**
- `enhanced_prompt`: AI-generated enhanced version with context injected
- `original_prompt`: Echo back user's input
- `context_sources`: Array of messages used for context
  - `content`: Preview (first 200 chars)
  - `full_content`: Complete message text
  - `from_current_thread`: `true` if from current conversation
  - `similarity`: Cosine similarity (0-1, higher = more relevant)
- `processing_time_ms`: Total API processing time

#### Error Responses

**400 Bad Request:**
```json
{
  "success": false,
  "error": "Invalid input",
  "message": "Field 'prompt' is required and must not be empty"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Enhancement failed",
  "message": "Gemini API error: Rate limit exceeded"
}
```

#### Backend Logic

1. **Extract user_id** from JWT
2. **Generate embedding** for user's prompt:
   - Call Gemini API: `text-embedding-004`
   - Input: `prompt` text
   - Output: 768-dimension vector
3. **Query vector database** for similar messages:
   ```sql
   SELECT
     m.id,
     m.content,
     m.role,
     m.weight,
     m.created_at,
     m.thread_id,
     t.title as thread_title,
     (m.embedding <=> $1::vector) as distance,
     (m.thread_id = $2) as from_current_thread
   FROM messages m
   JOIN threads t ON m.thread_id = t.id
   WHERE
     t.user_id = $3
     AND m.weight >= $4
     AND m.embedding IS NOT NULL
     ${projectId ? 'AND t.project_id = $5' : ''}
   ORDER BY
     m.embedding <=> $1::vector,
     m.weight DESC
   LIMIT $6 * 2
   ```
   - `<=>` is pgvector cosine distance operator
   - Retrieve `topK * 2` candidates initially

4. **Add current thread's recent messages** (if `threadId` provided):
   ```sql
   SELECT * FROM messages
   WHERE thread_id = $1
   ORDER BY created_at DESC
   LIMIT 10
   ```
   - Merge with vector search results
   - Deduplicate by message ID

5. **Rank and filter:**
   - Sort by: similarity first, then weight
   - Take top `topK` messages
   - Convert distance to similarity: `similarity = 1 - distance`

6. **Build context for LLM:**
   ```
   PAST RELEVANT CONTEXT:
   [user]: I need to add password reset functionality...
   [assistant]: Previously, you implemented JWT authentication using...

   USER'S NEW PROMPT:
   How do I implement login?

   TASK: Enhance the user's prompt by incorporating relevant context...
   ```

7. **Call LLM for enhancement:**
   - Model: `gemini-2.5-flash` (cost-effective)
   - Temperature: 0.3 (more deterministic)
   - Max tokens: 2000
   - System prompt instructs to maintain user's intent while adding context
   - Use existing `GeminiService.improvePrompt()` method

8. **Prepare response:**
   - Extract enhanced prompt from LLM output
   - Format context sources with previews
   - Calculate processing time

**Performance Requirements:**
- Total response time: < 3 seconds (target: < 2s)
- Embedding generation: ~200ms
- Vector search: < 100ms
- LLM enhancement: < 2s
- Use connection pooling and caching where possible

**Cost Optimization:**

- Use `text-embedding-004` ($0.000125 per 1k chars)
- Use `gemini-2.5-flash` for enhancement ($0.075/1M input tokens)
- Cache embeddings aggressively
- Note: Gemini embeddings ~6x more expensive than OpenAI, but chat is 50% cheaper

---

### 3.4 GET `/api/v1/conversations/:threadId`

**Purpose:** Retrieve full conversation thread with messages.

#### Request

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**URL Parameters:**
- `threadId`: UUID of thread to retrieve

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Messages per page (default: 50, max: 100)
- `include_enhanced`: Include `enhanced_content` field (default: false)

**Example:**
```
GET /api/v1/conversations/550e8400-e29b-41d4-a716-446655440000?page=1&limit=50&include_enhanced=true
```

#### Response (200 OK)

```json
{
  "success": true,
  "thread": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Implement user authentication",
    "project_id": "660e8400-e29b-41d4-a716-446655440000",
    "feature_id": null,
    "created_at": "2025-11-10T08:00:00Z",
    "updated_at": "2025-11-18T15:30:00Z",
    "message_count": 47
  },
  "messages": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "role": "user",
      "content": "How do I implement login?",
      "enhanced_content": "Based on your previous work with authentication...",
      "was_enhanced": true,
      "weight": 0.92,
      "created_at": "2025-11-18T15:30:00Z"
    },
    {
      "id": "880e8400-e29b-41d4-a716-446655440000",
      "role": "assistant",
      "content": "To implement login, you'll need to...",
      "enhanced_content": null,
      "was_enhanced": false,
      "weight": 0.91,
      "created_at": "2025-11-18T15:31:00Z"
    }
  ],
  "total": 47,
  "page": 1,
  "limit": 50,
  "has_more": false
}
```

**Response Fields:**
- `thread`: Thread metadata
  - `message_count`: Total messages in thread
- `messages`: Array of messages (ordered by `created_at ASC`)
  - `enhanced_content`: Only included if `include_enhanced=true`
- `total`: Total message count
- `has_more`: `true` if more pages available

#### Error Responses

**404 Not Found:**
```json
{
  "success": false,
  "error": "Thread not found",
  "message": "Thread with id '...' does not exist or you don't have access"
}
```

#### Backend Logic

1. **Extract user_id** from JWT
2. **Verify thread ownership:**
   ```sql
   SELECT * FROM threads
   WHERE id = $1 AND user_id = $2
   ```
3. **Get message count:**
   ```sql
   SELECT COUNT(*) FROM messages WHERE thread_id = $1
   ```
4. **Retrieve paginated messages:**
   ```sql
   SELECT
     id, role, content,
     ${include_enhanced ? 'enhanced_content,' : ''}
     was_enhanced, weight, created_at
   FROM messages
   WHERE thread_id = $1
   ORDER BY created_at ASC
   LIMIT $2 OFFSET $3
   ```
5. **Calculate pagination:**
   - `offset = (page - 1) * limit`
   - `has_more = total > (page * limit)`

**Performance:**
- Use indexed query on `thread_id, created_at`
- Response time: < 200ms

---

### 3.5 GET `/api/v1/conversations`

**Purpose:** List user's conversation threads.

#### Request

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**Query Parameters:**
- `project_id`: Filter by project (optional)
- `limit`: Threads per page (default: 20, max: 100)
- `offset`: Pagination offset (default: 0)

**Example:**
```
GET /api/v1/conversations?project_id=660e8400-e29b-41d4-a716-446655440000&limit=20&offset=0
```

#### Response (200 OK)

```json
{
  "success": true,
  "threads": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Implement user authentication",
      "project_id": "660e8400-e29b-41d4-a716-446655440000",
      "message_count": 47,
      "last_message_preview": "To implement login, you'll need to...",
      "last_message_at": "2025-11-18T15:31:00Z",
      "created_at": "2025-11-10T08:00:00Z",
      "updated_at": "2025-11-18T15:31:00Z"
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "title": "Fix database connection issues",
      "project_id": "660e8400-e29b-41d4-a716-446655440000",
      "message_count": 23,
      "last_message_preview": "The connection pool configuration should...",
      "last_message_at": "2025-11-17T10:15:00Z",
      "created_at": "2025-11-16T14:20:00Z",
      "updated_at": "2025-11-17T10:15:00Z"
    }
  ],
  "total": 42
}
```

**Response Fields:**
- `threads`: Array of thread summaries (ordered by `updated_at DESC`)
  - `last_message_preview`: First 100 chars of most recent message
  - `last_message_at`: Timestamp of most recent message
- `total`: Total thread count matching filters

#### Backend Logic

```sql
SELECT
  t.id,
  t.title,
  t.project_id,
  COUNT(m.id) as message_count,
  (SELECT content FROM messages
   WHERE thread_id = t.id
   ORDER BY created_at DESC
   LIMIT 1
  ) as last_message_full,
  (SELECT created_at FROM messages
   WHERE thread_id = t.id
   ORDER BY created_at DESC
   LIMIT 1
  ) as last_message_at,
  t.created_at,
  t.updated_at
FROM threads t
LEFT JOIN messages m ON m.thread_id = t.id
WHERE t.user_id = $1
  ${project_id ? 'AND t.project_id = $2' : ''}
GROUP BY t.id
ORDER BY t.updated_at DESC
LIMIT $3 OFFSET $4
```

- Truncate `last_message_full` to 100 chars for `last_message_preview`

**Performance:**
- Response time: < 300ms
- Use materialized view or denormalized fields for large datasets

---

### 3.6 GET `/api/v1/conversations/:threadId/stream` (SSE)

**Purpose:** Server-Sent Events stream for real-time message updates.

**Priority:** OPTIONAL (Phase 8 - Advanced Features)

#### Request

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**URL Parameters:**
- `threadId`: UUID of thread to monitor

**Example:**
```
GET /api/v1/conversations/550e8400-e29b-41d4-a716-446655440000/stream
```

#### Response

**Content-Type:** `text/event-stream`

**Stream Format:**
```
event: connected
data: {"thread_id": "550e8400-e29b-41d4-a716-446655440000", "timestamp": "2025-11-18T15:30:00Z"}

event: message
data: {"id": "770e8400-...", "role": "user", "content": "How do I...", "created_at": "2025-11-18T15:31:00Z"}

event: message
data: {"id": "880e8400-...", "role": "assistant", "content": "To implement...", "created_at": "2025-11-18T15:31:30Z"}

event: ping
data: {"timestamp": "2025-11-18T15:32:00Z"}
```

**Event Types:**
- `connected`: Initial connection confirmation
- `message`: New message inserted
- `update`: Message updated (e.g., embedding added)
- `ping`: Keepalive every 30 seconds

#### Backend Implementation

Use Supabase Realtime subscriptions:

```javascript
// Verify thread ownership
const thread = await db.threads.findOne({ id: threadId, user_id: userId });
if (!thread) {
  return res.status(404).json({ error: 'Thread not found' });
}

// Set SSE headers
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no'
});

// Send initial connection event
res.write(`event: connected\n`);
res.write(`data: ${JSON.stringify({ thread_id: threadId, timestamp: new Date() })}\n\n`);

// Subscribe to Supabase Realtime
const subscription = supabase
  .from(`messages:thread_id=eq.${threadId}`)
  .on('INSERT', payload => {
    res.write(`event: message\n`);
    res.write(`data: ${JSON.stringify(payload.new)}\n\n`);
  })
  .on('UPDATE', payload => {
    res.write(`event: update\n`);
    res.write(`data: ${JSON.stringify(payload.new)}\n\n`);
  })
  .subscribe();

// Keepalive ping
const pingInterval = setInterval(() => {
  res.write(`event: ping\n`);
  res.write(`data: ${JSON.stringify({ timestamp: new Date() })}\n\n`);
}, 30000);

// Cleanup on disconnect
req.on('close', () => {
  clearInterval(pingInterval);
  subscription.unsubscribe();
  res.end();
});
```

**Requirements:**
- Enable Supabase Realtime on `messages` table
- Handle client reconnection logic
- Implement connection timeout (10 minutes idle)

---

## 4. Edge Function: Generate Embeddings

### 4.1 Overview

**Purpose:** Asynchronously generate embeddings and AI importance scores after message recording.

**Trigger:** Invoked by `/api/v1/conversations/record` endpoint (fire-and-forget).

**Function Name:** `generate-embeddings`

**Runtime:** Deno (Supabase Edge Functions)

**Location:** `supabase/functions/generate-embeddings/index.ts`

---

### 4.2 Input

```json
{
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "content": "How do I implement user authentication?"
}
```

---

### 4.3 Processing Steps

1. **Generate embedding:**
   - Call Gemini API: `POST https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent`
   - Model: `text-embedding-004`
   - Input: `content` text
   - Output: 768-dimension vector

2. **Calculate AI importance score:**
   - Call Gemini API: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
   - Model: `gemini-2.5-flash`
   - System prompt: "Rate the importance of this message for future context retrieval. Return ONLY a number between 0.0 and 1.0."
   - User prompt: `content`
   - Parse response to float (0-1)

3. **Update message:**
   ```sql
   UPDATE messages
   SET
     embedding = $1,
     ai_importance_score = $2
   WHERE id = $3
   ```
   - Weight will be recalculated automatically by trigger

---

### 4.4 Output

```json
{
  "success": true,
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "ai_importance_score": 0.78,
  "processing_time_ms": 1234
}
```

---

### 4.5 Error Handling

**Retry Logic:**
- Retry up to 3 times on Gemini API errors
- Exponential backoff: 1s, 2s, 4s

**Fallback:**
- If embedding generation fails: Log error, skip update (embedding remains NULL)
- If AI importance fails: Default to 0.5
- Never throw errors that would block message recording

**Logging:**
- Log all API calls (duration, cost)
- Log failures for monitoring
- Monitor Gemini API quota usage

---

### 4.6 Environment Variables

Required secrets (set via `supabase secrets set`):

```bash
GEMINI_API_KEY=AIza...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # Bypass RLS for updates
```

---

### 4.7 Deployment

```bash
# Deploy function
supabase functions deploy generate-embeddings --no-verify-jwt

# Set secrets
supabase secrets set GEMINI_API_KEY=AIza...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

### 4.8 Performance Requirements

- Processing time: < 2 seconds per message
- Cost per message: ~$0.00025 (embedding) + ~$0.00001 (importance) = $0.00026
- Handle up to 100 concurrent invocations
- Note: Gemini embeddings are more expensive but offset by cheaper chat costs

---

### 4.9 Reference Implementation

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  const startTime = Date.now();

  try {
    const { message_id, content } = await req.json();

    // 1. Generate embedding via Gemini
    const embeddingRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: {
            parts: [{ text: content }]
          }
        })
      }
    );
    const embeddingData = await embeddingRes.json();
    const embedding = embeddingData.embedding.values;

    // 2. Calculate AI importance via Gemini
    const importanceRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Rate the importance of this message for future context retrieval. Return ONLY a number between 0.0 and 1.0.\n\nMessage: ${content}`
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 10
          }
        })
      }
    );
    const importanceData = await importanceRes.json();
    const aiImportanceScore = parseFloat(
      importanceData.candidates[0].content.parts[0].text.trim()
    ) || 0.5;

    // 3. Update message
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabase
      .from('messages')
      .update({
        embedding,
        ai_importance_score: aiImportanceScore
      })
      .eq('id', message_id);

    if (error) throw error;

    return new Response(
      JSON.stringify({
        success: true,
        message_id,
        ai_importance_score: aiImportanceScore,
        processing_time_ms: Date.now() - startTime
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
});
```

---

## 5. Testing Requirements

### 5.1 Unit Tests

**Database Functions:**
- [ ] `calculate_message_weight()` returns correct values
- [ ] Weight trigger updates on insert/update
- [ ] Recency score decays correctly over time

**API Endpoints:**
- [ ] Record message with valid input
- [ ] Record message creates new thread
- [ ] Record message with invalid thread returns 404
- [ ] Enhancement with valid prompt returns sources
- [ ] Enhancement with no embeddings returns empty sources
- [ ] List conversations filters by project
- [ ] Get thread returns paginated messages

**Edge Function:**
- [ ] Embedding generation succeeds
- [ ] AI importance score calculated
- [ ] Database updated correctly
- [ ] Error handling (API failures)

---

### 5.2 Integration Tests

- [ ] End-to-end: Record → Embed → Enhance → Retrieve
- [ ] Authentication: Unauthorized requests return 401
- [ ] RLS: Users can't access other users' threads
- [ ] Pagination: Correct page navigation
- [ ] SSE: Real-time updates work (optional)

---

### 5.3 Performance Tests

- [ ] Record endpoint: < 200ms response time
- [ ] Enhancement endpoint: < 3s response time
- [ ] Vector search: < 100ms for 10k messages
- [ ] List conversations: < 300ms for 1000 threads
- [ ] Concurrent load: 100 req/s without degradation

---

### 5.4 Test Data

Provide sample test data:
- 10 test users
- 50 threads per user
- 20-100 messages per thread
- Mix of enhanced and non-enhanced messages
- Various project/feature associations

---

## 6. API Client Usage Examples

### 6.1 Record User Message

```javascript
const result = await apiClient.recordMessage({
  threadId: '550e8400-e29b-41d4-a716-446655440000',
  projectId: '660e8400-e29b-41d4-a716-446655440000',
  role: 'user',
  content: 'How do I implement login?',
  enhancedContent: 'Based on your previous work...',
  wasEnhanced: true,
  contextSources: [
    { messageId: '770e8400-...', similarity: 0.92, weight: 0.89 }
  ],
  metadata: { source: 'vscode_claude_cli' }
});

console.log('Message ID:', result.message_id);
console.log('Weight:', result.weight);
```

---

### 6.2 Enhance Prompt

```javascript
const enhancement = await apiClient.enhancePrompt({
  prompt: 'How do I implement login?',
  threadId: '550e8400-e29b-41d4-a716-446655440000',
  projectId: '660e8400-e29b-41d4-a716-446655440000',
  topK: 5,
  minWeight: 0.3
});

console.log('Enhanced:', enhancement.enhanced_prompt);
console.log('Context sources:', enhancement.context_sources.length);
console.log('Processing time:', enhancement.processing_time_ms + 'ms');
```

---

### 6.3 List Conversations

```javascript
const threads = await apiClient.listThreads(
  '660e8400-e29b-41d4-a716-446655440000',  // projectId
  20,  // limit
  0    // offset
);

threads.threads.forEach(thread => {
  console.log(`${thread.title} (${thread.message_count} messages)`);
  console.log(`  Last: ${thread.last_message_preview}`);
});
```

---

### 6.4 Get Thread Messages

```javascript
const conversation = await apiClient.getThread(
  '550e8400-e29b-41d4-a716-446655440000',
  1,    // page
  true  // include_enhanced
);

console.log('Thread:', conversation.thread.title);
conversation.messages.forEach(msg => {
  console.log(`[${msg.role}]: ${msg.content}`);
  if (msg.was_enhanced) {
    console.log(`  Enhanced: ${msg.enhanced_content}`);
  }
});
```

---

## 7. Monitoring & Observability

### 7.1 Metrics to Track

**API Performance:**
- Request count per endpoint
- Response time (p50, p95, p99)
- Error rate (4xx, 5xx)
- Throughput (req/s)

**Database:**
- Connection pool utilization
- Query execution time
- Slow query log (> 500ms)
- Table sizes (`threads`, `messages`)

**Edge Function:**
- Invocation count
- Success/failure rate
- Processing time
- Gemini API costs and quota usage

**Business Metrics:**
- Total threads created
- Total messages recorded
- Enhancement usage rate
- Average messages per thread

---

### 7.2 Logging

**Format:** JSON structured logs

**Required Fields:**
- `timestamp`: ISO 8601
- `level`: `info` | `warn` | `error`
- `endpoint`: API route
- `user_id`: From JWT
- `request_id`: UUID for tracing
- `duration_ms`: Request duration

**Example:**
```json
{
  "timestamp": "2025-11-18T15:30:00.123Z",
  "level": "info",
  "endpoint": "POST /api/v1/conversations/enhance",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "request_id": "req_abc123",
  "duration_ms": 1847,
  "context_sources_count": 5,
  "topK": 5
}
```

---

### 7.3 Alerts

Set up alerts for:
- [ ] Error rate > 5% (5 min window)
- [ ] Response time p95 > 5s
- [ ] Edge function failure rate > 10%
- [ ] Database connection pool exhausted
- [ ] Gemini API quota exceeded (track daily limits)

---

## 8. Security Considerations

### 8.1 Authentication & Authorization

- [ ] All endpoints require valid Supabase JWT token
- [ ] RLS policies enforce user isolation
- [ ] Service role key only used in Edge Functions (not exposed)
- [ ] API tokens stored securely in VS Code secrets

---

### 8.2 Input Validation

- [ ] Validate all UUIDs (format, existence, ownership)
- [ ] Sanitize text inputs (max length, no SQL injection)
- [ ] Validate enum values (`role`, etc.)
- [ ] Rate limiting: 100 req/min per user

---

### 8.3 Data Privacy

- [ ] Users can only access their own threads/messages
- [ ] Embeddings not shared between users
- [ ] No cross-user context leakage in RAG
- [ ] GDPR compliance: User can delete all data

---

### 8.4 API Security

- [ ] HTTPS only (TLS 1.2+)
- [ ] CORS configured for VS Code extension origin
- [ ] Rate limiting per user
- [ ] Request size limits (1MB max)
- [ ] SQL injection prevention (parameterized queries)

---

## 9. Cost Estimation

### 9.1 Gemini API Costs

**Per Message:**

- Embedding: ~200 chars × $0.000125/1k chars = $0.000025
- AI Importance: ~100 tokens × $0.075/1M (gemini-2.5-flash) = $0.0000075
- **Total per message:** ~$0.000033

**Per Enhancement:**

- Query embedding: $0.000025
- Enhancement (500 tokens avg): ~$0.000038
- **Total per enhancement:** ~$0.000063

**Monthly (1000 users, 100 messages each):**

- Messages: 100k × $0.000033 = $3.30
- Enhancements (30% usage): 30k × $0.000063 = $1.89
- **Total:** ~$5.20/month

**Cost Comparison vs OpenAI:**

- Embeddings: ~6x more expensive (Gemini text-embedding-004 vs OpenAI text-embedding-3-small)
- Chat: ~50% cheaper (Gemini gemini-2.5-flash vs OpenAI gpt-4o-mini)
- Net result: Slightly higher overall cost (~4% more), but already integrated

---

### 9.2 Supabase Costs

**Database:**
- Storage: ~100MB per 100k messages = $0.021/month
- Realtime: If using SSE, ~$0.10/month per 100 concurrent connections

**Edge Functions:**
- 100k invocations/month = Free tier (2M included)

**Total Supabase:** < $1/month for small scale

---

### 9.3 Total Estimated Cost

- Small scale (1k users): ~$10/month
- Medium scale (10k users): ~$100/month
- Large scale (100k users): ~$1000/month

---

## 10. Deployment Checklist

### Pre-Deployment

- [ ] Database migrations tested on staging
- [ ] All indexes created
- [ ] RLS policies enabled and tested
- [ ] pgvector extension installed
- [ ] Environment variables configured
- [ ] Gemini API key set (with embeddings & chat enabled)
- [ ] Supabase service role key set

### Deployment

- [ ] Run database migrations
- [ ] Deploy Edge Function
- [ ] Deploy API endpoints
- [ ] Enable Supabase Realtime (if using SSE)
- [ ] Configure rate limiting
- [ ] Set up monitoring/alerts

### Post-Deployment

- [ ] Smoke test all endpoints
- [ ] Verify authentication works
- [ ] Test RAG enhancement quality
- [ ] Monitor error rates
- [ ] Check Gemini API usage and quota

---

## 11. Support & Contact

**For Questions:**
- Technical lead: [Name]
- Email: [email]
- Slack: #api-development

**Documentation:**
- API Reference: [Link to OpenAPI/Swagger docs]
- Database Schema: [Link to ERD]
- Postman Collection: [Link]

**Issue Tracking:**
- Jira Project: [Link]
- Bug reports: [Link]

---

## 12. Appendix

### A. Example SQL Queries

**Get user's conversation stats:**
```sql
SELECT
  u.email,
  COUNT(DISTINCT t.id) as thread_count,
  COUNT(m.id) as message_count,
  COUNT(CASE WHEN m.was_enhanced THEN 1 END) as enhanced_count
FROM auth.users u
LEFT JOIN threads t ON t.user_id = u.id
LEFT JOIN messages m ON m.thread_id = t.id
WHERE u.id = '550e8400-e29b-41d4-a716-446655440000'
GROUP BY u.id, u.email;
```

**Find most relevant messages for a topic:**
```sql
SELECT
  m.content,
  m.weight,
  t.title,
  m.created_at
FROM messages m
JOIN threads t ON m.thread_id = t.id
WHERE t.user_id = '550e8400-e29b-41d4-a716-446655440000'
  AND m.embedding IS NOT NULL
ORDER BY m.embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 10;
```

---

### B. OpenAPI/Swagger Schema

See separate file: `api-openapi.yaml`

---

### C. Postman Collection

See separate file: `conversations-api.postman_collection.json`

---

**End of Document**
