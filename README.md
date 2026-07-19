# unblur-matching-service

Embeddings-based "related expertise" matching. See `MATCHING_SERVICE.md` in the project docs
folder for the full design rationale.

Shares the same RDS Postgres instance and database as `unblur-user-service` (pragmatic reuse of
existing infra) but owns and only touches its own tables (`expertise_embeddings`), never the
`users`/`expertise_*` tables.

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Scripts

- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run migrate` — run pending migrations
- `npm run backfill-embeddings` — (re)generate embeddings for every taxonomy node; run once
  after deploy, and again whenever new expertise types/levels are seeded
- `npm test` — unit tests (Vitest)
