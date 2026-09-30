"""Deployment bearer guard; local development stays optional."""

from __future__ import annotations

import secrets

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class APIAuthMiddleware:
    """Protect every API entrypoint before request validation or side effects."""

    def __init__(self, app: ASGIApp, *, token: str, production: bool):
        self.app = app
        self.token = token.encode("utf-8")
        self.production = production

    def authorized(self, scope: Scope) -> bool:
        headers = [value for name, value in scope.get("headers", []) if name.lower() == b"authorization"]
        if len(headers) != 1:
            return False
        scheme, separator, candidate = headers[0].partition(b" ")
        return bool(separator and scheme.lower() == b"bearer" and candidate
                    and secrets.compare_digest(candidate, self.token))

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        protected = (path == "/api" or path.startswith("/api/")) and path != "/api/health"
        if protected and scope["type"] in {"http", "websocket"}:
            unavailable = self.production and not self.token
            unauthorized = bool(self.token) and not self.authorized(scope)
            if unavailable or unauthorized:
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                else:
                    response = JSONResponse(
                        {"detail": "RULECRAFT_API_TOKEN 설정이 필요합니다." if unavailable else "API 인증이 필요합니다."},
                        status_code=503 if unavailable else 401,
                        headers={} if unavailable else {"WWW-Authenticate": "Bearer"},
                    )
                    await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
