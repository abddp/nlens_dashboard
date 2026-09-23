import json
import logging
import urllib.request
import urllib.error
from django.conf import settings

logger = logging.getLogger(__name__)


class AuthServiceError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class AuthService:
    def __init__(self):
        base = settings.NLENS_INTERNAL_API_ENDPOINT.rstrip("/")
        self.login_url = f"{base}/auth/login/"
        self.refresh_url = f"{base}/auth/refresh/"
        self.logout_url = f"{base}/auth/logout/"
        self.headers = {
            "X-Internal-Service-Key": settings.NLENS_INTERNAL_API_KEY,
            "Content-Type": "application/json",
            "User-Agent": "NealensDashboard/1.0",
        }

    def _post(self, url: str, payload: dict) -> dict:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=self.headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            raw_body = e.read().decode("utf-8", errors="ignore")
            logger.error("AuthService HTTP %d error on %s: %s", e.code, url, raw_body[:500])
            if e.code == 401:
                user_msg = "Invalid email or password."
            elif e.code == 403:
                user_msg = "Access denied. Your account is not authorized to access this dashboard."
            elif e.code == 400:
                user_msg = "Please provide a valid email and password."
            else:
                user_msg = "Authentication service is temporarily unavailable."
            raise AuthServiceError(user_msg, status_code=e.code)
        except urllib.error.URLError as e:
            logger.error("AuthService connection error on %s: %s", url, e.reason)
            raise AuthServiceError("Authentication service is temporarily unavailable.", status_code=503)

    def login(self, email: str, password: str) -> dict:
        return self._post(self.login_url, {"email": email, "password": password})

    def refresh(self, refresh_token: str) -> str:
        data = self._post(self.refresh_url, {"refresh": refresh_token})
        return data["access"]

    def logout(self, refresh_token: str) -> None:
        self._post(self.logout_url, {"refresh": refresh_token})
