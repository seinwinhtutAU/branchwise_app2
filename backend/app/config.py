from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8000

    database_url: str = "sqlite:///./app.db"

    # Logins moved from Supabase Auth to Neon Auth (managed Better Auth) on 2026-09-05,
    # when the Supabase project was shut down. Nothing Supabase remains — an old .env
    # carrying SUPABASE_* keys still loads, since unknown keys are ignored (extra above).
    #
    # The auth instance's base URL, e.g. https://<endpoint>.neonauth.<region>.aws.neon.tech/<db>/auth
    neon_auth_base_url: str = ""
    # Defaults to <base>/.well-known/jwks.json when left blank.
    neon_auth_jwks_url: str = ""

    # Powers the retail chatbot (app/services/chat_agent.py). Left blank, the chat
    # endpoint responds with a clear "not configured" error instead of failing deep
    # inside the OpenAI SDK.
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"

    # Cloudflare R2 Object Storage settings
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "branchwise"

    # Restrict CORS to known origins (local dev, Electron, and web deployments)
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:80",
        "http://127.0.0.1:80",
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        # A packaged Electron renderer loaded with BrowserWindow.loadFile() sends
        # requests with the opaque `null` origin. Keep this explicit so the desktop
        # build can reach the local/remote API without weakening CORS globally.
        "null",
        "https://branchwise-app2.vercel.app",
        "app://-",
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
