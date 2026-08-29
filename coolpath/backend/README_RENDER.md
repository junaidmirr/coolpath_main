# CoolPath Backend on Render

Phase 5.4 deploys the backend as a prebuilt GHCR image:

```text
GitHub Actions -> Docker -> GHCR -> Render image-backed Web Service
```

Render must not rebuild this repository and must not run migrations. GitHub
Actions runs `alembic upgrade head` before triggering the Render deploy hook.

## One-time Render bootstrap

1. Push the branch and let GitHub Actions publish the first GHCR package.
2. In Render, create a new Web Service.
3. Choose Existing Image as the source.
4. Use the image path `ghcr.io/<github-owner>/coolpath-backend:<commit-sha>`.
5. If the GHCR package is private, configure a Render registry credential with read-only package access. If the package is public, no private registry credential should be needed.
6. Set the service start command to the image default command.
7. Add environment variables in Render manually:
   - `APP_DATABASE_URL`
   - `MIGRATION_DATABASE_URL`
   - `CHECKPOINT_DATABASE_URL`
   - `DATABASE_POOL_MODE=transaction`
   - `GEMINI_API_KEY`
   - `FORTYGUARD_API_KEY`
   - `GEOAPIFY_API_KEY`
   - `LANGSMITH_API_KEY` if tracing is enabled
   - `LANGSMITH_TRACING`
   - `LANGSMITH_PROJECT`
   - `CORS_ALLOWED_ORIGINS`
8. Copy the service Deploy Hook URL.
9. Add it to GitHub Actions secrets as `RENDER_DEPLOY_HOOK_URL`.
10. Add `RENDER_SERVICE_URL` as a GitHub Actions repository variable.

The workflow deploys the exact immutable image tag with Render's `imgURL`
deploy-hook parameter:

```text
ghcr.io/<github-owner>/coolpath-backend:<commit-sha>
```

## GitHub configuration

Required GitHub Actions secrets:

- `MIGRATION_DATABASE_URL`
- `RENDER_DEPLOY_HOOK_URL`

Required GitHub Actions variables:

- `RENDER_SERVICE_URL`
- `VERCEL_FRONTEND_URL`

Vercel frontend configuration:

```env
VITE_API_BASE_URL=https://<render-backend-url>
```

Do not put server-side API keys in Vercel frontend configuration.
