import json
from typing import Any, Protocol

from openai import AsyncOpenAI

from backend.app.models import JobSummary, QnaResponse


SYSTEM_PROMPT = """You help administer Dremio from metadata, RBAC provenance, and job history only.
Never claim to have inspected table rows. Do not suggest destructive admin changes.
Answer in clear human language, not JSON-style prose. For RBAC questions, explain
who has access, where each privilege was explicitly granted, whether it is inherited
by the selected object, and any unresolved gaps. Cite catalog objects or job ids used
in the answer."""


class QnaProvider(Protocol):
    async def answer(
        self,
        question: str,
        catalog_object: dict[str, Any] | None,
        jobs: list[JobSummary],
        rbac_context: dict[str, Any] | None = None,
    ) -> QnaResponse: ...


class OpenAIQnaProvider:
    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def answer(
        self,
        question: str,
        catalog_object: dict[str, Any] | None,
        jobs: list[JobSummary],
        rbac_context: dict[str, Any] | None = None,
    ) -> QnaResponse:
        context = {
            "catalog_object": catalog_object,
            "jobs": [
                job.model_dump(exclude={"raw"}) | {"raw_keys": sorted(job.raw.keys())}
                for job in jobs
            ],
            "rbac": rbac_context,
            "policy": (
                "Only metadata, SQL text, status, timings, errors, and counts are present. "
                "No row data. Do not draft or run SQL unless the user explicitly asks outside "
                "an RBAC question."
            ),
        }
        response = await self._client.responses.create(
            model=self._model,
            instructions=SYSTEM_PROMPT,
            input=[
                {
                    "role": "user",
                    "content": (
                        "Question:\n"
                        f"{question}\n\nContext JSON:\n{json.dumps(context, default=str)[:20000]}"
                    ),
                }
            ],
        )
        text = response.output_text.strip()
        draft_sql = self._extract_sql(text)
        citations = [job.id for job in jobs if job.id and job.id in text]
        return QnaResponse(answer=text, draft_sql=draft_sql, citations=citations)

    @staticmethod
    def _extract_sql(text: str) -> str | None:
        marker = "```sql"
        if marker not in text:
            return None
        start = text.find(marker) + len(marker)
        end = text.find("```", start)
        if end == -1:
            return None
        return text[start:end].strip()


class DisabledQnaProvider:
    async def answer(
        self,
        question: str,
        catalog_object: dict[str, Any] | None,
        jobs: list[JobSummary],
        rbac_context: dict[str, Any] | None = None,
    ) -> QnaResponse:
        return QnaResponse(
            answer=(
                "Q&A is not configured. Set OPENAI_API_KEY to enable metadata and job-history "
                "answers. Generated SQL will still require manual execution."
            ),
            citations=[job.id for job in jobs if job.id],
        )
