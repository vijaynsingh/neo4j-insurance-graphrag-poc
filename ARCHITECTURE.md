# Architecture — Neo4j Insurance GraphRAG POC

Design notes for the retrieval pipeline, graph model, API layer, and demo UI.

---

## UI Layer (Step 9)

The demo UI (`static/index.html`, `styles.css`, `app.js`) is an intentionally thin
visualisation layer. It has one job: call `POST /ask` and render the response sections
in a way that makes the pipeline steps visible to a human.

```
Browser
  │  GET /             → FastAPI serves static/index.html
  │  GET /static/*     → FastAPI StaticFiles mount
  │  POST /ask  ──────→ GraphRAGPipeline (unchanged)
  │       ← JSON response with matched_chunks + graph_context added in Step 9
  ↓
Renders 6 sections:
  [Question] → [Phase 1: Vector chunks] → [Phase 2: Graph context]
  → [Decision badge] → [Reasoning] → [Citations]
```

**Design constraints (deliberately kept):**
- No React, no build tools, no npm — zero setup friction for a demo
- No CDN dependencies — works fully offline once the server is running
- No WebSockets — a simple fetch per question is enough for a POC
- `StaticFiles` mount at `/static`, `FileResponse` at `/` — two lines in FastAPI
- `aiofiles` is the only new dependency; it is required by FastAPI's `StaticFiles`

**What the UI does NOT do:**
The UI is read-only. It does not write to the graph, does not manage sessions, and has
no authentication. It is a demo tool, not a production UI. The API (`/ask`, `/health`)
is the production surface; the UI is optional scaffolding on top.

**`/ask` response enrichment:**
Fields added additively across Steps 9–10 (original fields are unchanged):
- `matched_chunks: list[dict]` — full chunk data (id, source, text, score) for Phase 1 display
- `graph_context: dict` — rules, risk\_factors, policies, applicants for Phase 2 display
- `mode: str` — which pipeline ran (`"demo"` or `"openai"`)
- `embedding_provider: str` — active embedding model name (`"mock"` or `"text-embedding-3-small"`)
- `llm_provider: str` — active LLM class name (`"MockLLM"` or `"OpenAILLM"`)
- `compatibility_warning: str | None` — set only if auto-reindex failed; null in normal operation
- `reindexed: bool` — `true` on the first request after a mode switch (embeddings were re-indexed)

All new fields have defaults, so clients that only read the original fields continue to work without changes.

---

## Graph Model

### Node labels

| Label | Purpose | Key properties |
|-------|---------|----------------|
| `Applicant` | Person applying for coverage | `name`, `age` |
| `Policy` | Insurance product | `name`, `type`, `class_name` |
| `RiskFactor` | Medical or lifestyle condition | `name`, `category`, `controlled` |
| `LabResult` | Raw lab measurement | `test_name`, `value`, `unit` |
| `UnderwritingRule` | Decision rule from the underwriting manual | `title`, `text`, `decision` |
| `DocumentChunk` | Source text passage with vector embedding | `source`, `text`, `embedding` |

### Relationship types

```
(Applicant)         -[:APPLIES_FOR]→    (Policy)
(Applicant)         -[:HAS_CONDITION]→  (RiskFactor)
(Applicant)         -[:HAS_LAB_RESULT]→ (LabResult)
(Policy)            -[:HAS_RULE]→       (UnderwritingRule)
(RiskFactor)        -[:EVALUATED_BY]→   (UnderwritingRule)
(UnderwritingRule)  -[:SUPPORTED_BY]→   (DocumentChunk)
```

### Why a graph instead of a relational table

An underwriting decision requires traversing a chain:
> Applicant → what conditions do they have → which rules govern those conditions → what policy are they applying for → what does the rule say to do

In SQL, this is 4+ JOINs and a non-trivial query. In Cypher:

```cypher
MATCH (a:Applicant)-[:HAS_CONDITION]->(rf)-[:EVALUATED_BY]->(r:UnderwritingRule)
MATCH (p:Policy)-[:HAS_RULE]->(r)
RETURN a.name, rf.name, r.decision, p.name
```

Adding a new relationship type (e.g., connecting a lab result directly to a rule) is a new
relationship — no schema migration, no ALTER TABLE.

### Why embeddings live on DocumentChunk, not UnderwritingRule

UnderwritingRule text is short and precise:
> "Controlled Type 2 Diabetes with A1C below 7.0 may be referred for underwriting review."

Embedding models work best on paragraph-length text that provides surrounding semantic
context. The DocumentChunk holds the manual passage this rule was extracted from — richer
vocabulary, better embedding quality.

**Design principle:** embed what is verbose and semantically rich; traverse to what is precise
and structured.

---

## Retrieval Flow

