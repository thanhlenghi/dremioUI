from collections.abc import AsyncIterator
from typing import Any

from fastapi.testclient import TestClient

from backend.app.config import Settings, get_settings
from backend.app.dependencies import get_current_session, get_dremio_client, get_qna_provider, get_session_store
from backend.app.main import app
from backend.app.dremio import DremioClient, DremioError
from backend.app.models import JobSummary, QnaResponse
from backend.app.session_store import MemorySessionStore, UserSession


class FakeDremioClient:
    async def list_catalog_root(self):
        return [{"id": "src", "path": ["src"], "type": "SOURCE"}]

    async def list_catalog_children(self, catalog_id: str):
        return [{"id": f"{catalog_id}.table", "path": ["src", "table"], "type": "DATASET"}]

    async def get_catalog_object(self, catalog_id: str):
        return {"id": catalog_id, "path": ["src"]}

    async def get_catalog_permissions(self, catalog_id: str):
        return {"effectivePermissions": [], "grants": []}

    async def list_recent_jobs(self, limit: int = 50):
        return [
            JobSummary(
                id="job-1",
                user_name="analyst",
                status="COMPLETED",
                sql="SELECT 1",
            )
        ]

    async def submit_sql(self, sql: str, context: list[str] | None = None):
        return "job-submitted"

    async def get_job(self, job_id: str):
        return {"job_id": job_id, "status": "COMPLETED", "query": "SELECT 1"}

    async def list_users(self):
        return [{"id": "u1", "name": "User One"}]

    async def list_roles(self):
        return [{"id": "r1", "name": "Reader"}]

    async def list_engines(self):
        return [{"id": "e1", "name": "Engine"}]


class FakeQnaProvider:
    async def answer(
        self,
        question: str,
        catalog_object: dict[str, Any] | None,
        jobs: list[JobSummary],
    ) -> QnaResponse:
        return QnaResponse(
            answer=f"Answered: {question}",
            draft_sql="SELECT 1",
            citations=[job.id for job in jobs],
        )


class FakeListPermissionsDremioClient(FakeDremioClient):
    async def get_catalog_permissions(self, catalog_id: str):
        return {"effectivePermissions": ["READ_METADATA", "READ", "SELECT"], "grants": []}


class FakeTransientJobsDremioClient(DremioClient):
    def __init__(self) -> None:
        self.result_attempts = 0
        self._job_poll_attempts = 2
        self._job_poll_interval = 0

    async def submit_sql(self, sql: str, context: list[str] | None = None) -> str:
        return "metadata-job"

    async def get_job(self, job_id: str) -> dict[str, Any]:
        return {"id": job_id, "jobState": "COMPLETED"}

    async def get_job_results(
        self,
        job_id: str,
        offset: int = 0,
        limit: int = 100,
    ) -> dict[str, Any]:
        self.result_attempts += 1
        if self.result_attempts == 1:
            raise DremioError(
                'Dremio 400: {"errorMessage":"Can not fetch details for a job that is in '
                '[METADATA_RETRIEVAL] state.","moreInfo":""}'
            )
        return {
            "rows": [
                {
                    "job_id": "job-1",
                    "user_name": "analyst",
                    "status": "COMPLETED",
                    "query": "SELECT 1",
                }
            ]
        }


class FakeFailingJobsDremioClient(FakeDremioClient):
    async def list_recent_jobs(self, limit: int = 50):
        raise DremioError("Dremio 400: transient job-state failure")


