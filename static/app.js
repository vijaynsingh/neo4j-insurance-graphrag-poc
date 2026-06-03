'use strict';

const DEFAULT_QUESTION =
  'Should a diabetic applicant with A1C below 7.0 qualify for preferred term life?';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const questionEl  = document.getElementById('question');
const askBtn      = document.getElementById('ask-btn');
const loadingEl   = document.getElementById('loading');
const errorEl     = document.getElementById('error');
const resultsEl   = document.getElementById('results');

// ── Init ──────────────────────────────────────────────────────────────────────
questionEl.value = DEFAULT_QUESTION;

askBtn.addEventListener('click', runQuery);

questionEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runQuery();
});

// ── Main query flow ───────────────────────────────────────────────────────────
async function runQuery() {
  const question = questionEl.value.trim();
  if (!question) return;

  const mode = document.querySelector('input[name="mode"]:checked')?.value || 'demo';

  setLoading(true, mode);
  clearError();
  hide(resultsEl);

  try {
    const res = await fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, mode }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.detail || `Error ${res.status}`);
      return;
    }

    render(data);
    show(resultsEl);
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError('Network error — is the server running? ' + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Render all sections ───────────────────────────────────────────────────────
function render(data) {
  renderProviderBar(data);
  renderCompatWarning(data.compatibility_warning);
  renderReindexNotice(data);
  renderQuestion(data.question);
  renderChunks(data.matched_chunks || []);
  renderGraphContext(data.graph_context || {});
  renderDecision(data.decision);
  renderReasoning(data.reasoning || []);
  renderCitations(data.citations || []);
}

// Section 1 — Question
function renderQuestion(question) {
  document.getElementById('display-question').textContent = question;
}

// Section 2 — Phase 1: Vector retrieval
function renderChunks(chunks) {
  const el = document.getElementById('chunks-list');
  el.innerHTML = '';

  if (!chunks.length) {
    el.appendChild(emptyState('No document chunks matched.'));
    return;
  }

  chunks.forEach(c => {
    const item = div('chunk-item');
    const header = div('chunk-header');

    const src = span('chunk-source', esc(c.source || '—'));
    const score = c.score != null
      ? span('chunk-score', `similarity ${Number(c.score).toFixed(4)}`)
      : span('chunk-score', '');

    header.append(src, score);
    item.append(header, span('chunk-text', esc(c.text || '')));
    el.appendChild(item);
  });
}

// Section 3 — Phase 2: Graph traversal
function renderGraphContext(ctx) {
  const el = document.getElementById('graph-context');
  el.innerHTML = '';

  const grid = div('context-grid');

  grid.appendChild(contextGroup('Applicants',
    (ctx.applicants || []).map(a => `${a.name}, age ${a.age}`)
  ));

  grid.appendChild(contextGroup('Policies',
    (ctx.policies || []).map(p => `${p.name}  (${p.type || 'n/a'})`)
  ));

  grid.appendChild(contextGroup('Risk Factors',
    (ctx.risk_factors || []).map(rf => `${rf.name}  [${rf.category}]`)
  ));

  // Rules — full width
  const rulesDiv = div('context-group rules-group');
  const rulesH3 = document.createElement('h3');
  rulesH3.textContent = `Underwriting Rules (${(ctx.rules || []).length})`;
  rulesDiv.appendChild(rulesH3);

  if (!(ctx.rules || []).length) {
    rulesDiv.appendChild(emptyState('None'));
  } else {
    ctx.rules.forEach(r => {
      const row = div('rule-item');
      const badge = span('rule-decision-tag', r.decision || '');
      badge.style.cssText = decisionStyle(r.decision);
      const title = span('rule-title', r.title || '');
      row.append(badge, title);
      rulesDiv.appendChild(row);
    });
  }

  grid.appendChild(rulesDiv);
  el.appendChild(grid);
}

function contextGroup(label, items) {
  const groupDiv = div('context-group');
  const h3 = document.createElement('h3');
  h3.textContent = `${label} (${items.length})`;
  groupDiv.appendChild(h3);

  if (!items.length) {
    groupDiv.appendChild(emptyState('None'));
  } else {
    items.forEach(text => {
      const tag = span('context-tag', esc(text));
      groupDiv.appendChild(tag);
    });
  }
  return groupDiv;
}

// Section 4 — Decision
function renderDecision(decision) {
  const el = document.getElementById('decision-badge');
  const label = (decision || 'UNKNOWN').replace(/_/g, ' ');   // non-breaking space
  const badge = span(`decision-badge decision-${decision || 'UNKNOWN'}`, label);
  el.innerHTML = '';
  el.appendChild(badge);
}

// Section 5 — Reasoning
function renderReasoning(reasoning) {
  const ol = document.getElementById('reasoning-list');
  ol.innerHTML = '';
  if (!reasoning.length) {
    ol.insertAdjacentHTML('afterbegin',
      '<li class="empty-state">No reasoning provided.</li>');
    return;
  }
  reasoning.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    ol.appendChild(li);
  });
}