```
Question  +  mode ("demo" | "openai")
  │
  ▼  auto-reindex check (if stored embedding_model ≠ provider.model_name)
     reindex_embeddings(driver, provider)   — re-embeds chunks, updates metadata
     asyncio.Lock prevents concurrent double-reseed
  │
  ▼  provider.embed(question)     — mock hash or text-embedding-3-small
float[1536]
  │
  ▼  db.index.vector.queryNodes('document_chunk_embeddings', top_k, vector)
Top-k DocumentChunk nodes         — most similar by cosine distance
  │
  ▼  UNWIND chunk_ids + MATCH traversal
{
  rules:        UnderwritingRule nodes reachable via SUPPORTED_BY
  risk_factors: RiskFactor nodes linked via EVALUATED_BY
  policies:     Policy nodes linked via HAS_RULE
  applicants:   Applicant nodes linked via HAS_CONDITION or APPLIES_FOR
}
  │
  ▼  llm.generate_answer(question, context)   — MockLLM or OpenAILLM
{decision, reasoning, supporting_rules, risk_factors, citations}
```

### Phase 1 — Vector search

```cypher
CALL db.index.vector.queryNodes($index, $top_k, $vector)
YIELD node, score
RETURN node.id AS id, node.source AS source, node.text AS text, score
```

Returns the DocumentChunk nodes whose embeddings are closest to the query embedding.
In this POC, similarity scores cluster near 0.5 because mock embeddings are not semantic —
all hashes end up in roughly the same region of the 1536-dimensional space.

In production, relevant chunks score near 1.0 and irrelevant ones score near 0.0.
The retrieval logic is identical; only the embedding quality changes.

### Phase 2 — Graph traversal

```cypher
UNWIND $chunk_ids AS chunk_id
MATCH (d:DocumentChunk {id: chunk_id})<-[:SUPPORTED_BY]-(r:UnderwritingRule)
OPTIONAL MATCH (rf:RiskFactor)-[:EVALUATED_BY]->(r)
OPTIONAL MATCH (p:Policy)-[:HAS_RULE]->(r)
OPTIONAL MATCH (a_cond:Applicant)-[:HAS_CONDITION]->(rf)
OPTIONAL MATCH (a_pol:Applicant)-[:APPLIES_FOR]->(p)
RETURN
    chunk_id,
    r.id, r.title, r.text, r.decision,
    collect(DISTINCT rf) AS risk_factors,
    collect(DISTINCT p)  AS policies,
    collect(DISTINCT a_cond) + collect(DISTINCT a_pol) AS applicants
```

Key design points:
- `UNWIND` batches all chunk IDs into one round-trip, not one query per chunk
- `OPTIONAL MATCH` means nodes with no connections still return (no silent filtering)
- Deduplication happens in Python after the query, not in Cypher — easier to test and debug

---

## Embedding Providers

Both providers implement the same interface:

```python
provider.embed(text: str) -> list[float]   # returns float[1536]
provider.model_name                         # "mock" | "text-embedding-3-small"
```

`GraphRAGPipeline.for_mode(driver, mode)` in `app/graphrag_pipeline.py` wires the correct
provider for each mode — `MockEmbeddingProvider` for `"demo"`, `OpenAIEmbeddingProvider` for
`"openai"`. The pipeline never checks env vars at query time; the mode parameter is explicit.

**Embedding consistency — automatic from Step 10 onwards:**
The model name is stored on every `DocumentChunk` node at seed time (`embedding_model` property).
Before each query, `_auto_reseed_if_needed()` in `main.py` reads that stored name and compares
it to the active provider's `model_name`. If they differ, `reindex_embeddings()` re-embeds all
chunks using the correct provider before the query runs — no manual intervention required.

`GraphRetriever._check_embedding_compatibility()` still performs a final check and returns a
warning string if the models still differ after the auto-reindex attempt (e.g. because the
reindex itself failed due to an API error). The `compatibility_warning` field in the API
response carries this warning to the client; the UI displays it as an amber banner.

---

## LLM Providers

Both providers implement the same interface:

```python
llm.generate_answer(question: str, context: dict) -> dict
# returns {decision, reasoning, supporting_rules, risk_factors, citations}
```

`GraphRAGPipeline.for_mode(driver, mode)` returns the pipeline wired with the correct LLM:
`MockLLM` for `"demo"`, `OpenAILLM` for `"openai"`. The pipeline, API response shape, and
citation format are identical in both modes.

`OpenAILLM` uses `response_format={"type": "json_object"}` (JSON mode) so the response
is always valid JSON. The system prompt instructs the model to base its answer only on
the retrieved context and to use `REQUIRE_ADDITIONAL_REVIEW` when context is insufficient.

---

## MockLLM

The MockLLM reads `risk_factors` from the context dict by name (case-insensitive substring)
and applies a three-branch decision tree:

