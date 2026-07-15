import asyncio
from app.core.config import Settings
from app.core.shell_apps import shell_apps_for_user

async def main():
    settings = Settings()
    user = {
        "tenant": "demo",
        "groups": ["gentian:tenant:demo:admins"],
    }
    apps = await shell_apps_for_user(user, settings)
    print("Found apps:")
    for app in apps:
        print(f"  - ID: {app['id']}, Title: {app['title']}, URL: {app['launchUrl']}")

if __name__ == "__main__":
    asyncio.run(main())
