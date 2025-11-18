# API Requirements - Changelog

## Version 1.1 (2025-11-18)

### Changes: OpenAI → Google Gemini

This document has been updated to reflect the use of **Google Gemini** APIs instead of OpenAI, matching the existing implementation in the codebase.

---

## Key Changes

### 1. Embedding Model
**Before:** OpenAI `text-embedding-3-small` (1536 dimensions)
**After:** Google Gemini `text-embedding-004` (768 dimensions)

**Impact:**
- Vector column changed from `vector(1536)` to `vector(768)`
- pgvector index configuration remains the same
- API endpoint: `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent`

---

### 2. Enhancement LLM
**Before:** OpenAI `gpt-4o-mini`
**After:** Google Gemini `gemini-2.5-flash`

**Impact:**
- Uses existing `GeminiService.improvePrompt()` method
- API endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
- Temperature: 0.3 (same)
- Max tokens: 2000 (same)

---

### 3. Environment Variables
**Before:**
```bash
OPENAI_API_KEY=sk-...
```

**After:**
```bash
GEMINI_API_KEY=AIza...
```

---

### 4. Cost Changes

#### Per Message Recording
| Component | OpenAI | Gemini | Change |
|-----------|---------|---------|--------|
| Embedding | $0.000004 | $0.000025 | +525% |
| AI Importance | $0.000015 | $0.0000075 | -50% |
| **Total** | **$0.00002** | **$0.000033** | **+65%** |

#### Per Enhancement
| Component | OpenAI | Gemini | Change |
|-----------|---------|---------|--------|
| Query Embedding | $0.000004 | $0.000025 | +525% |
| LLM Enhancement | $0.00008 | $0.000038 | -52.5% |
| **Total** | **$0.00009** | **$0.000063** | **-30%** |

#### Monthly Cost (1000 users, 100 messages each, 30% enhancement rate)
| Item | OpenAI | Gemini | Change |
|------|---------|---------|--------|
| Recording | $2.00 | $3.30 | +65% |
| Enhancement | $2.70 | $1.89 | -30% |
| **Total** | **$5.00** | **$5.20** | **+4%** |

**Conclusion:** Slightly higher overall cost, but offset by eliminating need for new API integration.

---

### 5. API Response Fields Updated

**Response field changes:**
```json
{
  "embedding_model": "text-embedding-004",        // was: text-embedding-3-small
  "enhancement_model": "gemini-2.5-flash"         // was: gpt-4o-mini
}
```

**Error messages:**
- "OpenAI API error" → "Gemini API error"

---

### 6. Edge Function Implementation

**Changes in `generate-embeddings` function:**

#### Embedding Generation
```typescript
// BEFORE (OpenAI)
const embeddingRes = await fetch('https://api.openai.com/v1/embeddings', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'text-embedding-3-small',
    input: content
  })
});

// AFTER (Gemini)
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
```

#### Response Parsing
```typescript
// BEFORE (OpenAI)
const embedding = embeddingData.data[0].embedding;

// AFTER (Gemini)
const embedding = embeddingData.embedding.values;
```

#### AI Importance Calculation
```typescript
// BEFORE (OpenAI)
const importanceRes = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Rate the importance...'
      },
      { role: 'user', content }
    ],
    temperature: 0.3,
    max_tokens: 10
  })
});
const aiImportanceScore = parseFloat(
  importanceData.choices[0].message.content.trim()
) || 0.5;

// AFTER (Gemini)
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
const aiImportanceScore = parseFloat(
  importanceData.candidates[0].content.parts[0].text.trim()
) || 0.5;
```

---

### 7. Monitoring & Alerts

**Updated metrics:**
- "OpenAI API costs" → "Gemini API costs and quota usage"
- "OpenAI API quota exceeded" → "Gemini API quota exceeded (track daily limits)"

**Additional monitoring:**
- Gemini API has different rate limits than OpenAI
- Monitor daily quota consumption (Gemini has per-day limits)
- Track embedding vs chat API usage separately

---

### 8. Deployment Checklist Updates

**Environment setup:**
- [ ] ~~OpenAI API key set~~ → Gemini API key set (with embeddings & chat enabled)
- [ ] Verify Gemini API key has access to:
  - `text-embedding-004` model
  - `gemini-2.5-flash` model
