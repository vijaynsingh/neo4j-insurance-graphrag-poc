# Learning Notes — Neo4j Insurance GraphRAG

Personal notes from completing the Neo4j & GenerativeAI Fundamentals course
and building this project step by step. Organised by build step.

---

## Contents

- [Course Notes](#course-notes) — VectorRetriever, GraphRAG, Text2Cypher, comparison table
- [Step 2 — Graph Schema](#step-2--graph-schema-and-seed-data) — graph model, relationship design, design Q&A
- [Step 3 — Vector Index](#step-3--vector-index-and-mock-embeddings) — embeddings, HNSW, similarity search, design Q&A
- [Step 4 — GraphRetriever](#step-4--graph-enhanced-retrieval) — two-phase retrieval, multi-hop, explainability, design Q&A
- [Step 5 — Answer Generation](#step-5--graphrag-answer-generation) — MockLLM, pipeline flow, citations, design Q&A
- [Step 6 — FastAPI](#step-6--fastapi-ask-endpoint) — lifespan pattern, error handling, enterprise integration, design Q&A
- [Step 8 — Real Embeddings and LLM](#step-8--real-embeddings-and-llm) — provider abstraction, embedding consistency, JSON mode, design Q&A
- [Design Considerations](#design-considerations) — key architectural decisions and trade-offs

---

## Course Notes

### What I Learned from the Course

- Neo4j stores data as nodes, relationships, and properties — not tables
- Cypher is Neo4j's query language, designed to read like a diagram: `(a)-[:REL]->(b)`
- Vector indexes in Neo4j allow embedding-based similarity search natively
- The `neo4j-graphrag` Python package wraps retrievers and LLM pipelines
- GraphRAG combines structured graph context with LLM generation
- APOC is a plugin that extends Cypher with utility procedures (math, text, graph algos)

---

## VectorRetriever Summary

**What it does:**
Searches Neo4j's vector index for nodes whose embeddings are closest to the query embedding.
Returns top-k nodes and their properties as context for the LLM.

**When to use:**
When your question is about *what something is* and doesn't require traversing relationships.
Example: "Describe the flood risk exclusion clause."

**How it works:**
1. Embed the user's question using an embedding model (e.g. OpenAI, Cohere)
2. Run a vector similarity search against a pre-built Neo4j vector index
3. Return the top-k matching node properties
4. Pass those properties as context to the LLM

**Cypher equivalent (approximate):**
```cypher
CALL db.index.vector.queryNodes('policy-embeddings', 5, $queryVector)
YIELD node, score
RETURN node.text, score
```

---

## GraphRAG Summary

**What it does:**
Extends VectorRetriever by also traversing the graph around each matched node.
Retrieves connected entities and relationships as additional context.

**When to use:**
When the answer depends on *relationships*, not just the matched node itself.
Example: "Which claims are linked to policyholders in flood-prone zones?"

**How it works:**
1. Vector search finds seed nodes (same as VectorRetriever)
2. A `retrieval_query` (Cypher) traverses outward from those seeds
3. Traversal results are combined with vector results
4. The combined context is passed to the LLM

**Key insight:**
The `retrieval_query` is what makes GraphRAG powerful. You write a Cypher snippet
that tells the retriever *what neighborhood* to explore around each seed node.

---

## Text2CypherRetriever Summary

**What it does:**
Uses an LLM to translate a natural language question into a Cypher query,
runs it against Neo4j, and returns the results as context.

**When to use:**
When the user's question maps cleanly to a structured lookup — not fuzzy similarity.
Example: "List all claims filed by policyholders in California with liability coverage."

**How it works:**
1. Pass the user question + the graph schema to the LLM
2. LLM generates a Cypher query
3. Execute that Cypher against Neo4j
4. Return the query results as context for a final LLM answer

**Risk:**
The LLM can generate invalid Cypher. Validation and error handling are important.
A good schema description (node labels, relationship types, property names) dramatically
improves accuracy.

---

## Vector Retrieval vs Graph Retrieval

| | Vector Retrieval | Graph Retrieval |
|---|---|---|
| Input | Embedding of query | Cypher query (manual or LLM-generated) |
| Matching | Cosine/dot-product similarity | Exact structural traversal |
| Handles relationships | No | Yes |
| Handles fuzzy/semantic | Yes | No (unless combined) |
| Requires embeddings | Yes | No |
| Requires schema knowledge | No | Yes |
| Best for | "Find things like this" | "Find things connected to this" |

**The power move:** combine both. Use vector search to find seed nodes, then
use graph traversal to pull in their neighborhood. This is what GraphRAG does.

---

## Frequently Asked Questions

**Q: What is GraphRAG and how does it differ from RAG?**
A: RAG retrieves chunks of text by embedding similarity and feeds them to an LLM.
GraphRAG retrieves from a knowledge graph — it uses vector search to find seed nodes,
then traverses relationships to build richer, structured context. The key advantage
is relationship-awareness: you can answer multi-hop questions like "what policies
does this agent manage, and which have open claims?" — impossible with flat vectors.

**Q: What is a VectorRetriever in neo4j-graphrag?**
A: It's a class that wraps the Neo4j vector index query. You give it an embedder and
an index name, and it embeds the query and returns the top-k matching nodes.

**Q: When would you use Text2Cypher over VectorRetriever?**
A: When the question maps to a precise, structured lookup. Vector retrieval is fuzzy —
it finds semantically similar nodes. Text2Cypher is exact — it generates a Cypher query
from the question, which is better for aggregate or filter-heavy questions.

**Q: What is APOC in Neo4j?**
A: APOC (Awesome Procedures on Cypher) is the standard Neo4j plugin library.
It adds hundreds of procedures for data import/export, text processing, graph algorithms,
and more. It's nearly always installed in production Neo4j environments.

**Q: What makes graph databases better than relational for this domain?**
A: In insurance, relationships are the data. A claim connects to a policyholder,
an agent, a coverage type, a risk zone, and possibly fraud flags. In a relational DB,
answering a multi-hop question means many JOINs. In Neo4j, it's a short Cypher path query.
Graphs also make it easy to add new relationship types without schema migrations.

---

## Open Questions to Research

- [ ] How does `neo4j-graphrag` handle embedding caching?
- [ ] What's the recommended way to version Neo4j graph schemas?
- [ ] How do vector indexes perform at scale vs dedicated vector DBs (Pinecone, Weaviate)?
- [ ] Can APOC procedures be called from within a retrieval_query?
- [ ] What are best practices for Text2Cypher prompt engineering with complex schemas?
- [ ] How does Neo4j Aura (cloud) differ from self-hosted for vector index support?
- [ ] What is the difference between `GraphRAG` and `HybridRetriever` in neo4j-graphrag?

---

---

# Step 2 — Graph Schema and Seed Data

## What Changed in Step 2

Added the first real graph data and the Python infrastructure to populate Neo4j.

New files:
- `app/config.py` — loads Neo4j connection details from `.env` using python-dotenv
- `app/graph.py` — creates a Neo4j driver and a reusable `run_query` helper
- `app/seed.py` — clears existing sample data, creates constraints, seeds all nodes and relationships
- `data/underwriting_sample.json` — all sample data in a single JSON file (source of truth)
- `CYPHER_QUERIES.md` — 6 validation queries with explanations

---

## Graph Model Explanation

The model represents one insurance underwriting scenario: John Smith (age 48) applying
for a Preferred Term Life policy with Type 2 Diabetes and a controlled A1C.

```
(Applicant) -[:APPLIES_FOR]->    (Policy)
(Applicant) -[:HAS_CONDITION]->  (RiskFactor)
(Applicant) -[:HAS_LAB_RESULT]-> (LabResult)
(Policy)    -[:HAS_RULE]->       (UnderwritingRule)
(RiskFactor)-[:EVALUATED_BY]->   (UnderwritingRule)
(UnderwritingRule)-[:SUPPORTED_BY]-> (DocumentChunk)
```

**Node types:**

| Label | Purpose | Key properties |
|---|---|---|
| Applicant | Person applying for coverage | name, age |
| Policy | Insurance product being applied for | name, type, class_name |
| RiskFactor | Medical condition or lifestyle factor | name, category, controlled |
| LabResult | Raw lab measurement | test_name, value, unit |
| UnderwritingRule | A rule that governs eligibility | title, text, decision |
| DocumentChunk | Source text from underwriting manual | source, text |

---

## Why These Relationships Matter

**APPLIES_FOR** connects an applicant to the specific policy product.
This scopes which rules apply — a Preferred Life policy has different rules than a Standard policy.

**HAS_CONDITION** links an applicant to their risk factors.
This is the clinical profile. In a real system this comes from medical records or an application form.

**HAS_LAB_RESULT** links an applicant to raw lab data.
Separate from risk factors because lab results are quantitative and verifiable.
A risk factor like "Controlled A1C" is an *interpretation* of the raw lab value.

**EVALUATED_BY** links a risk factor to the rule(s) that govern it.
This is the key underwriting logic edge. It says: "this condition is judged by this rule."
Multiple rules can evaluate the same risk factor (e.g., diabetes is evaluated by both
the controlled-diabetes rule AND the age+diabetes rule).

**HAS_RULE** links a policy to its governing rules.
Different policy products (Preferred, Standard, Substandard) would link to different rule sets.

**SUPPORTED_BY** links each rule to its source text from the underwriting manual.
This is the GraphRAG bridge — the chunk carries the embedding, the rule carries the logic,
and the graph connects them. Vector search finds the chunk; traversal finds the rule and applicant.

---

## Frequently Asked Questions — Step 2

**Q: Why model underwriting as a graph instead of a table?**
A: In underwriting, the decision is produced by traversing relationships — which applicant has
which conditions, which conditions are governed by which rules, which rules belong to which policy.
A graph models this naturally. In SQL, answering "what rules apply to this applicant via their
risk factors" requires multiple JOINs across several tables and a non-trivial query.
In Cypher: `MATCH (a:Applicant)-[:HAS_CONDITION]->(rf)-[:EVALUATED_BY]->(r:UnderwritingRule) RETURN r`.

**Q: What would be difficult with only vector search?**
A: Vector search finds semantically similar text — it cannot reason about specific entities and
their relationships. A query like "does John Smith's A1C disqualify him from Preferred class?"
requires knowing John's specific A1C value, the threshold in the rule, and that John is the
applicant in question. None of that is expressible as similarity. Vector search would return
the most similar text chunks about A1C and diabetes, but the LLM would have no grounding
about John's specific values or situation.

**Q: What would be difficult with only SQL?**
A: SQL is good at structured lookups but struggles with variable-depth traversal.
"Find all rules that apply to this applicant, including rules connected through any
combination of conditions and lab results" is a recursive join problem in SQL.
In Cypher it's a path query. Additionally, adding a new relationship type (e.g.,
connecting a lab result directly to a rule) requires an ALTER TABLE in SQL but
is just a new relationship type in Neo4j — no schema migration needed.

**Q: How does this prepare for GraphRAG?**
A: The DocumentChunk nodes are the semantic bridge. In Step 5, each chunk will receive
a vector embedding (its text converted to a float array). The VectorRetriever will find
the chunk whose embedding is closest to the question. Then a `retrieval_query` will
traverse the graph from that chunk back through the rule, risk factor, and applicant
to assemble rich structured context. The LLM gets both the matching text AND the
full relational context — something neither pure vector nor pure SQL can provide.

**Q: What is the role of DocumentChunk nodes?**
A: They are the semantic entry points into the graph. The underwriting rules are precise
but short — they don't embed well on their own. The chunks provide the surrounding
natural-language context from the manual that makes vector similarity work.
When the VectorRetriever finds chunk_002 (the A1C rule text), it's really finding
the neighborhood that includes rule_002 and all the applicants whose risk factors
are evaluated by that rule. The chunk is a handle; the graph is the payload.

---

---

# Step 3 — Vector Index and Mock Embeddings

## What Changed in Step 3

New files:
- `app/embed.py` — deterministic mock embedding function, no API calls required
- `app/vector_index.py` — create index, verify it's ONLINE, run similarity search

Updated files:
- `app/seed.py` — added Step 5: attaches embeddings to DocumentChunk nodes after creation

---

## What Is an Embedding?

An embedding is a list of floating-point numbers (a vector) that encodes the *meaning* of
a piece of text in a high-dimensional space. Two semantically similar texts produce vectors
that point in nearly the same direction. Two unrelated texts produce vectors that are nearly
perpendicular (cosine similarity ≈ 0).

Example of what a real embedding model does:
- "diabetes management" → [0.021, -0.043, 0.017, ...]  (1536 floats)
- "glycemic control"    → [0.019, -0.041, 0.018, ...]  (very similar direction)
- "tax filing deadline" → [-0.031, 0.087, -0.054, ...]  (very different direction)

Embeddings are produced by a trained neural network — the embedding model. Common choices:
- OpenAI `text-embedding-3-small` → 1536 dimensions (what we target)
- Cohere `embed-english-v3.0` → 1024 dimensions
- `sentence-transformers/all-MiniLM-L6-v2` → 384 dimensions (local, no API)

Our mock embedding uses SHA-256 hashing to produce a valid-shaped, normalized vector with
no semantic meaning. It costs nothing and validates the infrastructure.

---

## What Is a Vector Index?

A vector index makes similarity search fast. Without one, finding the closest vector to a
query requires comparing the query against every stored vector — O(n) per query.

Neo4j's vector index uses **HNSW** (Hierarchical Navigable Small World), an algorithm
that builds a multi-layer approximate nearest neighbor graph. This reduces search to
roughly O(log n) — fast enough for millions of nodes.

Creating the index in Neo4j:
```cypher
CREATE VECTOR INDEX document_chunk_embeddings IF NOT EXISTS
FOR (n:DocumentChunk)
ON (n.embedding)
OPTIONS {
  indexConfig: {
    `vector.dimensions`: 1536,
    `vector.similarity_function`: 'cosine'
  }
}
```

Two parameters matter:
- **`vector.dimensions`** — must match exactly the size of every embedding stored. If you change the embedding model (and thus its dimension), you must drop and recreate the index.
- **`vector.similarity_function`** — `cosine` for text (direction matters, not magnitude); `euclidean` for spatial data.

---

## Vector Similarity Search

```cypher
CALL db.index.vector.queryNodes('document_chunk_embeddings', $top_k, $query_vector)
YIELD node, score
RETURN node.id, node.source, node.text, score
```

- `$top_k` — how many results to return (typically 3–10 for RAG)
- `$query_vector` — the embedded question, as a list of floats
- `score` — cosine similarity: 1.0 = identical, 0.0 = unrelated

The VectorRetriever in `neo4j-graphrag` calls this exact procedure internally.
In Step 6, you'll instantiate `VectorRetriever` and it will handle the embedding + query call.
What you built in `vector_index.py` is the manual equivalent, so you understand what's happening under the hood.

---

## Why Embeddings Live on DocumentChunk, Not UnderwritingRule

UnderwritingRule nodes hold short, precise text like:
> "Controlled Type 2 Diabetes with A1C below 7.0 may be referred for underwriting review."

That's 87 characters. Embedding models work best with full sentences and paragraphs that
provide semantic context. The DocumentChunk holds the surrounding manual text:

> "Type 2 Diabetes is assessed based on glycemic control. An A1C below 7.0% is considered
> controlled. Applicants with controlled diabetes may be referred for standard or preferred
> review depending on other risk factors."

The chunk text is *richer* — it includes domain vocabulary (glycemic control, controlled,
preferred review) that the embedding model uses to locate it correctly in semantic space.

The relationship `(UnderwritingRule)-[:SUPPORTED_BY]->(DocumentChunk)` lets us get the best
of both: the chunk finds the right neighborhood via semantic similarity, the rule carries the
precise logic.

**The design principle:**
> Embed what is verbose and semantically rich. Traverse to what is precise and structured.

---

## db.create.setNodeVectorProperty vs SET n.embedding = $list

This is a subtle but important distinction:

| Method | Type stored | Safe for vector index? |
|---|---|---|
| `SET n.embedding = $list` | Float64[] (Python float is 64-bit) | Sometimes — depends on Neo4j version |
| `CALL db.create.setNodeVectorProperty(n, 'embedding', $list)` | Float32[] | Always — this is what Neo4j's vector index requires |

Neo4j's HNSW index expects 32-bit floats. The procedure explicitly converts to Float32 before storage. Using `SET` with a Python float list stores 64-bit values, which can cause a type mismatch error when querying the index on some Neo4j 5.x versions. The procedure call is the safe, explicit path.

---

## How This Prepares for GraphRAG

The full pipeline (to be assembled in Steps 5–6) will be:

```
User question: "Is John Smith eligible for Preferred class with his diabetes?"
    │
    ▼  embed.mock_embed() ← swap for OpenAIEmbeddings() in Step 6
query_vector (1536 floats)
    │
    ▼  db.index.vector.queryNodes('document_chunk_embeddings', 3, query_vector)
Top-3 DocumentChunk nodes — the most semantically relevant manual sections
    │
    ▼  retrieval_query (Cypher — written in Step 7)
MATCH (chunk)<-[:SUPPORTED_BY]-(rule)<-[:EVALUATED_BY]-(rf)<-[:HAS_CONDITION]-(a)
MATCH (a)-[:HAS_LAB_RESULT]->(lab)
    │
    ▼  Structured context assembled
"Applicant: John Smith, age 48. Risk Factor: Type 2 Diabetes (controlled). Lab: A1C 6.8%.
 Rule: Controlled Diabetes Review — decision: REFER_FOR_REVIEW.
 Rule: Age and Diabetes Additional Review — decision: REQUIRE_ADDITIONAL_REVIEW.
 Source: Underwriting Manual v3.2, Section 6.3."
    │
    ▼  LLM
"Based on John Smith's profile, he has controlled Type 2 Diabetes (A1C 6.8%) and is 48
years old. Under Underwriting Manual Section 6.3 and 6.5, he requires underwriting review
and additional medical evaluation due to his age. He may still qualify for Preferred class
pending that review."
```

Each piece you built in Step 3 maps directly to a component in this pipeline:
- `mock_embed()` → replaced by `OpenAIEmbeddings(model="text-embedding-3-small")` in Step 6
- Vector index → queried by `VectorRetriever` internally
- `similarity_search()` in `vector_index.py` → what `VectorRetriever.search()` does internally

---

## Frequently Asked Questions — Step 3

**Q: What is an embedding and why is it needed for RAG?**
A: An embedding is a fixed-length float vector that encodes the semantic meaning of text.
RAG needs embeddings because computers can't directly compare meaning — but they can compute
cosine similarity between vectors. By embedding both the stored documents and the user's
question, we find semantically relevant content even when no exact keywords match. A question
about "glycemic management" will find a chunk about "A1C control" because their embeddings
are nearby in vector space.

**Q: What is cosine similarity and why use it for text?**
A: Cosine similarity measures the angle between two vectors, returning 1.0 for identical
direction and 0.0 for perpendicular. We use it for text because it's scale-invariant — a
short and long document about the same topic score high even if one has more words. Since
we normalize our embeddings to unit length, cosine similarity is numerically equivalent to
a dot product, which is extremely fast to compute.

**Q: What is HNSW and why does it matter for production?**
A: HNSW (Hierarchical Navigable Small World) is the graph-based algorithm behind most
production vector indexes including Neo4j's. It organizes vectors into a multi-layer
"small world" graph where each node connects to approximate nearest neighbors. This enables
O(log n) similarity search. Without it, comparing a query against 10 million embeddings
brute-force would take seconds per query. With HNSW it takes milliseconds.

**Q: Why use a mock embedding instead of a real one?**
A: To isolate infrastructure from model concerns. The vector index, the Cypher procedure,
and the `setNodeVectorProperty` call can all be validated with any valid-shaped vector.
A mock embedding has zero cost, zero API dependency, and fails loudly on infrastructure
errors. When we swap in a real embedder, any new failures are definitively the embedder's
fault — not the index setup.

**Q: What's the difference between db.create.setNodeVectorProperty and SET n.embedding = $list?**
A: `setNodeVectorProperty` stores the vector as Float32[]. Direct `SET` with a Python list
stores Float64[]. Neo4j's HNSW vector index expects Float32 — using Float64 can cause a
type mismatch when querying the index on some Neo4j 5.x versions. Always use the procedure
for vector properties.

---

---

# Step 4 — Graph-Enhanced Retrieval

## What Changed in Step 4

New files:
- `app/graph_retriever.py` — `GraphRetriever` class: two-phase retrieval (vector → graph), `print_context()` display helper, and a runnable `main()` demo

Updated files:
- `CYPHER_QUERIES.md` — added Queries A–D showing each traversal hop separately, then combined

---

## Why Vector Search Alone Is Insufficient

Vector search answers: **"Which stored text is most similar to this question?"**

That is a powerful first step, but it has a hard ceiling:

**What vector search cannot do:**

1. **It has no memory of structure.** A chunk about "A1C control" and a chunk about "age 45 review" are independent text blobs. Vector search cannot know they both apply to the same applicant at the same time.

2. **It cannot filter on properties.** You cannot say "find the rule that applies to this specific applicant given their age is 48". The applicant's age lives on an `Applicant` node, not inside any text chunk. Vector search only operates over chunk embeddings.

3. **It cannot follow logic chains.** The underwriting decision requires knowing: applicant → condition → rule → decision. This is a traversal. No amount of text similarity retrieval reassembles this chain — it must be queried from a structured store.

4. **Its context is flat.** An LLM fed three text chunks gets three disconnected paragraphs. It must infer the relationships itself — and often gets them wrong. An LLM fed structured graph context (applicant name, age, specific lab value, specific rule, specific decision) can reason precisely because the relationships are explicit.

---

## Why Graph Traversal Adds Business Context

After the vector search returns DocumentChunk matches, the graph traversal walks:

```
DocumentChunk
    └─[SUPPORTED_BY]─► UnderwritingRule     ← the decision logic (REFER_FOR_REVIEW, etc.)
          └─[EVALUATED_BY]─► RiskFactor     ← what clinical condition triggers this rule
                └─[HAS_CONDITION]─► Applicant ← who has this condition
          └─[HAS_RULE]─► Policy             ← what product this rule governs
                └─[APPLIES_FOR]─► Applicant  ← who applied for this product
```

Each hop adds a layer of business meaning that is invisible inside any single text chunk:

| Hop | What it adds |
|---|---|
| Chunk → Rule | Decision classification: what should the underwriter do? |
| Rule → RiskFactor | Clinical cause: which condition triggers this rule? |
| RiskFactor → Applicant | Personalization: does this rule actually apply to John Smith? |
| Rule → Policy | Scope: does this rule govern the product John is applying for? |

The result is not "similar text" — it is a **structured reasoning trace**:
> "John Smith (48) has Type 2 Diabetes. The Controlled Diabetes Review rule applies and
> calls for REFER_FOR_REVIEW. Additionally, the Age and Diabetes rule applies and calls for
> REQUIRE_ADDITIONAL_REVIEW. Both rules are supported by Sections 6.3 and 6.5 of the
> Underwriting Manual. He is applying for Preferred Term Life."

This is what an LLM needs to produce a grounded, explainable, correct answer.

---

## How GraphRAG Differs from Pure Vector RAG

| Dimension | Pure Vector RAG | GraphRAG |
|---|---|---|
| Retrieval input | Embedding of question | Same |
| First retrieval step | Semantic similarity over all chunks | Same |
| What's retrieved | Top-k text chunks | Top-k chunks + graph neighborhood |
| Entity awareness | None — text only | Full — nodes are typed entities |
| Relationship awareness | None | First-class (typed, directed edges) |
| Personalization | Cannot filter to specific entity | Can filter: `WHERE a.name = "John Smith"` |
| Multi-hop reasoning | Impossible | Natural — follow edge types |
| LLM prompt content | Paragraph blobs | Structured key-value context |
| Explainability | "We retrieved this chunk" | "We found this rule because this chunk is SUPPORTED_BY it, and it EVALUATED_BY this condition on this applicant" |

---

## Multi-Hop Reasoning

A "hop" is one relationship traversal in the graph. A query that crosses multiple
relationship types is called multi-hop.

Example: answering "Is John's diabetes a disqualifier for Preferred class?" requires:

```
Hop 1: Applicant -[HAS_CONDITION]→ RiskFactor ("Type 2 Diabetes")
Hop 2: RiskFactor -[EVALUATED_BY]→ UnderwritingRule ("Controlled Diabetes Review")
Hop 3: UnderwritingRule ←[HAS_RULE]- Policy ("Preferred Term Life")
Hop 4: UnderwritingRule -[SUPPORTED_BY]→ DocumentChunk (manual text)
```

This is a 4-hop traversal. No single text chunk contains all this information. The graph
encodes it as structure, and Cypher traverses it in one query.

**Why multi-hop reasoning matters:**
Multi-hop reasoning is the core architectural argument for using a knowledge graph over a vector store.
The key question is: "Why not just embed all the documents and use a vector database?"
The answer is: "Because the question requires reasoning over relationships between entities,
not just similarity between texts."

---

## Explainability Benefits

GraphRAG produces auditable retrieval. Every piece of context in the LLM prompt can be
traced back to a specific graph path:

```
Answer: "John Smith requires additional underwriting review."
  ← LLM reasoning from rule: "Applicants over age 45 with diabetes require review"
    ← Rule found via: chunk_004 ← SUPPORTED_BY ← rule_004
    ← Rule applies because: (John Smith) -[HAS_CONDITION]→ (Type 2 Diabetes) -[EVALUATED_BY]→ rule_004
    ← Age condition: John Smith.age = 48 > 45
    ← Source: Underwriting Manual v3.2, Section 6.5
```

This is not possible with vector RAG. You can say "we retrieved this chunk," but you
cannot say "this specific rule applies to this specific applicant because of this
specific condition." The graph makes the reasoning chain explicit and auditable.

In regulated industries (insurance, healthcare, finance), explainability is not optional.
GraphRAG's structural provenance is a key architectural argument for knowledge graphs
over pure vector stores in these domains.

---

## Frequently Asked Questions — Step 4

**Q: Why not stop at vector search?**
A: Vector search finds semantically similar text, but insurance underwriting decisions
require reasoning over *structured relationships* between entities. We need to know not
just "which text mentions diabetes" but "which rule governs this specific applicant's
diabetes diagnosis given their age, lab results, and the policy they're applying for."
That information is encoded in the graph topology, not in any text chunk. Vector search
retrieves context; graph traversal *assembles* the reasoning chain.

**Q: What additional context does graph traversal provide?**
A: Four categories: (1) **Decision logic** — the UnderwritingRule node carries a
machine-readable `decision` field (REFER_FOR_REVIEW, etc.) that no text chunk expresses
as a clean enum. (2) **Entity properties** — the applicant's exact age, the lab result
value (6.8%), are node properties unreachable by text similarity. (3) **Scope** — which
policy product the rule belongs to, ensuring we only surface rules relevant to what John
is actually applying for. (4) **Personalization** — we know these rules apply to John
specifically because the graph has explicit edges connecting him to these conditions and policies.

**Q: What is multi-hop reasoning?**
A: Multi-hop reasoning means answering a question that requires traversing multiple
relationship types in sequence — for example, going from Applicant → RiskFactor →
UnderwritingRule → Policy in four steps. Each hop crosses a relationship boundary and
adds a new layer of context. It's called "multi-hop" because you're following multiple
edges in the knowledge graph. It's the defining capability that graph retrieval adds over
flat vector search, which can only do "one-hop" retrieval (query embedding → nearest chunks).

**Q: How does GraphRAG improve explainability?**
A: Every fact in the LLM prompt can be traced to a specific graph path. If the answer
mentions "John requires additional review due to his age and diabetes," that can be
audited: rule_004 was retrieved because chunk_004 scored high → SUPPORTED_BY → rule_004
→ EVALUATED_BY → Type 2 Diabetes → HAS_CONDITION → John Smith. The exact path is
reproducible and inspectable. In regulated industries like insurance, this provenance
trail matters — it's the difference between "the AI said so" and "the underwriting
manual Section 6.5 says so, and here is the specific rule that applied to this applicant."

---

---

# Step 5 — GraphRAG Answer Generation

## What Changed in Step 5

New files:
- `app/mock_llm.py` — `MockLLM` class: deterministic business logic that converts graph context into a structured answer (no API calls)
- `app/graphrag_pipeline.py` — `GraphRAGPipeline` class: wires `GraphRetriever` → `MockLLM` into a single callable pipeline, plus a runnable demo

---

## GraphRAG Pipeline — Full Flow

```
Question (natural language)
    │
    ▼  GraphRetriever._vector_search()
Top-k DocumentChunk nodes — most semantically relevant manual sections
    │
    ▼  GraphRetriever._traverse_from_chunks()
Structured graph context:
  • UnderwritingRule nodes  (decision logic)
  • RiskFactor nodes        (clinical conditions)
  • Policy nodes            (product scope)
  • Applicant nodes         (entity personalization)
    │
    ▼  MockLLM.generate_answer()  ← replaced by real LLM in Step 8
Final answer:
  • decision          (REFER_FOR_REVIEW / REQUIRE_ADDITIONAL_REVIEW / APPROVE)
  • reasoning         (ordered list of plain-English steps)
  • supporting_rules  (rule IDs, titles, decisions used)
  • risk_factors      (risk factors considered)
  • citations         (DocumentChunk sources + UnderwritingRule titles)
```

---

## Why a MockLLM Instead of Skipping to a Real LLM

The MockLLM validates that:

1. **The context structure is correct.** If `mock_llm.py` can consume the context dict and produce a structured answer, the shape is proven before any real LLM sees it.
2. **The pipeline plumbing works.** The full call chain (driver → retriever → context → LLM → output) runs end-to-end without API cost or latency.
3. **The business logic is auditable.** Hard-coded logic is transparent — you can read exactly why a decision was made. Real LLMs are probabilistic; the mock is deterministic. Baseline expected behaviour is locked in before the LLM introduces variance.

In production, the MockLLM is replaced by a single substitution: pass the context dict into a real prompt and call the LLM. The pipeline structure is identical.

---

## What the MockLLM Decision Logic Encodes

The three-branch decision tree captures the core underwriting scenario:

| Condition detected | Decision |
|---|---|
| Type 2 Diabetes **+** Controlled A1C | `REFER_FOR_REVIEW` |
| Type 2 Diabetes alone (A1C not confirmed) | `REQUIRE_ADDITIONAL_REVIEW` |
| No disqualifying conditions | `APPROVE` |

The logic reads from `context["risk_factors"]` by name (case-insensitive substring match),
not from hard-coded applicant IDs. This means it would generalise to any applicant whose
graph context contains these risk factors — it is not John-Smith-specific.

---

## Citations: The Explainability Artefact

The `citations` field in the answer links every output to its source:

```python
[
  {"type": "DocumentChunk",    "source": "Underwriting Manual v3.2, Section 6.3", "relevance_score": 0.9998},
  {"type": "DocumentChunk",    "source": "Underwriting Manual v3.2, Section 6.5", "relevance_score": 0.9997},
  {"type": "UnderwritingRule", "title": "Controlled Diabetes Review",              "decision": "REFER_FOR_REVIEW"},
  {"type": "UnderwritingRule", "title": "Age and Diabetes Additional Review",      "decision": "REQUIRE_ADDITIONAL_REVIEW"},
]
```

This is explainable AI in practice: every sentence in the reasoning trace can be pinned to a specific DocumentChunk (the source text) and a specific UnderwritingRule (the decision logic node). A compliance officer can inspect the graph path that produced each citation.

---

## Frequently Asked Questions — Step 5

**Q: What is GraphRAG?**
A: GraphRAG is a retrieval-augmented generation pattern that replaces (or augments)
flat vector search with knowledge graph retrieval. A vector search finds semantically
similar text chunks. GraphRAG goes further: it traverses the graph around those chunks
to assemble structured, entity-aware context — specific nodes (applicants, rules, policies)
and the typed relationships between them. The LLM then reasons over structured context
rather than raw text blobs, producing more grounded and explainable answers.

**Q: Why not pass vector results directly to the LLM?**
A: Vector results are text chunks — unstructured paragraphs with no explicit entity
bindings. The LLM would have to infer: "this chunk is about diabetes, and presumably
it applies to the applicant in question." That inference is unreliable. By traversing
the graph first, we hand the LLM structured facts: "John Smith (age 48) has Type 2
Diabetes (controlled). Rule: Controlled Diabetes Review. Decision: REFER_FOR_REVIEW.
Source: Section 6.3." The LLM is doing reasoning, not extraction — which is what
language models do well. Extraction from ambiguous text is where they hallucinate.

**Q: Why assemble graph context first, before calling the LLM?**
A: Because graph traversal is deterministic and cheap, while LLM calls are
probabilistic and expensive. Graph context assembly runs in milliseconds against
a local Neo4j instance with zero API cost. If the LLM later gets the decision wrong,
you can inspect the context dict and see exactly what it was given. Separating
retrieval from generation also means you can cache the context for identical questions,
test retrieval quality independently of generation quality, and swap LLMs without
touching the retrieval layer.

**Q: What is explainable AI in this example?**
A: Explainability here means every output can be traced to a specific source in the
knowledge graph. The `citations` field lists the exact DocumentChunk nodes (manual
sections) and UnderwritingRule nodes whose properties drove the decision. A compliance
reviewer can open the graph, run the same traversal Cypher, and reproduce the exact
context the system used. There is no black-box step — the retrieval is auditable Cypher,
the reasoning is explicit code (or, with a real LLM, an explicit prompt with structured
input), and the citations link back to the authoritative source documents.

**Q: How would production GraphRAG differ from this project?**
A: Four main differences:
1. **Real embeddings** — `mock_embed()` is replaced by a model like `text-embedding-3-small`.
   The vector search then returns semantically relevant chunks, not hash-based noise.
2. **Real LLM** — `MockLLM.generate_answer()` is replaced by a prompt that feeds the
   context dict to a real LLM (e.g., gpt-4o). The reasoning is generated, not hard-coded.
3. **Schema breadth** — the seed data has one applicant and four rules. Production would
   have thousands of applicants, hundreds of rules, and complex multi-policy scenarios.
   The retrieval and traversal queries scale with data, not code changes.
4. **API layer** — `GraphRAGPipeline.run()` is called from a FastAPI endpoint, enabling
   concurrent requests, authentication, logging, and response streaming. The pipeline
   class itself is unchanged — it's just called from a different entry point.

---

---

# Step 6 — FastAPI /ask Endpoint

## What Changed in Step 6

New files:
- `app/main.py` — FastAPI app with `POST /ask` and `GET /health`; lifespan creates and closes the Neo4j driver once for the server process

Updated files:
- `README.md` — API usage, curl examples, response schema, error table

---

## Why Expose GraphRAG as an API

The pipeline as a Python script answers one question in one process. Making it a REST API changes what is possible:

| Concern | Script | API |
|---|---|---|
| Caller | Must be Python, same process | Any language, any network client |
| Concurrency | One question at a time | Handled by Uvicorn/ASGI worker model |
| Reuse of DB connection | Recreated per run | Driver opened once, sessions reused |
| Integration | Manual | curl, SDK, agent, UI, workflow platform |
| Observability | stdout only | HTTP status codes, structured error responses |

The FastAPI endpoint is a thin adapter — it validates the request, delegates to the pipeline, and shapes the response. The business logic does not move.

---

## Lifespan Pattern — One Driver, Many Requests

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    driver = get_driver()                              # opened once at server startup
    app.state.driver = driver
    app.state.reseed_lock = asyncio.Lock()             # serialises auto-reindex operations
    app.state.pipelines = {
        "demo":   GraphRAGPipeline.for_mode(driver, "demo"),
        "openai": GraphRAGPipeline.for_mode(driver, "openai"),  # only if OPENAI_API_KEY set
    }
    yield                                              # server runs here
    driver.close()                                     # closed cleanly at shutdown
```

The Neo4j driver maintains a **connection pool** internally. Opening it once and sharing it across requests is the correct pattern — it avoids the overhead of a new connection per request and respects Neo4j's session model. Creating a new driver per request would exhaust connections under any real load.

`app.state` is FastAPI's mechanism for storing server-scoped objects. Both pipelines and the lock are available in every route handler via `request.app.state`. Step 10 extended this from a single pipeline to a dict of pipelines keyed by mode, plus the `asyncio.Lock` that prevents concurrent auto-reindex operations from triggering a double-reseed.

---

## Error Handling Strategy

Three error classes, three HTTP codes:

| Condition | HTTP code | How detected |
|---|---|---|
| Blank question | 400 Bad Request | `question.strip()` is empty |
| Neo4j unreachable | 503 Service Unavailable | `neo4j.exceptions.ServiceUnavailable` or `AuthError` |
| Unexpected bug | 500 Internal Server Error | bare `Exception` catch-all |

The 400/503/500 split matters for callers. A 400 means the caller sent bad input — fix the request. A 503 means the backend dependency is down — retry later or alert ops. A 500 means a bug in the server — never the caller's fault.

---

## How This Maps to Enterprise Architecture

In a production system, the `/ask` endpoint sits at the centre of several integration patterns:

```
UI (React / mobile)
        │  POST /ask
        ▼
  FastAPI /ask
        │
        ├── GraphRAGPipeline
        │       ├── Neo4j (graph + vector)
        │       └── LLM API (OpenAI)    ← added in Step 8
        │
        └── Auth middleware (JWT / API key)       ← added in production

Workflow platform (n8n / Prefect / Airflow)
        │  POST /ask  (automated underwriting batch)
        ▼
  FastAPI /ask

AI agent (LangChain / LLM agent)
        │  tool call → POST /ask
        ▼
  FastAPI /ask
```

The endpoint does not care who calls it. A human using a browser, a batch job processing 1 000 applications overnight, and an AI agent orchestrating a multi-step underwriting workflow all use the same interface. This is why the REST boundary matters: it decouples the retrieval-and-reasoning layer from every consumer of it.

---

## retrieval_summary — Why Include It

The response includes a `retrieval_summary` field:

```json
"retrieval_summary": {
  "matched_chunks": 3,
  "rules": 3,
  "risk_factors": 3,
  "policies": 1,
  "applicants": 1
}
```

This is not the answer — it is metadata about the retrieval. It lets callers (and developers) see whether the pipeline retrieved anything meaningful without having to inspect the full `citations` array. In production it is useful for:
- **Debugging** — if `matched_chunks` is 0, the question did not match anything in the vector index.
- **Monitoring** — log `matched_chunks` and `rules` counts to detect retrieval quality degradation over time.
- **UI** — a frontend can show "Found 3 relevant manual sections and 3 applicable rules" alongside the decision.

---

## Frequently Asked Questions — Step 6

**Q: Why use FastAPI over Flask or Django for a GraphRAG service?**
A: FastAPI is async-native (built on Starlette and ASGI), which matches well with I/O-bound
workloads like Neo4j queries and LLM API calls. It generates OpenAPI docs automatically,
which matters for a service intended to be called by other teams or agents. Pydantic models
enforce request and response shape at the boundary — if the pipeline returns a malformed
context dict, the 422 response is automatic and precise. Flask would require manually wiring
all of that; Django would bring significantly more overhead for what is effectively one
endpoint.

**Q: How would you add authentication to this endpoint in production?**
A: Depends on the deployment context. For internal services, a shared API key in the
`Authorization` header is simple and auditable — validate it in a FastAPI dependency that
every route depends on. For external or user-facing APIs, JWT tokens issued by an identity
provider (Auth0, Cognito, Azure AD) allow per-user claims, token expiry, and scoped
permissions (e.g., read-only vs. write). Both approaches are a FastAPI `Depends()` function
that raises `HTTPException(401)` or `HTTPException(403)` — the route handlers never change.

**Q: How would you scale this to handle hundreds of concurrent /ask requests?**
A: Three layers. First, run multiple Uvicorn workers (`uvicorn app.main:app --workers 4`) —
each worker shares the Neo4j driver's connection pool. Second, put a load balancer
(nginx, ALB) in front. Third, make the expensive step (LLM API call, once added) async
— FastAPI's `async def` routes yield back to the event loop while waiting for the LLM
response, so one worker can handle many in-flight requests concurrently. The Neo4j driver
is already thread-safe and manages its own pool. The MockLLM is CPU-bound and near-instant,
so the bottleneck in production will be the LLM API latency, not the graph retrieval.

---

---

---

---

# Step 8 — Real Embeddings and LLM

## What Changed in Step 8

Updated files:
- `app/config.py` — five new env vars: `OPENAI_API_KEY`, `USE_OPENAI_EMBEDDINGS`, `OPENAI_EMBEDDING_MODEL`, `USE_OPENAI_LLM`, `OPENAI_LLM_MODEL`
- `app/embed.py` — added `MockEmbeddingProvider`, `OpenAIEmbeddingProvider`, `get_embedding_provider()` factory; kept `mock_embed()` for backward compatibility
- `app/seed.py` — uses `get_embedding_provider()` instead of `mock_embed()` directly; stores `embedding_model` and `embedding_provider` as properties on DocumentChunk nodes
- `app/graph_retriever.py` — accepts `embedding_provider` parameter; adds `_check_embedding_compatibility()` warning
- `app/graphrag_pipeline.py` — adds `_get_llm()` factory; displays active mode in demo output

New files:
- `app/openai_llm.py` — `OpenAILLM` class: calls OpenAI chat completions with JSON mode; produces same response shape as `MockLLM`
- `.env.example` — documents all env vars with comments

Updated docs:
- `README.md` — two-mode table, per-mode run instructions, provider-switch warning
- `ARCHITECTURE.md` — embedding provider section, LLM provider section, updated production table

---

## The Provider Abstraction Pattern

Both embedding providers expose the same interface:

```python
provider.embed(text: str) -> list[float]
provider.model_name        -> str
```

Both LLM providers expose the same interface:

```python
llm.generate_answer(question: str, context: dict) -> dict
```

The pipeline, API handler, and display code never check which provider is active — they call
`embed()` and `generate_answer()` and get the same shapes back. This is the **strategy
pattern**: the algorithm (embed / generate) is the same; only the implementation varies.

Adding a third provider (e.g., `CohereEmbeddingProvider`) requires:
1. Writing the new class with the same two-method interface
2. Updating the factory function to check for its env vars
3. Zero changes to the pipeline, retriever, or API

---

## Embedding Consistency — Why It Matters

This is the most important operational constraint in any embedding-based system.

When you call `python3 -m app.seed`, the embedding function turns each DocumentChunk's
text into a float vector and stores it in Neo4j. That vector is now frozen in the database.

When a question arrives, the embedding function turns the question into a float vector and
runs a similarity search against the stored vectors.

**If the two vectors were produced by different models, the similarity scores are
meaningless.** The model's embedding space is its own coordinate system. A position in the
OpenAI embedding space and the same position in the mock hash space refer to completely
different directions. They happen to be the same 1536 numbers, but they represent nothing
comparable.

This is not a subtle edge case — it produces confidently wrong results with no error message.
The API returns 200 OK, the retrieval_summary shows matched_chunks=3, and every citation is
wrong.

**How we prevent it — automatic from Step 10 onwards:**

1. `seed.py` stores `embedding_model` on every `DocumentChunk` node it processes.
2. Before each `/ask` request, `_auto_reseed_if_needed()` in `main.py` reads the stored
   model name and compares it to the active pipeline's provider `model_name`.
3. If they differ, `reindex_embeddings(driver, provider)` from `seed.py` re-embeds every
   `DocumentChunk` using the correct provider and updates the stored metadata — all before
   the query vector is computed.
4. An `asyncio.Lock` serialises concurrent re-index attempts so only the first request after
   a mode switch performs the re-index; subsequent requests skip it.
5. `GraphRetriever._check_embedding_compatibility()` runs as a final safety check and returns
   a warning string if the models still differ (e.g. the re-index failed because the OpenAI
   API was unreachable). This string surfaces in the `compatibility_warning` response field
   and the amber banner in the UI.

The `reindexed: bool` field in the API response tells callers (and the UI) whether
re-indexing ran for that specific request. A green "auto-reindexed" notice appears in the
browser the first time after a mode switch, then disappears on subsequent requests.

In production, the check would block the request and trigger an alert. The seed/index
pipeline and the retrieval pipeline would be part of the same CI/CD workflow to ensure
they always stay in sync rather than relying on runtime detection.

---

## OpenAI JSON Mode

`OpenAILLM` uses `response_format={"type": "json_object"}`:

```python
response = client.chat.completions.create(
    model=OPENAI_LLM_MODEL,
    response_format={"type": "json_object"},
    messages=[...],
)
```

JSON mode guarantees the response is valid JSON — `json.loads()` will not raise. Without it,
the model might include preamble like "Here is my answer:" before the JSON, which breaks
parsing. JSON mode is available on GPT-4o and later. It requires the system prompt to
explicitly mention JSON — otherwise OpenAI returns an error.

The system prompt instructs the model to:
- Base the answer only on the retrieved context (no hallucination)
- Return `REQUIRE_ADDITIONAL_REVIEW` if context is insufficient
- Use the same field names as `MockLLM` so the response shape is provider-agnostic

---

## Why Structured Context Is Better Than Raw Text for the LLM

This is the core GraphRAG argument, made concrete by the OpenAI mode.

**What the LLM receives in this system:**
```
=== Underwriting Rules ===
  Title    : Controlled Diabetes Review
  Rule text: Controlled Type 2 Diabetes with A1C below 7.0 may be referred for review.
  Decision : REFER_FOR_REVIEW

=== Risk Factors ===
  Type 2 Diabetes  [category: chronic_condition]
  Controlled A1C   [category: lab_marker]

=== Applicants ===
  John Smith, age 48
```

**What a plain RAG system would give the LLM:**
```
"Type 2 Diabetes is assessed based on glycemic control. An A1C below 7.0% is considered
controlled. Applicants with controlled diabetes may be referred for standard or preferred
review depending on other risk factors..."
```

The structured version has explicit entity types, labeled properties, and the decision
enum. The LLM can directly read `Decision: REFER_FOR_REVIEW` and confirm it. In the
plain text version, the LLM must infer: Is this about John? Does this rule apply to him?
What is the actual decision? These inferences are where hallucination happens.

**Key insight:** GraphRAG shifts work from LLM inference time (expensive, probabilistic)
to graph retrieval time (cheap, deterministic). The LLM does reasoning; the graph does
extraction.

---

## Frequently Asked Questions — Step 8

**Q: How do you switch between mock and real embeddings without changing the pipeline?**
A: Both providers implement the same two-method interface: `embed(text)` and `model_name`.
`GraphRAGPipeline.for_mode(driver, mode)` wires the correct provider for the requested mode.
The pipeline, retriever, and API never check which provider is active — they call `embed()`
and get a `list[float]` back. Switching is per-request via the `mode` field; the server
auto-reindexes embeddings on the first request in a new mode using `reindex_embeddings()`.

**Q: What happens if you switch embedding models without re-indexing?**
A: The stored vectors and the query vector live in incompatible coordinate spaces. The
similarity search runs without error and returns results with confidently wrong scores.
This is the most dangerous failure mode in embedding systems — silent and plausible-looking.
We guard against it in two layers: `_auto_reseed_if_needed()` detects the mismatch and
re-indexes before the query runs; `GraphRetriever._check_embedding_compatibility()` is a
final safety check that returns a warning string if re-indexing was skipped or failed.

**Q: Why use OpenAI's JSON mode instead of asking the model to return JSON in the prompt?**
A: Because JSON mode is enforced by the API, not by the model's instruction-following.
Without JSON mode, the model might add preamble text ("Here is my answer:"), use trailing
commas, or truncate the response mid-object. All of these break `json.loads()`. JSON mode
activates a constrained decoding mode — the model's token sampling is filtered to only
produce valid JSON tokens. It is reliable in a way that a prompt instruction is not.

**Q: How would you add a new LLM provider (e.g., Cohere, Mistral)?**
A: Write a new class in `app/` with a `generate_answer(question, context)` method that
calls the provider's API and parses the response into the same dict shape as `MockLLM`
(`decision`, `reasoning`, `supporting_rules`, `risk_factors`, `citations`). Update
`_get_llm()` in `graphrag_pipeline.py` to check the new provider's env vars. No other
files change. The interface contract (same input, same output shape) is what makes the
provider swappable.

## Design Considerations

Quick-reference answers. Full narrative is in [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

---

### What is this project?

A GraphRAG system for insurance underwriting. It answers underwriting questions by combining
Neo4j vector similarity search with structured graph traversal, then feeding the assembled
context to a decision layer (MockLLM in Demo Mode, real LLM in production).

---

### Honest scope statement

> "This is a learning project. The embeddings are hash-based and not semantic. The LLM is
> deterministic business logic. The seed data covers one applicant. I built it to
> understand the pipeline architecture — the graph model, retrieval logic, and API
> contract are production-equivalent. Replacing the mocks requires changing two functions."

Being upfront about scope and limitations is more credible than overselling.

---

### Core technical arguments

**Why graph over vector-only:**
Vector search finds similar text. It cannot filter to a specific applicant, follow a
reasoning chain across entity types, or tell you which rule governs which condition for
which policy. Graph traversal does all three in one Cypher query.

**Why graph over SQL:**
Multi-hop traversal (applicant → condition → rule → policy) is a recursive JOIN problem
in SQL. In Cypher it is a path query. Adding a new relationship type requires no schema
migration.

**Why structured context is better for the LLM:**
An LLM given raw text paragraphs must infer entity identities and relationships under
inference-time uncertainty — that is where hallucinations happen. An LLM given structured
facts (applicant name, age, specific lab value, specific rule, specific decision enum) is
doing reasoning, not extraction. Reasoning is what language models do well.

**Why citations matter in regulated industries:**
Every output fact is traceable to a specific graph path. A compliance reviewer can reproduce
the exact context the system used. This is the difference between "the AI said so" and
"Section 6.3 of the Underwriting Manual says so, and here is the rule that applied to this
specific applicant."

---

### What I would add for production

1. Real embedding model — `text-embedding-3-small`. Vector index unchanged.
2. Real LLM — gpt-4o via OpenAI. Context dict format unchanged.
3. Authentication — FastAPI `Depends()` for API key or JWT.
4. Observability — log `retrieval_summary` counts to detect retrieval quality degradation.
5. Text2CypherRetriever — second retrieval path for structured lookups ("list all open claims").

---

### What I learned building this

- The `SUPPORTED_BY` relationship is the architectural bridge between semantic (vector)
  and structural (graph) retrieval. Embeddings on chunks, logic on rules, graph connects them.
- `db.create.setNodeVectorProperty` stores Float32. Direct `SET n.embedding = $list` stores
  Float64. Neo4j's HNSW index requires Float32. Use the procedure.
- `UNWIND` batches multi-chunk traversal into one round-trip. One query per chunk would not
  scale.
- FastAPI's lifespan pattern is the correct way to manage a shared Neo4j driver. One driver,
  internal connection pool, closed cleanly at shutdown.
- Mock components should fail loudly on infrastructure errors and produce correct output shapes.
  That is their only job — and it is enough to validate the pipeline before adding API cost.
