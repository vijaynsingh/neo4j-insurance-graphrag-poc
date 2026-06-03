# Demo Script — 2-Minute Interview Walkthrough

A structured talking track for explaining this project in a technical interview.
Each section has a suggested time and the key point to land.

---

## Live Browser Demo (before the verbal walkthrough)

Run this before the interview, or open a browser during a screen-share:

```bash
docker compose up -d
python3 -m app.seed   # once only — populates the graph
uvicorn app.main:app --port 8765 --reload
open http://127.0.0.1:8765
```

**Demo flow — 60 seconds in the browser:**

1. **Show the mode selector.** Point out the two options: Demo Mode (mock, free) and OpenAI Mode (real embeddings + gpt-4o).
   *"The selector controls which embedding provider and LLM the pipeline uses for this request. Demo Mode is the default — zero cost, no API key needed."*

2. **Leave Demo Mode selected. Click Ask.** While it loads: *"It's hitting a FastAPI endpoint, which calls GraphRetriever, then a decision layer."*

3. **Provider bar:** Point to the bar that appears above the results.
   *"This confirms which providers ran — Embedding: mock, LLM: MockLLM. Now switch to OpenAI Mode and click Ask again."*

   **Switch to OpenAI Mode and click Ask.** The loading message says "first switch re-indexes embeddings."
   *"The server detected that the stored vectors were built with the mock provider. Before running the query it automatically re-embedded all document chunks with text-embedding-3-small — no manual command needed. The green banner confirms it happened."*

   Point to `reindexed: true` in the provider bar.
   *"Every subsequent OpenAI Mode query skips this step — it only re-indexes when the mode actually changes."*

4. **Phase 1 — Vector Search:** Point to the matched chunks section.
   *"These are the DocumentChunk nodes whose embeddings were closest to the question in Neo4j's HNSW vector index. Each shows the manual section source and similarity score."*

5. **Phase 2 — Graph Traversal:** Point to Applicant, Risk Factors, Underwriting Rules.
   *"From those chunks, it walked the graph — found the rules those chunks support, the risk factors evaluated by those rules, and the applicant connected through those conditions. This is the structured context no text chunk contains on its own."*

6. **Decision badge:** Point to REFER\_FOR\_REVIEW.
   *"The decision comes from the MockLLM reading the risk factors and applying the underwriting business logic. Switch to OpenAI Mode and the same pipeline calls gpt-4o instead — same context dict, same response shape."*

7. **Citations:** Point to the citation list.
   *"Every source is traceable — specific manual section, specific rule. This is explainability. A compliance reviewer can reproduce exactly what the system saw."*

---

## 1. Why I Built This (15 seconds)

> "I wanted to understand GraphRAG from the inside — not just use a library, but build
> each layer by hand so I could explain what it does and why. I used an insurance
> underwriting scenario because it's relationship-heavy and the business logic is
> concrete enough to validate that the retrieval is actually working."

**Key point:** Built to learn, not to ship. Every layer is visible.

---

## 2. What Problem It Solves (20 seconds)

> "The problem with standard RAG for underwriting is that the decision depends on
> *relationships*, not just text similarity. You need to know: this applicant has
> this condition, that condition is governed by this rule, that rule belongs to the
> policy they're applying for. No single text chunk contains all of that. A vector
> search returns the most similar passage — but it can't assemble the reasoning chain.
> That's what the graph provides."

**Key point:** Vector search finds relevant text. Graph traversal assembles the reasoning chain.

---

## 3. How the Graph Is Modelled (25 seconds)

> "I modelled six node types: Applicant, Policy, RiskFactor, LabResult, UnderwritingRule,
> and DocumentChunk. The relationships encode the underwriting logic: an Applicant
> HAS_CONDITION a RiskFactor, which is EVALUATED_BY an UnderwritingRule, which is owned
> by a Policy via HAS_RULE. The DocumentChunk nodes carry the vector embeddings — they
> hold the surrounding manual text that gives the embedding model enough context to work
> with. The rule nodes hold the structured decision logic: REFER_FOR_REVIEW,
> REQUIRE_ADDITIONAL_REVIEW, APPROVE_FACTOR."