- [ ] Check Gemini API quotas and rate limits

**Testing:**
- [ ] ~~Check OpenAI API usage~~ → Check Gemini API usage and quota
- [ ] Verify embedding dimensions (768 vs 1536)
- [ ] Test vector similarity search with 768-dim vectors

---

## Rationale for Change

### Why Gemini Instead of OpenAI?

1. **Already Integrated**: The codebase already has `GeminiService` implemented and working
2. **No New Dependencies**: Avoids adding OpenAI SDK and API key management
3. **Proven Implementation**: `GeminiService.improvePrompt()` is already tested and in production
4. **Minimal Cost Difference**: Only 4% more expensive (~$0.20/month for 1000 users)
5. **Consistent Provider**: All AI operations use single provider (Gemini)

### Trade-offs

**Advantages:**
- ✅ No code changes needed for chat/enhancement (reuse `GeminiService`)
- ✅ Single API key to manage
- ✅ Chat/enhancement 50% cheaper than OpenAI
- ✅ Consistent with existing architecture

**Disadvantages:**
- ❌ Embeddings 6x more expensive
- ❌ Smaller embedding dimension (768 vs 1536)
- ❌ Less mature embedding model than OpenAI

**Net Assessment:** Trade-off is acceptable given integration benefits and minimal cost increase.

---

## Files Changed in API_REQUIREMENTS.md

### Section Changes
1. **Document Information**: Added AI provider version
2. **Executive Summary**: Added Gemini provider summary
3. **Database Schema**: Changed embedding vector size (1536 → 768)
4. **API Endpoints**: Updated model names in responses
5. **Edge Function**: Complete rewrite for Gemini APIs
6. **Cost Estimation**: Recalculated all costs for Gemini
7. **Monitoring**: Updated metrics and alerts
8. **Deployment**: Changed environment variables

### Total Changes
- **Lines modified**: ~50 lines
- **Code blocks rewritten**: 3 (Edge Function, API examples, deployment)
- **Cost tables updated**: 3 tables

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-18 | Initial version (OpenAI-based) |
| 1.1 | 2025-11-18 | Updated to use Google Gemini |

---

## Next Steps for API Development Team

### Before Starting Implementation

1. **Verify Gemini API Access**:
   ```bash
   # Test embedding API
   curl -X POST \
     "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=$GEMINI_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"content":{"parts":[{"text":"Hello world"}]}}'

   # Test chat API
   curl -X POST \
     "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$GEMINI_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"contents":[{"parts":[{"text":"Say hello"}]}]}'
   ```

2. **Check Quotas**:
   - Visit Google AI Studio: https://aistudio.google.com/
   - Verify rate limits and quotas for both models
   - Consider applying for quota increases if needed

3. **Review Existing GeminiService**:
   - Examine `/Users/guyduncan/my-first-vscode-extension/src/geminiService.ts` (if exists in backend)
   - Reuse authentication and API call patterns
   - Use same error handling and retry logic

### Implementation Priorities

**Phase 1 (Critical - Week 1):**
1. Database schema with vector(768)
2. POST `/api/v1/conversations/record`
3. Basic Edge Function for embeddings

**Phase 2 (High - Week 1-2):**
1. POST `/api/v1/conversations/enhance` with Gemini
2. GET endpoints for conversation retrieval
3. Vector similarity search

**Phase 3 (Medium - Week 2-3):**
1. AI importance scoring
2. Weight calculation optimization
3. Performance tuning

**Phase 4 (Low - Week 3+):**
1. SSE streaming (optional)
2. Advanced analytics
3. Cost optimization

---

## Questions for API Team?

If you have questions about the Gemini implementation, please reach out:

1. **Gemini API specifics**: Check Google AI documentation
2. **Existing GeminiService**: Review current codebase implementation
3. **Vector dimensions**: 768-dim embeddings sufficient for semantic search
4. **Cost concerns**: Budget ~$5-10/month for small scale testing

**Documentation Links:**
- Gemini Embeddings: https://ai.google.dev/gemini-api/docs/embeddings
- Gemini Chat: https://ai.google.dev/gemini-api/docs/text-generation
- pgvector with 768-dim: Works identically to 1536-dim
