"""Keycloak Admin REST API client for tenant realm user/group management."""

from __future__ import annotations

import time
import uuid
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from app.services.admin_store import CONFIGURE_TOTP_ACTION, INVITE_EMAIL_ATTR, PROFILE_PROMPT_ACTIONS, UPDATE_PASSWORD_ACTION, Group, Member, UserSession



def _attribute_is_true(value: Any) -> bool:
    """Keycloak stores every group attribute as a list of strings."""
    if isinstance(value, list):
        return any(str(v).strip().lower() == "true" for v in value)
    return str(value or "").strip().lower() == "true"


class KeycloakAdminStore:
    def __init__(
        self,
        *,
        base_url: str,
        username: str,
        password: str,
        portal_client_id: str = "gentian-portal",
        portal_login_url: str = "https://portal.gentian.local/login",
        idp_public_host: str | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._username = username
        self._password = password
        self._portal_client_id = portal_client_id
        self._portal_login_url = portal_login_url
        self._idp_public_host = idp_public_host
        self._token = ""
        self._token_expiry = 0.0
        self._client = httpx.AsyncClient(timeout=30.0)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def list_members(self, realm: str) -> list[Member]:
        raw = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}/users", params={"max": "1000"})
        members: list[Member] = []
        for item in raw:
            member = self._member_from_raw(item)
            member.groups = [g["name"] for g in await self._list_user_groups(realm, member.id)]
            await self._apply_totp_status(realm, member.id, member, item)
            members.append(member)
        return sorted(members, key=lambda m: (m.username or "").lower())

    async def get_member(self, realm: str, member_id: str) -> Member:
        raw = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}/users/{member_id}")
        member = self._member_from_raw(raw)
        member.groups = [g["name"] for g in await self._list_user_groups(realm, member_id)]
        await self._apply_totp_status(realm, member_id, member, raw)
        return member

    async def create_member(
        self,
        realm: str,
        *,
        username: str,
        email: str,
        first_name: str | None,
        last_name: str | None,
        enabled: bool,
    ) -> Member:
        localpart = username.split("@", 1)[0]
        body = {
            "username": username,
            # The recovery address when there is one, not the workspace address.
            # Keycloak mails this field, and it is where the address has to stay:
            # the attribute below is a mirror for the admin console, not a store
            # that can be trusted to keep anything.
            "email": delivery_email or email,
            "firstName": first_name or "",
            "lastName": last_name or "",
            "enabled": enabled,
            "emailVerified": False,
            "attributes": {"uid": [localpart]},
        }
        response = await self._raw_request(
            "POST",
            f"/admin/realms/{quote(realm, safe='')}/users",
            json=body,
        )
        if response.status_code not in {201, 204}:
            await self._raise_for_status(response)
        location = response.headers.get("location", "")
        member_id = location.rstrip("/").split("/")[-1] if location else ""
        if not member_id:
            users = await self._request(
                "GET",
                f"/admin/realms/{quote(realm, safe='')}/users",
                params={"username": username, "exact": "true"},
            )
            if not users:
                raise HTTPException(status_code=500, detail="Created user not found")
            member_id = users[0]["id"]
        return await self.get_member(realm, member_id)

    async def invite_member(
        self,
        realm: str,
        *,
        username: str,
        email: str,
        first_name: str | None,
        last_name: str | None,
        invite_email: str | None,
        group_ids: list[str],
        require_totp: bool = False,
    ) -> Member:
        await self._assert_realm_smtp_configured(realm)
        localpart = username.split("@", 1)[0]
        attributes: dict[str, list[str]] = {"uid": [localpart]}
        delivery_email = (invite_email or email).strip()
        if invite_email and invite_email.strip().lower() != email.strip().lower():
            attributes[INVITE_EMAIL_ATTR] = [invite_email.strip()]
        actions = [UPDATE_PASSWORD_ACTION]
        if require_totp:
            actions.append(CONFIGURE_TOTP_ACTION)
        body = {
            "username": username,
            "email": email,
            "firstName": first_name or "",
            "lastName": last_name or "",
            "enabled": True,
            "emailVerified": True,
            "attributes": attributes,
            "requiredActions": actions,
        }
        response = await self._raw_request(
            "POST",
            f"/admin/realms/{quote(realm, safe='')}/users",
            json=body,
        )
        if response.status_code not in {201, 204}:
            await self._raise_for_status(response)
        location = response.headers.get("location", "")
        member_id = location.rstrip("/").split("/")[-1] if location else ""
        if not member_id:
            users = await self._request(
                "GET",
                f"/admin/realms/{quote(realm, safe='')}/users",
                params={"username": username, "exact": "true"},
            )
            if not users:
                raise HTTPException(status_code=500, detail="Created user not found")
            member_id = users[0]["id"]
        try:
            raw_user = await self._request(
                "GET",
                f"/admin/realms/{quote(realm, safe='')}/users/{member_id}",
            )
            await self._set_required_actions(realm, member_id, raw_user, actions)
            if group_ids:
                await self.set_member_groups(realm, member_id, group_ids)
            await self._execute_actions_email(
                realm,
                member_id,
                actions,
                delivery_email=delivery_email,
                require_delivery=True,
            )
        except Exception:
            try:
                await self.delete_member(realm, member_id)
            except HTTPException:
                pass
            raise
        member = await self.get_member(realm, member_id)
        # Read back rather than assume. Every recovery address entered before this
        # was accepted by the API and silently discarded by Keycloak, and the only
        # signal was a password reset months later going to the wrong mailbox.
        if invite_email and not member.invite_email:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "The account was created but the recovery email was not stored. "
                    "A password reset would go to the workspace mailbox. "
                    "Check the realm's user profile, then set the recovery email again."
                ),
            )
        return member

    async def send_password_reset_by_email(self, realm: str, email: str) -> bool:
        """Send password-reset email if a user exists. Returns whether a user was found."""
        normalized = email.strip().lower()
        users = await self._request(
            "GET",
            f"/admin/realms/{quote(realm, safe='')}/users",
            params={"email": normalized, "exact": "true", "max": "1"},
        )
        if not users:
            users = await self._request(
                "GET",
                f"/admin/realms/{quote(realm, safe='')}/users",
                params={"username": normalized, "exact": "true", "max": "1"},
            )
        if not users:
            return False
        await self.send_password_reset(realm, str(users[0]["id"]))
        return True

    async def send_password_reset(self, realm: str, member_id: str) -> str:
        """Invalidate the current password and email a link to set a new one."""
        await self._assert_realm_smtp_configured(realm)
        raw = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}/users/{member_id}")
        delivery = self._delivery_email(raw) or raw.get("email") or raw.get("username") or ""
        await self.revoke_all_member_sessions(realm, member_id)
        await self._invalidate_password(realm, member_id)
        await self._execute_actions_email(
            realm,
            member_id,
            [UPDATE_PASSWORD_ACTION],
            delivery_email=delivery,
            require_delivery=True,
        )
        return delivery

    async def enable_totp(self, realm: str, member_id: str, *, send_email: bool) -> Member:
        raw = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}/users/{member_id}")
        member = self._member_from_raw(raw)
        await self._apply_totp_status(realm, member_id, member, raw)
        if member.totp_configured:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="TOTP is already configured for this member",
            )
        if send_email:
            delivery = self._delivery_email(raw)
            await self._execute_actions_email(
                realm,
                member_id,
                [CONFIGURE_TOTP_ACTION],
                delivery_email=delivery,
            )
        else:
            await self._set_required_action(realm, member_id, raw, CONFIGURE_TOTP_ACTION, add=True)
        return await self.get_member(realm, member_id)

    async def remove_totp(self, realm: str, member_id: str) -> Member:
        raw = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}/users/{member_id}")
        for credential in await self._list_credentials(realm, member_id):
            if credential.get("type") == "otp":
                await self._request(
                    "DELETE",
                    f"/admin/realms/{quote(realm, safe='')}/users/{member_id}/credentials/{credential['id']}",
                )
        await self._set_required_action(realm, member_id, raw, CONFIGURE_TOTP_ACTION, add=False)
        return await self.get_member(realm, member_id)

    async def clear_totp_requirement(self, realm: str, member_id: str) -> None:
        raw = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}/users/{member_id}")
        member = self._member_from_raw(raw)
        await self._apply_totp_status(realm, member_id, member, raw)
        if member.totp_configured:
            return
        await self._set_required_action(realm, member_id, raw, CONFIGURE_TOTP_ACTION, add=False)

    async def update_member(
        self,
        realm: str,
        member_id: str,
        *,
        email: str | None,
        first_name: str | None,
        last_name: str | None,
        enabled: bool | None,
        invite_email: str | None = None,
        invite_email_set: bool = False,
    ) -> Member:
        current = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}/users/{member_id}")
        attributes = dict(current.get("attributes") or {})
        # The recovery address goes in the email FIELD, and the attribute keeps a
        # mirror for whoever reads the Keycloak console. Writing only the
        # attribute is what made the Recovery email box appear to work while
        # Keycloak discarded every value put in it.
        #
        # Cleared, the field falls back to the username — the workspace address —
        # so it never keeps a stale recovery address, and the reset path says
        # plainly that no recovery address is set.
        effective_email = email if email is not None else current.get("email")
        if invite_email_set:
            normalized = (invite_email or "").strip()
            if normalized:
                attributes[INVITE_EMAIL_ATTR] = [normalized]
                effective_email = normalized
            else:
                attributes.pop(INVITE_EMAIL_ATTR, None)
                effective_email = current.get("username")
        body = {
            "username": current.get("username"),
            "email": effective_email,
            "firstName": first_name if first_name is not None else current.get("firstName", ""),
            "lastName": last_name if last_name is not None else current.get("lastName", ""),
            "enabled": enabled if enabled is not None else current.get("enabled", True),
            "attributes": attributes,
        }
        await self._request(
            "PUT",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}",
            json=body,
        )
        if enabled is False:
            await self.revoke_all_member_sessions(realm, member_id)
        return await self.get_member(realm, member_id)

    async def delete_member(self, realm: str, member_id: str) -> None:
        await self._request("DELETE", f"/admin/realms/{quote(realm, safe='')}/users/{member_id}")

    async def list_groups(self, realm: str) -> list[Group]:
        raw = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}/groups", params={"max": "1000"})
        import asyncio
        async def fetch_group(item):
            try:
                detail = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}/groups/{item['id']}")
                return self._group_from_raw(detail)
            except Exception:
                return self._group_from_raw(item)
        return await asyncio.gather(*(fetch_group(item) for item in raw))

    async def create_group(self, realm: str, *, name: str) -> Group:
        await self._request(
            "POST",
            f"/admin/realms/{quote(realm, safe='')}/groups",
            json={"name": name},
        )
        groups = await self.list_groups(realm)
        for group in groups:
            if group.name == name:
                return group
        raise HTTPException(status_code=500, detail="Created group not found")

    async def get_group(self, realm: str, group_id: str) -> Group:
        raw = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}/groups/{group_id}")
        return self._group_from_raw(raw)

    async def update_group(
        self,
        realm: str,
        group_id: str,
        *,
        name: str,
        gentian_odoo_modules: list[str] | None = None,
        gentian_odoo_group_roles: list[str] | None = None,
    ) -> Group:
        current = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}/groups/{group_id}")
        current["name"] = name
        
        attributes = current.setdefault("attributes", {})
        if gentian_odoo_modules is not None:
            attributes["gentianOdooModules"] = [",".join(gentian_odoo_modules)]
        if gentian_odoo_group_roles is not None:
            import json
            attributes["gentianOdooGroupRoles"] = [json.dumps(gentian_odoo_group_roles)]
            
        await self._request(
            "PUT",
            f"/admin/realms/{quote(realm, safe='')}/groups/{group_id}",
            json=current,
        )
        return await self.get_group(realm, group_id)

    async def delete_group(self, realm: str, group_id: str) -> None:
        await self._request("DELETE", f"/admin/realms/{quote(realm, safe='')}/groups/{group_id}")

    async def add_member_to_group(self, realm: str, member_id: str, group_id: str) -> None:
        await self._request(
            "PUT",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}/groups/{group_id}",
        )

    async def remove_member_from_group(self, realm: str, member_id: str, group_id: str) -> None:
        await self._request(
            "DELETE",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}/groups/{group_id}",
        )

    async def set_member_groups(self, realm: str, member_id: str, group_ids: list[str]) -> Member:
        current = await self._list_user_groups(realm, member_id)
        current_ids = {g["id"] for g in current}
        desired = set(group_ids)
        for group_id in current_ids - desired:
            await self.remove_member_from_group(realm, member_id, group_id)
        for group_id in desired - current_ids:
            await self.add_member_to_group(realm, member_id, group_id)
        return await self.get_member(realm, member_id)

    async def list_member_sessions(self, realm: str, member_id: str) -> list[UserSession]:
        await self.get_member(realm, member_id)
        raw = await self._request(
            "GET",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}/sessions",
        )
        if not isinstance(raw, list):
            return []
        return [self._session_from_raw(member_id, item) for item in raw]

    async def revoke_member_session(self, realm: str, member_id: str, session_id: str) -> None:
        await self.get_member(realm, member_id)
        await self._request(
            "DELETE",
            f"/admin/realms/{quote(realm, safe='')}/sessions/{quote(session_id, safe='')}",
            params={"isOffline": "false"},
        )

    async def revoke_all_member_sessions(self, realm: str, member_id: str) -> None:
        await self.get_member(realm, member_id)
        await self._request(
            "POST",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}/logout",
        )

    async def _execute_actions_email(
        self,
        realm: str,
        member_id: str,
        actions: list[str],
        *,
        delivery_email: str | None = None,
        require_delivery: bool = False,
    ) -> None:
        current = await self._request(
            "GET",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}",
        )
        current = self._with_profile_defaults(current)
        primary = current.get("email")
        target = delivery_email or primary
        swapped = False
        if target and primary and target != primary:
            await self._request(
                "PUT",
                f"/admin/realms/{quote(realm, safe='')}/users/{member_id}",
                json=self._user_update_body(current, email=target),
            )
            swapped = True
        params = {
            "client_id": self._portal_client_id,
            "redirect_uri": self._portal_login_url,
            "lifespan": "43200",
        }
        response = await self._raw_request(
            "PUT",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}/execute-actions-email",
            params=params,
            json=actions,
        )
        if response.status_code >= 400:
            if swapped and primary:
                await self._request(
                    "PUT",
                    f"/admin/realms/{quote(realm, safe='')}/users/{member_id}",
                    json=self._user_update_body(current, email=primary),
                )
            if not require_delivery and self._execute_actions_email_degraded(response):
                await self._set_required_actions(realm, member_id, current, actions)
                return
            if require_delivery:
                await self._raise_invite_email_failed(response)
            await self._raise_for_status(response)
        await self._finalize_action_email_user(realm, member_id, actions)
        # Keep the delivery email until required actions complete; restoring immediately
        # invalidates action-token links (Keycloak returns invalid_email on mismatch).

    async def _finalize_action_email_user(
        self,
        realm: str,
        member_id: str,
        requested_actions: list[str],
    ) -> None:
        """Drop profile prompts Keycloak adds after admin email changes for delivery."""
        raw = await self._request(
            "GET",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}",
        )
        allowed = set(requested_actions)
        required_actions = [
            action
            for action in (raw.get("requiredActions") or [])
            if action in allowed and action not in PROFILE_PROMPT_ACTIONS
        ]
        body = self._user_update_body(self._with_profile_defaults(raw))
        body["requiredActions"] = required_actions
        await self._request(
            "PUT",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}",
            json=body,
        )

    # restore_workspace_email_for_login is gone.
    #
    # It set the email field back to the username on the user's first login,
    # which destroyed the recovery address: the field was the only place it
    # survived, because the attribute meant to hold it was being discarded. A
    # locked-out user was then sent their reset link to the mailbox they could
    # not open, which is the one moment the address exists for.
    #
    # The workspace address is not lost by leaving the field alone — it is the
    # username. Applications read it from the email CLAIM, which the platform
    # maps from the username (see the groups Job in gentian-os), so they receive
    # the same value as before whatever the field holds.

    async def _list_user_groups(self, realm: str, member_id: str) -> list[dict[str, Any]]:
        raw = await self._request(
            "GET",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}/groups",
        )
        return raw if isinstance(raw, list) else []

    async def _list_credentials(self, realm: str, member_id: str) -> list[dict[str, Any]]:
        raw = await self._request(
            "GET",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}/credentials",
        )
        return raw if isinstance(raw, list) else []

    async def _invalidate_password(self, realm: str, member_id: str) -> None:
        """Replace the password with an unknown temporary value so the old password stops working."""
        await self._request(
            "PUT",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}/reset-password",
            json={
                "type": "password",
                "value": str(uuid.uuid4()),
                "temporary": True,
            },
        )

    async def _apply_totp_status(
        self,
        realm: str,
        member_id: str,
        member: Member,
        raw: dict[str, Any],
    ) -> None:
        credentials = await self._list_credentials(realm, member_id)
        member.totp_configured = any(credential.get("type") == "otp" for credential in credentials)
        required_actions = raw.get("requiredActions") or []
        member.totp_pending = CONFIGURE_TOTP_ACTION in required_actions

    async def _set_required_action(
        self,
        realm: str,
        member_id: str,
        raw: dict[str, Any],
        action: str,
        *,
        add: bool,
    ) -> None:
        required_actions = list(raw.get("requiredActions") or [])
        if add:
            if action not in required_actions:
                required_actions.append(action)
        else:
            required_actions = [item for item in required_actions if item != action]
        await self._request(
            "PUT",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}",
            json={
                "username": raw.get("username"),
                "email": raw.get("email"),
                "firstName": raw.get("firstName", ""),
                "lastName": raw.get("lastName", ""),
                "enabled": raw.get("enabled", True),
                "requiredActions": required_actions,
            },
        )

    async def _set_required_actions(
        self,
        realm: str,
        member_id: str,
        raw: dict[str, Any],
        actions: list[str],
    ) -> None:
        required_actions = list(raw.get("requiredActions") or [])
        for action in actions:
            if action not in required_actions:
                required_actions.append(action)
        await self._request(
            "PUT",
            f"/admin/realms/{quote(realm, safe='')}/users/{member_id}",
            json={
                "username": raw.get("username"),
                "email": raw.get("email"),
                "firstName": raw.get("firstName", ""),
                "lastName": raw.get("lastName", ""),
                "enabled": raw.get("enabled", True),
                "requiredActions": required_actions,
            },
        )

    @staticmethod
    def _smtp_unavailable(response: httpx.Response) -> bool:
        text = response.text.lower()
        return (
            response.status_code >= 400
            and (
                "no sender address" in text
                or "failed to send execute actions email" in text
                or "failed to send email" in text
            )
        )

    @staticmethod
    def _execute_actions_email_degraded(response: httpx.Response) -> bool:
        """True when execute-actions-email cannot run; fall back to required actions."""
        if KeycloakAdminStore._smtp_unavailable(response):
            return True
        text = response.text.lower()
        return response.status_code >= 400 and (
            "client doesn't exist" in text or "client doesnt exist" in text
        )

    async def _admin_token(self) -> str:
        if self._token and time.time() < self._token_expiry - 30:
            return self._token
        response = await self._client.post(
            f"{self._base_url}/realms/master/protocol/openid-connect/token",
            data={
                "client_id": "admin-cli",
                "username": self._username,
                "password": self._password,
                "grant_type": "password",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Keycloak admin token request failed: {response.text}",
            )
        payload = response.json()
        self._token = payload["access_token"]
        self._token_expiry = time.time() + int(payload.get("expires_in", 60))
        return self._token

    def _public_frontend_headers(self) -> dict[str, str]:
        """Keycloak uses forwarded headers for front-channel URLs in emails when called in-cluster."""
        if not self._idp_public_host:
            return {}
        return {
            "X-Forwarded-Host": self._idp_public_host,
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Port": "443",
        }

    async def _raw_request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
    ) -> httpx.Response:
        token = await self._admin_token()
        headers = {"Authorization": f"Bearer {token}", **self._public_frontend_headers()}
        return await self._client.request(
            method,
            f"{self._base_url}{path}",
            params=params,
            json=json,
            headers=headers,
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
    ) -> Any:
        response = await self._raw_request(method, path, params=params, json=json)
        if response.status_code == 404:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        if response.status_code >= 400:
            await self._raise_for_status(response)
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    async def _assert_realm_smtp_configured(self, realm: str) -> None:
        raw = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}")
        smtp = raw.get("smtpServer") or {}
        host = smtp.get("host")
        if not host:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Invitation email is unavailable: tenant realm SMTP is not configured",
            )

    async def _raise_invite_email_failed(self, response: httpx.Response) -> None:
        detail = response.text.strip() or response.reason_phrase
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Invitation email could not be sent: {detail}",
        )

    async def _raise_for_status(self, response: httpx.Response) -> None:
        detail = response.text.strip() or response.reason_phrase
        code = status.HTTP_502_BAD_GATEWAY if response.status_code >= 500 else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=f"Keycloak admin API: {detail}")

    @staticmethod
    def _with_profile_defaults(raw: dict[str, Any]) -> dict[str, Any]:
        first = str(raw.get("firstName") or "").strip()
        last = str(raw.get("lastName") or "").strip()
        if first and last:
            return raw
        handle = str(raw.get("username") or raw.get("email") or "member").split("@", 1)[0]
        parts = [part for part in handle.replace("-", " ").replace("_", " ").split() if part]
        return {
            **raw,
            "firstName": first or (parts[0].title() if parts else "Member"),
            "lastName": last or (parts[-1].title() if len(parts) > 1 else "User"),
        }

    @staticmethod
    def _user_update_body(raw: dict[str, Any], *, email: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {
            "username": raw.get("username"),
            "email": email if email is not None else raw.get("email"),
            "firstName": raw.get("firstName", ""),
            "lastName": raw.get("lastName", ""),
            "enabled": raw.get("enabled", True),
            "emailVerified": raw.get("emailVerified", True),
        }
        attributes = raw.get("attributes")
        if attributes:
            body["attributes"] = attributes
        return body

    @staticmethod
    def _member_from_raw(raw: dict[str, Any]) -> Member:
        """Read a member, and work out which address is which.

        The email FIELD holds the recovery address, because Keycloak's own
        password reset mails that field and can be pointed at nothing else. The
        workspace address is the username — christian@corp.example is the login
        and the mailbox both — so a field that differs from the username is a
        recovery address, and one that equals it means none has been set.

        The gentian.inviteEmail attribute is read as a fallback and no longer
        written as the source of truth. It could not be relied on: Keycloak
        silently discards attributes a realm's user profile does not declare, and
        the tenant realms had no user profile at all, so every recovery address
        entered through it was dropped without an error.
        """
        username = raw.get("username") or ""
        email = raw.get("email") or None
        invite_email = None
        attrs = raw.get("attributes") or {}
        invite_vals = attrs.get(INVITE_EMAIL_ATTR) or []
        if invite_vals:
            invite_email = invite_vals[0]
        elif email and email.strip().lower() != username.strip().lower():
            invite_email = email
        return Member(
            id=raw["id"],
            username=raw.get("username") or "",
            email=raw.get("email"),
            first_name=raw.get("firstName") or None,
            last_name=raw.get("lastName") or None,
            enabled=bool(raw.get("enabled", True)),
            invite_email=invite_email,
        )

    @staticmethod
    def _delivery_email(raw: dict[str, Any]) -> str | None:
        invite = KeycloakAdminStore._member_from_raw(raw).invite_email
        return invite or raw.get("email")

    @staticmethod
    def _group_from_raw(raw: dict[str, Any]) -> Group:
        attributes = raw.get("attributes") or {}
        
        modules_val = attributes.get("gentianOdooModules") or []
        modules = []
        for val in modules_val:
            if isinstance(val, str):
                modules.extend([m.strip() for m in val.split(",") if m.strip()])
            else:
                modules.append(str(val))
        
        roles_val = attributes.get("gentianOdooGroupRoles") or []
        roles = []
        for val in roles_val:
            if isinstance(val, str):
                val_str = val.strip()
                if val_str.startswith("[") and val_str.endswith("]"):
                    import json
                    try:
                        parsed = json.loads(val_str)
                        if isinstance(parsed, list):
                            roles.extend([str(r).strip() for r in parsed if r])
                        else:
                            roles.append(str(parsed).strip())
                    except Exception:
                        roles.append(val_str)
                else:
                    roles.extend([r.strip() for r in val_str.split(",") if r.strip()])
            else:
                roles.append(str(val))

        return Group(
            id=raw["id"],
            name=raw.get("name") or "",
            path=raw.get("path") or raw.get("name") or "",
            member_count=int(raw.get("subGroupCount") or 0),
            gentian_odoo_modules=modules,
            gentian_odoo_group_roles=roles,
            default_grant=_attribute_is_true(attributes.get("gentianDefaultGrant")),
        )

    @staticmethod
    def _session_from_raw(member_id: str, raw: dict[str, Any]) -> UserSession:
        clients = raw.get("clients") or {}
        if isinstance(clients, dict) and clients:
            client_id, client_name = next(iter(clients.items()))
        else:
            client_id, client_name = "", "unknown"
        return UserSession(
            id=raw["id"],
            member_id=member_id,
            client_id=str(client_id),
            client_name=str(client_name),
            ip_address=raw.get("ipAddress"),
            started_at=int(raw.get("start") or 0),
            last_access_at=int(raw.get("lastAccess") or 0),
        )
