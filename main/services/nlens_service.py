import json
import logging
import urllib.request
import urllib.error
from django.conf import settings

logger = logging.getLogger(__name__)


class NlensServiceError(Exception):
    pass


class NlensService:
    def __init__(self):
        self.endpoint = settings.NLENS_INTERNAL_API_ENDPOINT + "nlensql-plus/"
        self.api_key = settings.NLENS_INTERNAL_API_KEY
        self.headers = {
            "X-Internal-Service-Key": self.api_key,
            "Content-Type": "application/json",
            "User-Agent": "NealensDashboard/1.0",
        }

    def query(self, query_string: str) -> dict:
        payload = json.dumps({"query": query_string.strip()}).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint,
            data=payload,
            headers=self.headers,
            method="POST",
        )

        try:
            logger.debug("Executing nlensql_plus query: %s", query_string.strip())
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            try:
                error_data = json.loads(error_body)
                error_type = error_data.get("error_type", f"HTTP_{e.code}")
                error_msg = error_data.get("error", error_body[:300])
            except Exception:
                error_type = f"HTTP_{e.code}"
                error_msg = error_body[:300]
            logger.error(
                "❌ nlensql_plus API HTTP %d error [%s]: %s | Failed Query: %s",
                e.code,
                error_type,
                error_msg,
                query_string.strip(),
            )
            raise NlensServiceError(f"[{error_type}] {error_msg}")
        except urllib.error.URLError as e:
            logger.error(
                "❌ nlensql_plus connection error: %s | Failed Query: %s",
                e.reason,
                query_string.strip(),
            )
            raise NlensServiceError(f"Connection error: {e.reason}")
