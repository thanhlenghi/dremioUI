# Dremio Management Console

Read-mostly web console for `https://dremio.eea.europa.eu:9047`.

V1 supports session-only personal-token login, catalog browsing, metadata/RBAC inspection, recent job history, read-only admin inventory for users/roles/engines, OpenAI-backed Q&A over metadata/job text, and manual SQL submission.

## Local Development

Install backend dependencies:

```bash
uv sync --extra dev
```

Install frontend dependencies:

```bash
npm install --prefix frontend
```

Run the backend:

```bash
uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Run the frontend:

```bash
npm run dev --prefix frontend
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8000`.

## Configuration

Copy `.env.example` to `.env` and set:

- `DREMIO_BASE_URL`: Dremio coordinator URL.
- `APP_ALLOWLIST`: comma-separated app users allowed to submit a Dremio personal token.
- `SESSION_SECRET`: long random value reserved for session hardening.
- `REDIS_URL`: Redis session store URL.
- `OPENAI_API_KEY`: enables Q&A; without it, the app returns a disabled message.
- `OPENAI_MODEL`: model used by the backend Q&A provider.
- `CORS_ORIGINS`: frontend origins allowed to call the backend in development.

Dremio tokens are stored only in Redis-backed server sessions and are cleared on logout/session expiry.

## Docker Deployment

On `gpu02.pdmz.eea`, provide environment values and start:

```bash
docker compose up --build -d
```

By default, the frontend is exposed on `http://<host>:8888`. Change with `WEB_PORT`.

TLS is intentionally not included yet. Treat the first deployment as internal/testing only until Nginx or another reverse proxy terminates HTTPS.

## Verification

Run backend tests:

```bash
uv run pytest
```

Run frontend checks:

```bash
npm test --prefix frontend
npm run build --prefix frontend
```
