from django.shortcuts import render, redirect


def login_view(request):
    if request.session.get("user"):
        return redirect("home")
    next_url = request.GET.get("next", "/")
    return render(request, "login.html", {"next": next_url})


def home(request):
    return render(request, "index.html", {"active_page": "overview"})


def finance(request):
    return render(request, "finance.html", {"active_page": "finance"})


def engagement(request):
    return render(request, "engagement.html", {"active_page": "engagement"})


def ai_analytics(request):
    return render(request, "ai.html", {"active_page": "ai"})


def audience(request):
    return render(request, "audience.html", {"active_page": "audience"})


def onboarding(request):
    return render(request, "onboarding.html", {"active_page": "onboarding"})