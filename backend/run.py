import uvicorn

from app.config import get_settings
from app.main import app


def main() -> None:
    settings = get_settings()
    uvicorn.run(app, host="127.0.0.1", port=settings.port)


if __name__ == "__main__":
    main()
