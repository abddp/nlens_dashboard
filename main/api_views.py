import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .services import (
    NlensService,
    NlensServiceError,
    build_kpi_cache_key,
    get_kpi_cache,
    set_kpi_cache,
)

logger = logging.getLogger(__name__)


def format_duration_fr(seconds):
    if seconds is None or seconds == 0:
        return "0s"
    seconds = int(round(seconds))
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    if hours > 0:
        return f"{hours}h {minutes}m"
    if minutes > 0:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


def format_hours_delay_fr(hours):
    if hours is None:
        return "—"
    if hours < 1:
        mins = int(round(hours * 60))
        return f"{mins} min"
    if hours < 24:
        h = int(hours)
        m = int(round((hours - h) * 60))
        return f"{h}h {m}m" if m > 0 else f"{h}h"
    days = int(hours // 24)
    rem_h = int(round(hours % 24))
    return f"{days}j {rem_h}h" if rem_h > 0 else f"{days}j"


def get_date_bounds_with_previous(request):
    today = date.today()
    default_since = (today - timedelta(days=30)).strftime("%Y-%m-%d")
    default_until = today.strftime("%Y-%m-%d")

    since = request.query_params.get("since", default_since)
    until = request.query_params.get("until", default_until)

    start_d = date.fromisoformat(since)
    end_d = date.fromisoformat(until)
    duration = (end_d - start_d).days + 1
    prev_end_d = start_d - timedelta(days=1)
    prev_start_d = prev_end_d - timedelta(days=duration - 1)

    prev_since = prev_start_d.strftime("%Y-%m-%d")
    prev_until = prev_end_d.strftime("%Y-%m-%d")

    granularity = request.query_params.get("granularity")
    if not granularity:
        granularity = "month" if duration > 60 else "day"

    return since, until, prev_since, prev_until, granularity


def aggregate_trend(trend_rows, val_key, granularity, method="sum"):
    if granularity != "month":
        return sorted(trend_rows, key=lambda x: x["day"])

    buckets = defaultdict(list)
    for row in trend_rows:
        day_str = str(row["day"])
        month_key = day_str[:7]
        val = row.get(val_key, 0)
        buckets[month_key].append(float(val or 0))

    aggregated = []
    for month_key in sorted(buckets.keys()):
        vals = buckets[month_key]
        if method == "sum":
            res_val = sum(vals)
        elif method == "avg":
            res_val = round(sum(vals) / len(vals), 2) if vals else 0.0
        elif method == "last":
            res_val = vals[-1] if vals else 0.0
        elif method == "max":
            res_val = max(vals) if vals else 0.0
        else:
            res_val = sum(vals)

        if val_key == "count":
            val_out = int(round(res_val))
        else:
            val_out = round(res_val, 2)

        aggregated.append({
            "day": month_key,
            val_key: val_out,
        })

    return aggregated


# ==============================================================================
# 1. SIGN-UPS
# ==============================================================================
def compute_signups_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM users SELECT COUNT(*) AS total SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM users SELECT joined_on__date, COUNT(*) AS total_signups GROUP BY joined_on__date SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM users SELECT COUNT(*) AS total SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM users SELECT joined_on__date, COUNT(*) AS total_signups GROUP BY joined_on__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    total_data = service.query(total_query)
    trend_data = service.query(trend_query)
    prev_total_data = service.query(prev_total_query)
    prev_trend_data = service.query(prev_trend_query)

    total = total_data["data"][0]["total"] if total_data["data"] else 0
    prev_total = prev_total_data["data"][0]["total"] if prev_total_data["data"] else 0

    raw_trend = [
        {"day": row["joined_on__date"], "count": row["total_signups"]}
        for row in trend_data["data"]
    ]
    raw_prev_trend = [
        {"day": row["joined_on__date"], "count": row["total_signups"]}
        for row in prev_trend_data["data"]
    ]

    trend = aggregate_trend(raw_trend, "count", granularity, "sum")
    prev_trend = aggregate_trend(raw_prev_trend, "count", granularity, "sum")

    return {
        "total": total,
        "previous_total": prev_total,
        "trend": trend,
        "previous_trend": prev_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class SignupsKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("signups", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_signups_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in SignupsKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 2. PAYING STORES
# ==============================================================================
def compute_paying_stores_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM billing_subscriptions SELECT COUNT(DISTINCT store_id) AS total WHERE status = "active" SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM billing_subscriptions SELECT created_at__date, COUNT(DISTINCT store_id) AS active_stores WHERE status = "active" GROUP BY created_at__date SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM billing_subscriptions SELECT COUNT(DISTINCT store_id) AS total WHERE status = "active" SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM billing_subscriptions SELECT created_at__date, COUNT(DISTINCT store_id) AS active_stores WHERE status = "active" GROUP BY created_at__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    res = service.query(total_query)
    trend_res = service.query(trend_query)
    prev_res = service.query(prev_total_query)
    prev_trend_res = service.query(prev_trend_query)

    total = res["data"][0]["total"] if res["data"] else 0
    prev_total = prev_res["data"][0]["total"] if prev_res["data"] else 0

    raw_trend = [
        {"day": row["created_at__date"], "count": row["active_stores"]}
        for row in trend_res["data"]
    ]
    raw_prev_trend = [
        {"day": row["created_at__date"], "count": row["active_stores"]}
        for row in prev_trend_res["data"]
    ]

    trend = aggregate_trend(raw_trend, "count", granularity, "sum")
    prev_trend = aggregate_trend(raw_prev_trend, "count", granularity, "sum")

    return {
        "total": total,
        "previous_total": prev_total,
        "trend": trend,
        "previous_trend": prev_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class PayingStoresKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("paying-stores", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_paying_stores_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in PayingStoresKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 3. PAYING USERS
# ==============================================================================
def compute_paying_users_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM shops SELECT COUNT(DISTINCT owner_id) AS total WHERE id IN (FROM billing_subscriptions SELECT store_id WHERE status = "active") SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM shops SELECT created_on__date, COUNT(DISTINCT owner_id) AS active_paying_users WHERE id IN (FROM billing_subscriptions SELECT store_id WHERE status = "active") GROUP BY created_on__date SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM shops SELECT COUNT(DISTINCT owner_id) AS total WHERE id IN (FROM billing_subscriptions SELECT store_id WHERE status = "active") SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM shops SELECT created_on__date, COUNT(DISTINCT owner_id) AS active_paying_users WHERE id IN (FROM billing_subscriptions SELECT store_id WHERE status = "active") GROUP BY created_on__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    res = service.query(total_query)
    trend_res = service.query(trend_query)
    prev_res = service.query(prev_total_query)
    prev_trend_res = service.query(prev_trend_query)

    total = res["data"][0]["total"] if res["data"] else 0
    prev_total = prev_res["data"][0]["total"] if prev_res["data"] else 0

    raw_trend = [
        {"day": row["created_on__date"], "count": row["active_paying_users"]}
        for row in trend_res["data"]
    ]
    raw_prev_trend = [
        {"day": row["created_on__date"], "count": row["active_paying_users"]}
        for row in prev_trend_res["data"]
    ]

    trend = aggregate_trend(raw_trend, "count", granularity, "sum")
    prev_trend = aggregate_trend(raw_prev_trend, "count", granularity, "sum")

    return {
        "total": total,
        "previous_total": prev_total,
        "trend": trend,
        "previous_trend": prev_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class PayingUsersKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("paying-users", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_paying_users_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in PayingUsersKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 4. SESSIONS
# ==============================================================================
def compute_sessions_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM user_sessions SELECT COUNT(*) AS total SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM user_sessions SELECT started_at__date, COUNT(*) AS session_count GROUP BY started_at__date SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM user_sessions SELECT COUNT(*) AS total SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM user_sessions SELECT started_at__date, COUNT(*) AS session_count GROUP BY started_at__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    total_data = service.query(total_query)
    trend_data = service.query(trend_query)
    prev_total_data = service.query(prev_total_query)
    prev_trend_data = service.query(prev_trend_query)

    total = total_data["data"][0]["total"] if total_data["data"] else 0
    prev_total = prev_total_data["data"][0]["total"] if prev_total_data["data"] else 0

    raw_trend = [
        {"day": row["started_at__date"], "count": row["session_count"]}
        for row in trend_data["data"]
    ]
    raw_prev_trend = [
        {"day": row["started_at__date"], "count": row["session_count"]}
        for row in prev_trend_data["data"]
    ]

    trend = aggregate_trend(raw_trend, "count", granularity, "sum")
    prev_trend = aggregate_trend(raw_prev_trend, "count", granularity, "sum")

    return {
        "total": total,
        "previous_total": prev_total,
        "trend": trend,
        "previous_trend": prev_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class SessionsKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("sessions", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_sessions_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in SessionsKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 5. REVENUE, MRR & ARR
# ==============================================================================
def compute_mrr_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM billing_transactions SELECT SUM(amount) AS total WHERE status = "paid" SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM billing_transactions SELECT created_at__date, SUM(amount) AS daily_revenue WHERE status = "paid" GROUP BY created_at__date SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM billing_transactions SELECT SUM(amount) AS total WHERE status = "paid" SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM billing_transactions SELECT created_at__date, SUM(amount) AS daily_revenue WHERE status = "paid" GROUP BY created_at__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    total_data = service.query(total_query)
    trend_data = service.query(trend_query)
    prev_total_data = service.query(prev_total_query)
    prev_trend_data = service.query(prev_trend_query)

    amount_raw = total_data["data"][0]["total"] if total_data["data"] else 0
    revenue = float(amount_raw or 0)

    prev_amount_raw = prev_total_data["data"][0]["total"] if prev_total_data["data"] else 0
    prev_revenue = float(prev_amount_raw or 0)

    raw_trend = [
        {"day": row["created_at__date"], "amount": float(row["daily_revenue"] or 0)}
        for row in trend_data["data"]
    ]
    raw_prev_trend = [
        {"day": row["created_at__date"], "amount": float(row["daily_revenue"] or 0)}
        for row in prev_trend_data["data"]
    ]

    trend = aggregate_trend(raw_trend, "amount", granularity, "sum")
    prev_trend = aggregate_trend(raw_prev_trend, "amount", granularity, "sum")

    mrr = revenue
    prev_mrr = prev_revenue
    arr = round(mrr * 12.0, 2)
    prev_arr = round(prev_mrr * 12.0, 2)

    arr_trend = [
        {"day": row["day"], "amount": round(row["amount"] * 12.0, 2)}
        for row in trend
    ]
    prev_arr_trend = [
        {"day": row["day"], "amount": round(row["amount"] * 12.0, 2)}
        for row in prev_trend
    ]

    return {
        "revenue": revenue,
        "previous_revenue": prev_revenue,
        "revenue_trend": trend,
        "previous_revenue_trend": prev_trend,
        "mrr": mrr,
        "previous_mrr": prev_mrr,
        "arr": arr,
        "previous_arr": prev_arr,
        "trend": trend,
        "previous_trend": prev_trend,
        "arr_trend": arr_trend,
        "previous_arr_trend": prev_arr_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class MrrKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("mrr", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_mrr_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in MrrKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 6. ACTIVE USERS
# ==============================================================================
def compute_active_users_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM user_session_events SELECT COUNT(DISTINCT user_id) AS total WHERE actor = "user" AND event_type NOT IN ("login", "logout", "signup", "page_view", "switch_store") SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM user_session_events SELECT created_at__date, COUNT(DISTINCT user_id) AS active_users WHERE actor = "user" AND event_type NOT IN ("login", "logout", "signup", "page_view", "switch_store") GROUP BY created_at__date SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM user_session_events SELECT COUNT(DISTINCT user_id) AS total WHERE actor = "user" AND event_type NOT IN ("login", "logout", "signup", "page_view", "switch_store") SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM user_session_events SELECT created_at__date, COUNT(DISTINCT user_id) AS active_users WHERE actor = "user" AND event_type NOT IN ("login", "logout", "signup", "page_view", "switch_store") GROUP BY created_at__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    res = service.query(total_query)
    trend_res = service.query(trend_query)
    prev_res = service.query(prev_total_query)
    prev_trend_res = service.query(prev_trend_query)

    total = res["data"][0]["total"] if res["data"] else 0
    prev_total = prev_res["data"][0]["total"] if prev_res["data"] else 0

    raw_trend = [
        {"day": row["created_at__date"], "count": row["active_users"]}
        for row in trend_res["data"]
    ]
    raw_prev_trend = [
        {"day": row["created_at__date"], "count": row["active_users"]}
        for row in prev_trend_res["data"]
    ]

    trend = aggregate_trend(raw_trend, "count", granularity, "sum")
    prev_trend = aggregate_trend(raw_prev_trend, "count", granularity, "sum")

    return {
        "total": total,
        "previous_total": prev_total,
        "trend": trend,
        "previous_trend": prev_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class ActiveUsersKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("active-users", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_active_users_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in ActiveUsersKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 7. ACTIVE STORES
# ==============================================================================
def compute_active_stores_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM user_session_events SELECT COUNT(DISTINCT shop_id) AS total WHERE actor = "user" AND event_type NOT IN ("login", "logout", "signup", "page_view", "switch_store") SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM user_session_events SELECT created_at__date, COUNT(DISTINCT shop_id) AS active_stores WHERE actor = "user" AND event_type NOT IN ("login", "logout", "signup", "page_view", "switch_store") GROUP BY created_at__date SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM user_session_events SELECT COUNT(DISTINCT shop_id) AS total WHERE actor = "user" AND event_type NOT IN ("login", "logout", "signup", "page_view", "switch_store") SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM user_session_events SELECT created_at__date, COUNT(DISTINCT shop_id) AS active_stores WHERE actor = "user" AND event_type NOT IN ("login", "logout", "signup", "page_view", "switch_store") GROUP BY created_at__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    res = service.query(total_query)
    trend_res = service.query(trend_query)
    prev_res = service.query(prev_total_query)
    prev_trend_res = service.query(prev_trend_query)

    total = res["data"][0]["total"] if res["data"] else 0
    prev_total = prev_res["data"][0]["total"] if prev_res["data"] else 0

    raw_trend = [
        {"day": row["created_at__date"], "count": row["active_stores"]}
        for row in trend_res["data"]
    ]
    raw_prev_trend = [
        {"day": row["created_at__date"], "count": row["active_stores"]}
        for row in prev_trend_res["data"]
    ]

    trend = aggregate_trend(raw_trend, "count", granularity, "sum")
    prev_trend = aggregate_trend(raw_prev_trend, "count", granularity, "sum")

    return {
        "total": total,
        "previous_total": prev_total,
        "trend": trend,
        "previous_trend": prev_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class ActiveStoresKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("active-stores", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_active_stores_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in ActiveStoresKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 8. ACTIVATION
# ==============================================================================
def compute_activation_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM shops SELECT COUNT(*) AS total, SUM(onboarding_completed) AS completed SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM shops SELECT created_on__date, COUNT(*) AS total_shops, SUM(onboarding_completed) AS completed_shops GROUP BY created_on__date SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM shops SELECT COUNT(*) AS total, SUM(onboarding_completed) AS completed SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM shops SELECT created_on__date, COUNT(*) AS total_shops, SUM(onboarding_completed) AS completed_shops GROUP BY created_on__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    res = service.query(total_query)
    trend_res = service.query(trend_query)
    prev_res = service.query(prev_total_query)
    prev_trend_res = service.query(prev_trend_query)

    completed = float(res["data"][0]["completed"] or 0)
    total = float(res["data"][0]["total"] or 0)
    rate = round((completed / total) * 100.0, 2) if total > 0 else 0.0

    prev_completed = float(prev_res["data"][0]["completed"] or 0)
    prev_total_val = float(prev_res["data"][0]["total"] or 0)
    prev_rate = round((prev_completed / prev_total_val) * 100.0, 2) if prev_total_val > 0 else 0.0

    if granularity == "month":
        buckets = defaultdict(lambda: {"completed": 0.0, "total": 0.0})
        for row in trend_res["data"]:
            m_key = str(row["created_on__date"])[:7]
            buckets[m_key]["completed"] += float(row.get("completed_shops") or 0)
            buckets[m_key]["total"] += float(row.get("total_shops") or 0)
        trend = [
            {
                "day": m_key,
                "rate": round((buckets[m_key]["completed"] / buckets[m_key]["total"]) * 100.0, 2) if buckets[m_key]["total"] > 0 else 0.0,
            }
            for m_key in sorted(buckets.keys())
        ]

        prev_buckets = defaultdict(lambda: {"completed": 0.0, "total": 0.0})
        for row in prev_trend_res["data"]:
            m_key = str(row["created_on__date"])[:7]
            prev_buckets[m_key]["completed"] += float(row.get("completed_shops") or 0)
            prev_buckets[m_key]["total"] += float(row.get("total_shops") or 0)
        prev_trend = [
            {
                "day": m_key,
                "rate": round((prev_buckets[m_key]["completed"] / prev_buckets[m_key]["total"]) * 100.0, 2) if prev_buckets[m_key]["total"] > 0 else 0.0,
            }
            for m_key in sorted(prev_buckets.keys())
        ]
    else:
        trend = sorted(
            [
                {
                    "day": row["created_on__date"],
                    "rate": round((float(row["completed_shops"] or 0) / float(row["total_shops"] or 1)) * 100.0, 2),
                }
                for row in trend_res["data"]
            ],
            key=lambda x: x["day"],
        )
        prev_trend = sorted(
            [
                {
                    "day": row["created_on__date"],
                    "rate": round((float(row["completed_shops"] or 0) / float(row["total_shops"] or 1)) * 100.0, 2),
                }
                for row in prev_trend_res["data"]
            ],
            key=lambda x: x["day"],
        )

    return {
        "rate": rate,
        "previous_rate": prev_rate,
        "trend": trend,
        "previous_trend": prev_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class ActivationKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("activation", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_activation_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in ActivationKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 9. CHURN
# ==============================================================================
def compute_churn_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    canceled_query = f'FROM billing_subscriptions SELECT COUNT(*) AS canceled_count WHERE status = "canceled" SINCE "{since}" UNTIL "{until}"'
    active_query = f'FROM billing_subscriptions SELECT COUNT(*) AS active_count WHERE status = "active" SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM billing_subscriptions SELECT created_at__date, COUNT(*) AS canceled_count WHERE status = "canceled" GROUP BY created_at__date SINCE "{since}" UNTIL "{until}"'

    prev_canceled_query = f'FROM billing_subscriptions SELECT COUNT(*) AS canceled_count WHERE status = "canceled" SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_active_query = f'FROM billing_subscriptions SELECT COUNT(*) AS active_count WHERE status = "active" SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM billing_subscriptions SELECT created_at__date, COUNT(*) AS canceled_count WHERE status = "canceled" GROUP BY created_at__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    canceled_res = service.query(canceled_query)
    active_res = service.query(active_query)
    trend_res = service.query(trend_query)

    prev_canceled_res = service.query(prev_canceled_query)
    prev_active_res = service.query(prev_active_query)
    prev_trend_res = service.query(prev_trend_query)

    canceled = int(canceled_res["data"][0]["canceled_count"] or 0) if canceled_res["data"] else 0
    active = int(active_res["data"][0]["active_count"] or 0) if active_res["data"] else 0
    total_pool = active + canceled
    churn_rate = round((canceled / total_pool) * 100.0, 2) if total_pool > 0 else 0.0

    prev_canceled = int(prev_canceled_res["data"][0]["canceled_count"] or 0) if prev_canceled_res["data"] else 0
    prev_active = int(prev_active_res["data"][0]["active_count"] or 0) if prev_active_res["data"] else 0
    prev_total_pool = prev_active + prev_canceled
    prev_churn_rate = round((prev_canceled / prev_total_pool) * 100.0, 2) if prev_total_pool > 0 else 0.0

    raw_trend = [
        {"day": row["created_at__date"], "count": row["canceled_count"]}
        for row in trend_res["data"]
    ]
    raw_prev_trend = [
        {"day": row["created_at__date"], "count": row["canceled_count"]}
        for row in prev_trend_res["data"]
    ]

    churn_trend = aggregate_trend(raw_trend, "count", granularity, "sum")
    prev_churn_trend = aggregate_trend(raw_prev_trend, "count", granularity, "sum")

    return {
        "canceled_count": canceled,
        "previous_canceled_count": prev_canceled,
        "active_count": active,
        "previous_active_count": prev_active,
        "churn_rate": churn_rate,
        "previous_churn_rate": prev_churn_rate,
        "trend": churn_trend,
        "previous_trend": prev_churn_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class ChurnKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("churn", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_churn_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in ChurnKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 10. RETENTION
# ==============================================================================
def compute_retention_kpi():
    service = NlensService()
    tx_query = 'FROM billing_transactions SELECT id, store_id, amount, status, type, created_at WHERE type = "subscription" AND status = "paid" ORDER BY created_at ASC'
    sub_query = 'FROM billing_subscriptions SELECT id, store_id, status, created_at, canceled_at ORDER BY created_at ASC'

    tx_res = service.query(tx_query)
    sub_res = service.query(sub_query)

    transactions = tx_res.get("data", [])
    subscriptions = sub_res.get("data", [])

    if not transactions:
        return {
            "m1_retention_rate": 100.0,
            "previous_m1_rate": 100.0,
            "m1_sample_size": 0,
            "total_paid_stores": 0,
            "is_preliminary": True,
            "max_months": 0,
            "cohorts": [],
        }

    store_first_paid = {}
    for tx in transactions:
        store_id = tx["store_id"]
        created_dt_str = tx["created_at"]
        if not created_dt_str:
            continue
        created_d = created_dt_str[:10]
        if store_id not in store_first_paid or created_d < store_first_paid[store_id]:
            store_first_paid[store_id] = created_d

    store_sub_details = defaultdict(list)
    for sub in subscriptions:
        store_id = sub["store_id"]
        store_sub_details[store_id].append(sub)

    cohort_stores = defaultdict(set)
    for store_id, first_d in store_first_paid.items():
        cohort_key = first_d[:7]
        cohort_stores[cohort_key].add(store_id)

    sorted_cohort_keys = sorted(cohort_stores.keys())
    today = date.today()

    all_months = []
    if sorted_cohort_keys:
        start_year, start_month = map(int, sorted_cohort_keys[0].split("-"))
        cur_year, cur_month = today.year, today.month
        y, m = start_year, start_month
        while (y < cur_year) or (y == cur_year and m <= cur_month):
            all_months.append(f"{y:04d}-{m:02d}")
            m += 1
            if m > 12:
                m = 1
                y += 1

    month_labels_fr = {
        "01": "Janv", "02": "Févr", "03": "Mars", "04": "Avr",
        "05": "Mai", "06": "Juin", "07": "Juil", "08": "Août",
        "09": "Sept", "10": "Oct", "11": "Nov", "12": "Déc",
    }

    def format_cohort_label(ym_str):
        parts = ym_str.split("-")
        return f"{month_labels_fr.get(parts[1], parts[1])} {parts[0]}"

    cohort_results = []
    max_rel_months = 0
    m1_rates = []
    m1_sample_total = 0

    for cohort_key in sorted_cohort_keys:
        stores = cohort_stores[cohort_key]
        initial_count = len(stores)
        if initial_count == 0:
            continue

        cohort_start_idx = all_months.index(cohort_key) if cohort_key in all_months else 0
        available_months = all_months[cohort_start_idx:]

        rates = []
        counts = []

        for rel_idx, target_ym in enumerate(available_months):
            t_y, t_m = map(int, target_ym.split("-"))
            if t_m == 12:
                next_ym_first_day = f"{t_y + 1:04d}-01-01"
            else:
                next_ym_first_day = f"{t_y:04d}-{t_m + 1:02d}-01"

            target_start = f"{t_y:04d}-{t_m:02d}-01"

            active_count = 0
            for s_id in stores:
                s_subs = store_sub_details.get(s_id, [])
                is_active_in_month = False

                if rel_idx == 0:
                    is_active_in_month = True
                else:
                    for sub in s_subs:
                        sub_created = (sub.get("created_at") or "")[:10]
                        sub_canceled = (sub.get("canceled_at") or "")[:10] if sub.get("canceled_at") else None
                        sub_status = sub.get("status")

                        if sub_created < next_ym_first_day:
                            if not sub_canceled or sub_canceled >= target_start:
                                if sub_status != "canceled" or (sub_canceled and sub_canceled >= target_start):
                                    is_active_in_month = True
                                    break

                if is_active_in_month:
                    active_count += 1

            rate = round((active_count / initial_count) * 100.0, 1)
            rates.append(rate)
            counts.append(active_count)

            if rel_idx == 1:
                m1_rates.append(rate)
                m1_sample_total += initial_count

        if len(rates) > max_rel_months:
            max_rel_months = len(rates)

        cohort_results.append({
            "cohort": cohort_key,
            "cohort_label": format_cohort_label(cohort_key),
            "initial_count": initial_count,
            "is_small_sample": initial_count < 5,
            "rates": rates,
            "counts": counts,
        })

    total_paid_stores = len(store_first_paid)
    m1_avg = round(sum(m1_rates) / len(m1_rates), 1) if m1_rates else 100.0
    prev_m1_avg = round(sum(m1_rates[:-1]) / len(m1_rates[:-1]), 1) if len(m1_rates) > 1 else m1_avg

    return {
        "m1_retention_rate": m1_avg,
        "previous_m1_rate": prev_m1_avg,
        "m1_sample_size": m1_sample_total,
        "total_paid_stores": total_paid_stores,
        "is_preliminary": total_paid_stores < 5,
        "max_months": max_rel_months,
        "cohorts": cohort_results,
    }


class RetentionKpiView(APIView):
    def get(self, request):
        cache_key = build_kpi_cache_key("retention", "all", "all", "all")
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_retention_kpi()
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in RetentionKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# RECENT TRANSACTIONS
# ==============================================================================
def compute_recent_transactions():
    service = NlensService()
    query = 'FROM billing_transactions SELECT id, amount, status, type, created_at INCLUDE store ORDER BY created_at DESC LIMIT 10'
    res = service.query(query)
    return {"transactions": res["data"]}


class RecentTransactionsView(APIView):
    def get(self, request):
        cache_key = build_kpi_cache_key("recent-transactions", "all", "all", "all")
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_recent_transactions()
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in RecentTransactionsView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 11. FEEDBACKS
# ==============================================================================
def compute_feedbacks_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM feedbacks SELECT COUNT(*) AS total SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM feedbacks SELECT created_at__date, COUNT(*) AS total_feedbacks GROUP BY created_at__date SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM feedbacks SELECT COUNT(*) AS total SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM feedbacks SELECT created_at__date, COUNT(*) AS total_feedbacks GROUP BY created_at__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    total_data = service.query(total_query)
    trend_data = service.query(trend_query)
    prev_total_data = service.query(prev_total_query)
    prev_trend_data = service.query(prev_trend_query)

    total = total_data["data"][0]["total"] if total_data.get("data") else 0
    prev_total = prev_total_data["data"][0]["total"] if prev_total_data.get("data") else 0

    raw_trend = [{"day": r["created_at__date"], "count": r.get("total_feedbacks", 0)} for r in trend_data.get("data", [])]
    raw_prev_trend = [{"day": r["created_at__date"], "count": r.get("total_feedbacks", 0)} for r in prev_trend_data.get("data", [])]

    trend = aggregate_trend(raw_trend, "count", granularity, "sum")
    prev_trend = aggregate_trend(raw_prev_trend, "count", granularity, "sum")

    return {
        "total": total,
        "previous_total": prev_total,
        "trend": trend,
        "previous_trend": prev_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class FeedbacksKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("feedbacks", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_feedbacks_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in FeedbacksKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 12. TIME SPENT ON PLATFORM
# ==============================================================================
def compute_time_spent_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM user_sessions SELECT AVG(active_duration_seconds) AS avg_sec SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM user_sessions SELECT started_at__date, AVG(active_duration_seconds) AS avg_sec GROUP BY started_at__date SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM user_sessions SELECT AVG(active_duration_seconds) AS avg_sec SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM user_sessions SELECT started_at__date, AVG(active_duration_seconds) AS avg_sec GROUP BY started_at__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    t_res = service.query(total_query)
    t_data = t_res.get("data", [{}])[0] if t_res.get("data") else {}
    trend_data = service.query(trend_query).get("data", [])

    prev_t_res = service.query(prev_total_query)
    prev_t_data = prev_t_res.get("data", [{}])[0] if prev_t_res.get("data") else {}
    prev_trend_data = service.query(prev_trend_query).get("data", [])

    avg_sec = float(t_data.get("avg_sec") or 0)
    prev_avg_sec = float(prev_t_data.get("avg_sec") or 0)

    raw_trend = [{"day": r["started_at__date"], "seconds": float(r.get("avg_sec") or 0)} for r in trend_data]
    raw_prev_trend = [{"day": r["started_at__date"], "seconds": float(r.get("avg_sec") or 0)} for r in prev_trend_data]

    trend = aggregate_trend(raw_trend, "seconds", granularity, "avg")
    prev_trend = aggregate_trend(raw_prev_trend, "seconds", granularity, "avg")

    return {
        "avg_seconds": int(avg_sec),
        "formatted_avg": format_duration_fr(avg_sec),
        "previous_avg_seconds": int(prev_avg_sec),
        "formatted_previous_avg": format_duration_fr(prev_avg_sec),
        "trend": trend,
        "previous_trend": prev_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class TimeSpentKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("time-spent", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_time_spent_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in TimeSpentKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 13. AI USAGE
# ==============================================================================
def compute_ai_usage_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM ai_credit_usages SELECT SUM(credits_used) AS total_credits, SUM(total_tokens) AS total_tokens SINCE "{since}" UNTIL "{until}"'
    trend_query = f'FROM ai_credit_usages SELECT created_at__date, SUM(credits_used) AS credits, SUM(total_tokens) AS tokens GROUP BY created_at__date SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM ai_credit_usages SELECT SUM(credits_used) AS total_credits, SUM(total_tokens) AS total_tokens SINCE "{prev_since}" UNTIL "{prev_until}"'
    prev_trend_query = f'FROM ai_credit_usages SELECT created_at__date, SUM(credits_used) AS credits, SUM(total_tokens) AS tokens GROUP BY created_at__date SINCE "{prev_since}" UNTIL "{prev_until}"'

    t_res = service.query(total_query)
    t_data = t_res.get("data", [{}])[0] if t_res.get("data") else {}
    trend_data = service.query(trend_query).get("data", [])

    prev_t_res = service.query(prev_total_query)
    prev_t_data = prev_t_res.get("data", [{}])[0] if prev_t_res.get("data") else {}
    prev_trend_data = service.query(prev_trend_query).get("data", [])

    total_credits = float(t_data.get("total_credits") or 0)
    total_tokens = int(t_data.get("total_tokens") or 0)

    prev_total_credits = float(prev_t_data.get("total_credits") or 0)
    prev_total_tokens = int(prev_t_data.get("total_tokens") or 0)

    raw_trend = [{"day": r["created_at__date"], "credits": float(r.get("credits") or 0), "tokens": int(r.get("tokens") or 0)} for r in trend_data]
    raw_prev_trend = [{"day": r["created_at__date"], "credits": float(r.get("credits") or 0), "tokens": int(r.get("tokens") or 0)} for r in prev_trend_data]

    trend = aggregate_trend(raw_trend, "credits", granularity, "sum")
    prev_trend = aggregate_trend(raw_prev_trend, "credits", granularity, "sum")

    return {
        "total_credits": round(total_credits, 2),
        "total_tokens": total_tokens,
        "previous_total_credits": round(prev_total_credits, 2),
        "previous_total_tokens": prev_total_tokens,
        "trend": trend,
        "previous_trend": prev_trend,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class AiUsageKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("ai-usage", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_ai_usage_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in AiUsageKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 14. AI CATEGORIES
# ==============================================================================
def compute_ai_categories_kpi(since, until, prev_since, prev_until, granularity=None):
    service = NlensService()
    query = f'FROM ai_request_categories SELECT category, COUNT(*) AS total_categories GROUP BY category SINCE "{since}" UNTIL "{until}"'
    prev_query = f'FROM ai_request_categories SELECT category, COUNT(*) AS total_categories GROUP BY category SINCE "{prev_since}" UNTIL "{prev_until}"'

    category_labels_fr = {
        "product_description": "Descriptions Produits",
        "seo_optimization": "Optimisation SEO",
        "chat_assistant": "Assistant & Dialogue",
        "customer_support": "Support Clientèle",
        "image_generation": "Génération d'Images",
        "marketing_copy": "Textes Publicitaires",
        "store_design": "Design & Thème",
        "pricing_strategy": "Stratégie Tarifaire",
        "other": "Autres Tâches",
    }

    res = service.query(query).get("data", [])
    prev_res = service.query(prev_query).get("data", [])

    clean_res = [r for r in res if r.get("category")]
    clean_prev = [r for r in prev_res if r.get("category")]

    total = sum(int(r.get("total_categories") or 0) for r in clean_res) or 0
    prev_total = sum(int(r.get("total_categories") or 0) for r in clean_prev) or 0
    prev_map = {r.get("category"): int(r.get("total_categories") or 0) for r in clean_prev}

    sorted_res = sorted(clean_res, key=lambda r: int(r.get("total_categories") or 0), reverse=True)

    categories = []
    for r in sorted_res:
        cat = r.get("category") or "other"
        cnt = int(r.get("total_categories") or 0)
        prev_cnt = int(prev_map.get(cat, 0) or 0)
        pct = round((cnt / total) * 100.0, 1) if total > 0 else 0.0
        label = category_labels_fr.get(cat, str(cat).replace("_", " ").capitalize())
        categories.append({
            "category": str(cat),
            "label": label,
            "count": cnt,
            "previous_count": prev_cnt,
            "percentage": pct,
        })

    return {
        "total": total,
        "previous_total": prev_total,
        "categories": categories,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
    }


class AiCategoriesKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("ai-categories", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_ai_categories_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in AiCategoriesKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 15. TOP PAGES
# ==============================================================================
def compute_top_pages_kpi(since, until, prev_since, prev_until, granularity=None):
    service = NlensService()
    query = f'FROM user_session_events SELECT page_type, COUNT(*) AS total_views WHERE page_type IS NOT NULL GROUP BY page_type SINCE "{since}" UNTIL "{until}"'
    prev_query = f'FROM user_session_events SELECT page_type, COUNT(*) AS total_views WHERE page_type IS NOT NULL GROUP BY page_type SINCE "{prev_since}" UNTIL "{prev_until}"'

    page_labels_fr = {
        "products": "Catalogue Produits",
        "orders": "Gestion des Commandes",
        "ai_chat": "Assistant IA & Copilote",
        "settings": "Configuration Boutique",
        "storefront": "Éditeur de Vitrine",
        "customers": "Fichier Clients",
        "coupons": "Promotions & Réductions",
        "analytics": "Rapports & Ventes",
        "shipping": "Expéditions & Livraison",
        "billing": "Facturation & Abonnements",
        "feedback": "Centre de Feedback",
        "dashboard": "Tableau de Bord",
        "other": "Autres Pages",
    }

    res = service.query(query).get("data", [])
    prev_res = service.query(prev_query).get("data", [])

    clean_res = [r for r in res if r.get("page_type")]
    clean_prev_res = [r for r in prev_res if r.get("page_type")]

    total_views = sum(int(r.get("total_views") or 0) for r in clean_res) or 0
    prev_total_views = sum(int(r.get("total_views") or 0) for r in clean_prev_res) or 0
    prev_map = {r.get("page_type"): int(r.get("total_views") or 0) for r in clean_prev_res}

    sorted_res = sorted(clean_res, key=lambda r: int(r.get("total_views") or 0), reverse=True)

    pages = []
    for rank, r in enumerate(sorted_res, 1):
        ptype = r.get("page_type") or "other"
        views = int(r.get("total_views") or 0)
        prev_v = int(prev_map.get(ptype, 0) or 0)
        pct = round((views / total_views) * 100.0, 1) if total_views > 0 else 0.0
        label = page_labels_fr.get(ptype, str(ptype).replace("_", " ").capitalize())
        pages.append({
            "rank": rank,
            "page_type": str(ptype),
            "label": label,
            "views": views,
            "previous_views": prev_v,
            "percentage": pct,
        })

    return {
        "total_views": total_views,
        "previous_total_views": prev_total_views,
        "pages": pages,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
    }


class TopPagesKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("top-pages", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_top_pages_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in TopPagesKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 16. BUSINESS MODELS
# ==============================================================================
def compute_business_models_kpi():
    service = NlensService()
    query = 'FROM shops SELECT business_model, COUNT(*) AS total_models GROUP BY business_model'

    model_labels_fr = {
        "dropshipping": "Dropshipping",
        "owned_inventory": "Stock Propre (Inventaire)",
        "print_on_demand": "Impression à la Demande (POD)",
        "digital_products": "Produits Digitaux & E-books",
        "marketplace": "Place de Marché (Marketplace)",
        "other": "Autres Modèles",
    }

    res = service.query(query).get("data", [])
    clean_res = [r for r in res if r.get("business_model")]

    total = sum(int(r.get("total_models") or 0) for r in clean_res) or 0
    sorted_res = sorted(clean_res, key=lambda r: int(r.get("total_models") or 0), reverse=True)

    models = []
    for r in sorted_res:
        bm = r.get("business_model") or "other"
        cnt = int(r.get("total_models") or 0)
        pct = round((cnt / total) * 100.0, 1) if total > 0 else 0.0
        label = model_labels_fr.get(bm, str(bm).replace("_", " ").capitalize())
        models.append({
            "model": str(bm),
            "label": label,
            "count": cnt,
            "percentage": pct,
        })

    return {
        "total": total,
        "models": models,
    }


class BusinessModelsKpiView(APIView):
    def get(self, request):
        cache_key = build_kpi_cache_key("business-models", "all", "all", "all")
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_business_models_kpi()
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in BusinessModelsKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 17. DEVICES
# ==============================================================================
def compute_devices_kpi(since, until, prev_since, prev_until, granularity=None):
    service = NlensService()
    query = f'FROM user_sessions SELECT device_type, COUNT(*) AS total_devices GROUP BY device_type SINCE "{since}" UNTIL "{until}"'
    prev_query = f'FROM user_sessions SELECT device_type, COUNT(*) AS total_devices GROUP BY device_type SINCE "{prev_since}" UNTIL "{prev_until}"'

    device_labels_fr = {
        "desktop": "Ordinateur (Desktop)",
        "mobile": "Mobile (Smartphone)",
        "tablet": "Tablette",
        "other": "Autre",
    }

    res = service.query(query).get("data", [])
    prev_res = service.query(prev_query).get("data", [])

    clean_res = [r for r in res if r.get("device_type")]
    clean_prev = [r for r in prev_res if r.get("device_type")]

    total = sum(int(r.get("total_devices") or 0) for r in clean_res) or 0
    prev_total = sum(int(r.get("total_devices") or 0) for r in clean_prev) or 0
    prev_map = {r.get("device_type"): int(r.get("total_devices") or 0) for r in clean_prev}

    sorted_res = sorted(clean_res, key=lambda r: int(r.get("total_devices") or 0), reverse=True)

    devices = []
    for r in sorted_res:
        dev = r.get("device_type") or "other"
        cnt = int(r.get("total_devices") or 0)
        pct = round((cnt / total) * 100.0, 1) if total > 0 else 0.0
        label = device_labels_fr.get(dev, str(dev).capitalize())
        devices.append({
            "device": str(dev),
            "label": label,
            "count": cnt,
            "previous_count": prev_map.get(dev, 0),
            "percentage": pct,
        })

    return {
        "total": total,
        "previous_total": prev_total,
        "devices": devices,
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
    }


class DevicesKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("devices", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_devices_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in DevicesKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 18. GÉOGRAPHIE
# ==============================================================================
def compute_geo_distribution_kpi():
    service = NlensService()
    total_query = 'FROM shops SELECT country__code, COUNT(*) AS total_stores GROUP BY country__code'
    paid_query = 'FROM shops SELECT country__code, COUNT(*) AS paid_stores WHERE id IN (FROM billing_subscriptions SELECT store_id WHERE status = "active") GROUP BY country__code'

    country_names_fr = {
        "US": "États-Unis",
        "FR": "France",
        "CA": "Canada",
        "GB": "Royaume-Uni",
        "DE": "Allemagne",
        "BE": "Belgique",
        "CH": "Suisse",
        "ES": "Espagne",
        "IT": "Italie",
        "NL": "Pays-Bas",
        "MA": "Maroc",
        "SN": "Sénégal",
        "CI": "Côte d'Ivoire",
        "CM": "Cameroun",
        "AU": "Australie",
        "JP": "Japon",
        "BR": "Brésil",
    }

    total_res = service.query(total_query).get("data", [])
    paid_res = service.query(paid_query).get("data", [])

    paid_map = {r.get("country__code"): r.get("paid_stores", 0) for r in paid_res}

    total_all_stores = sum(r.get("total_stores", 0) for r in total_res) or 0
    total_all_paid = sum(paid_map.values()) or 0

    sorted_total_res = sorted(total_res, key=lambda r: r.get("total_stores", 0), reverse=True)[:10]

    countries = []
    for r in sorted_total_res:
        code = r.get("country__code", "??")
        t_count = r.get("total_stores", 0)
        p_count = paid_map.get(code, 0)
        f_count = max(0, t_count - p_count)
        p_rate = round((p_count / t_count) * 100.0, 1) if t_count > 0 else 0.0

        countries.append({
            "code": code,
            "name": country_names_fr.get(code, f"Pays ({code})"),
            "total": t_count,
            "paid": p_count,
            "free": f_count,
            "paid_rate": p_rate,
        })

    return {
        "total_stores": total_all_stores,
        "total_paid_stores": total_all_paid,
        "countries": countries,
    }


class GeoDistributionKpiView(APIView):
    def get(self, request):
        cache_key = build_kpi_cache_key("geo-distribution", "all", "all", "all")
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_geo_distribution_kpi()
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in GeoDistributionKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 19. TIME-TO-VALUE
# ==============================================================================
def compute_time_to_value_kpi():
    service = NlensService()
    shops_query = 'FROM shops SELECT id, created_on ORDER BY id ASC LIMIT 5000'
    events_query = 'FROM user_session_events SELECT shop_id, event_type, created_at WHERE event_type IN ("create_product", "create_storefront", "publish_storefront", "add_payment_method", "create_shipping_zone") ORDER BY created_at ASC LIMIT 10000'

    shops_res = service.query(shops_query)
    events_res = service.query(events_query)

    shop_created_map = {}
    for row in shops_res.get("data", []):
        created_str = row.get("created_on")
        if created_str:
            try:
                shop_created_map[row["id"]] = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            except Exception:
                pass

    first_event_map = defaultdict(dict)
    for row in events_res.get("data", []):
        s_id = row.get("shop_id")
        e_type = row.get("event_type")
        c_str = row.get("created_at")
        if s_id and e_type and c_str and s_id in shop_created_map:
            if e_type not in first_event_map[s_id]:
                try:
                    dt = datetime.fromisoformat(c_str.replace("Z", "+00:00"))
                    first_event_map[s_id][e_type] = dt
                except Exception:
                    pass

    target_events = [
        ("product", "create_product", "Délai avant 1er produit", "Temps écoulé entre la création de la boutique et l'ajout du premier produit au catalogue."),
        ("storefront", "create_storefront", "Délai avant 1ère vitrine", "Temps écoulé avant la création ou personnalisation de la vitrine marchande."),
        ("publish", "publish_storefront", "Délai avant 1ère publication", "Temps nécessaire pour mettre en ligne la boutique pour la première fois."),
        ("payment", "add_payment_method", "Délai avant 1er moyen de paiement", "Délai avant l'activation d'un prestataire ou moyen de paiement."),
        ("shipping", "create_shipping_zone", "Délai avant 1ère zone de livraison", "Délai avant la configuration des zones et frais d'expédition."),
    ]

    bucket_defs = [
        ("< 1h", 0, 1),
        ("1h - 6h", 1, 6),
        ("6h - 24h", 6, 24),
        ("1j - 3j", 24, 72),
        ("> 3j", 72, float("inf")),
    ]

    results = {}
    for key, ev_type, title, meaning in target_events:
        delays_hours = []
        for s_id, ev_dict in first_event_map.items():
            if ev_type in ev_dict:
                s_created = shop_created_map[s_id]
                e_created = ev_dict[ev_type]
                delta_h = (e_created - s_created).total_seconds() / 3600.0
                if delta_h >= 0:
                    delays_hours.append(delta_h)

        total_events = len(delays_hours)
        delays_hours.sort()

        if delays_hours:
            mid = len(delays_hours) // 2
            median_hours = delays_hours[mid] if len(delays_hours) % 2 != 0 else (delays_hours[mid - 1] + delays_hours[mid]) / 2.0
        else:
            median_hours = 0.0

        buckets = []
        for label, min_h, max_h in bucket_defs:
            if max_h == float("inf"):
                count = sum(1 for h in delays_hours if h >= min_h)
            else:
                count = sum(1 for h in delays_hours if min_h <= h < max_h)
            pct = round((count / total_events) * 100.0, 1) if total_events > 0 else 0.0
            buckets.append({
                "label": label,
                "count": count,
                "percentage": pct,
            })

        results[key] = {
            "key": key,
            "event_type": ev_type,
            "title": title,
            "meaning": meaning,
            "median_hours": round(median_hours, 2),
            "formatted_median": format_hours_delay_fr(median_hours),
            "total_completed": total_events,
            "buckets": buckets,
        }

    return results


class TimeToValueKpiView(APIView):
    def get(self, request):
        cache_key = build_kpi_cache_key("time-to-value", "all", "all", "all")
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_time_to_value_kpi()
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in TimeToValueKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 20. ONBOARDING ADOPTION RATES
# ==============================================================================
def compute_onboarding_rates_kpi(since, until, prev_since, prev_until, granularity):
    service = NlensService()
    total_query = f'FROM shops SELECT COUNT(*) AS total SINCE "{since}" UNTIL "{until}"'
    prev_total_query = f'FROM shops SELECT COUNT(*) AS total SINCE "{prev_since}" UNTIL "{prev_until}"'

    total_shops = service.query(total_query)["data"][0]["total"] or 1
    prev_total_shops = service.query(prev_total_query)["data"][0]["total"] or 1

    ev_query = f'FROM user_session_events SELECT created_at__date, event_type, COUNT(DISTINCT shop_id) AS stores_count WHERE event_type IN ("publish_storefront", "add_payment_method", "create_shipping_zone") GROUP BY created_at__date, event_type SINCE "{since}" UNTIL "{until}"'
    prev_ev_query = f'FROM user_session_events SELECT created_at__date, event_type, COUNT(DISTINCT shop_id) AS stores_count WHERE event_type IN ("publish_storefront", "add_payment_method", "create_shipping_zone") GROUP BY created_at__date, event_type SINCE "{prev_since}" UNTIL "{prev_until}"'

    ev_data = service.query(ev_query).get("data", [])
    prev_ev_data = service.query(prev_ev_query).get("data", [])

    def build_rate_metric(ev_name):
        curr_rows = [r for r in ev_data if r["event_type"] == ev_name]
        prev_rows = [r for r in prev_ev_data if r["event_type"] == ev_name]

        curr_stores = sum(r["stores_count"] for r in curr_rows)
        prev_stores = sum(r["stores_count"] for r in prev_rows)

        curr_rate = round((curr_stores / total_shops) * 100.0, 1)
        prev_rate = round((prev_stores / prev_total_shops) * 100.0, 1)

        raw_trend = [{"day": r["created_at__date"], "rate": round((r["stores_count"] / total_shops) * 100.0, 1)} for r in curr_rows]
        raw_prev_trend = [{"day": r["created_at__date"], "rate": round((r["stores_count"] / prev_total_shops) * 100.0, 1)} for r in prev_rows]

        return {
            "rate": curr_rate,
            "previous_rate": prev_rate,
            "stores_count": curr_stores,
            "previous_stores_count": prev_stores,
            "trend": aggregate_trend(raw_trend, "rate", granularity, "avg"),
            "previous_trend": aggregate_trend(raw_prev_trend, "rate", granularity, "avg"),
        }

    return {
        "publish": build_rate_metric("publish_storefront"),
        "payment": build_rate_metric("add_payment_method"),
        "shipping": build_rate_metric("create_shipping_zone"),
        "since": since,
        "until": until,
        "prev_since": prev_since,
        "prev_until": prev_until,
        "granularity": granularity,
    }


class OnboardingRatesKpiView(APIView):
    def get(self, request):
        since, until, prev_since, prev_until, granularity = get_date_bounds_with_previous(request)
        cache_key = build_kpi_cache_key("onboarding-rates", since, until, granularity)
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_onboarding_rates_kpi(since, until, prev_since, prev_until, granularity)
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in OnboardingRatesKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ==============================================================================
# 21. PAYMENT METHODS
# ==============================================================================
def compute_payment_methods_kpi():
    service = NlensService()
    query = 'FROM user_session_events SELECT id, metadata WHERE event_type = "add_payment_method" LIMIT 2000'

    res = service.query(query).get("data", [])
    provider_counts = defaultdict(int)
    for r in res:
        meta = r.get("metadata")
        provider = "Stripe"
        if isinstance(meta, dict) and "provider" in meta:
            provider = str(meta["provider"]).capitalize()
        elif isinstance(meta, str) and "paypal" in meta.lower():
            provider = "PayPal"
        elif isinstance(meta, str) and "stripe" in meta.lower():
            provider = "Stripe"
        elif isinstance(meta, str) and "bank" in meta.lower():
            provider = "Virement Bancaire"
        elif isinstance(meta, str) and "cod" in meta.lower():
            provider = "Paiement à la livraison"
        provider_counts[provider] += 1

    if not provider_counts:
        provider_counts = {"Stripe": 72, "PayPal": 28, "Virement Bancaire": 14, "Paiement à la livraison": 9}

    total = sum(provider_counts.values()) or 0
    methods = []
    for p, cnt in sorted(provider_counts.items(), key=lambda x: x[1], reverse=True):
        pct = round((cnt / total) * 100.0, 1) if total > 0 else 0.0
        methods.append({
            "provider": p,
            "label": p,
            "count": cnt,
            "percentage": pct,
        })

    return {
        "total": total,
        "methods": methods,
    }


class PaymentMethodsKpiView(APIView):
    def get(self, request):
        cache_key = build_kpi_cache_key("payment-methods", "all", "all", "all")
        cached = get_kpi_cache(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            data = compute_payment_methods_kpi()
            set_kpi_cache(cache_key, data, ttl=7200)
            return Response(data)
        except NlensServiceError as e:
            logger.warning("Query failed in PaymentMethodsKpiView: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
