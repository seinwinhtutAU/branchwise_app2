from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

settings = get_settings()

is_sqlite = settings.database_url.startswith("sqlite")

# Postgres here means Neon — a database on the other side of the internet, reached from
# branch machines whose connection is often slow and sometimes drops for a few seconds.
# The defaults assume a reliable local network, which produces the worst failure this app
# had: a pooled connection that died while idle is handed to the next request, which then
# fails with "server closed the connection unexpectedly" and shows up in the UI as a page
# that couldn't load, even though the network was back.
#
#   pool_pre_ping   sends a cheap SELECT 1 before handing out a pooled connection and
#                   transparently replaces it if it's dead — turning that failure into a
#                   short delay instead of an error.
#   pool_recycle    drops connections older than 5 minutes, since Neon's pooler and any
#                   NAT/router in between will silently close idle ones anyway.
#   connect_timeout caps how long a *new* connection waits before giving up, so a
#                   request on a dead link fails in 10s rather than hanging for minutes.
#   keepalives_*    make the OS probe an idle connection every 30s (3 failed probes, 10s
#                   apart, then drop) so a link that died is noticed rather than left to
#                   block a long query forever.
connect_args = (
    {"check_same_thread": False}
    if is_sqlite
    else {
        "connect_timeout": 10,
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
    }
)

engine_kwargs = (
    {}
    if is_sqlite
    else {"pool_pre_ping": True, "pool_recycle": 300}
)

engine = create_engine(settings.database_url, connect_args=connect_args, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
