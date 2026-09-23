import base64
import json
import logging
import time
import urllib.parse
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import redirect
from .services import AuthService, AuthServiceError

logger = logging.getLogger(__name__)

EXEMPT_PREFIXES = (
    "/login/",
    "/api/auth/login/",
    "/robots.txt",
    "/.well-known/",
    settings.STATIC_URL,
    "/favicon.ico",
)


def _is_token_near_expiry(token: str, buffer_seconds: int = 300) -> bool:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return True
        payload_b64 = parts[1]
        payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
        payload_json = base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8")
        payload = json.loads(payload_json)
        exp = payload.get("exp", 0)
        return time.time() >= (exp - buffer_seconds)
    except Exception:
        return True


class InternalAuthMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self._handle_request(request)
        response["X-Robots-Tag"] = "noindex, nofollow, noarchive, nosnippet, noimageindex"
        response["Referrer-Policy"] = "no-referrer"
        return response

    def _handle_request(self, request):
        path = request.path_info

        # Redirect to home if already authenticated user accesses /login/
        if path == "/login/" and request.session.get("user"):
            return redirect("home")

        # Allow public routes without verification
        if any(path.startswith(prefix) for prefix in EXEMPT_PREFIXES):
            return self.get_response(request)

        user = request.session.get("user")
        access_token = request.session.get("access_token")
        refresh_token = request.session.get("refresh_token")

        if not user or not access_token or not refresh_token:
            if path.startswith("/api/"):
                return JsonResponse({"error": "Authentication required."}, status=401)
            next_param = urllib.parse.quote(request.get_full_path())
            return redirect(f"/login/?next={next_param}")

        # Transparently refresh access token if nearing expiry
        if _is_token_near_expiry(access_token):
            try:
                new_access_token = AuthService().refresh(refresh_token)
                request.session["access_token"] = new_access_token
            except AuthServiceError as e:
                logger.warning("Session expired for %s: %s", user.get("email"), e)
                request.session.flush()
                if path.startswith("/api/"):
                    return JsonResponse({"error": "Session expired, please log in again."}, status=401)
                return redirect("/login/")

        request.internal_user = user
        return self.get_response(request)
