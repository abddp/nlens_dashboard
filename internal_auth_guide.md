# Nealens Internal Services Authentication Guide

This guide describes how internal satellite applications (such as `nlens_dashboard` and other internal tools) authenticate users and communicate with the Nealens backend API.

---

## 1. Overview & Architecture

Internal services use a **stateless, dual-layer authentication model**:

1. **Service-Level Authentication**: The calling application proves its identity using a private service key via the `X-Internal-Service-Key` HTTP header.
2. **User-Level Authentication**: Individual team members log in using their Nealens email and password, receiving a **JSON Web Token (JWT)** containing their verified identity and role.

```
[ Team Member ]
       |
       v  (Enters Email & Password)
[ Client Service (e.g., nlens_dashboard) ]
       |
       |  POST /api/internal/v1/auth/login/
       |  Header: X-Internal-Service-Key: <SERVICE_KEY>
       v
[ Nealens Backend API ]
       |
       |  Verifies service key, credentials, and role
       v
  200 OK + { access, refresh, user: { role } }
```

---

## 2. Common Headers

All HTTP requests to the internal authentication endpoints **MUST** include:

| Header | Value | Description |
| :--- | :--- | :--- |
| `X-Internal-Service-Key` | `<YOUR_SERVICE_KEY>` | The shared secret key identifying your service. |
| `Content-Type` | `application/json` | Required for all POST requests. |

> [!CAUTION]
> Never expose your `X-Internal-Service-Key` in public client-side browser code. Calls to this endpoint should originate from your service backend or a secure server-side proxy.

---

## 3. API Endpoints Reference

### 3.1. User Login

Authenticates a team member, verifies their role, and issues access and refresh tokens.

- **Method**: `POST`
- **Path**: `/api/internal/v1/auth/login/`

#### Request Body
```json
{
  "email": "alex@nealens.com",
  "password": "your_secure_password"
}
```

#### Success Response (`200 OK`)
```json
{
  "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "alex@nealens.com",
    "first_name": "Alex",
    "last_name": "Dev",
    "nlens_team_member": true,
    "nlens_user_role": "nealens_admin"
  }
}
```

#### Error Responses
| Status Code | Response Body | Reason |
| :--- | :--- | :--- |
| `400 Bad Request` | `{"error": "Email and password are required."}` | Missing fields in request payload. |
| `401 Unauthorized` | `{"error": "Invalid email or password."}` | Incorrect credentials. |
| `403 Forbidden` | `{"error": "Access non autorisé : clé de service interne manquante ou invalide."}` | Missing or incorrect `X-Internal-Service-Key`. |
| `403 Forbidden` | `{"error": "Access denied: user is not an internal team member."}` | User has `nlens_team_member = false`. |
| `403 Forbidden` | `{"error": "Access denied: valid role required for internal services."}` | User does not have an authorized role. |

---

### 3.2. Refresh Token

Renews an expired access token without prompting the user to re-enter their credentials.

- **Method**: `POST`
- **Path**: `/api/internal/v1/auth/refresh/`

