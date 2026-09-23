from django.urls import path
from .views import (
    robots_txt,
    login_view,
    home,
    finance,
    engagement,
    ai_analytics,
    audience,
    onboarding,
)
from .auth_api_views import (
    AuthLoginApiView,
    AuthLogoutApiView,
    AuthMeApiView,
)
from .api_views import (
    SignupsKpiView,
    CreatedShopsKpiView,
    PayingStoresKpiView,
    PayingUsersKpiView,
    SessionsKpiView,
    MrrKpiView,
    ActiveUsersKpiView,
    ActiveStoresKpiView,
    ActivationKpiView,
    ChurnKpiView,
    RetentionKpiView,
    RecentTransactionsView,
    FeedbacksKpiView,
    TimeSpentKpiView,
    AiUsageKpiView,
    AiCategoriesKpiView,
    TopPagesKpiView,
    BusinessModelsKpiView,
    DevicesKpiView,
    GeoDistributionKpiView,
    TimeToValueKpiView,
    OnboardingRatesKpiView,
)

urlpatterns = [
    # SEO / Crawlers disallow
    path("robots.txt", robots_txt, name="robots-txt"),

    # Auth & Pages HTML
    path("login/", login_view, name="login"),
    path("", home, name="home"),
    path("finance/", finance, name="finance"),
    path("engagement/", engagement, name="engagement"),
    path("ai/", ai_analytics, name="ai"),
    path("audience/", audience, name="audience"),
    path("onboarding/", onboarding, name="onboarding"),

    # Auth REST API
    path("api/auth/login/", AuthLoginApiView.as_view(), name="api-auth-login"),
    path("api/auth/logout/", AuthLogoutApiView.as_view(), name="api-auth-logout"),
    path("api/auth/me/", AuthMeApiView.as_view(), name="api-auth-me"),

    # KPIs API
    path("api/kpis/signups/", SignupsKpiView.as_view(), name="kpi-signups"),
    path("api/kpis/created-shops/", CreatedShopsKpiView.as_view(), name="kpi-created-shops"),
    path("api/kpis/paying-stores/", PayingStoresKpiView.as_view(), name="kpi-paying-stores"),
    path("api/kpis/paying-users/", PayingUsersKpiView.as_view(), name="kpi-paying-users"),
    path("api/kpis/sessions/", SessionsKpiView.as_view(), name="kpi-sessions"),
    path("api/kpis/mrr/", MrrKpiView.as_view(), name="kpi-mrr"),
    path("api/kpis/active-users/", ActiveUsersKpiView.as_view(), name="kpi-active-users"),
    path("api/kpis/active-stores/", ActiveStoresKpiView.as_view(), name="kpi-active-stores"),
    path("api/kpis/activation/", ActivationKpiView.as_view(), name="kpi-activation"),
    path("api/kpis/churn/", ChurnKpiView.as_view(), name="kpi-churn"),
    path("api/kpis/retention/", RetentionKpiView.as_view(), name="kpi-retention"),
    path("api/kpis/recent-transactions/", RecentTransactionsView.as_view(), name="kpi-recent-transactions"),
    path("api/kpis/feedbacks/", FeedbacksKpiView.as_view(), name="kpi-feedbacks"),
    path("api/kpis/time-spent/", TimeSpentKpiView.as_view(), name="kpi-time-spent"),
    path("api/kpis/ai-usage/", AiUsageKpiView.as_view(), name="kpi-ai-usage"),
    path("api/kpis/ai-categories/", AiCategoriesKpiView.as_view(), name="kpi-ai-categories"),
    path("api/kpis/top-pages/", TopPagesKpiView.as_view(), name="kpi-top-pages"),
    path("api/kpis/business-models/", BusinessModelsKpiView.as_view(), name="kpi-business-models"),
    path("api/kpis/devices/", DevicesKpiView.as_view(), name="kpi-devices"),
    path("api/kpis/geo-distribution/", GeoDistributionKpiView.as_view(), name="kpi-geo-distribution"),
    path("api/kpis/time-to-value/", TimeToValueKpiView.as_view(), name="kpi-time-to-value"),
    path("api/kpis/onboarding-rates/", OnboardingRatesKpiView.as_view(), name="kpi-onboarding-rates"),
]