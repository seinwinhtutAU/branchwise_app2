from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8000

    database_url: str = "sqlite:///./app.db"

    supabase_url: str = ""

    # Powers the retail chatbot (app/services/chat_agent.py). Left blank, the chat
    # endpoint responds with a clear "not configured" error instead of failing deep
    # inside the OpenAI SDK.
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"


@lru_cache
def get_settings() -> Settings:
    return Settings()