#### Request Body
```json
{
  "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Success Response (`200 OK`)
```json
{
  "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Error Responses
| Status Code | Response Body | Reason |
| :--- | :--- | :--- |
| `400 Bad Request` | `{"error": "Refresh token is required."}` | Missing `refresh` field in payload. |
| `401 Unauthorized` | `{"error": "Invalid or expired refresh token."}` | Malformed, expired, or invalid token. |
| `401 Unauthorized` | `{"error": "Token has been revoked."}` | Token version mismatch (revoked account). |
| `403 Forbidden` | `{"error": "User account is inactive or no longer authorized."}` | User has been deactivated. |

---

### 3.3. Logout (Token Revocation)

Invalidates the refresh token on the server side by placing it on a permanent blacklist.

- **Method**: `POST`
- **Path**: `/api/internal/v1/auth/logout/`

#### Request Body
```json
{
  "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Success Response (`200 OK`)
```json
{
  "detail": "Successfully logged out."
}
```

---

## 4. JWT Token Payload & Roles

### 4.1. Token Payload Claims
The `access` token is a standard RFC 7519 JSON Web Token. Decoding the token payload provides the following claims:

```json
{
  "token_type": "access",
  "exp": 1727100000,
  "iat": 1727013600,
  "jti": "a1b2c3d4e5...",
  "user_id": 1,
  "token_version": 1,
  "nlens_team_member": true,
  "nlens_user_role": "nealens_admin"
}
```

### 4.2. Available Roles (`nlens_user_role`)
Your application should inspect `nlens_user_role` to enforce UI and permission boundaries:

| Role Code | Display Name | Permissions |
| :--- | :--- | :--- |
| `nealens_admin` | **Nealens Admin** | Full access to all dashboard charts, metrics, sensitive financial data, and configurations. |
| `nealens_viewer` | **Nealens Viewer** | Read-only access to high-level dashboard charts and reports. |

---

## 5. Client Integration Best Practices

### 1. Instant Page Navigation (Zero Network Overhead)
Do **not** perform an API request on every page change or page reload (F5).
- Store the `access` token in secure client-side storage (e.g., memory, secure cookie, or sessionStorage).
- Decode the JWT locally in **0 ms** to display the user's name and role in the interface.

### 2. Lifespan & Token Refresh
- **Access Token**: Valid for **24 hours**.
- **Refresh Token**: Valid for **14 days**.
- Set up a timer or an HTTP client interceptor (e.g., in Axios or Fetch) to call `POST /api/internal/v1/auth/refresh/` before the access token expires.

### 3. Logout Flow
When a user clicks "Log out":
1. Call `POST /api/internal/v1/auth/logout/` with the refresh token to blacklist it on the server.
2. Clear all tokens from local client storage.
3. Redirect the user to your login screen.

---

## 6. Code Examples

### JavaScript / TypeScript Example (Node.js / Client Backend)

```javascript
const BACKEND_URL = "https://your-nealens-backend.com";
const SERVICE_KEY = process.env.NLENS_INTERNAL_API_KEY;

// 1. User Login
async function loginUser(email, password) {
  const response = await fetch(`${BACKEND_URL}/api/internal/v1/auth/login/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": SERVICE_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Login failed");
  }

  return await response.json(); // Returns { access, refresh, user }
}

// 2. Refresh Token
async function refreshAccessToken(refreshToken) {
  const response = await fetch(`${BACKEND_URL}/api/internal/v1/auth/refresh/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": SERVICE_KEY,
    },
    body: JSON.stringify({ refresh: refreshToken }),
  });

  if (!response.ok) {
    throw new Error("Session expired. Please log in again.");
  }

  const data = await response.json();
  return data.access; // Returns new access token
}

// 3. Logout
async function logoutUser(refreshToken) {
  await fetch(`${BACKEND_URL}/api/internal/v1/auth/logout/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": SERVICE_KEY,
    },
    body: JSON.stringify({ refresh: refreshToken }),
  });
}
```

### Python Example (`httpx` / `requests`)

```python
import httpx

BACKEND_URL = "https://your-nealens-backend.com"
SERVICE_KEY = "your_service_key_here"

headers = {
    "Content-Type": "application/json",
    "X-Internal-Service-Key": SERVICE_KEY,
}

# 1. Login
def login(email: str, password: str) -> dict:
    url = f"{BACKEND_URL}/api/internal/v1/auth/login/"
    payload = {"email": email, "password": password}
    response = httpx.post(url, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()

# 2. Refresh
def refresh(refresh_token: str) -> str:
    url = f"{BACKEND_URL}/api/internal/v1/auth/refresh/"
    payload = {"refresh": refresh_token}
    response = httpx.post(url, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()["access"]

# 3. Logout
def logout(refresh_token: str) -> None:
    url = f"{BACKEND_URL}/api/internal/v1/auth/logout/"
    payload = {"refresh": refresh_token}
    httpx.post(url, json=payload, headers=headers)
```
