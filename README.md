# Demo: Knowledge Source para Copilot Studio

Demo simples que ilustra o padrão **RAG (retrieval-augmented)** usado pelo Copilot Studio quando você adiciona um *Knowledge Source* do tipo Azure AI Search.

## Fluxo

```
Upload → Document Intelligence (OCR) → Chunking → AI Search (index) → Perguntas → Trechos relevantes
```

## Stack

- **Frontend**: HTML + JS vanilla, drag-drop upload
- **Backend**: 3 Azure Functions (Node 20)
  - `POST /api/ingest` — recebe arquivo, chama Document Intelligence `prebuilt-layout`, particiona em chunks, indexa
  - `POST /api/ask` — busca BM25 com filter por `document_id`, retorna top-5 com highlighting
  - `POST /api/reset` — remove trechos de 1 documento ou limpa o índice
- **Hospedagem**: Azure Static Web Apps (Free)

## Recursos Azure (todos free tier)

- Document Intelligence F0 (`di-whsie-demos`) — 500 págs/mês, 1 req/s
- AI Search Free (`srch-whsie-demos`) — 50 MB, 3 índices
- Índice `kb-uploads` com 7 campos + analyzer `pt-br.microsoft`

## App Settings (após criar SWA)

```
DOC_INTELLIGENCE_ENDPOINT
DOC_INTELLIGENCE_KEY
SEARCH_ENDPOINT
SEARCH_ADMIN_KEY     (necessário para ingest e reset)
SEARCH_QUERY_KEY     (opcional, usado em /ask)
SEARCH_INDEX_UPLOADS = kb-uploads
```

## Limitação de demo (e como explicar)

- Sem LLM = sem resposta gerada em linguagem natural. A demo mostra a etapa de **retrieval**.
- No Copilot Studio real, esses trechos são exatamente o que o LLM (GPT-4) recebe como contexto para compor a resposta com citações.
- Para evoluir: adicionar Azure OpenAI (fora do free tier) ou conectar o índice diretamente como Knowledge Source no Copilot Studio.
