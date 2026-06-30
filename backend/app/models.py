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
    source_type: str | None = None


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
    rbac_user_id: str | None = None


class QnaResponse(BaseModel):
    answer: str
    draft_sql: str | None = None
    citations: list[str] = Field(default_factory=list)


class AdminListResponse(BaseModel):
    items: list[dict[str, Any]]


class RbacPrincipal(BaseModel):
    id: str | None = None
    name: str | None = None
    email: str | None = None


class RbacGrantExplanation(BaseModel):
    privilege: str
    source: str
    grantee_type: str
    grantee_id: str | None = None
    grantee_name: str | None = None
    grant_object_id: str
    grant_object_path: list[str]
    inherited: bool
    explicit: bool = True
    via_role_id: str | None = None
    via_role_name: str | None = None


class RbacExplanationResponse(BaseModel):
    object_id: str
    object_path: list[str]
    user: RbacPrincipal
    roles: list[RbacPrincipal] = Field(default_factory=list)
    effective_privileges: list[str] = Field(default_factory=list)
    grants: list[RbacGrantExplanation] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
