"""
database.py
-----------
SQLite engine + session factory.
Tables are created on first startup (via create_db_and_tables).
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import URL
from sqlmodel import SQLModel, Session, create_engine

load_dotenv()

# Default: coverageiq.db in the same directory as this file
_DEFAULT_DB = f"sqlite:///{Path(__file__).parent / 'coverageiq.db'}"
DATABASE_URL: str = os.getenv("DATABASE_URL", _DEFAULT_DB)


def _build_engine_url(raw: str):
    """
    Parse a database URL into a SQLAlchemy URL object.
    Uses URL.create() for PostgreSQL so passwords with special characters
    (@, /, +, =) are passed through without URL-encoding errors.
    Falls back to the raw string for SQLite.
    """
    if not raw.startswith(("postgresql://", "postgres://", "postgresql+")):
        return raw

    scheme_sep = raw.index("://")
    scheme = raw[:scheme_sep]
    after_scheme = raw[scheme_sep + 3:]

    # Use rfind("@") so passwords containing "@" are handled correctly.
    at_pos = after_scheme.rfind("@")
    if at_pos == -1:
        return raw

    userinfo = after_scheme[:at_pos]
    hostpart = after_scheme[at_pos + 1:]

    colon_pos = userinfo.find(":")
    username = userinfo[:colon_pos] if colon_pos != -1 else userinfo
    password = userinfo[colon_pos + 1:] if colon_pos != -1 else None

    if "?" in hostpart:
        hostpath, querystr = hostpart.split("?", 1)
        query = dict(p.split("=", 1) for p in querystr.split("&") if "=" in p)
    else:
        hostpath, query = hostpart, {}

    hostport, _, database = hostpath.partition("/")
    if ":" in hostport:
        host, port_str = hostport.rsplit(":", 1)
        port = int(port_str)
    else:
        host, port = hostport, None

    drivername = "postgresql+psycopg2" if scheme in ("postgresql", "postgres") else scheme

    return URL.create(
        drivername=drivername,
        username=username,
        password=password,
        host=host,
        port=port,
        database=database or None,
        query=query,
    )


# SQLite: connect_args disables the "same thread" restriction so FastAPI can
# share the connection across request threads.
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(_build_engine_url(DATABASE_URL), echo=False, connect_args=_connect_args)


def create_db_and_tables() -> None:
    """Import all models so SQLModel.metadata is populated, then create tables."""
    import models  # noqa: F401 – side effect: registers all SQLModel tables
    SQLModel.metadata.create_all(engine)


def get_session():
    """FastAPI dependency that yields a DB session and closes it when done."""
    with Session(engine) as session:
        yield session
