import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from neo4j.exceptions import AuthError, ServiceUnavailable
from pydantic import BaseModel

from app.config import OPENAI_API_KEY
from app.graph import get_driver, run_query
from app.graphrag_pipeline import GraphRAGPipeline

STATIC_DIR = Path(__file__).parent.parent / "static"

VALID_MODES = {"demo", "openai"}


# ------------------------------------------------------------------
# Pydantic models
# ------------------------------------------------------------------

class AskRequest(BaseModel):
    question: str
    mode: str = "demo"


class RetrievalSummary(BaseModel):
    matched_chunks: int
    rules: int
    risk_factors: int
    policies: int
    applicants: int


class AskResponse(BaseModel):
    # Core answer — original contract, unchanged
    question: str
    decision: str
    reasoning: list[str]
    supporting_rules: list[dict]
    risk_factors: list[dict]
    citations: list[dict]
    retrieval_summary: RetrievalSummary
    # Extended retrieval detail — added in Step 9 for UI visualization
    matched_chunks: list[dict] = []
    graph_context: dict = {}
    # Step 10 — mode and provider metadata
    mode: str = "demo"
    embedding_provider: str = "mock"
    llm_provider: str = "MockLLM"
    compatibility_warning: str | None = None
    # True when embeddings were automatically re-indexed for this request's mode
    reindexed: bool = False


# ------------------------------------------------------------------
# Auto-reseed helper
# ------------------------------------------------------------------

async def _auto_reseed_if_needed(
    pipeline: GraphRAGPipeline,
    driver,
    lock: asyncio.Lock,
) -> bool:
    """
    Compares the embedding model stored on DocumentChunk nodes with the model
    the active pipeline's provider would produce.  If they differ, re-embeds
    all DocumentChunk nodes using the pipeline's provider — no graph structure
    changes, only the embedding vectors and metadata.

    Returns True  if reseeding was performed successfully.
    Returns False if no reseed was needed, or if reseeding failed.

    The asyncio.Lock prevents concurrent requests from triggering a double-reseed.
    Each reseed operation runs in a thread pool so the async event loop is not blocked.
    """
    def _stored_model() -> str | None:
        rows = run_query(
            driver,
            "MATCH (d:DocumentChunk) WHERE d.embedding_model IS NOT NULL "
            "RETURN d.embedding_model AS model LIMIT 1",
        )
        return rows[0]["model"] if rows else None

    stored = await asyncio.to_thread(_stored_model)
    target = pipeline.retriever.embedding_provider.model_name

    if stored is None or stored == target:
        return False  # already consistent, nothing to do

    async with lock:
        # Re-check inside the lock: a concurrent request may have reseeded already
        stored = await asyncio.to_thread(_stored_model)
        if stored == target:
            return False  # done by a concurrent request, not by us

        try:
            from app.seed import reindex_embeddings
            await asyncio.to_thread(
                reindex_embeddings, driver, pipeline.retriever.embedding_provider
            )
            return True
        except Exception as exc:
            print(f"[auto-reseed] failed: {exc}")
            return False


# ------------------------------------------------------------------
# Lifespan: open the Neo4j driver once and reuse it across requests
# ------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    driver = get_driver()
    app.state.driver = driver
    app.state.reseed_lock = asyncio.Lock()

    pipelines: dict[str, GraphRAGPipeline] = {
        "demo": GraphRAGPipeline.for_mode(driver, "demo"),
    }
    if OPENAI_API_KEY:
        pipelines["openai"] = GraphRAGPipeline.for_mode(driver, "openai")

    app.state.pipelines = pipelines
    yield
    driver.close()


# ------------------------------------------------------------------
# App
# ------------------------------------------------------------------

app = FastAPI(
    title="Neo4j Insurance GraphRAG",
    description="Insurance underwriting question-answering via graph-augmented retrieval.",
    version="0.10.0",
    lifespan=lifespan,
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------

@app.get("/", include_in_schema=False)
async def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "neo4j-insurance-graphrag-poc"}


@app.post("/ask", response_model=AskResponse)
async def ask(body: AskRequest, request: Request):
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question must not be blank")

    mode = body.mode
    if mode not in VALID_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"mode must be one of: {sorted(VALID_MODES)}",
        )

    pipelines: dict[str, GraphRAGPipeline] = request.app.state.pipelines
    if mode not in pipelines:
        raise HTTPException(
            status_code=400,
            detail=(
                f"mode '{mode}' is not available — "
                "set OPENAI_API_KEY in .env and restart the server to enable it"
            ),
        )

    pipeline = pipelines[mode]
    driver = request.app.state.driver
    lock: asyncio.Lock = request.app.state.reseed_lock

    # If the stored embeddings don't match the requested mode's provider,
    # re-embed all DocumentChunk nodes before running the query.
    # The first request after a mode switch is slightly slower; subsequent ones are fast.
    reseeded = await _auto_reseed_if_needed(pipeline, driver, lock)

    try:
        # Skip the in-query compatibility check when we just reseeded (saves a DB round-trip)
        result = pipeline.run(question, check_compatibility=not reseeded)
    except (ServiceUnavailable, AuthError) as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Neo4j unavailable — is Docker running? ({exc})",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    context = result["context"]
    answer = result["answer"]

    return AskResponse(
        # Original fields
        question=question,
        decision=answer["decision"],
        reasoning=answer["reasoning"],
        supporting_rules=answer["supporting_rules"],
        risk_factors=answer["risk_factors"],
        citations=answer["citations"],
        retrieval_summary=RetrievalSummary(
            matched_chunks=len(context["matched_chunks"]),
            rules=len(context["rules"]),
            risk_factors=len(context["risk_factors"]),
            policies=len(context["policies"]),
            applicants=len(context["applicants"]),
        ),
        # Extended retrieval detail for UI
        matched_chunks=context["matched_chunks"],
        graph_context={
            "rules":        context["rules"],
            "risk_factors": context["risk_factors"],
            "policies":     context["policies"],
            "applicants":   context["applicants"],
        },
        # Step 10 — mode and provider metadata
        mode=mode,
        embedding_provider=pipeline.retriever.embedding_provider.model_name,
        llm_provider=type(pipeline.llm).__name__,
        compatibility_warning=context.get("compatibility_warning"),
        reindexed=reseeded,
    )
