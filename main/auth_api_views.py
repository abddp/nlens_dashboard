import logging
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from .services import AuthService, AuthServiceError

logger = logging.getLogger(__name__)


class AuthLoginApiView(APIView):
    def post(self, request):
        email = request.data.get("email", "").strip()
        password = request.data.get("password", "").strip()
        next_url = request.data.get("next", "").strip() or "/"

        if not email or not password:
            return Response(
                {"success": False, "error": "Please enter both your email and password."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        auth_service = AuthService()
        try:
            auth_data = auth_service.login(email=email, password=password)
            request.session["access_token"] = auth_data["access"]
            request.session["refresh_token"] = auth_data["refresh"]
            request.session["user"] = auth_data["user"]
            request.session.set_expiry(14 * 86400)

            return Response({
                "success": True,
                "user": auth_data["user"],
                "redirect_url": next_url,
            })
        except AuthServiceError as e:
            return Response({"success": False, "error": e.message}, status=e.status_code)
        except Exception as e:
            logger.error("Unexpected error during login: %s", e)
            return Response(
                {"success": False, "error": "An unexpected error occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class AuthLogoutApiView(APIView):
    def post(self, request):
        refresh_token = request.session.get("refresh_token")
        if refresh_token:
            try:
                AuthService().logout(refresh_token)
            except AuthServiceError as e:
                logger.warning("Failed to revoke refresh token on central server: %s", e)

        request.session.flush()
        return Response({"success": True, "redirect_url": "/login/"})


class AuthMeApiView(APIView):
    def get(self, request):
        user = request.session.get("user")
        if not user:
            return Response({"authenticated": False}, status=status.HTTP_401_UNAUTHORIZED)
        return Response({"authenticated": True, "user": user})
