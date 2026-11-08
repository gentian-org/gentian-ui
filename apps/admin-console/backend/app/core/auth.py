# SPDX-License-Identifier: Apache-2.0
"""Who the caller is, for this app's settings: gentian_app_runtime.auth answers."""

from gentian_app_runtime.auth import bearer_of, current_user

from app.core.config import get_settings

get_current_user = current_user(get_settings)

__all__ = ["bearer_of", "get_current_user"]
