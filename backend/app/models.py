from typing import Any

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    user_id: str = Field(min_length=1)
    token: str = Field(min_length=1)


class SessionResponse(BaseModel):
    authenticated: bool
    user_id: str | None = None


class CatalogItem(BaseModel):
    id: str
    path: list[str]
    type: str
    tag: str | None = None
    container_type: str | None = None


class CatalogChildrenResponse(BaseModel):
    items: list[CatalogItem]


class ObjectDetailsResponse(BaseModel):
    id: str
    raw: dict[str, Any]
    permissions: dict[str, Any] | list[Any] | None = None


class JobSummary(BaseModel):
    id: str
    user_name: str | None = None
    query_type: str | None = None
    status: str | None = None
    start_time: str | None = None
    duration_ms: int | None = None
    sql: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class JobsResponse(BaseModel):
    jobs: list[JobSummary]


class SqlRequest(BaseModel):
    sql: str = Field(min_length=1)
    context: list[str] = Field(default_factory=list)


class SqlResponse(BaseModel):
    job_id: str


class QnaRequest(BaseModel):
    question: str = Field(min_length=1)
    object_id: str | None = None
    job_ids: list[str] = Field(default_factory=list)


class QnaResponse(BaseModel):
    answer: str
    draft_sql: str | None = None
    citations: list[str] = Field(default_factory=list)


class AdminListResponse(BaseModel):
    items: list[dict[str, Any]]
