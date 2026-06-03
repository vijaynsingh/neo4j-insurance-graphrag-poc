# Build Plan — Neo4j Insurance GraphRAG

Steps follow the actual build sequence. Each step has a clear deliverable.

---

## ✅ Step 1 — Docker + Project Skeleton

- `docker-compose.yml` with Neo4j 5 + APOC
- `requirements.txt`, `.gitignore`, `app/__init__.py`, `data/`
- `README.md`, `LEARNING_NOTES.md`, `TODO.md`

**Done:** `docker compose up -d` starts Neo4j. Browser at `http://localhost:7474`.

---

## ✅ Step 2 — Graph Schema + Seed Data

- `app/config.py` — dotenv Neo4j connection settings
- `app/graph.py` — driver factory + `run_query` helper
- `app/seed.py` — constraints, all node types, all relationships
- `data/underwriting_sample.json` — seed data source of truth
- `CYPHER_QUERIES.md` — 6 validation queries

**Done:** `python3 -m app.seed` populates the graph. All node types verified in Neo4j Browser.

---

## ✅ Step 3 — Vector Index + Mock Embeddings

- `app/embed.py` — deterministic SHA-256 mock embedding, dimension 1536
- `app/vector_index.py` — `create_vector_index()`, `verify_index()`, `similarity_search()`
- `app/seed.py` updated — `attach_embeddings()` uses `db.create.setNodeVectorProperty`
- `CYPHER_QUERIES.md` updated — vector index validation queries

**Done:** HNSW index is ONLINE. `similarity_search()` returns results.

---

## ✅ Step 4 — GraphRetriever

- `app/graph_retriever.py` — `GraphRetriever` class
  - `_vector_search()` — Phase 1: query vector index
  - `_traverse_from_chunks()` — Phase 2: UNWIND + OPTIONAL MATCH traversal
  - `retrieve_context()` — public API: returns structured context dict
  - `print_context()` — display helper
  - `main()` — runnable demo
- `CYPHER_QUERIES.md` updated — each traversal hop separately + combined

**Done:** `python3 -m app.graph_retriever` retrieves and prints structured context.

---

## ✅ Step 5 — GraphRAG Answer Generation (MockLLM)

- `app/mock_llm.py` — `MockLLM.generate_answer(question, context)`
  - 3-branch decision logic: REFER_FOR_REVIEW / REQUIRE_ADDITIONAL_REVIEW / APPROVE
  - Builds citations: DocumentChunk sources + UnderwritingRule titles
- `app/graphrag_pipeline.py` — `GraphRAGPipeline.run()` wires retriever → LLM
- `LEARNING_NOTES.md` updated — Step 5 section, 5 design Q&As

**Done:** `python3 -m app.graphrag_pipeline` prints decision, reasoning, and citations.

---

## ✅ Step 6 — FastAPI /ask Endpoint

- `app/main.py` — FastAPI app
  - `POST /ask` — validates input, runs pipeline, returns structured JSON
  - `GET /health` — liveness check
  - Lifespan: one driver + one pipeline for the server process (Step 10 extended to two pipelines + reseed lock)
  - Error handling: 400 (blank), 503 (Neo4j down), 500 (unexpected)
- `README.md` updated — architecture diagram, run instructions, curl example, error table

**Done:** `uvicorn app.main:app --port 8765` serves both endpoints. Verified with curl.

---

## ✅ Step 7 — Project Cleanup for GitHub and Documentation

- `README.md` — concise, GitHub-ready with honest mock caveats
- `ARCHITECTURE.md` — graph model, retrieval flow, mock components, production mapping
- `DEMO_SCRIPT.md` — 2-minute technical walkthrough with anticipated Q&A
- `LEARNING_NOTES.md` — organised by step, table of contents added, technical design notes
- `TODO.md` — this file, reflecting actual build sequence

**Done:** Project is presentation-ready. Clone → run → demo in under 5 minutes.

---

## ✅ Step 8 — Real Embeddings and LLM (OpenAI, optional)

- `app/embed.py` — `MockEmbeddingProvider`, `OpenAIEmbeddingProvider`, `get_embedding_provider()` factory
- `app/openai_llm.py` — `OpenAILLM`: OpenAI chat completions with JSON mode; same response shape as MockLLM
- `app/seed.py` — uses `get_embedding_provider()`; stores `embedding_model` / `embedding_provider` on DocumentChunk nodes
- `app/graph_retriever.py` — accepts `embedding_provider` parameter; `_check_embedding_compatibility()` warns on mismatch
- `app/graphrag_pipeline.py` — `_get_llm()` factory; mode displayed in demo output
- `.env.example` — all env vars documented with comments
- `requirements.txt` — added `openai`

**Enabled:** set `OPENAI_API_KEY=sk-...` in `.env`. Step 10 makes provider switching automatic — no manual re-seed required after initial setup.

**Done:** Both modes verified. Mock mode unchanged. Step 10 adds auto-reindex so switching providers no longer requires a manual seed command.

---

## ✅ Step 9 — Browser Application UI

