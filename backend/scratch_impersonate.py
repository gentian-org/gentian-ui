import httpx
from app.core.config import Settings
from app.services.keycloak_user_groups import _fetch_admin_token

settings = Settings()
print("Fetching admin token...")
admin_token = _fetch_admin_token(settings)
print(f"Admin token fetched: {admin_token[:20]}...")

base = settings.keycloak_admin_url.rstrip("/")
# Let's get a user ID first
realm = "demo"
users_url = f"{base}/admin/realms/{realm}/users"
headers = {"Authorization": f"Bearer {admin_token}"}
r = httpx.get(users_url, headers=headers)
users = r.json()
print(f"Found users: {[u['username'] for u in users]}")

# Pick the first user
user = users[0]
user_id = user["id"]
username = user["username"]
print(f"Impersonating user {username} ({user_id})...")

url = f"{base}/admin/realms/{realm}/users/{user_id}/impersonation"
response = httpx.post(url, headers=headers)
print(f"Status code: {response.status_code}")
print("Response headers:")
for k, v in response.headers.items():
    print(f"  {k}: {v}")
print("Response JSON:")
print(response.json())
