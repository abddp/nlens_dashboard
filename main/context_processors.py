def auth_context(request):
    user = request.session.get("user")
    initials = ""
    if user:
        first = user.get("first_name", "").strip()
        last = user.get("last_name", "").strip()
        if first and last:
            initials = f"{first[0]}{last[0]}".upper()
        elif first:
            initials = first[:2].upper()
        elif user.get("email"):
            initials = user["email"][:2].upper()

    return {
        "current_user": user,
        "user_initials": initials,
    }
