from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool
from typing import Generator

from app.config import APP_DATABASE_URL, DATABASE_POOL_MODE


def _use_null_pool(database_url: str, pool_mode: str) -> bool:
    if pool_mode in {"null", "transaction"}:
        return True
    if pool_mode in {"queue", "pooled"}:
        return False
    return "pooler.supabase.com" in database_url and ":6543" in database_url

engine_kwargs = {
    "pool_pre_ping": True,
}

if _use_null_pool(APP_DATABASE_URL, DATABASE_POOL_MODE):
    # Supabase transaction pooler already manages pooling; SQLAlchemy should not
    # keep its own persistent connections in front of it.
    engine_kwargs["poolclass"] = NullPool
else:
    engine_kwargs.update(
        pool_size=5,
        max_overflow=10,
    )

engine = create_engine(APP_DATABASE_URL, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db() -> Generator:
    """Dependency for FastAPI or generic usage to yield a DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
