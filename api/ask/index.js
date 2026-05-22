const SEARCH_ENDPOINT = (process.env.SEARCH_ENDPOINT || '').replace(/\/+$/, '');
const SEARCH_KEY = process.env.SEARCH_QUERY_KEY || process.env.SEARCH_ADMIN_KEY || '';
const SEARCH_INDEX = process.env.SEARCH_INDEX_UPLOADS || 'kb-uploads';
const API_VERSION = '2024-07-01';

function escapeFilter(s) { return String(s).replace(/'/g, "''"); }

module.exports = async function (context, req) {
  context.res = { headers: { 'Content-Type': 'application/json' } };
  if (!SEARCH_ENDPOINT || !SEARCH_KEY) {
    context.res.status = 500;
    context.res.body = { error: 'SEARCH_ENDPOINT/SEARCH_KEY not configured' };
    return;
  }

  const body = req.body || {};
  const question = (body.question || '').trim();
  const documentId = (body.document_id || '').trim();
  const top = Math.min(Number(body.top) || 5, 10);

  if (!question) { context.res.status = 400; context.res.body = { error: 'question obrigatoria' }; return; }

  const searchBody = {
    search: question,
    queryType: 'simple',
    searchMode: 'any',
    top,
    count: true,
    highlight: 'content',
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
    select: 'id,document_id,document_name,page,chunk_index,content,uploaded_at'
  };
  if (documentId) searchBody.filter = `document_id eq '${escapeFilter(documentId)}'`;

  try {
    const url = `${SEARCH_ENDPOINT}/indexes/${SEARCH_INDEX}/docs/search?api-version=${API_VERSION}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': SEARCH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(searchBody)
    });
    const data = await r.json();
    if (!r.ok) {
      context.res.status = r.status;
      context.res.body = { error: (data.error && data.error.message) || 'Search error' };
      return;
    }
    context.res.status = 200;
    context.res.body = {
      question,
      document_id: documentId || null,
      total: data['@odata.count'],
      results: data.value
    };
  } catch (e) {
    context.res.status = 500;
    context.res.body = { error: e.message || String(e) };
  }
};
