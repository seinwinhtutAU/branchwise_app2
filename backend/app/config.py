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


@lru_cache
def get_settings() -> Settings:
    return Settings()
