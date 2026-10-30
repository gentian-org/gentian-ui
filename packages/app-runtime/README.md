# gentian-app-runtime

What the platform's apps share, so that a fix is made once: token verification
(`auth`), tenant scoping (`tenant`), the origin check (`origin_check`), security
headers (`security_headers`), config drop-ins (`dropins`) and extensions
(`extensions`).

```python
from gentian_app_runtime.auth import current_user

get_current_user = current_user(get_settings)
```

`auth` reads the app's Settings through the protocol `AuthSettings`. An app has
to say who may reach plugin routes and `/extensions`: `dependencies` has no
default.
