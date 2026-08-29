import os
from dotenv import load_dotenv

load_dotenv()

DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"
FORTYGUARD_API_KEY = os.getenv("FORTYGUARD_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
LLM_API_KEY = os.getenv("LLM_API_KEY", GEMINI_API_KEY)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_OAUTH_TOKEN = os.getenv("GOOGLE_OAUTH_TOKEN", "")
GOOGLE_PROJECT_ID = os.getenv("GOOGLE_PROJECT_ID", "avian-augury-205417")


def _normalize_database_url(url: str) -> str:
    """SQLAlchemy 2 expects postgresql:// instead of Supabase's postgres:// alias."""
    if url.startswith("postgres://"):
        return "postgresql://" + url.removeprefix("postgres://")
    return url


DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/coolpath"


def _first_env_value(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def _resolve_database_url(*names: str, fallback: str = DEFAULT_DATABASE_URL) -> str:
    return _normalize_database_url(_first_env_value(*names) or fallback)


APP_DATABASE_URL_IS_CONFIGURED = bool(
    _first_env_value("APP_DATABASE_URL", "SUPABASE_DB_URL", "DATABASE_URL")
)
MIGRATION_DATABASE_URL_IS_CONFIGURED = bool(
    _first_env_value("MIGRATION_DATABASE_URL", "DATABASE_URL", "SUPABASE_DB_URL")
)
CHECKPOINT_DATABASE_URL_IS_CONFIGURED = bool(
    _first_env_value("CHECKPOINT_DATABASE_URL", "DATABASE_URL", "SUPABASE_DB_URL")
)

APP_DATABASE_URL = _resolve_database_url(
    "APP_DATABASE_URL",
    "SUPABASE_DB_URL",
    "DATABASE_URL",
)
MIGRATION_DATABASE_URL = _resolve_database_url(
    "MIGRATION_DATABASE_URL",
    "DATABASE_URL",
    "SUPABASE_DB_URL",
)
CHECKPOINT_DATABASE_URL = _resolve_database_url(
    "CHECKPOINT_DATABASE_URL",
    "DATABASE_URL",
    "SUPABASE_DB_URL",
)

# Backward-compatible canonical name for existing code and certification helpers.
DATABASE_URL = APP_DATABASE_URL
DATABASE_URL_IS_CONFIGURED = APP_DATABASE_URL_IS_CONFIGURED

# Use "transaction" or "null" when DATABASE_URL points at Supabase's transaction
# pooler on port 6543. Use "queue" for a direct DB URL or session pooler.
DATABASE_POOL_MODE = os.getenv("DATABASE_POOL_MODE", "auto").lower()
