from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from typing import Generator

from app.config import DATABASE_URL

# Sane connection pooling for synchronous connections
# psycopg2 URL should be used (e.g., postgresql://...)
engine = create_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db() -> Generator:
    """Dependency for FastAPI or generic usage to yield a DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
