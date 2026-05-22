const $ = (id) => document.getElementById(id);

let currentDoc = null; // { document_id, document_name, pages, chunks_total }

// Drag & drop
const dz = $('dropzone');
$('browse-btn').addEventListener('click', () => $('file-input').click());
dz.addEventListener('click', (e) => {
  if (e.target.id === 'browse-btn' || e.target.tagName === 'BUTTON') return;
  $('file-input').click();
});
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover');
}));
dz.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f) ingest(f);
});
$('file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) ingest(f);
});

// Ask
$('ask-btn').addEventListener('click', ask);
$('question-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
  $('question-input').value = c.dataset.q;
  ask();
}));

// Reset
$('reset-doc-btn').addEventListener('click', () => resetIndex(false));
$('reset-all-btn').addEventListener('click', () => {
  if (confirm('Limpar TODOS os documentos do índice? Esta ação não pode ser desfeita.')) resetIndex(true);
});

function setStep(n, state) {
  for (let i = 1; i <= 4; i++) {
    const el = $(`step-${i}`);
    el.classList.remove('active', 'done');
  }
  for (let i = 1; i < n; i++) $(`step-${i}`).classList.add('done');
  if (n <= 4) $(`step-${n}`).classList.add('active');
}

async function ingest(file) {
  if (file.size > 20 * 1024 * 1024) {
    setIngestStatus('❌ Arquivo acima de 20 MB. Reduza o tamanho.', 'error');
    return;
  }
  setStep(2);
  setIngestStatus(`⏳ Processando "${file.name}" — OCR + indexação podem levar 20-60s...`, 'info');
  $('document-info').classList.add('hidden');
  $('ask-card').classList.add('hidden');
  $('manage-card').classList.add('hidden');

  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/ingest', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro desconhecido');

    currentDoc = data;
    setStep(4);
    setIngestStatus(`✅ Documento processado e indexado com sucesso.`, 'success');
    renderDocInfo(data);
    $('ask-card').classList.remove('hidden');
    $('manage-card').classList.remove('hidden');
    $('copilot-note').classList.remove('hidden');
    $('question-input').focus();
  } catch (e) {
    setStep(1);
    setIngestStatus(`❌ ${e.message}`, 'error');
  }
}

function renderDocInfo(d) {
  const info = $('document-info');
  info.classList.remove('hidden');
  info.innerHTML = `
    <div class="doc-name">📄 ${escapeHtml(d.document_name)}</div>
    <div class="muted">ID: <code>${escapeHtml(d.document_id)}</code></div>
    <div class="metrics">
      <div class="metric"><span class="metric-value">${d.pages}</span><span class="metric-label">páginas</span></div>
      <div class="metric"><span class="metric-value">${d.chunks_indexed}</span><span class="metric-label">trechos indexados</span></div>
      <div class="metric"><span class="metric-value">${(d.timings.ocr_ms/1000).toFixed(1)}s</span><span class="metric-label">tempo OCR</span></div>
      <div class="metric"><span class="metric-value">${(d.timings.total_ms/1000).toFixed(1)}s</span><span class="metric-label">tempo total</span></div>
    </div>
  `;
}

async function ask() {
  const q = $('question-input').value.trim();
  if (!q) { setAskStatus('Digite uma pergunta.', 'error'); return; }
  if (!currentDoc) { setAskStatus('Envie um documento primeiro.', 'error'); return; }

  setAskStatus('🔎 Buscando trechos relevantes...', 'info');
  $('ask-btn').disabled = true;
  $('answers').innerHTML = '';

  try {
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, document_id: currentDoc.document_id })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro na busca');
    renderAnswers(data);
    setAskStatus('');
  } catch (e) {
    setAskStatus(`❌ ${e.message}`, 'error');
  } finally {
    $('ask-btn').disabled = false;
  }
}

function renderAnswers(data) {
  const div = $('answers');
  if (!data.results || !data.results.length) {
    div.innerHTML = '<div class="answer-card"><p class="muted">Nenhum trecho relevante encontrado. Tente reformular a pergunta.</p></div>';
    return;
  }
  div.innerHTML = data.results.map((r, i) => {
    const snippet = (r['@search.highlights'] && (r['@search.highlights'].content || []).join(' ... '))
                 || r.content;
    const score = r['@search.score'] ? r['@search.score'].toFixed(2) : '—';
    return `
      <div class="answer-card ${i === 0 ? 'top' : ''}">
        <div class="answer-meta">
          <span class="answer-rank">${i + 1}</span>
          <span class="citation">📄 ${escapeHtml(r.document_name)} · Página ${r.page} · Trecho ${r.chunk_index + 1}</span>
          <span class="score">BM25 score: ${score}</span>
        </div>
        <div class="answer-text">${snippet}</div>
      </div>
    `;
  }).join('');
}

async function resetIndex(all) {
  setResetStatus('⏳ Removendo...', 'info');
  try {
    const body = all ? {} : { document_id: currentDoc ? currentDoc.document_id : '' };
    const r = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro');
    setResetStatus(`✅ ${data.deleted} trecho(s) removido(s).`, 'success');
    if (all || (currentDoc && data.document_id === currentDoc.document_id)) {
      currentDoc = null;
      $('document-info').classList.add('hidden');
      $('ask-card').classList.add('hidden');
      $('manage-card').classList.add('hidden');
      $('answers').innerHTML = '';
      $('ingest-status').innerHTML = '';
      setStep(1);
    }
  } catch (e) {
    setResetStatus(`❌ ${e.message}`, 'error');
  }
}

function setIngestStatus(msg, cls) {
  const s = $('ingest-status');
  s.textContent = msg;
  s.className = 'status ' + (cls || '');
}
function setAskStatus(msg, cls) {
  const s = $('ask-status');
  s.textContent = msg;
  s.className = 'status ' + (cls || '');
}
function setResetStatus(msg, cls) {
  const s = $('reset-status');
  s.textContent = msg;
  s.className = 'status ' + (cls || '');
}
function escapeHtml(s) {
  return (s || '').toString().replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
}

setStep(1);