def client(*, mock_dremio: bool = False) -> AsyncIterator[TestClient]:
    store = MemorySessionStore()
    app.dependency_overrides[get_session_store] = lambda: store
    app.dependency_overrides[get_qna_provider] = lambda: FakeQnaProvider()
    app.dependency_overrides[get_settings] = lambda: Settings(
        app_allowlist=["allowed@example.org"],
        redis_url=None,
        session_secret="test-secret",
    )
    if mock_dremio:
        app.dependency_overrides[get_dremio_client] = lambda: FakeDremioClient()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def client_no_raise() -> AsyncIterator[TestClient]:
    store = MemorySessionStore()
    app.dependency_overrides[get_session_store] = lambda: store
    app.dependency_overrides[get_qna_provider] = lambda: FakeQnaProvider()
    app.dependency_overrides[get_settings] = lambda: Settings(
        app_allowlist=["allowed@example.org"],
        redis_url=None,
        session_secret="test-secret",
    )
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_health() -> None:
    with TestClient(app) as test_client:
        response = test_client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_allowlist_rejects_login_before_token_validation() -> None:
    for test_client in client():
        response = test_client.post(
            "/api/auth/login",
            json={"user_id": "blocked@example.org", "token": "secret"},
        )
    assert response.status_code == 403


def test_catalog_requires_session() -> None:
    for test_client in client():
        response = test_client.get("/api/catalog")
    assert response.status_code == 401


def test_catalog_returns_items_for_session() -> None:
    async def current_session() -> UserSession:
        return UserSession(user_id="allowed@example.org", dremio_token="token")

    app.dependency_overrides[get_current_session] = current_session
    try:
        for test_client in client(mock_dremio=True):
            response = test_client.get("/api/catalog")
    finally:
        app.dependency_overrides.pop(get_current_session, None)

    assert response.status_code == 200
    assert response.json()["items"][0]["id"] == "src"


def test_catalog_item_preserves_source_type() -> None:
    item = DremioClient._catalog_item(
        {
            "id": "source-id",
            "path": ["lake"],
            "type": "CONTAINER",
            "containerType": "SOURCE",
            "sourceConfig": {"type": "S3"},
        }
    )

    assert item.source_type == "S3"


def test_qna_returns_draft_sql() -> None:
    async def current_session() -> UserSession:
        return UserSession(user_id="allowed@example.org", dremio_token="token")

    app.dependency_overrides[get_current_session] = current_session
    try:
        for test_client in client(mock_dremio=True):
            response = test_client.post(
                "/api/qna",
                json={"question": "What happened?", "object_id": "src", "job_ids": ["job-1"]},
            )
    finally:
        app.dependency_overrides.pop(get_current_session, None)

    assert response.status_code == 200
    assert response.json()["draft_sql"] == "SELECT 1"


def test_catalog_object_accepts_list_permissions() -> None:
    async def current_session() -> UserSession:
        return UserSession(user_id="allowed@example.org", dremio_token="token")

    app.dependency_overrides[get_current_session] = current_session
    app.dependency_overrides[get_dremio_client] = lambda: FakeListPermissionsDremioClient()
    try:
        for test_client in client():
            response = test_client.get("/api/catalog/source-id")
    finally:
        app.dependency_overrides.pop(get_current_session, None)

    assert response.status_code == 200
    assert response.json()["permissions"]["effectivePermissions"] == [
        "READ_METADATA",
        "READ",
        "SELECT",
    ]


async def test_recent_jobs_retries_transient_metadata_retrieval() -> None:
    dremio = FakeTransientJobsDremioClient()

    jobs = await dremio.list_recent_jobs(limit=50)

    assert dremio.result_attempts == 2
    assert jobs[0].id == "job-1"


def test_dremio_errors_return_bad_gateway() -> None:
    async def current_session() -> UserSession:
        return UserSession(user_id="allowed@example.org", dremio_token="token")

    app.dependency_overrides[get_current_session] = current_session
    app.dependency_overrides[get_dremio_client] = lambda: FakeFailingJobsDremioClient()
    try:
        for test_client in client_no_raise():
            response = test_client.get("/api/jobs")
    finally:
        app.dependency_overrides.pop(get_current_session, None)

    assert response.status_code == 502
    assert "transient job-state failure" in response.json()["detail"]
