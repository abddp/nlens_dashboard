import logging
import time
from datetime import date, timedelta
from celery import shared_task
from .services import (
    build_kpi_cache_key,
    set_kpi_cache,
)
from .api_views import (
    compute_signups_kpi,
    compute_created_shops_kpi,
    compute_paying_stores_kpi,
    compute_paying_users_kpi,
    compute_sessions_kpi,
    compute_mrr_kpi,
    compute_active_users_kpi,
    compute_active_stores_kpi,
    compute_activation_kpi,
    compute_churn_kpi,
    compute_retention_kpi,
    compute_recent_transactions,
    compute_feedbacks_kpi,
    compute_time_spent_kpi,
    compute_ai_usage_kpi,
    compute_ai_categories_kpi,
    compute_top_pages_kpi,
    compute_business_models_kpi,
    compute_devices_kpi,
    compute_geo_distribution_kpi,
    compute_time_to_value_kpi,
    compute_onboarding_rates_kpi,
)

logger = logging.getLogger(__name__)


def get_standard_periods():
    today = date.today()
    periods = []

    # 1. 7 Days
    start_7d = today - timedelta(days=7)
    duration_7d = 8
    prev_end_7d = start_7d - timedelta(days=1)
    prev_start_7d = prev_end_7d - timedelta(days=duration_7d - 1)
    periods.append({
        "name": "7d",
        "since": start_7d.strftime("%Y-%m-%d"),
        "until": today.strftime("%Y-%m-%d"),
        "prev_since": prev_start_7d.strftime("%Y-%m-%d"),
        "prev_until": prev_end_7d.strftime("%Y-%m-%d"),
        "granularity": "day",
    })

    # 2. 30 Days (Default)
    start_30d = today - timedelta(days=30)
    duration_30d = 31
    prev_end_30d = start_30d - timedelta(days=1)
    prev_start_30d = prev_end_30d - timedelta(days=duration_30d - 1)
    periods.append({
        "name": "30d",
        "since": start_30d.strftime("%Y-%m-%d"),
        "until": today.strftime("%Y-%m-%d"),
        "prev_since": prev_start_30d.strftime("%Y-%m-%d"),
        "prev_until": prev_end_30d.strftime("%Y-%m-%d"),
        "granularity": "day",
    })

    # 3. Current Month
    start_month = today.replace(day=1)
    duration_month = (today - start_month).days + 1
    prev_end_month = start_month - timedelta(days=1)
    prev_start_month = prev_end_month - timedelta(days=duration_month - 1)
    periods.append({
        "name": "month",
        "since": start_month.strftime("%Y-%m-%d"),
        "until": today.strftime("%Y-%m-%d"),
        "prev_since": prev_start_month.strftime("%Y-%m-%d"),
        "prev_until": prev_end_month.strftime("%Y-%m-%d"),
        "granularity": "day",
    })

    # 4. Current Year
    start_year = today.replace(month=1, day=1)
    duration_year = (today - start_year).days + 1
    prev_end_year = start_year - timedelta(days=1)
    prev_start_year = prev_end_year - timedelta(days=duration_year - 1)
    periods.append({
        "name": "year",
        "since": start_year.strftime("%Y-%m-%d"),
        "until": today.strftime("%Y-%m-%d"),
        "prev_since": prev_start_year.strftime("%Y-%m-%d"),
        "prev_until": prev_end_year.strftime("%Y-%m-%d"),
        "granularity": "month" if duration_year > 60 else "day",
    })

    return periods


@shared_task(name="main.tasks.sync_all_kpis_task")
def sync_all_kpis_task():
    start_time = time.time()
    logger.info("Celery Beat: Starting periodic KPI cache sync (1h schedule)...")
    periods = get_standard_periods()
    synced_count = 0

    kpi_computations = [
        ("signups", compute_signups_kpi),
        ("created-shops", compute_created_shops_kpi),
        ("paying-stores", compute_paying_stores_kpi),
        ("paying-users", compute_paying_users_kpi),
        ("sessions", compute_sessions_kpi),
        ("mrr", compute_mrr_kpi),
        ("active-users", compute_active_users_kpi),
        ("active-stores", compute_active_stores_kpi),
        ("activation", compute_activation_kpi),
        ("churn", compute_churn_kpi),
        ("feedbacks", compute_feedbacks_kpi),
        ("time-spent", compute_time_spent_kpi),
        ("ai-usage", compute_ai_usage_kpi),
        ("ai-categories", compute_ai_categories_kpi),
        ("top-pages", compute_top_pages_kpi),
        ("devices", compute_devices_kpi),
        ("onboarding-rates", compute_onboarding_rates_kpi),
    ]

    # 1. Synchronize period-based KPIs
    for p in periods:
        s, u, ps, pu, g = p["since"], p["until"], p["prev_since"], p["prev_until"], p["granularity"]
        for name, func in kpi_computations:
            try:
                data = func(s, u, ps, pu, g)
                cache_key = build_kpi_cache_key(name, s, u, g)
                set_kpi_cache(cache_key, data, ttl=7200)
                synced_count += 1
            except Exception as e:
                logger.error("Error pre-caching KPI '%s' for period %s: %s", name, p["name"], e)

        # Also pre-cache period-aware global modules (business models, geo distribution, ttv)
        period_aware_globals = [
            ("business-models", compute_business_models_kpi),
            ("geo-distribution", compute_geo_distribution_kpi),
            ("time-to-value", compute_time_to_value_kpi),
        ]
        for name, func in period_aware_globals:
            try:
                data = func(s, u)
                cache_key = build_kpi_cache_key(name, s, u, g)
                set_kpi_cache(cache_key, data, ttl=7200)
                synced_count += 1
            except Exception as e:
                logger.error("Error pre-caching module '%s' for period %s: %s", name, p["name"], e)

    # 2. Synchronize non-period / global KPIs
    global_computations = [
        ("retention", compute_retention_kpi),
        ("recent-transactions", compute_recent_transactions),
        ("business-models", compute_business_models_kpi),
        ("geo-distribution", compute_geo_distribution_kpi),
        ("time-to-value", compute_time_to_value_kpi),
    ]

    for name, func in global_computations:
        try:
            data = func()
            cache_key = build_kpi_cache_key(name, "all", "all", "all")
            set_kpi_cache(cache_key, data, ttl=7200)
            synced_count += 1
        except Exception as e:
            logger.error("Error pre-caching global KPI '%s': %s", name, e)

    duration = round(time.time() - start_time, 2)
    logger.info("Celery Beat: KPI cache sync completed successfully in %s seconds. Total metrics cached: %d", duration, synced_count)
    return {"synced_count": synced_count, "duration_seconds": duration}
