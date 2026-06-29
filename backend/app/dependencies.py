from collections.abc import AsyncIterator

from fastapi import Cookie, Depends, HTTPException, Request, Response, status
from redis.asyncio import Redis

from backend.app.config import Settings, get_settings
from backend.app.dremio import DremioClient
from backend.app.qna import DisabledQnaProvider, OpenAIQnaProvider, QnaProvider
from backend.app.session_store import MemorySessionStore, RedisSessionStore, SessionStore, UserSession


async def lifespan_session_store(settings: Settings) -> SessionStore:
    if settings.redis_url:
        redis = Redis.from_url(settings.redis_url, decode_responses=True)
        return RedisSessionStore(redis)
    return MemorySessionStore()


def get_session_store(request: Request) -> SessionStore:
    return request.app.state.session_store


def get_qna_provider(request: Request) -> QnaProvider:
    return request.app.state.qna_provider


async def get_current_session(
    dremio_ui_session: str | None = Cookie(default=None),
    store: SessionStore = Depends(get_session_store),
) -> UserSession:
    if not dremio_ui_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    session = await store.get(dremio_ui_session)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return session


def get_dremio_client(
    session: UserSession = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
) -> DremioClient:
    return DremioClient(str(settings.dremio_base_url), session.dremio_token)


def set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        "dremio_ui_session",
        session_id,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=8 * 60 * 60,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie("dremio_ui_session")


async def create_app_resources(settings: Settings) -> AsyncIterator[tuple[SessionStore, QnaProvider]]:
    store = await lifespan_session_store(settings)
    qna_provider: QnaProvider
    if settings.openai_api_key:
        qna_provider = OpenAIQnaProvider(settings.openai_api_key, settings.openai_model)
    else:
        qna_provider = DisabledQnaProvider()
    yield store, qna_provider
