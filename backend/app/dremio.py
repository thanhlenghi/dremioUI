import asyncio
from typing import Any
from urllib.parse import quote

import httpx

from backend.app.models import CatalogItem, JobSummary


class DremioError(RuntimeError):
    pass


class DremioClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        timeout: float = 30.0,
        job_poll_attempts: int = 8,
        job_poll_interval: float = 0.25,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout
        self._job_poll_attempts = job_poll_attempts
        self._job_poll_interval = job_poll_interval

    async def validate_token(self) -> dict[str, Any]:
        return await self._request("GET", "/api/v3/catalog")

    async def list_catalog_root(self) -> list[CatalogItem]:
        payload = await self._request("GET", "/api/v3/catalog")
        return [self._catalog_item(item) for item in payload.get("data", [])]

    async def list_catalog_children(self, catalog_id: str) -> list[CatalogItem]:
        payload = await self.get_catalog_object(catalog_id)
        return [self._catalog_item(item) for item in payload.get("children", [])]

    async def resolve_catalog_path(self, path: list[str], selected_id: str) -> list[CatalogItem]:
        if not path:
            return [
                CatalogItem(
                    id=selected_id,
                    path=[],
                    type="unknown",
                )
            ]

        resolved: list[CatalogItem] = []
        siblings = await self.list_catalog_root()
        for index, segment in enumerate(path):
            expected_path = path[: index + 1]
            match = self._match_catalog_segment(siblings, expected_path, segment)
            if not match:
                break
            resolved.append(match)
            if index < len(path) - 1:
                siblings = await self.list_catalog_children(match.id)

        if not resolved or resolved[-1].id != selected_id:
            resolved.append(
                CatalogItem(
                    id=selected_id,
                    path=path,
                    type="unknown",
                )
            )
        return resolved

    async def get_catalog_object(self, catalog_id: str) -> dict[str, Any]:
        encoded = quote(catalog_id, safe="")
        return await self._request("GET", f"/api/v3/catalog/{encoded}", params={"maxChildren": 200})

    async def get_catalog_permissions(self, catalog_id: str) -> dict[str, Any] | None:
        encoded = quote(catalog_id, safe="")
        permissions_payload: dict[str, Any] | None = None
        try:
            payload = await self._request(
                "GET",
                f"/api/v3/catalog/{encoded}",
                params={"include": "permissions"},
            )
            permissions_payload = {"effectivePermissions": payload.get("permissions", [])}
        except DremioError:
            permissions_payload = {"effectivePermissions": []}

        try:
            grants_payload = await self._request("GET", f"/api/v3/catalog/{encoded}/grants")
        except DremioError:
            return permissions_payload

        return {
            **permissions_payload,
            "availablePrivileges": grants_payload.get("availablePrivileges", []),
            "grants": grants_payload.get("grants", []),
            "rawGrants": grants_payload,
        }

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
        bounded_limit = max(1, min(limit, 200))
        queries = [
            (
                "SELECT job_id, user_name, query_type, status, start_time, duration, query "
                "FROM sys.jobs_recent ORDER BY start_time DESC LIMIT "
                f"{bounded_limit}"
            ),
            f"SELECT * FROM sys.jobs_recent LIMIT {bounded_limit}",
        ]
        last_error: DremioError | None = None
        for sql in queries:
            try:
                job_id = await self.submit_sql(sql)
                data = await self._wait_for_job_results(job_id, limit=bounded_limit)
                rows = data.get("rows", data.get("data", []))
                return [self._job_summary(row) for row in rows]
            except DremioError as exc:
                last_error = exc
        raise DremioError("Could not load recent jobs from sys.jobs_recent") from last_error

    async def _wait_for_job_results(self, job_id: str, limit: int) -> dict[str, Any]:
        last_error: DremioError | None = None
        for _ in range(getattr(self, "_job_poll_attempts", 8)):
            try:
                return await self.get_job_results(job_id, limit=limit)
            except DremioError as exc:
                if not self._is_transient_results_error(exc):
                    raise
                last_error = exc

            job = await self.get_job(job_id)
            state = str(
                job.get("jobState")
                or job.get("state")
                or job.get("status")
                or job.get("jobStatus")
                or ""
            ).upper()
            if state in {"FAILED", "CANCELED", "CANCELLED"}:
                raise DremioError(f"Dremio job {job_id} ended in {state}")
            await asyncio.sleep(getattr(self, "_job_poll_interval", 0.25))

        raise DremioError(f"Timed out waiting for Dremio job {job_id} results") from last_error

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
    def _is_transient_results_error(exc: DremioError) -> bool:
        message = str(exc).upper()
        return "METADATA_RETRIEVAL" in message or "NOT COMPLETED" in message or "RUNNING" in message

    @staticmethod
    def _catalog_item(item: dict[str, Any]) -> CatalogItem:
        return CatalogItem(
            id=str(item.get("id") or ".".join(item.get("path", []))),
            path=list(item.get("path", [])),
            type=str(item.get("type") or item.get("entityType") or "unknown"),
            tag=item.get("tag"),
            container_type=item.get("containerType"),
            source_type=DremioClient._source_type(item),
        )

    @staticmethod
    def _match_catalog_segment(
        items: list[CatalogItem],
        expected_path: list[str],
        segment: str,
    ) -> CatalogItem | None:
        for item in items:
            if item.path == expected_path:
                return item
        for item in items:
            if item.path and item.path[-1] == segment:
                return item
        return None

    @staticmethod
    def _source_type(item: dict[str, Any]) -> str | None:
        candidates: list[Any] = [
            item.get("sourceType"),
            item.get("source_type"),
            item.get("sourceTypeName"),
            item.get("pluginType"),
            item.get("storageType"),
            item.get("connectionType"),
        ]
        for field in ("sourceConfig", "config", "connectionConf", "connectionConfig"):
            config = item.get(field)
            if isinstance(config, dict):
                candidates.extend(
                    [
                        config.get("type"),
                        config.get("sourceType"),
                        config.get("pluginType"),
                        config.get("storageType"),
                        config.get("connectionType"),
                    ]
                )

        for candidate in candidates:
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        return None

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
