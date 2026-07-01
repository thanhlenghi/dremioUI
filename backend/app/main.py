from contextlib import asynccontextmanager

from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from backend.app.config import Settings, get_settings
from backend.app.dependencies import (
    clear_session_cookie,
    create_app_resources,
    get_current_session,
    get_dremio_client,
    get_qna_provider,
    get_session_store,
    set_session_cookie,
)
from backend.app.dremio import DremioClient, DremioError
from backend.app.models import (
    AdminListResponse,
    CatalogChildrenResponse,
    JobsResponse,
    LoginRequest,
    ObjectDetailsResponse,
    QnaRequest,
    QnaResponse,
    RbacExplanationResponse,
    SessionResponse,
    SqlRequest,
    SqlResponse,
)
from backend.app.qna import QnaProvider
from backend.app.rbac import (
    explain_object_rbac_context,
    explain_rbac_access,
    question_has_rbac_intent,
)
from backend.app.session_store import SessionStore, UserSession


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    async for store, qna_provider in create_app_resources(settings):
        app.state.session_store = store
        app.state.qna_provider = qna_provider
        yield
        redis = getattr(store, "_redis", None)
        if isinstance(redis, Redis):
            await redis.aclose()


app = FastAPI(title="Dremio Management Console", version="0.1.0", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(DremioError)
async def dremio_error_handler(_request, exc: DremioError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={"detail": str(exc)},
    )


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/login", response_model=SessionResponse)
async def login(
    request: LoginRequest,
    response: Response,
    settings: Settings = Depends(get_settings),
    store: SessionStore = Depends(get_session_store),
) -> SessionResponse:
    user_id = request.user_id.strip().lower()
    if settings.allowlist_normalized and user_id not in settings.allowlist_normalized:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not allowlisted")
    client = DremioClient(str(settings.dremio_base_url), request.token)
    try:
        await client.validate_token()
    except DremioError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    session_id = await store.create(UserSession(user_id=user_id, dremio_token=request.token))
    set_session_cookie(response, session_id)
    return SessionResponse(authenticated=True, user_id=user_id)


@app.post("/api/auth/logout", response_model=SessionResponse)
async def logout(
    response: Response,
    dremio_ui_session: str | None = Cookie(default=None),
    store: SessionStore = Depends(get_session_store),
) -> SessionResponse:
    if dremio_ui_session:
        await store.delete(dremio_ui_session)
    clear_session_cookie(response)
    return SessionResponse(authenticated=False)


@app.get("/api/session", response_model=SessionResponse)
async def session_status(session: UserSession = Depends(get_current_session)) -> SessionResponse:
    return SessionResponse(authenticated=True, user_id=session.user_id)


@app.get("/api/catalog", response_model=CatalogChildrenResponse)
async def catalog_root(
    client: DremioClient = Depends(get_dremio_client),
) -> CatalogChildrenResponse:
    return CatalogChildrenResponse(items=await client.list_catalog_root())


@app.get("/api/catalog/{catalog_id}/children", response_model=CatalogChildrenResponse)
async def catalog_children(
    catalog_id: str,
    client: DremioClient = Depends(get_dremio_client),
) -> CatalogChildrenResponse:
    return CatalogChildrenResponse(items=await client.list_catalog_children(catalog_id))


@app.get("/api/catalog/{catalog_id}", response_model=ObjectDetailsResponse)
async def catalog_object(
    catalog_id: str,
    client: DremioClient = Depends(get_dremio_client),
) -> ObjectDetailsResponse:
    raw = await client.get_catalog_object(catalog_id)
    permissions = await client.get_catalog_permissions(catalog_id)
    return ObjectDetailsResponse(id=catalog_id, raw=raw, permissions=permissions)


@app.get("/api/jobs", response_model=JobsResponse)
async def jobs(limit: int = 50, client: DremioClient = Depends(get_dremio_client)) -> JobsResponse:
    return JobsResponse(jobs=await client.list_recent_jobs(limit=limit))


@app.post("/api/sql", response_model=SqlResponse)
async def run_sql(
    request: SqlRequest,
    client: DremioClient = Depends(get_dremio_client),
) -> SqlResponse:
    return SqlResponse(job_id=await client.submit_sql(request.sql, request.context))


@app.post("/api/qna", response_model=QnaResponse)
async def qna(
    request: QnaRequest,
    client: DremioClient = Depends(get_dremio_client),
    provider: QnaProvider = Depends(get_qna_provider),
) -> QnaResponse:
    catalog_object = await client.get_catalog_object(request.object_id) if request.object_id else None
    jobs = [
        DremioClient._job_summary(await client.get_job(job_id))
        for job_id in request.job_ids[:10]
    ]
    rbac_context = None
    rbac_intent = question_has_rbac_intent(request.question)
    if rbac_intent and request.object_id:
        rbac_context = await explain_object_rbac_context(client, request.object_id, request.question)
    elif rbac_intent:
        rbac_context = {
            "mode": "unresolved",
            "object_id": None,
            "object_path": [],
            "inferred_user": None,
            "object_grants": [],
            "users": [],
            "roles": [],
            "unresolved": [
                "Select a catalog object before asking object-scoped RBAC questions."
            ],
        }

    unresolved = rbac_context.get("unresolved", []) if isinstance(rbac_context, dict) else []
    audit_payload = {
        "selected_catalog_object": catalog_object,
        "detected_rbac_intent": rbac_intent,
        "deterministic_rbac_context": rbac_context,
        "unresolved": unresolved,
    }
    response = await provider.answer(request.question, catalog_object, jobs, rbac_context)
    response.raw = audit_payload
    return response


@app.get("/api/rbac/explain", response_model=RbacExplanationResponse)
async def rbac_explain(
    object_id: str,
    user_id: str,
    client: DremioClient = Depends(get_dremio_client),
) -> RbacExplanationResponse:
    return await explain_rbac_access(client, object_id, user_id)


@app.get("/api/admin/users", response_model=AdminListResponse)
async def users(client: DremioClient = Depends(get_dremio_client)) -> AdminListResponse:
    return AdminListResponse(items=await client.list_users())


@app.get("/api/admin/roles", response_model=AdminListResponse)
async def roles(client: DremioClient = Depends(get_dremio_client)) -> AdminListResponse:
    return AdminListResponse(items=await client.list_roles())


@app.get("/api/admin/engines", response_model=AdminListResponse)
async def engines(client: DremioClient = Depends(get_dremio_client)) -> AdminListResponse:
    return AdminListResponse(items=await client.list_engines())
