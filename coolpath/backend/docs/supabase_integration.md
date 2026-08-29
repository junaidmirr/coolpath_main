# Supabase Integration

CoolPath already uses SQLAlchemy, Alembic, and Postgres-oriented repository code.
The Supabase integration is therefore the backend `DATABASE_URL`, not a separate
browser/mobile Supabase client.

## Required Supabase value

Set this on Render and in local `coolpath/backend/.env`:

```env
APP_DATABASE_URL=postgresql://postgres.PROJECT_REF:YOUR_DB_PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?sslmode=require
MIGRATION_DATABASE_URL=postgresql://postgres:YOUR_DB_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require
CHECKPOINT_DATABASE_URL=postgresql://postgres.PROJECT_REF:YOUR_DB_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require
DATABASE_POOL_MODE=transaction
```

Use one Supabase project/database. The roles select connection endpoints:

- `APP_DATABASE_URL`: transaction pooler, port `6543`, for autoscaling runtime traffic.
- `MIGRATION_DATABASE_URL`: direct connection, or session pooler when direct IPv6 is unavailable.
- `CHECKPOINT_DATABASE_URL`: explicit checkpoint connection, preferably direct or session pooler.

Replace `YOUR_DB_PASSWORD`; percent-encode special characters in the password.
Do not commit real values.

Backward-compatible fallback order:

- App: `APP_DATABASE_URL` -> `SUPABASE_DB_URL` -> `DATABASE_URL`
- Migrations: `MIGRATION_DATABASE_URL` -> `DATABASE_URL` -> `SUPABASE_DB_URL`
- Checkpoints: `CHECKPOINT_DATABASE_URL` -> `DATABASE_URL` -> `SUPABASE_DB_URL`

For a long-running VM with IPv6 support, a direct connection can also be used:

```env
DATABASE_URL=postgresql://postgres:YOUR_DB_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require
DATABASE_POOL_MODE=queue
```

## Apply schema

Render now runs migrations on boot:

```bash
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Local verification:

```powershell
cd coolpath/backend
$env:APP_DATABASE_URL="postgresql://postgres.PROJECT_REF:YOUR_DB_PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?sslmode=require"
$env:MIGRATION_DATABASE_URL="postgresql://postgres:YOUR_DB_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
$env:CHECKPOINT_DATABASE_URL="postgresql://postgres.PROJECT_REF:YOUR_DB_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require"
$env:DATABASE_POOL_MODE="transaction"
$env:PYTHONPATH="."
alembic upgrade head
pytest tests/persistence/test_pg_certification.py -v
```

## Keys needed for full project integration

- `SUPABASE_DB_URL`: server-side Postgres connection string for SQLAlchemy and Alembic.
- Supabase project ref: needed only to identify the project in dashboard/tools.
- Supabase DB password: goes inside `SUPABASE_DB_URL`; never put it in frontend/mobile env.
- `GEMINI_API_KEY`: backend AI intent parsing and route briefing.
- `FORTYGUARD_API_KEY`: thermal/microclimate provider.
- `MAPBOX_TOKEN`: map routing/geocoding. Frontend/mobile may use public Mapbox tokens.
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`: optional speech/transcribe/Polly flow.
- `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, `LANGSMITH_TRACING=true`: optional LangChain/LangGraph tracing.

## Supabase keys not currently needed

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are only needed if the frontend/mobile app talks directly to Supabase Auth, Storage, Realtime, or REST.
- `SUPABASE_SERVICE_ROLE_KEY` is not needed for the current app path and must never be exposed to frontend/mobile code.