| Condition detected | Decision |
|--------------------|----------|
| Type 2 Diabetes + Controlled A1C | `REFER_FOR_REVIEW` |
| Type 2 Diabetes alone | `REQUIRE_ADDITIONAL_REVIEW` |
| Neither | `APPROVE` |

It also builds `citations` — a list linking each DocumentChunk source (manual section) and
each UnderwritingRule (decision logic node) back to the answer. This is the explainability
artefact: every reasoning step has a traceable source in the graph.

In production, this function is replaced by:

```python
response = openai_client.chat.completions.create(
    model="gpt-4o",
    response_format={"type": "json_object"},
    messages=[{"role": "user", "content": build_prompt(question, context)}],
)
```

The context dict shape is unchanged. The LLM receives structured input, not raw text chunks.

---

## API Layer

### Lifespan — one driver, two pipelines, one lock

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    driver = get_driver()                              # opened once at startup
    app.state.driver = driver
    app.state.reseed_lock = asyncio.Lock()             # prevents concurrent re-indexes
    app.state.pipelines = {
        "demo":   GraphRAGPipeline.for_mode(driver, "demo"),
        "openai": GraphRAGPipeline.for_mode(driver, "openai"),  # only if OPENAI_API_KEY set
    }
    yield
    driver.close()                                     # closed cleanly at shutdown
```

The Neo4j driver maintains an internal connection pool. Opening it once and sharing across
requests is correct; creating a new driver per request would exhaust connections under load.

The `asyncio.Lock` serialises embedding re-index operations: if two requests arrive
simultaneously after a mode switch, only the first acquires the lock and re-indexes;
the second re-checks inside the lock and skips the re-index because it is already done.

### Error handling

| Exception | HTTP code | Meaning for caller |
|-----------|-----------|-------------------|
| Blank question | 400 | Fix the request |
| `ServiceUnavailable` / `AuthError` | 503 | Backend down — retry later |
| Unexpected `Exception` | 500 | Server bug — not caller's fault |

### Response shape

```json
{
  "question": "...",
  "decision": "REFER_FOR_REVIEW",
  "reasoning": ["...", "..."],
  "supporting_rules": [{"id": "...", "title": "...", "decision": "..."}],
  "risk_factors": [{"name": "...", "category": "..."}],
  "citations": [
    {"type": "DocumentChunk",    "source": "...", "relevance_score": 0.506},
    {"type": "UnderwritingRule", "title": "...",  "decision": "..."}
  ],
  "retrieval_summary": {
    "matched_chunks": 3,
    "rules": 3,
    "risk_factors": 3,
    "policies": 1,
    "applicants": 1
  },
  "mode": "demo",
  "embedding_provider": "mock",
  "llm_provider": "MockLLM",
  "compatibility_warning": null,
  "reindexed": false
}
```

`retrieval_summary` — zero values signal retrieval failure without inspecting the full response.
`reindexed: true` — set on the first request after a mode switch; signals that embeddings were
automatically re-indexed before the query ran.
`compatibility_warning` — non-null only when auto-reindex was attempted but failed.

---

## How This Maps to Production GraphRAG

| Demo Mode | OpenAI Mode | Production |
|-----------|-------------|------------|
| `MockEmbeddingProvider` — SHA-256 hash | `OpenAIEmbeddingProvider` — `text-embedding-3-small` | Same as OpenAI Mode, or self-hosted model |
| `MockLLM` — Python decision tree | `OpenAILLM` — gpt-4o with JSON mode | enterprise-approved LLM |
| 1 applicant, 4 rules, 4 chunks | Same data | Thousands of nodes |
| Single Uvicorn worker | Same | Multiple workers behind a load balancer |
| No auth | Same | JWT / API key via FastAPI `Depends()` |
| stdout logging | Same | Structured JSON logs + `retrieval_summary` metrics |

Mode B is already implemented. Switching requires only `OPENAI_API_KEY` in `.env`; embeddings
re-index automatically on the first request in that mode. The graph schema, traversal query,
context assembly, and API contract are unchanged across all three columns.
The production path is a substitution, not a rewrite.

---

## Limitations of This POC

1. **Mock embeddings are not semantic.** Similarity scores cluster near 0.5. The pipeline
   retrieves chunks, but not necessarily the *most relevant* ones. Step ordering in output
   is hash-determined, not meaning-determined.

2. **MockLLM does not generalise.** It hard-codes diabetes/A1C business logic. A question
   about tobacco classification will retrieve tobacco-related chunks but the LLM branch
   reads risk factor names, so the output depends on what the traversal returned.

3. **One applicant scenario.** The seed data models one person (John Smith, age 48) and
   four rules. Multi-applicant retrieval (e.g., "which of our applicants need additional
   review?") is not yet implemented.

4. **No auth.** The API is unauthenticated. For any real deployment, add authentication
   before exposing to the network.
