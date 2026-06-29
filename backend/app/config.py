from functools import lru_cache

from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", enable_decoding=False)

    dremio_base_url: AnyHttpUrl = "https://dremio.eea.europa.eu:9047"
    app_allowlist: list[str] = Field(default_factory=list)
    session_secret: str = "change-me"
    redis_url: str | None = "redis://localhost:6379/0"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    @field_validator("app_allowlist", "cors_origins", mode="before")
    @classmethod
    def parse_csv(cls, value: str | list[str] | None) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def allowlist_normalized(self) -> set[str]:
        return {item.lower() for item in self.app_allowlist}


@lru_cache
def get_settings() -> Settings:
    return Settings()
