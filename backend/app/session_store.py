import json
import secrets
from dataclasses import asdict, dataclass
from typing import Protocol

from redis.asyncio import Redis


@dataclass
class UserSession:
    user_id: str
    dremio_token: str


class SessionStore(Protocol):
    async def create(self, session: UserSession) -> str: ...

    async def get(self, session_id: str) -> UserSession | None: ...

    async def delete(self, session_id: str) -> None: ...


class RedisSessionStore:
    def __init__(self, redis: Redis, ttl_seconds: int = 8 * 60 * 60) -> None:
        self._redis = redis
        self._ttl_seconds = ttl_seconds

    async def create(self, session: UserSession) -> str:
        session_id = secrets.token_urlsafe(32)
        await self._redis.setex(self._key(session_id), self._ttl_seconds, json.dumps(asdict(session)))
        return session_id

    async def get(self, session_id: str) -> UserSession | None:
        raw = await self._redis.get(self._key(session_id))
        if raw is None:
            return None
        data = json.loads(raw)
        await self._redis.expire(self._key(session_id), self._ttl_seconds)
        return UserSession(**data)

    async def delete(self, session_id: str) -> None:
        await self._redis.delete(self._key(session_id))

    @staticmethod
    def _key(session_id: str) -> str:
        return f"dremio-ui:session:{session_id}"


class MemorySessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, UserSession] = {}

    async def create(self, session: UserSession) -> str:
        session_id = secrets.token_urlsafe(32)
        self._sessions[session_id] = session
        return session_id

    async def get(self, session_id: str) -> UserSession | None:
        return self._sessions.get(session_id)

    async def delete(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
