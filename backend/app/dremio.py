from typing import Any
from urllib.parse import quote

import httpx

from backend.app.models import CatalogItem, JobSummary


class DremioError(RuntimeError):
    pass


class DremioClient:
    def __init__(self, base_url: str, token: str, timeout: float = 30.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout

    async def validate_token(self) -> dict[str, Any]:
        return await self._request("GET", "/api/v3/catalog")

    async def list_catalog_root(self) -> list[CatalogItem]:
        payload = await self._request("GET", "/api/v3/catalog")
        return [self._catalog_item(item) for item in payload.get("data", [])]

    async def list_catalog_children(self, catalog_id: str) -> list[CatalogItem]:
        payload = await self.get_catalog_object(catalog_id)
        return [self._catalog_item(item) for item in payload.get("children", [])]

    async def get_catalog_object(self, catalog_id: str) -> dict[str, Any]:
        encoded = quote(catalog_id, safe="")
        return await self._request("GET", f"/api/v3/catalog/{encoded}", params={"maxChildren": 200})

    async def get_catalog_permissions(self, catalog_id: str) -> dict[str, Any] | None:
        encoded = quote(catalog_id, safe="")
        try:
            payload = await self._request(
                "GET",
                f"/api/v3/catalog/{encoded}",
                params={"include": "permissions"},
            )
            return payload.get("permissions", payload)
        except DremioError:
            return None

    async def submit_sql(self, sql: str, context: list[str] | None = None) -> str:
        payload: dict[str, Any] = {"sql": sql}
        if context:
            payload["context"] = context
        response = await self._request("POST", "/api/v3/sql", json=payload)
        job_id = response.get("id")
        if not job_id:
            raise DremioError("Dremio did not return a job id")
        return str(job_id)

    async def get_job(self, job_id: str) -> dict[str, Any]:
        encoded = quote(job_id, safe="")
        return await self._request("GET", f"/api/v3/job/{encoded}")

    async def get_job_results(self, job_id: str, offset: int = 0, limit: int = 100) -> dict[str, Any]:
        encoded = quote(job_id, safe="")
        return await self._request("GET", f"/api/v3/job/{encoded}/results", params={"offset": offset, "limit": limit})

    async def list_recent_jobs(self, limit: int = 50) -> list[JobSummary]:
        sql = (
            "SELECT job_id, user_name, query_type, status, start_time, duration, query "
            "FROM sys.jobs_recent ORDER BY start_time DESC LIMIT "
            f"{max(1, min(limit, 200))}"
        )
        job_id = await self.submit_sql(sql)
        data = await self.get_job_results(job_id, limit=limit)
        rows = data.get("rows", data.get("data", []))
        return [self._job_summary(row) for row in rows]

    async def list_users(self) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/api/v3/user")
        return payload.get("data", payload if isinstance(payload, list) else [payload])

    async def list_roles(self) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/api/v3/role")
        return payload.get("data", payload if isinstance(payload, list) else [])

    async def list_engines(self) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/api/v3/engines")
        return payload.get("data", payload if isinstance(payload, list) else [])

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {self._token}"
        headers["Content-Type"] = "application/json"
        async with httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout) as client:
            response = await client.request(method, path, headers=headers, **kwargs)
        if response.status_code >= 400:
            detail = response.text[:500]
            raise DremioError(f"Dremio {response.status_code}: {detail}")
        if not response.content:
            return {}
        return response.json()

    @staticmethod
    def _catalog_item(item: dict[str, Any]) -> CatalogItem:
        return CatalogItem(
            id=str(item.get("id") or ".".join(item.get("path", []))),
            path=list(item.get("path", [])),
            type=str(item.get("type") or item.get("entityType") or "unknown"),
            tag=item.get("tag"),
            container_type=item.get("containerType"),
        )

    @staticmethod
    def _job_summary(row: dict[str, Any]) -> JobSummary:
        return JobSummary(
            id=str(row.get("job_id") or row.get("id") or ""),
            user_name=row.get("user_name") or row.get("user"),
            query_type=row.get("query_type"),
            status=row.get("status"),
            start_time=str(row.get("start_time")) if row.get("start_time") is not None else None,
            duration_ms=row.get("duration") or row.get("duration_ms"),
            sql=row.get("query") or row.get("sql"),
            raw=row,
        )