// Section 6 — Citations
function renderCitations(citations) {
  const el = document.getElementById('citations-list');
  el.innerHTML = '';

  if (!citations.length) {
    el.appendChild(emptyState('No citations.'));
    return;
  }

  citations.forEach(cit => {
    const row = div('citation-item');
    let badgeClass, badgeText, citText;

    if (typeof cit === 'string') {
      badgeClass = 'badge-other';
      badgeText  = 'Source';
      citText    = cit;
    } else if (cit.type === 'DocumentChunk') {
      badgeClass = 'badge-chunk';
      badgeText  = 'Chunk';
      const s    = cit.relevance_score != null ? `  (score ${cit.relevance_score})` : '';
      citText    = `${cit.source}${s}`;
    } else {
      badgeClass = 'badge-rule';
      badgeText  = 'Rule';
      citText    = `${cit.title}  →  ${cit.decision}`;
    }

    row.append(
      span(`citation-badge ${badgeClass}`, badgeText),
      span('citation-text', esc(citText))
    );
    el.appendChild(row);
  });
}

// Provider bar
function renderProviderBar(data) {
  const modeLabel = data.mode === 'openai' ? 'OpenAI' : 'Learning';
  document.getElementById('mode-display').textContent      = modeLabel;
  document.getElementById('embedding-display').textContent = data.embedding_provider || '—';
  document.getElementById('llm-display').textContent       = data.llm_provider || '—';
}

// Compatibility warning — only shown if auto-reseed failed
function renderCompatWarning(warning) {
  const el = document.getElementById('compat-warning');
  if (warning) {
    document.getElementById('compat-warning-text').textContent = warning;
    show(el);
  } else {
    hide(el);
  }
}

// Reindex notice — shown once after automatic embedding switch
function renderReindexNotice(data) {
  const el = document.getElementById('reindex-notice');
  if (data.reindexed) {
    const modeLabel = data.mode === 'openai' ? 'OpenAI' : 'Learning';
    document.getElementById('reindex-mode').textContent = modeLabel;
    show(el);
  } else {
    hide(el);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function div(className) {
  const el = document.createElement('div');
  if (className) el.className = className;
  return el;
}

function span(className, text) {
  const el = document.createElement('span');
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function emptyState(msg) {
  return span('empty-state', msg);
}

function esc(str) {
  // Escape for textContent assignment — textContent is already XSS-safe,
  // but we use innerHTML in a few places so keep this available.
  return String(str);
}

function decisionStyle(decision) {
  const styles = {
    APPROVE:                   'background:#dcfce7;color:#15803d',
    REFER_FOR_REVIEW:          'background:#fef9c3;color:#a16207',
    REQUIRE_ADDITIONAL_REVIEW: 'background:#ffedd5;color:#c2410c',
    DECLINE:                   'background:#fee2e2;color:#b91c1c',
    APPROVE_FACTOR:            'background:#dcfce7;color:#15803d',
    REFER_IF_UNCONTROLLED:     'background:#fef9c3;color:#a16207',
  };
  return styles[decision] || 'background:#f3f4f6;color:#374151';
}

function setLoading(on, mode) {
  askBtn.disabled = on;
  askBtn.textContent = on ? 'Running…' : 'Ask →';
  if (on) {
    const modeLabel = mode === 'openai' ? 'OpenAI' : 'Learning';
    loadingEl.innerHTML =
      `<span class="spinner"></span> Running ${modeLabel} pipeline` +
      (mode === 'openai' ? ' <span class="loading-hint">(first switch re-indexes embeddings)</span>' : '') +
      '…';
    show(loadingEl);
  } else {
    hide(loadingEl);
  }
}

function showError(msg) {
  errorEl.textContent = `⚠ ${msg}`;
  show(errorEl);
}

function clearError() {
  errorEl.textContent = '';
  hide(errorEl);
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
