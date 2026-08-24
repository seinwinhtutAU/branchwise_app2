from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8000

    database_url: str = "sqlite:///./app.db"

    supabase_url: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
