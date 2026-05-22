const SEARCH_ENDPOINT = (process.env.SEARCH_ENDPOINT || '').replace(/\/+$/, '');
const SEARCH_KEY = process.env.SEARCH_ADMIN_KEY || '';
const SEARCH_INDEX = process.env.SEARCH_INDEX_UPLOADS || 'kb-uploads';
const API_VERSION = '2024-07-01';

function escapeFilter(s) { return String(s).replace(/'/g, "''"); }

module.exports = async function (context, req) {
  context.res = { headers: { 'Content-Type': 'application/json' } };
  if (!SEARCH_ENDPOINT || !SEARCH_KEY) {
    context.res.status = 500;
    context.res.body = { error: 'SEARCH_ENDPOINT/SEARCH_ADMIN_KEY not configured' };
    return;
  }

  const body = req.body || {};
  const documentId = (body.document_id || '').trim();

  try {
    // 1) Listar ids do documento (ou todos se nao filtrado)
    const filter = documentId ? `document_id eq '${escapeFilter(documentId)}'` : null;
    const searchUrl = `${SEARCH_ENDPOINT}/indexes/${SEARCH_INDEX}/docs/search?api-version=${API_VERSION}`;
    const searchBody = { search: '*', top: 1000, select: 'id', count: true };
    if (filter) searchBody.filter = filter;

    const sr = await fetch(searchUrl, {
      method: 'POST',
      headers: { 'api-key': SEARCH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(searchBody)
    });
    const sdata = await sr.json();
    if (!sr.ok) throw new Error(JSON.stringify(sdata));
    const ids = (sdata.value || []).map(v => v.id);

    if (!ids.length) {
      context.res.status = 200;
      context.res.body = { deleted: 0, document_id: documentId || null };
      return;
    }

    // 2) Delete em batch
    const deleteUrl = `${SEARCH_ENDPOINT}/indexes/${SEARCH_INDEX}/docs/index?api-version=${API_VERSION}`;
    const actions = ids.map(id => ({ '@search.action': 'delete', id }));
    const dr = await fetch(deleteUrl, {
      method: 'POST',
      headers: { 'api-key': SEARCH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: actions })
    });
    const ddata = await dr.json();
    if (!dr.ok) throw new Error(JSON.stringify(ddata));
    const deleted = (ddata.value || []).filter(x => x.status).length;

    context.res.status = 200;
    context.res.body = { deleted, document_id: documentId || null };
  } catch (e) {
    context.res.status = 500;
    context.res.body = { error: e.message || String(e) };
  }
};
