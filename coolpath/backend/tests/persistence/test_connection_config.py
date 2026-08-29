import os
import subprocess
import sys
import tempfile


def _run_config_probe(script: str, env: dict[str, str]) -> str:
    clean_env = os.environ.copy()
    for key in (
        "APP_DATABASE_URL",
        "MIGRATION_DATABASE_URL",
        "CHECKPOINT_DATABASE_URL",
        "SUPABASE_DB_URL",
        "DATABASE_URL",
        "DATABASE_POOL_MODE",
        "ENVIRONMENT",
        "USE_POSTGRES_SAVER",
    ):
        clean_env.pop(key, None)
    clean_env.update(env)
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    existing_pythonpath = clean_env.get("PYTHONPATH")
    clean_env["PYTHONPATH"] = (
        backend_dir
        if not existing_pythonpath
        else os.pathsep.join([backend_dir, existing_pythonpath])
    )

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tempfile.gettempdir(),
        env=clean_env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def test_transaction_pooler_uses_sqlalchemy_nullpool():
    output = _run_config_probe(
        "from app.db.database import engine; "
        "print(engine.pool.__class__.__name__)",
        {
            "APP_DATABASE_URL": "postgresql://user:pass@aws-0-region.pooler.supabase.com:6543/postgres",
            "DATABASE_POOL_MODE": "auto",
        },
    )

    assert output == "NullPool"


def test_migration_url_override_is_resolved_for_alembic():
    output = _run_config_probe(
        "from app.config import MIGRATION_DATABASE_URL; "
        "print(MIGRATION_DATABASE_URL)",
        {
            "APP_DATABASE_URL": "postgresql://app:pass@aws-0-region.pooler.supabase.com:6543/postgres",
            "MIGRATION_DATABASE_URL": "postgres://migrator:pass@db.project.supabase.co:5432/postgres",
        },
    )

    assert output == "postgresql://migrator:pass@db.project.supabase.co:5432/postgres"


def test_checkpoint_url_override_is_resolved_for_postgressaver():
    output = _run_config_probe(
        "from app.config import CHECKPOINT_DATABASE_URL; "
        "print(CHECKPOINT_DATABASE_URL)",
        {
            "DATABASE_URL": "postgresql://legacy:pass@db.project.supabase.co:5432/postgres",
            "CHECKPOINT_DATABASE_URL": "postgres://checkpoint:pass@aws-0-region.pooler.supabase.com:5432/postgres",
        },
    )

    assert output == "postgresql://checkpoint:pass@aws-0-region.pooler.supabase.com:5432/postgres"


def test_legacy_database_url_remains_backward_compatible():
    output = _run_config_probe(
        "from app.config import APP_DATABASE_URL, MIGRATION_DATABASE_URL, CHECKPOINT_DATABASE_URL; "
        "print(APP_DATABASE_URL); print(MIGRATION_DATABASE_URL); print(CHECKPOINT_DATABASE_URL)",
        {
            "DATABASE_URL": "postgres://legacy:pass@db.project.supabase.co:5432/postgres",
        },
    ).splitlines()

    assert output == [
        "postgresql://legacy:pass@db.project.supabase.co:5432/postgres",
        "postgresql://legacy:pass@db.project.supabase.co:5432/postgres",
        "postgresql://legacy:pass@db.project.supabase.co:5432/postgres",
    ]


def test_postgressaver_pool_uses_checkpoint_url_and_required_psycopg_kwargs():
    output = _run_config_probe(
        """
from psycopg.rows import dict_row
from app.agent.graph import _create_checkpoint_pool

captured = {}

class FakePool:
    def __init__(self, *args, **kwargs):
        captured.update(kwargs)

_create_checkpoint_pool(
    FakePool,
    "postgresql://checkpoint:pass@aws-0-region.pooler.supabase.com:5432/postgres",
)

print(captured["conninfo"])
print(captured["kwargs"]["autocommit"])
print(captured["kwargs"]["prepare_threshold"])
print(captured["kwargs"]["row_factory"] is dict_row)
""",
        {
            "CHECKPOINT_DATABASE_URL": "postgres://checkpoint:pass@aws-0-region.pooler.supabase.com:5432/postgres",
        },
    ).splitlines()

    assert output == [
        "postgresql://checkpoint:pass@aws-0-region.pooler.supabase.com:5432/postgres",
        "True",
        "0",
        "True",
    ]
