import json
import logging
import redis
from django.conf import settings

logger = logging.getLogger(__name__)

APP_PREFIX = "nlens_dashboard:analytics"

redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)


def build_kpi_cache_key(kpi_name: str, since: str, until: str, granularity: str = "day") -> str:
    clean_name = kpi_name.strip().lower()
    return f"{APP_PREFIX}:kpi:{clean_name}:range_{since}_to_{until}:granularity_{granularity}"


def get_kpi_cache(cache_key: str) -> dict | None:
    try:
        val = redis_client.get(cache_key)
        if val:
            logger.info("⚡ Redis Cache HIT: %s", cache_key)
            return json.loads(val)
        logger.info("💨 Redis Cache MISS: %s", cache_key)
        return None
    except Exception as e:
        logger.warning("Redis cache read error for key %s: %s", cache_key, e)
        return None


def set_kpi_cache(cache_key: str, data: dict, ttl: int = 7200) -> None:
    try:
        redis_client.setex(cache_key, ttl, json.dumps(data))
        logger.info("💾 Redis Cache SET: %s (TTL: %ss)", cache_key, ttl)
    except Exception as e:
        logger.warning("Redis cache write error for key %s: %s", cache_key, e)
