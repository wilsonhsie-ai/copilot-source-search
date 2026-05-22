const Busboy = require('busboy');

const DI_ENDPOINT = (process.env.DOC_INTELLIGENCE_ENDPOINT || '').replace(/\/+$/, '');
const DI_KEY = process.env.DOC_INTELLIGENCE_KEY || '';
const DI_API_VERSION = '2024-11-30';
const DI_MODEL = 'prebuilt-layout';

const SEARCH_ENDPOINT = (process.env.SEARCH_ENDPOINT || '').replace(/\/+$/, '');
const SEARCH_KEY = process.env.SEARCH_ADMIN_KEY || '';
const SEARCH_INDEX = process.env.SEARCH_INDEX_UPLOADS || 'kb-uploads';
const SEARCH_API_VERSION = '2024-07-01';

const MAX_CHUNK_LEN = 1200; // chars
const MIN_CHUNK_LEN = 80;

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers || {})) headers[k.toLowerCase()] = v;
    const bb = Busboy({ headers, limits: { fileSize: 25 * 1024 * 1024 } });
    let fileBuf = null;
    let mimetype = 'application/pdf';
    let filename = 'documento';
    bb.on('file', (_name, file, info) => {
      mimetype = info.mimeType || mimetype;
      filename = info.filename || filename;
      const chunks = [];
      file.on('data', c => chunks.push(c));
      file.on('end', () => { fileBuf = Buffer.concat(chunks); });
    });
    bb.on('finish', () => resolve({ fileBuf, mimetype, filename }));
    bb.on('error', reject);
    bb.end(req.body);
  });
}

async function ocrLayout(fileBuf, contentType) {
  const url = `${DI_ENDPOINT}/documentintelligence/documentModels/${DI_MODEL}:analyze?api-version=${DI_API_VERSION}`;
  const submit = await fetch(url, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': DI_KEY, 'Content-Type': contentType },
    body: fileBuf,
  });
  if (submit.status !== 202) {
    const t = await submit.text();
    throw new Error(`DI submit failed: ${submit.status} ${t}`);
  }
  const opUrl = submit.headers.get('operation-location');
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pr = await fetch(opUrl, { headers: { 'Ocp-Apim-Subscription-Key': DI_KEY } });
    const data = await pr.json();
    if (data.status === 'succeeded') return data.analyzeResult;
    if (data.status === 'failed') throw new Error(`DI failed: ${JSON.stringify(data)}`);
  }
  throw new Error('DI polling timeout');
}

function chunkContent(analyzeResult) {
  // Preferir paragrafos do layout, mas mesclar pequenos e quebrar grandes
  const paragraphs = (analyzeResult.paragraphs || []).filter(p => (p.content || '').trim().length);
  if (!paragraphs.length) {
    // Fallback: usar content bruto particionado
    const content = (analyzeResult.content || '').trim();
    if (!content) return [];
    const chunks = [];
    for (let i = 0; i < content.length; i += MAX_CHUNK_LEN) {
      chunks.push({ content: content.slice(i, i + MAX_CHUNK_LEN), page: 1 });
    }
    return chunks;
  }

  const out = [];
  let buf = '';
  let bufPage = 1;
  for (const p of paragraphs) {
    const text = (p.content || '').trim();
    if (!text) continue;
    const page = ((p.boundingRegions && p.boundingRegions[0] && p.boundingRegions[0].pageNumber) || 1);
    if (buf && (buf.length + text.length + 2 > MAX_CHUNK_LEN || page !== bufPage)) {
      out.push({ content: buf.trim(), page: bufPage });
      buf = '';
    }
    if (!buf) bufPage = page;
    buf = buf ? buf + '\n\n' + text : text;
    if (buf.length >= MAX_CHUNK_LEN) {
      out.push({ content: buf.trim(), page: bufPage });
      buf = '';
    }
  }
  if (buf.trim().length >= MIN_CHUNK_LEN) out.push({ content: buf.trim(), page: bufPage });
  return out;
}

async function indexChunks(chunks, documentId, documentName) {
  const uploadedAt = new Date().toISOString();
  const actions = chunks.map((c, idx) => ({
    '@search.action': 'mergeOrUpload',
    id: `${documentId}_${idx}`,
    document_id: documentId,
    document_name: documentName,
    page: c.page || 1,
    chunk_index: idx,
    content: c.content,
    uploaded_at: uploadedAt
  }));

  // Index in batches of 100
  const batchSize = 100;
  let ok = 0, fail = 0;
  for (let i = 0; i < actions.length; i += batchSize) {
    const batch = { value: actions.slice(i, i + batchSize) };
    const url = `${SEARCH_ENDPOINT}/indexes/${SEARCH_INDEX}/docs/index?api-version=${SEARCH_API_VERSION}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': SEARCH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Indexing error: ${JSON.stringify(data)}`);
    for (const item of (data.value || [])) {
      if (item.status) ok++; else fail++;
    }
  }
  return { ok, fail };
}

module.exports = async function (context, req) {
  context.res = { headers: { 'Content-Type': 'application/json' } };

  if (!DI_ENDPOINT || !DI_KEY || !SEARCH_ENDPOINT || !SEARCH_KEY) {
    context.res.status = 500;
    context.res.body = { error: 'Missing env vars (DOC_INTELLIGENCE_* or SEARCH_*)' };
    return;
  }

  try {
    const { fileBuf, mimetype, filename } = await parseMultipart(req);
    if (!fileBuf) {
      context.res.status = 400;
      context.res.body = { error: 'Arquivo nao enviado' };
      return;
    }
    if (fileBuf.length > 20 * 1024 * 1024) {
      context.res.status = 400;
      context.res.body = { error: 'Arquivo acima de 20 MB' };
      return;
    }

    const t0 = Date.now();
    const result = await ocrLayout(fileBuf, mimetype);
    const t1 = Date.now();
    const chunks = chunkContent(result);
    if (!chunks.length) {
      context.res.status = 400;
      context.res.body = { error: 'Nao foi possivel extrair texto do documento' };
      return;
    }

    const documentId = 'doc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const documentName = filename;
    const { ok, fail } = await indexChunks(chunks, documentId, documentName);
    const t2 = Date.now();

    // Aguarda indexer (eventual consistency)
    await new Promise(r => setTimeout(r, 1500));

    context.res.status = 200;
    context.res.body = {
      document_id: documentId,
      document_name: documentName,
      pages: (result.pages || []).length,
      chunks_total: chunks.length,
      chunks_indexed: ok,
      chunks_failed: fail,
      timings: {
        ocr_ms: t1 - t0,
        index_ms: t2 - t1,
        total_ms: t2 - t0
      },
      sample_chunk: chunks[0] && chunks[0].content.slice(0, 300)
    };
  } catch (e) {
    context.log.error(e);
    context.res.status = 500;
    context.res.body = { error: e.message || String(e) };
  }
};