> "The design principle is: embed what is semantically rich, traverse to what is
> structurally precise."

**Key point:** Embeddings on DocumentChunk (rich text). Decision logic on UnderwritingRule (precise). Graph connects them.

---

## 4. How Retrieval Works (25 seconds)

> "Retrieval is two phases. Phase one: embed the question and run a vector similarity
> search against the DocumentChunk index. This returns the top-k chunks closest to
> the question in embedding space. Phase two: take those chunk IDs and run a single
> Cypher query — UNWIND the IDs, traverse back through SUPPORTED_BY to the rules,
> through EVALUATED_BY to the risk factors, through HAS_RULE to the policies, and
> through HAS_CONDITION to the applicants. One round-trip. The result is a structured
> context dict with all the entities relevant to the question."

> "That context dict is what the LLM receives — not raw text paragraphs."

**Key point:** Two phases, one Neo4j round-trip for traversal, structured output (not text blobs).

---

## 5. Why GraphRAG Adds Value Beyond Vector RAG (20 seconds)

> "Three things vector RAG can't do that this system does. First, entity awareness —
> I know it's John Smith, age 48, with a specific A1C value. That's not inferrable
> from text chunks. Second, scope — I know these rules apply to Preferred Term Life,
> not just any policy. Third, explainability — every citation in the response traces
> to a specific graph path. A compliance reviewer can reproduce exactly what the system
> saw. In regulated industries like insurance, that auditability matters."

**Key point:** Entity awareness, scope, and auditable citations — none of which vector RAG provides.

---

## 6. What I Would Change for Production (15 seconds)

> "Swaps one and two are already done — OpenAI Mode uses text-embedding-3-small and gpt-4o,
> and switching is automatic: the first request in a new mode re-indexes the embeddings without
> any manual command. What remains is three: authentication middleware and structured logging of
> retrieval_summary counts to detect retrieval quality drift over time. The graph schema and
> API contract are already production-equivalent."

**Key point:** The production path is a substitution, not a rewrite — and the provider switch is now seamless.

---

## Anticipated Questions

**"Why Neo4j over a relational database?"**
> "The query for 'which rules apply to this applicant through their conditions' is a
> 4-hop traversal. In SQL that's 4 JOINs and it gets harder to reason about as the
> schema grows. In Cypher it reads like a diagram. Also, adding a new relationship
> type — say, connecting a lab result directly to a rule — is a new relationship in
> Neo4j, not an ALTER TABLE."

**"Why not just stuff everything into the LLM context window?"**
> "Two reasons. First, the structured facts — applicant age, exact A1C value, rule
> decision enum — are not reliably extractable from flat text at inference time.
> The LLM would have to do extraction and reasoning simultaneously, which is where
> hallucination risk spikes. Second, with a graph you can filter before the LLM sees
> anything — only pass the rules that apply to this specific applicant for this specific
> policy. Smaller, more precise context is better than large, noisy context."

**"Is this production-ready?"**
> "No, and I'm clear about that. The seed data is one applicant with four rules, and there
> is no authentication. What is production-equivalent is the graph model, the retrieval
> architecture, the context assembly, and the API contract. Real embeddings and a real LLM
> are already wired in via OpenAI Mode — switching is seamless, the server re-indexes
> embeddings automatically on the first request in a new mode."

**"What does HNSW mean and why does it matter?"**
> "HNSW is Hierarchical Navigable Small World — the graph-based algorithm behind
> Neo4j's vector index. It organises vectors into a multi-layer approximate nearest
> neighbour graph, making similarity search O(log n) instead of O(n). Without it,
> 10 million embeddings would take seconds per query to scan. With it, milliseconds.
> It's also in Pinecone, Weaviate, and pgvector — the same algorithm powers most
> production vector indexes."
