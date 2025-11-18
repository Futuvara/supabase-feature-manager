# Quick Start Guide: Claude Integration Development

## 🚀 Get Started in 15 Minutes

This guide gets you up and running with local development for the Claude CLI integration feature.

---

## Prerequisites Checklist

Before you begin, ensure you have:

- [ ] **Node.js 18+** installed (`node --version`)
- [ ] **PostgreSQL 15+** with pgvector (`psql --version`)
- [ ] **Supabase CLI** installed (`supabase --version`)
- [ ] **Git** for version control
- [ ] **VS Code** for extension development
- [ ] **Claude CLI** installed (`which claude`)
- [ ] **Gemini API Key** (get from https://aistudio.google.com/)

---

## Backend Setup (15 minutes)

### Step 1: Database Setup

```bash
# 1. Create local Supabase project
cd backend
supabase init

# 2. Start local Supabase (Docker required)
supabase start

# 3. Get your local connection details
supabase status
# Note: Copy SUPABASE_URL and SERVICE_ROLE_KEY

# 4. Install pgvector extension
psql -U postgres -d postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 5. Run migrations
supabase db push
```

**Expected Output:**
```
✅ Supabase running at: http://localhost:54321
✅ Database URL: postgresql://postgres:postgres@localhost:54322/postgres
✅ API URL: http://localhost:54321
```

---

### Step 2: Environment Variables

Create `backend/.env`:
```bash
# Local Supabase
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=<from supabase status>

# Gemini API
GEMINI_API_KEY=AIza...

# Server
NODE_ENV=development
PORT=3000
```

---

### Step 3: Install & Run API

```bash
# Install dependencies
npm install

# Run API server
npm run dev
```

**Test it works:**
```bash
# Should return 200 OK
curl http://localhost:3000/health
```

---

### Step 4: Deploy Edge Function (Local)

```bash
# Create function
mkdir -p supabase/functions/generate-embeddings
cp ../docs/edge-function-example.ts supabase/functions/generate-embeddings/index.ts

# Set secrets
supabase secrets set GEMINI_API_KEY=AIza...

# Deploy locally
supabase functions deploy generate-embeddings --no-verify-jwt

# Test it
curl -X POST http://localhost:54321/functions/v1/generate-embeddings \
  -H "Content-Type: application/json" \
  -d '{"message_id":"test-123","content":"Hello world"}'
```

---

## Frontend Setup (10 minutes)

### Step 1: Install Extension Dependencies

```bash
cd /Users/guyduncan/my-first-vscode-extension
npm install
```

---

### Step 2: Configure Local API

Create or update `.vscode/settings.json`:
```json
{
  "supabaseFeatures.apiBaseUrl": "http://localhost:3000/api"
}
```

---

### Step 3: Run Extension in Development

```bash
# Option A: VS Code command palette
# Press F5 or Cmd+Shift+D → "Run Extension"

# Option B: npm script
npm run compile
code --extensionDevelopmentPath=$PWD .
```

**Expected:** New VS Code window opens with extension loaded.

---

### Step 4: Verify Setup

In the new VS Code window:

1. Open Command Palette (Cmd+Shift+P)
2. Type "Supabase Features"
3. You should see extension commands
4. Open sidebar panel (Supabase icon)
5. Log in with test credentials

**Test credentials:**
```
Email: test@example.com
Password: testpassword123
```

---

## Test the Full Flow

### 1. Create Test Conversation

```bash
# Insert test data
psql -U postgres -d postgres << EOF
INSERT INTO threads (id, user_id, title, project_id)
VALUES ('test-thread-1', '<your-user-id>', 'Test Conversation', null);

INSERT INTO messages (id, thread_id, role, content, was_enhanced)
VALUES
  ('msg-1', 'test-thread-1', 'user', 'How do I create a button?', false),
  ('msg-2', 'test-thread-1', 'assistant', 'You can create a button using...', false);
EOF
```

---

### 2. Test Recording Endpoint

```bash
curl -X POST http://localhost:3000/api/v1/conversations/record \
  -H "Authorization: Bearer <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "user",
    "content": "Test message",
    "wasEnhanced": false
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message_id": "...",
  "thread_id": "...",
  "weight": 1.0,
  "embedding_queued": true
}
```

---

### 3. Test Enhancement Endpoint

First, wait for embeddings to generate (check database):
```sql
SELECT id, content, embedding IS NOT NULL as has_embedding
FROM messages;
```

Then test enhancement:
```bash
curl -X POST http://localhost:3000/api/v1/conversations/enhance \
  -H "Authorization: Bearer <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "How do I style a button?",
    "topK": 3,
    "minWeight": 0.3
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "enhanced_prompt": "Based on your previous question...",
  "context_sources": [...]
}
```

---

### 4. Test Claude Tab in Extension

1. Open extension in dev window
2. Go to Feature tab
3. Select a feature
4. Click "Execute on code"
5. Should switch to Claude tab
6. Prompt should appear in input
7. Click "Run"
8. Claude should respond (if CLI installed)

---

## Troubleshooting

### ❌ Database Connection Failed

**Error:** `ECONNREFUSED localhost:54322`

**Solution:**
```bash
# Check if Supabase is running
supabase status

# If not, start it
supabase start

# Check Docker containers
docker ps | grep supabase
```

---

### ❌ pgvector Extension Not Found

**Error:** `type "vector" does not exist`

**Solution:**
```bash
# Connect to database
psql -U postgres -d postgres

# Install extension
CREATE EXTENSION IF NOT EXISTS vector;

# Verify
\dx
```

---

### ❌ Gemini API Error

**Error:** `Gemini API key invalid`

**Solution:**
1. Go to https://aistudio.google.com/
2. Create new API key
3. Enable "Generative Language API"
4. Update `.env` file
5. Restart server

---

### ❌ Claude CLI Not Found

**Error:** `Claude CLI not found in PATH`

**Solution:**
```bash
# Install Claude CLI
npm install -g @anthropic-ai/claude-cli

# Or download from: https://claude.ai/cli

# Verify installation
which claude
claude --version
```

---

### ❌ Extension Won't Load

**Error:** Extension not appearing in dev window

**Solution:**
```bash
# Rebuild extension
npm run compile

# Check for errors
npm run lint

# Clean and rebuild
rm -rf out/
npm run compile

# Try again
code --extensionDevelopmentPath=$PWD .
```

---

## Development Workflow

### Making Changes

**Backend:**
```bash
# 1. Make changes to API code
# 2. Server auto-reloads (nodemon)
# 3. Test with curl or Postman
# 4. Commit changes

git add .
git commit -m "feat: add enhancement endpoint"
git push origin feature/claude-integration
```

**Frontend:**
```bash
# 1. Make changes to extension code
# 2. Reload extension window (Cmd+R)
# 3. Test in extension
# 4. Commit changes

git add .
git commit -m "feat: add Claude tab UI"
git push origin feature/claude-integration
```

---

### Database Migrations

```bash
# Create new migration
supabase migration new add_context_sources_table

# Edit migration file in supabase/migrations/

# Apply migration
supabase db push

# Reset database (⚠️ DELETES DATA)
supabase db reset
```

---

### Debugging

**Backend API:**
```bash
# Run with debugger
npm run debug

# In VS Code, attach debugger:
# 1. Open "Run and Debug" panel
# 2. Select "Attach to Node"
# 3. Set breakpoints
```

**Frontend Extension:**
```bash
# In extension dev window:
# 1. Help > Toggle Developer Tools
# 2. Console shows logs
# 3. Network tab shows API calls

# In main VS Code window:
# 1. Set breakpoints in .ts files
# 2. Press F5 to debug
```

---

## Useful Commands

### Database
```bash
# View logs
supabase logs

# Connect to database
psql -U postgres -d postgres

# View tables
\dt

# View messages
SELECT * FROM messages LIMIT 10;

# Check embeddings
SELECT COUNT(*) FROM messages WHERE embedding IS NOT NULL;
```

---

### API Testing
```bash
# Health check
curl http://localhost:3000/health

# List threads
curl http://localhost:3000/api/v1/conversations \
  -H "Authorization: Bearer <token>"

# Get thread
curl http://localhost:3000/api/v1/conversations/<thread-id> \
  -H "Authorization: Bearer <token>"
```

---

### Extension
```bash
# Compile TypeScript
npm run compile

# Watch mode (auto-compile)
npm run watch

# Run tests
npm test

# Lint
npm run lint

# Package extension
vsce package
```

---

## Next Steps

Once you have everything running:

1. ✅ **Read the Build Plan:** [BUILD_PLAN.md](BUILD_PLAN.md)
2. ✅ **Review API Requirements:** [API_REQUIREMENTS.md](API_REQUIREMENTS.md)
3. ✅ **Check Current Phase:** See which phase you're implementing
4. ✅ **Create Feature Branch:** `git checkout -b feature/your-phase`
5. ✅ **Start Coding:** Follow the phase tasks
6. ✅ **Test Thoroughly:** Use the test scenarios
7. ✅ **Submit PR:** When phase is complete

---

## Getting Help

### Documentation
- [Build Plan](BUILD_PLAN.md) - Full implementation plan
- [API Requirements](API_REQUIREMENTS.md) - API specifications
- [API Changelog](API_REQUIREMENTS_CHANGELOG.md) - OpenAI → Gemini changes

### Example Code
- Edge Function: [API_REQUIREMENTS.md](API_REQUIREMENTS.md) Section 4.9
- API Client: [src/promptApiClient.ts](src/promptApiClient.ts)
- Existing UI: [src/enhancedSidebarProvider.ts](src/enhancedSidebarProvider.ts)

### External Resources
- [Gemini API Docs](https://ai.google.dev/gemini-api/docs)
- [Supabase Docs](https://supabase.com/docs)
- [pgvector Guide](https://github.com/pgvector/pgvector)
- [VS Code Extension API](https://code.visualstudio.com/api)

### Team Contacts
- Slack: #claude-integration
- Email: dev-team@example.com
- GitHub: [Issues](https://github.com/your-repo/issues)

---

## Common Development Tasks

### Add a New API Endpoint

1. **Create route:**
   ```typescript
   // backend/routes/conversations.ts
   router.post('/new-endpoint', async (req, res) => {
     // Implementation
   });
   ```

2. **Add to controller:**
   ```typescript
   // backend/controllers/conversationsController.ts
   export async function handleNewEndpoint(req, res) {
     // Logic
   }
   ```

3. **Test:**
   ```bash
   curl -X POST http://localhost:3000/api/v1/conversations/new-endpoint \
     -H "Authorization: Bearer <token>" \
     -d '{"test": "data"}'
   ```

---

### Add a New UI Component

1. **Add HTML:**
   ```typescript
   // src/enhancedSidebarProvider.ts
   // In _getHtmlForWebview() method
   <div id="newComponent">...</div>
   ```

2. **Add CSS:**
   ```css
   #newComponent {
     padding: 10px;
     background: var(--vscode-editor-background);
   }
   ```

3. **Add JavaScript:**
   ```javascript
   document.getElementById('newComponent').addEventListener('click', () => {
     vscode.postMessage({ type: 'newAction' });
   });
   ```

4. **Handle message:**
   ```typescript
   case 'newAction':
     await this.handleNewAction();
     break;
   ```

---

### Test Vector Search Locally

```sql
-- Insert test message with embedding
INSERT INTO messages (thread_id, role, content, embedding)
VALUES (
  'test-thread-1',
  'user',
  'How do I create a button?',
  '[0.1, 0.2, 0.3, ...]'::vector(768)
);

-- Test similarity search
SELECT id, content,
  (embedding <=> '[0.1, 0.2, 0.3, ...]'::vector(768)) as distance
FROM messages
ORDER BY distance
LIMIT 5;
```

---

## Environment-Specific Configuration

### Development
```bash
SUPABASE_URL=http://localhost:54321
NODE_ENV=development
LOG_LEVEL=debug
```

### Staging
```bash
SUPABASE_URL=https://staging.supabase.co
NODE_ENV=staging
LOG_LEVEL=info
```

### Production
```bash
SUPABASE_URL=https://requ.futuvara.com
NODE_ENV=production
LOG_LEVEL=warn
```

---

**Ready to build? Start with [BUILD_PLAN.md](BUILD_PLAN.md) Phase 1! 🚀**