- `static/index.html` — pipeline overview strip, query textarea, 6 result sections
- `static/styles.css` — no CDN dependencies; colour-coded decision badges, responsive grid
- `static/app.js` — fetch `/ask`, render each section; Ctrl+Enter shortcut; error handling
- `app/main.py` — `StaticFiles` mount at `/static`; `GET /` serves `index.html`; `AskResponse` extended with `matched_chunks` and `graph_context` (additive, existing contract intact)
- `requirements.txt` — added `aiofiles` (required by FastAPI `StaticFiles`)

**Run:** `uvicorn app.main:app --port 8765 --reload` → open `http://127.0.0.1:8765`

**Done:** All three routes verified (`GET /` → 200, `GET /health` → JSON, `POST /ask` → JSON with new fields).

---

## ✅ Step 10 — Learning Mode vs OpenAI Mode Selection + Auto-Reindex

**Mode selection:**
- `app/graphrag_pipeline.py` — `__init__` accepts `embedding_provider` and `llm` params; `for_mode(driver, mode)` classmethod wires the correct providers (`MockEmbeddingProvider + MockLLM` for `"demo"`, `OpenAIEmbeddingProvider + OpenAILLM` for `"openai"`)
- `app/main.py` — `AskRequest.mode` (default `"demo"`); `AskResponse` extended with `mode`, `embedding_provider`, `llm_provider`, `compatibility_warning`, `reindexed`; lifespan pre-creates both pipelines + `asyncio.Lock`; `/ask` validates mode and routes to the correct pipeline

**Auto-reindex on mode switch:**
- `app/seed.py` — new `reindex_embeddings(driver, provider)` — re-embeds all `DocumentChunk` nodes with the given provider; updates `embedding_model` / `embedding_provider` metadata; does not touch graph structure
- `app/main.py` — `_auto_reseed_if_needed(pipeline, driver, lock)` — checks stored vs active model before every query; calls `reindex_embeddings()` in a thread pool if they differ; `asyncio.Lock` prevents concurrent double-reseed; `pipeline.run(check_compatibility=not reseeded)` skips the final DB round-trip when reseeding succeeded
- `app/graph_retriever.py` — `_check_embedding_compatibility()` returns `str | None`; only reached if auto-reindex was skipped or failed

**UI:**
- `static/index.html` — mode selector (radio buttons); provider bar; auto-reindex notice (green); compat warning (amber, error path only)
- `static/styles.css` — mode selector, provider bar, reindex notice, compat warning styles
- `static/app.js` — reads mode from selector, passes in request body; renders provider bar, reindex notice, compat warning; loading hint for OpenAI mode

**Backward compatible:** clients that omit `mode` get `"demo"` (MockLLM + MockEmbeddingProvider).
**Zero manual steps for mode switching:** the first request after a mode switch re-indexes embeddings automatically. No `python3 -m app.seed` required after initial setup.

---

## Optional Enhancements (not yet started)

### Text2CypherRetriever

Add a second retrieval path: translate the question to Cypher using an LLM, run it,
return the results as additional context alongside the vector + graph retrieval.

New file: `app/text2cypher.py`
Integration point: `GraphRAGPipeline.run()` — run both retrievers, merge context.

### Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app/ ./app/
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Note: Neo4j still runs via Docker Compose; this Dockerfile is for the Python API only.

### AKS / Cloud Deployment Notes

- Neo4j Aura (managed Neo4j) replaces local Docker — update `NEO4J_URI` in `.env`
- Python API deployed as AKS pod or Azure Container App
- API key stored in Azure Key Vault, injected as environment variable
- `retrieval_summary` counts shipped to Application Insights for monitoring

### GitHub Publish

- Init git repo (`git init`)
- Verify `.gitignore` excludes `.env`, `__pycache__`, `neo4j/data/`
- Create GitHub repo, push
- Add GitHub Actions workflow: lint + type-check on push

---

## Design Considerations

Key architectural decisions and trade-offs in this project.

**What it is:**
A GraphRAG system for insurance underwriting. Answers questions about whether an applicant
qualifies for a policy class by combining vector similarity search with structured graph
traversal over a Neo4j knowledge graph.

**Why it is interesting architecturally:**
The retrieval is two-phase. Phase one finds the most semantically relevant documentation
chunks via vector similarity. Phase two traverses the graph outward from those chunks to
collect the structured business context — underwriting rules, risk factors, the specific
applicant, the policy they are applying for. The LLM receives structured entities and
relationships, not raw text paragraphs.

**Why GraphRAG over plain RAG:**
Plain RAG retrieves text chunks. It cannot tell you which specific applicant has which
specific condition, which rules govern that condition for the product they applied for,
or what the authoritative manual section says. Graph traversal assembles that chain
explicitly. Every fact in the answer is traceable to a specific graph path — that is
explainability, which matters in regulated industries.

**What I would do differently:**
Replace mock embeddings with a real model. The vector index, traversal queries, and
API contract are production-equivalent already — the graph model and retrieval logic
are the hard part, and they are done.

**Honest limitations to volunteer:**
The embeddings are hash-based and not semantic. The LLM is deterministic business logic.
The seed data covers one applicant. These are intentional choices for this learning project —
they let me focus on understanding the pipeline structure without API dependencies or cost.
