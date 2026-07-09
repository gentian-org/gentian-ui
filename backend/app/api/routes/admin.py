"""Gentian Admin Console API — Members and Groups (P1)."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field

from app.core.admin_context import admin_tenant_query, resolve_admin_tenant
from app.core.audit_log import record_admin_audit
from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.openfga_client import OpenFGAClient
from app.core.gentian_groups import (
    is_admin_managed_group,
    is_bootstrap_tenant_admin,
    is_platform_superadmin,
    is_privilege_group,
    is_system_tenant_group,
    is_tenant_admin,
    normalize_groups,
    tenant_admins_group,
    tenant_app_admins_group,
    tenant_members_group,
    tenant_prefix,
    tenant_admin_tenants,
    user_is_platform_admin,
)
from app.services.admin_store import AdminStore, AdminStoreDep, Member
from app.services.admin_notifications import NotificationAudience, NotificationSeverity
from app.services.audit_events import AuditCategory, AuditEvent, AuditEventFilters
from app.services.audit_store import AuditStoreDep, audit_actor
from app.services.notification_audience import validate_publish_audience
from app.services.notification_cloudevents import notification_to_cloudevent
from app.services.notification_store import NotificationStoreDep
from app.services.k8s_catalogue import request_tenant_app_privilege_reconcile
from app.services.k8s_authorization import (
    cluster_authorization_summary,
    effective_contract_capabilities,
    get_app_grant,
    get_platform_security_policy,
    list_app_grants,
    list_app_profiles_with_mac_requests,
    list_integration_bindings,
    replace_app_grant,
    replace_platform_security_policy,
    tenant_namespace,
)
from app.services.security_policy_store import SecurityPolicyStoreDep

router = APIRouter(prefix="/admin", tags=["admin"])


class MemberResponse(BaseModel):
    id: str
    username: str
    email: str | None = None
    inviteEmail: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    enabled: bool
    groups: list[str] = Field(default_factory=list)
    totpConfigured: bool = False
    totpPending: bool = False


class GroupResponse(BaseModel):
    id: str
    name: str
    path: str
    memberCount: int = 0
    gentianOdooModules: list[str] = Field(default_factory=list)
    gentianOdooGroupRoles: list[str] = Field(default_factory=list)


class AdminContextResponse(BaseModel):
    tenant: str
    realm: str
    isPlatformAdmin: bool
    isTenantAdmin: bool
    availableTenants: list[str] = Field(default_factory=list)
    storeConfigured: bool


class MemberCreateRequest(BaseModel):
    email: EmailStr
    firstName: str | None = None
    lastName: str | None = None
    enabled: bool = True


class MemberInviteRequest(BaseModel):
    email: EmailStr
    firstName: str | None = None
    lastName: str | None = None
    inviteEmail: EmailStr | None = None
    groupIds: list[str] = Field(default_factory=list)
    requireTotp: bool = False
    settingsTemplateId: str | None = None


class TotpEnableRequest(BaseModel):
    sendEmail: bool = True


class MemberUpdateRequest(BaseModel):
    email: EmailStr | None = None
    firstName: str | None = None
    lastName: str | None = None
    enabled: bool | None = None
    inviteEmail: EmailStr | None = None


class PasswordResetResponse(BaseModel):
    deliveryEmail: str


class GroupCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class GroupUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    gentianOdooModules: list[str] | None = None
    gentianOdooGroupRoles: list[str] | None = None


class MemberGroupsUpdateRequest(BaseModel):
    groupIds: list[str] = Field(default_factory=list)


class SecurityPoliciesResponse(BaseModel):
    passwordMinLength: int = Field(ge=4, le=128)
    passwordRequireDigits: bool = False
    passwordRequireLowercase: bool = False
    passwordRequireUppercase: bool = False
    passwordRequireSpecialChars: bool = False
    passwordHistoryCount: int = Field(default=0, ge=0, le=24)
    passwordMaxAgeDays: int = Field(default=0, ge=0, le=3650)
    ssoSessionIdleMinutes: int = Field(default=30, ge=1, le=1440)
    ssoSessionMaxHours: int = Field(default=10, ge=1, le=720)
    rememberMe: bool = False
    bruteForceProtected: bool = True
    maxLoginFailures: int = Field(default=5, ge=1, le=100)
    lockoutDurationSeconds: int = Field(default=900, ge=60, le=86400)
    requireTotpAdmins: bool = False
    requireTotpMembers: Literal["none", "optional", "required"] = "none"


class SecurityPoliciesUpdateRequest(SecurityPoliciesResponse):
    pass


class MemberSessionResponse(BaseModel):
    id: str
    memberId: str
    memberEmail: str | None = None
    memberUsername: str
    clientId: str
    clientName: str
    ipAddress: str | None = None
    startedAt: int
    lastAccessAt: int


class AuditEventResponse(BaseModel):
    id: str
    occurredAt: int
    category: AuditCategory
    action: str
    actor: str | None = None
    target: str | None = None
    tenant: str
    ipAddress: str | None = None
    success: bool
    details: dict[str, str] = Field(default_factory=dict)


class NotificationAudienceRequest(BaseModel):
    scope: Literal["platform", "tenant"] = "tenant"
    tenant: str | None = None
    groups: list[str] = Field(default_factory=list)


class NotificationPublishRequest(BaseModel):
    title: str = Field(min_length=1, max_length=512)
    body: str = Field(min_length=1, max_length=4000)
    severity: NotificationSeverity = "info"
    audience: NotificationAudienceRequest = Field(default_factory=NotificationAudienceRequest)
    linkUrl: str | None = Field(default=None, max_length=2048)
    linkLabel: str | None = Field(default=None, max_length=255)
    expiresAt: int | None = Field(default=None, ge=0)


class NotificationResponse(BaseModel):
    id: str
    publishedAt: int
    title: str
    body: str
    severity: NotificationSeverity
    audience: NotificationAudienceRequest
    publisher: str
    tenant: str
    linkUrl: str | None = None
    linkLabel: str | None = None
    expiresAt: int | None = None
    cloudEvent: dict[str, Any] = Field(default_factory=dict)


def _require_admin(user: dict[str, Any], settings: Settings) -> None:
    if settings.auth_disabled:
        return
    groups = normalize_groups(user)
    if user_is_platform_admin(user) or is_tenant_admin(groups):
        return
    if is_bootstrap_tenant_admin(user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin Console access requires tenant or platform administrator privileges",
    )


def _require_platform_admin(user: dict[str, Any], settings: Settings) -> None:
    if settings.auth_disabled:
        return
    if not user_is_platform_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform administrator privileges required",
        )


def _realm_for_tenant(tenant: str) -> str:
    return tenant


def _member_response(member: Member) -> MemberResponse:
    return MemberResponse(
        id=member.id,
        username=member.username,
        email=member.email,
        inviteEmail=member.invite_email,
        firstName=member.first_name,
        lastName=member.last_name,
        enabled=member.enabled,
        groups=member.groups,
        totpConfigured=member.totp_configured,
        totpPending=member.totp_pending,
    )


def _group_response(group: Any) -> GroupResponse:
    return GroupResponse(
        id=group.id,
        name=group.name,
        path=group.path,
        memberCount=group.member_count,
        gentianOdooModules=getattr(group, "gentian_odoo_modules", []),
        gentianOdooGroupRoles=getattr(group, "gentian_odoo_group_roles", []),
    )


def _session_response(session: Any, member: Member) -> MemberSessionResponse:
    return MemberSessionResponse(
        id=session.id,
        memberId=session.member_id,
        memberEmail=member.email,
        memberUsername=member.username,
        clientId=session.client_id,
        clientName=session.client_name,
        ipAddress=session.ip_address,
        startedAt=session.started_at,
        lastAccessAt=session.last_access_at,
    )


async def _list_tenant_sessions(store: AdminStore, realm: str) -> list[MemberSessionResponse]:
    members = await store.list_members(realm)
    sessions: list[MemberSessionResponse] = []
    for member in members:
        for session in await store.list_member_sessions(realm, member.id):
            sessions.append(_session_response(session, member))
    sessions.sort(key=lambda item: item.lastAccessAt, reverse=True)
    return sessions


def _notification_audience_request(audience: NotificationAudience) -> NotificationAudienceRequest:
    return NotificationAudienceRequest(
        scope=audience.scope,
        tenant=audience.tenant,
        groups=audience.groups,
    )


def _notification_response(notification: Any) -> NotificationResponse:
    return NotificationResponse(
        id=notification.id,
        publishedAt=notification.published_at,
        title=notification.title,
        body=notification.body,
        severity=notification.severity,
        audience=_notification_audience_request(notification.audience),
        publisher=notification.publisher,
        tenant=notification.tenant,
        linkUrl=notification.link_url,
        linkLabel=notification.link_label,
        expiresAt=notification.expires_at,
        cloudEvent=notification_to_cloudevent(notification),
    )


def _audit_event_response(event: AuditEvent) -> AuditEventResponse:
    return AuditEventResponse(
        id=event.id,
        occurredAt=event.occurred_at,
        category=event.category,
        action=event.action,
        actor=event.actor,
        target=event.target,
        tenant=event.tenant,
        ipAddress=event.ip_address,
        success=event.success,
        details=event.details,
    )


def _parse_epoch_ms(value: str | None) -> int | None:
    if not value:
        return None
    stripped = value.strip()
    if stripped.isdigit():
        parsed = int(stripped)
        return parsed if parsed > 10_000_000_000 else parsed * 1000
    try:
        if stripped.endswith("Z"):
            stripped = stripped[:-1] + "+00:00"
        dt = datetime.fromisoformat(stripped)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None


def _audit_filters(
    *,
    user: str | None,
    action: str | None,
    category: AuditCategory | None,
    from_time: str | None,
    to_time: str | None,
    limit: int,
) -> AuditEventFilters:
    return AuditEventFilters(
        user=user,
        action=action,
        category=category,
        from_epoch_ms=_parse_epoch_ms(from_time),
        to_epoch_ms=_parse_epoch_ms(to_time),
        limit=limit,
    )


def _audit_export_csv(events: list[AuditEventResponse]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["occurredAt", "category", "action", "actor", "target", "success", "ipAddress", "details"],
    )
    for event in events:
        writer.writerow(
            [
                event.occurredAt,
                event.category,
                event.action,
                event.actor or "",
                event.target or "",
                event.success,
                event.ipAddress or "",
                json.dumps(event.details, sort_keys=True),
            ],
        )
    return buffer.getvalue()


def _validate_group_name(name: str, tenant: str, settings: Settings) -> str:
    normalized = name.strip()
    if tenant == settings.kernel_realm:
        if not normalized.startswith("gentian:platform:"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Platform groups must start with gentian:platform:",
            )
        return normalized
    if not normalized.startswith(tenant_prefix(tenant)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Group name must start with {tenant_prefix(tenant)}",
        )
    if normalized == tenant_admins_group(tenant):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The tenant administrators group cannot be managed here",
        )
    if normalized == tenant_app_admins_group(tenant):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The app administrators group is provisioned automatically",
        )
    return normalized


async def _managed_groups(store: AdminStore, tenant: str, settings: Settings) -> list[Any]:
    realm = _realm_for_tenant(tenant)
    groups = await store.list_groups(realm)
    return [
        g
        for g in groups
        if is_admin_managed_group(g.name, tenant, kernel_realm=settings.kernel_realm)
        or is_privilege_group(g.name, tenant)
    ]


async def _member_group_ids(
    store: AdminStore,
    tenant: str,
    settings: Settings,
    requested: list[str],
) -> list[str]:
    realm = _realm_for_tenant(tenant)
    allowed = {g.id for g in await _managed_groups(store, tenant, settings)}
    invalid = [gid for gid in requested if gid not in allowed]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One or more groups are outside this tenant scope",
        )
    group_ids = set(requested)
    for group in await store.list_groups(realm):
        if group.name == tenant_members_group(tenant):
            group_ids.add(group.id)
            break
    return list(group_ids)


def _app_admins_membership_changed(
    groups: list[Any],
    before_names: set[str],
    after_group_ids: list[str],
    tenant: str,
) -> bool:
    app_admins = tenant_app_admins_group(tenant)
    by_id = {group.id: group.name for group in groups}
    after_names = {by_id[group_id] for group_id in after_group_ids if group_id in by_id}
    return (app_admins in before_names) != (app_admins in after_names)


async def _request_app_privilege_reconcile_if_needed(
    store: AdminStore,
    tenant: str,
    settings: Settings,
    *,
    before_names: set[str],
    after_group_ids: list[str],
) -> None:
    groups = await _managed_groups(store, tenant, settings)
    if not _app_admins_membership_changed(groups, before_names, after_group_ids, tenant):
        return
    request_tenant_app_privilege_reconcile(tenant)


def _security_policies_response(policies: Any) -> SecurityPoliciesResponse:
    return SecurityPoliciesResponse(
        passwordMinLength=policies.password_min_length,
        passwordRequireDigits=policies.password_require_digits,
        passwordRequireLowercase=policies.password_require_lowercase,
        passwordRequireUppercase=policies.password_require_uppercase,
        passwordRequireSpecialChars=policies.password_require_special_chars,
        passwordHistoryCount=policies.password_history_count,
        passwordMaxAgeDays=policies.password_max_age_days,
        ssoSessionIdleMinutes=policies.sso_session_idle_minutes,
        ssoSessionMaxHours=policies.sso_session_max_hours,
        rememberMe=policies.remember_me,
        bruteForceProtected=policies.brute_force_protected,
        maxLoginFailures=policies.max_login_failures,
        lockoutDurationSeconds=policies.lockout_duration_seconds,
        requireTotpAdmins=policies.require_totp_admins,
        requireTotpMembers=policies.require_totp_members,
    )


def _security_policies_from_request(body: SecurityPoliciesUpdateRequest) -> Any:
    from app.services.security_policies import SecurityPolicies

    return SecurityPolicies(
        password_min_length=body.passwordMinLength,
        password_require_digits=body.passwordRequireDigits,
        password_require_lowercase=body.passwordRequireLowercase,
        password_require_uppercase=body.passwordRequireUppercase,
        password_require_special_chars=body.passwordRequireSpecialChars,
        password_history_count=body.passwordHistoryCount,
        password_max_age_days=body.passwordMaxAgeDays,
        sso_session_idle_minutes=body.ssoSessionIdleMinutes,
        sso_session_max_hours=body.ssoSessionMaxHours,
        remember_me=body.rememberMe,
        brute_force_protected=body.bruteForceProtected,
        max_login_failures=body.maxLoginFailures,
        lockout_duration_seconds=body.lockoutDurationSeconds,
        require_totp_admins=body.requireTotpAdmins,
        require_totp_members=body.requireTotpMembers,
    )


@router.get("/context", response_model=AdminContextResponse)
async def admin_context(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    tenant: str | None = Depends(admin_tenant_query),
) -> AdminContextResponse:
    _require_admin(user, settings)
    groups = normalize_groups(user)
    resolved = resolve_admin_tenant(user, settings, tenant)
    if settings.auth_disabled or is_platform_superadmin(groups):
        available = [resolved]
    else:
        available = sorted(tenant_admin_tenants(groups))
    return AdminContextResponse(
        tenant=resolved,
        realm=_realm_for_tenant(resolved),
        isPlatformAdmin=settings.auth_disabled or user_is_platform_admin(user),
        isTenantAdmin=settings.auth_disabled
        or is_tenant_admin(groups)
        or is_bootstrap_tenant_admin(user),
        availableTenants=available,
        storeConfigured=settings.auth_disabled
        or bool(settings.keycloak_admin_url and settings.keycloak_admin_password),
    )


@router.get("/members", response_model=list[MemberResponse])
async def list_members(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> list[MemberResponse]:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    members = await store.list_members(_realm_for_tenant(resolved))
    return [_member_response(member) for member in members]


@router.post("/members", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def create_member(
    body: MemberCreateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    member = await store.create_member(
        _realm_for_tenant(resolved),
        username=str(body.email),
        email=str(body.email),
        first_name=body.firstName,
        last_name=body.lastName,
        enabled=body.enabled,
    )
    await record_admin_audit(
        user,
        tenant=resolved,
        action="member.created",
        target=member.email or member.username,
        details={"memberId": member.id},
    )
    return _member_response(member)


@router.post("/members/invite", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def invite_member(
    body: MemberInviteRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    group_ids = await _member_group_ids(store, resolved, settings, body.groupIds)
    member = await store.invite_member(
        realm,
        username=str(body.email),
        email=str(body.email),
        first_name=body.firstName,
        last_name=body.lastName,
        invite_email=str(body.inviteEmail) if body.inviteEmail else None,
        group_ids=group_ids,
        require_totp=body.requireTotp,
    )
    if body.settingsTemplateId:
        from app.db.tenant_engine import get_tenant_db_session
        from app.models.user_shell_prefs import UserShellPrefsRow, ShellPrefsTemplateRow
        with get_tenant_db_session(resolved) as session:
            template = session.get(ShellPrefsTemplateRow, {"id": body.settingsTemplateId, "tenant": resolved})
            if template:
                row = session.get(UserShellPrefsRow, {"user_sub": member.id, "tenant": resolved})
                if row is None:
                    row = UserShellPrefsRow(user_sub=member.id, tenant=resolved)
                    session.add(row)
                row.background = template.background
                row.background_mime = template.background_mime
                row.prefs_json = template.prefs_json
                session.commit()
    await _request_app_privilege_reconcile_if_needed(
        store,
        resolved,
        settings,
        before_names=set(),
        after_group_ids=group_ids,
    )
    await record_admin_audit(
        user,
        tenant=resolved,
        action="member.invited",
        target=member.email or member.username,
        details={"memberId": member.id},
    )
    return _member_response(member)


@router.post("/members/{member_id}/totp/enable", response_model=MemberResponse)
async def enable_member_totp(
    member_id: str,
    body: TotpEnableRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    member = await store.enable_totp(
        _realm_for_tenant(resolved),
        member_id,
        send_email=body.sendEmail,
    )
    await record_admin_audit(
        user,
        tenant=resolved,
        action="member.totp_enabled",
        target=member.email or member.username,
        details={"memberId": member_id, "sendEmail": str(body.sendEmail)},
    )
    return _member_response(member)


@router.delete("/members/{member_id}/totp", response_model=MemberResponse)
async def remove_member_totp(
    member_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    member = await store.remove_totp(_realm_for_tenant(resolved), member_id)
    await record_admin_audit(
        user,
        tenant=resolved,
        action="member.totp_removed",
        target=member.email or member.username,
        details={"memberId": member_id},
    )
    return _member_response(member)


@router.post("/members/{member_id}/reset-password", response_model=PasswordResetResponse)
async def reset_member_password(
    member_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> PasswordResetResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    member = await store.get_member(realm, member_id)
    delivery_email = await store.send_password_reset(realm, member_id)
    await record_admin_audit(
        user,
        tenant=resolved,
        action="member.password_reset",
        target=member.email or member.username,
        details={"memberId": member_id, "deliveryEmail": delivery_email},
    )
    return PasswordResetResponse(deliveryEmail=delivery_email)


@router.get("/members/{member_id}", response_model=MemberResponse)
async def get_member(
    member_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    member = await store.get_member(_realm_for_tenant(resolved), member_id)
    return _member_response(member)


@router.patch("/members/{member_id}", response_model=MemberResponse)
async def update_member(
    member_id: str,
    body: MemberUpdateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    before = await store.get_member(realm, member_id)
    member = await store.update_member(
        realm,
        member_id,
        email=str(body.email) if body.email is not None else None,
        first_name=body.firstName,
        last_name=body.lastName,
        enabled=body.enabled,
        invite_email=str(body.inviteEmail) if body.inviteEmail is not None else None,
        invite_email_set="inviteEmail" in body.model_fields_set,
    )
    if body.enabled is False and before.enabled:
        await record_admin_audit(
            user,
            tenant=resolved,
            action="member.disabled",
            target=member.email or member.username,
            details={"memberId": member_id},
        )
    elif body.enabled is True and not before.enabled:
        await record_admin_audit(
            user,
            tenant=resolved,
            action="member.enabled",
            target=member.email or member.username,
            details={"memberId": member_id},
        )
    else:
        await record_admin_audit(
            user,
            tenant=resolved,
            action="member.updated",
            target=member.email or member.username,
            details={"memberId": member_id},
        )
    return _member_response(member)


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_member(
    member_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> None:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    member = await store.get_member(realm, member_id)
    await store.delete_member(realm, member_id)
    await record_admin_audit(
        user,
        tenant=resolved,
        action="member.deleted",
        target=member.email or member.username,
        details={"memberId": member_id},
    )


@router.put("/members/{member_id}/groups", response_model=MemberResponse)
async def update_member_groups(
    member_id: str,
    body: MemberGroupsUpdateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    existing = await store.get_member(realm, member_id)
    before_names = set(existing.groups)
    group_ids = await _member_group_ids(store, resolved, settings, body.groupIds)
    member = await store.set_member_groups(realm, member_id, group_ids)
    await _request_app_privilege_reconcile_if_needed(
        store,
        resolved,
        settings,
        before_names=before_names,
        after_group_ids=group_ids,
    )
    await record_admin_audit(
        user,
        tenant=resolved,
        action="member.groups_updated",
        target=member.email or member.username,
        category="entitlement",
        details={"memberId": member_id, "groupCount": str(len(body.groupIds))},
    )
    return _member_response(member)


@router.get("/groups", response_model=list[GroupResponse])
async def list_groups(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> list[GroupResponse]:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    groups = await _managed_groups(store, resolved, settings)
    return [_group_response(group) for group in groups]


@router.post("/groups", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    body: GroupCreateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> GroupResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    name = _validate_group_name(body.name, resolved, settings)
    group = await store.create_group(_realm_for_tenant(resolved), name=name)
    await record_admin_audit(
        user,
        tenant=resolved,
        action="group.created",
        target=group.name,
        details={"groupId": group.id},
    )
    return _group_response(group)


@router.patch("/groups/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: str,
    body: GroupUpdateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> GroupResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    existing = await store.get_group(realm, group_id)
    if not is_admin_managed_group(existing.name, resolved, kernel_realm=settings.kernel_realm) and not is_privilege_group(
        existing.name, resolved
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Group is not manageable")
    if is_system_tenant_group(existing.name, resolved):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="System groups cannot be renamed")
    name = _validate_group_name(body.name, resolved, settings)
    group = await store.update_group(
        realm,
        group_id,
        name=name,
        gentian_odoo_modules=body.gentianOdooModules,
        gentian_odoo_group_roles=body.gentianOdooGroupRoles,
    )
    await record_admin_audit(
        user,
        tenant=resolved,
        action="group.updated",
        target=group.name,
        details={"groupId": group_id},
    )
    return _group_response(group)


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> None:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    existing = await store.get_group(realm, group_id)
    if not is_admin_managed_group(existing.name, resolved, kernel_realm=settings.kernel_realm) and not is_privilege_group(
        existing.name, resolved
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Group is not manageable")
    if is_system_tenant_group(existing.name, resolved):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="System groups cannot be deleted")
    await store.delete_group(realm, group_id)
    await record_admin_audit(
        user,
        tenant=resolved,
        action="group.deleted",
        target=existing.name,
        details={"groupId": group_id},
    )


@router.get("/security-policies", response_model=SecurityPoliciesResponse)
async def get_security_policies(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    tenant: str | None = Depends(admin_tenant_query),
    *,
    policy_store: SecurityPolicyStoreDep,
) -> SecurityPoliciesResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    policies = await policy_store.get_security_policies(_realm_for_tenant(resolved))
    return _security_policies_response(policies)


@router.put("/security-policies", response_model=SecurityPoliciesResponse)
async def update_security_policies(
    body: SecurityPoliciesUpdateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    tenant: str | None = Depends(admin_tenant_query),
    *,
    policy_store: SecurityPolicyStoreDep,
    store: AdminStoreDep,
) -> SecurityPoliciesResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    policies = await policy_store.update_security_policies(
        _realm_for_tenant(resolved),
        resolved,
        _security_policies_from_request(body),
        store,
    )
    await record_admin_audit(
        user,
        tenant=resolved,
        action="security_policies.updated",
        target=resolved,
    )
    return _security_policies_response(policies)


@router.get("/sessions", response_model=list[MemberSessionResponse])
async def list_sessions(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> list[MemberSessionResponse]:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    return await _list_tenant_sessions(store, _realm_for_tenant(resolved))


@router.get("/members/{member_id}/sessions", response_model=list[MemberSessionResponse])
async def list_member_sessions(
    member_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> list[MemberSessionResponse]:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    member = await store.get_member(realm, member_id)
    sessions = await store.list_member_sessions(realm, member_id)
    return [_session_response(session, member) for session in sessions]


@router.delete(
    "/members/{member_id}/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_member_session(
    member_id: str,
    session_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> None:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    member = await store.get_member(realm, member_id)
    await store.revoke_member_session(realm, member_id, session_id)
    await record_admin_audit(
        user,
        tenant=resolved,
        action="session.revoked",
        target=member.email or member.username,
        details={"memberId": member_id, "sessionId": session_id},
    )


@router.post(
    "/members/{member_id}/sessions/revoke-all",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_all_member_sessions(
    member_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> None:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    member = await store.get_member(realm, member_id)
    await store.revoke_all_member_sessions(realm, member_id)
    await record_admin_audit(
        user,
        tenant=resolved,
        action="session.revoked_all",
        target=member.email or member.username,
        details={"memberId": member_id},
    )


@router.get("/audit-events", response_model=list[AuditEventResponse])
async def list_audit_events(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    audit_store: AuditStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
    user_filter: str | None = Query(default=None, alias="user"),
    action: str | None = Query(default=None),
    category: AuditCategory | None = Query(default=None),
    from_time: str | None = Query(default=None, alias="from"),
    to_time: str | None = Query(default=None, alias="to"),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[AuditEventResponse]:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    filters = _audit_filters(
        user=user_filter,
        action=action,
        category=category,
        from_time=from_time,
        to_time=to_time,
        limit=limit,
    )
    events = await audit_store.list_events(_realm_for_tenant(resolved), resolved, filters)
    return [_audit_event_response(event) for event in events]


@router.get("/audit-events/export")
async def export_audit_events(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    audit_store: AuditStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
    format: Literal["json", "csv"] = Query(default="json"),
    user_filter: str | None = Query(default=None, alias="user"),
    action: str | None = Query(default=None),
    category: AuditCategory | None = Query(default=None),
    from_time: str | None = Query(default=None, alias="from"),
    to_time: str | None = Query(default=None, alias="to"),
    limit: int = Query(default=500, ge=1, le=500),
):
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    filters = _audit_filters(
        user=user_filter,
        action=action,
        category=category,
        from_time=from_time,
        to_time=to_time,
        limit=limit,
    )
    events = await audit_store.list_events(_realm_for_tenant(resolved), resolved, filters)
    payload = [_audit_event_response(event) for event in events]
    if format == "csv":
        content = _audit_export_csv(payload)
        return StreamingResponse(
            iter([content]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="audit-{resolved}.csv"'},
        )
    return StreamingResponse(
        iter([json.dumps([item.model_dump() for item in payload], indent=2)]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="audit-{resolved}.json"'},
    )


@router.get("/notifications", response_model=list[NotificationResponse])
async def list_notifications(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: NotificationStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> list[NotificationResponse]:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    items = await store.list_for_tenant(resolved)
    return [_notification_response(item) for item in items]


@router.post("/notifications", response_model=NotificationResponse, status_code=status.HTTP_201_CREATED)
async def publish_notification(
    body: NotificationPublishRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: NotificationStoreDep,
    tenant: str | None = Depends(admin_tenant_query),
) -> NotificationResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    audience = validate_publish_audience(
        user,
        resolved_tenant=resolved,
        kernel_realm=settings.kernel_realm,
        audience=NotificationAudience(
            scope=body.audience.scope,
            tenant=body.audience.tenant,
            groups=body.audience.groups,
        ),
        auth_disabled=settings.auth_disabled,
    )
    notification = await store.publish(
        tenant=resolved,
        title=body.title.strip(),
        body=body.body.strip(),
        severity=body.severity,
        audience=audience,
        publisher=audit_actor(user),
        link_url=body.linkUrl,
        link_label=body.linkLabel,
        expires_at=body.expiresAt,
    )
    await record_admin_audit(
        user,
        tenant=resolved,
        action="notification.published",
        target=notification.title,
        details={
            "notificationId": notification.id,
            "severity": notification.severity,
            "audienceScope": audience.scope,
        },
    )
    return _notification_response(notification)


class MacWaiverRequestModel(BaseModel):
    profile: str
    policy: str
    scope: str


class MacWaiverCatalogueEntry(BaseModel):
    name: str
    displayName: str = ""
    macWaivers: list[dict[str, str]] = Field(default_factory=list)


class PlatformSecurityPolicyResponse(BaseModel):
    allowedMacWaivers: list[MacWaiverRequestModel] = Field(default_factory=list)
    catalogueRequests: list[MacWaiverCatalogueEntry] = Field(default_factory=list)


class PlatformSecurityPolicyUpdateRequest(BaseModel):
    allowedMacWaivers: list[MacWaiverRequestModel] = Field(default_factory=list)


class IntegrationBindingResponse(BaseModel):
    name: str
    contract: str
    provider: str
    consumer: str
    capabilities: list[str] = Field(default_factory=list)
    state: str = ""


class ConsumeGrantModel(BaseModel):
    contract: str
    granted: list[str] = Field(default_factory=list)


class AllowConsumerModel(BaseModel):
    app: str
    contract: str
    scope: list[str] = Field(default_factory=list)


class AppGrantResponse(BaseModel):
    name: str
    app: str
    consume: list[ConsumeGrantModel] = Field(default_factory=list)
    allowConsumers: list[AllowConsumerModel] = Field(default_factory=list)
    phase: str = ""


class AppGrantUpdateRequest(BaseModel):
    consume: list[ConsumeGrantModel] = Field(default_factory=list)
    allowConsumers: list[AllowConsumerModel] = Field(default_factory=list)


class IntegrationsSummaryResponse(BaseModel):
    bindingCount: int = 0
    grantCount: int = 0
    grantReadyCount: int = 0


class EffectiveAccessRow(BaseModel):
    contract: str
    consumer: str
    provider: str
    bindingCapabilities: list[str] = Field(default_factory=list)
    grantedCapabilities: list[str] = Field(default_factory=list)
    macAllowed: bool = False
    grantPhase: str = ""
    openfgaGranted: dict[str, bool] = Field(default_factory=dict)


class IntegrationsOverviewResponse(BaseModel):
    bindings: list[IntegrationBindingResponse] = Field(default_factory=list)
    grants: list[AppGrantResponse] = Field(default_factory=list)
    summary: IntegrationsSummaryResponse = Field(default_factory=IntegrationsSummaryResponse)
    effectiveAccess: list[EffectiveAccessRow] = Field(default_factory=list)


class PlatformAuthorizationSummaryResponse(BaseModel):
    tenantCount: int = 0
    bindingCount: int = 0
    grantCount: int = 0
    grantReadyCount: int = 0
    allowedMacWaivers: int = 0
    catalogueMacWaiverProfiles: int = 0


@router.get("/platform/authorization-summary", response_model=PlatformAuthorizationSummaryResponse)
async def get_platform_authorization_summary(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> PlatformAuthorizationSummaryResponse:
    _require_admin(user, settings)
    _require_platform_admin(user, settings)
    try:
        summary = cluster_authorization_summary()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return PlatformAuthorizationSummaryResponse(**summary)


@router.get("/platform/security-policy", response_model=PlatformSecurityPolicyResponse)
async def get_platform_security_policy_route(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> PlatformSecurityPolicyResponse:
    _require_admin(user, settings)
    _require_platform_admin(user, settings)
    try:
        psp = get_platform_security_policy()
    except Exception as exc:  # noqa: BLE001 — surface K8s API errors to admins
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    allowed = [
        MacWaiverRequestModel(**item)
        for item in (psp.get("spec") or {}).get("allowedMacWaivers") or []
    ]
    catalogue = [
        MacWaiverCatalogueEntry(
            name=entry["name"],
            displayName=entry.get("displayName", ""),
            macWaivers=entry.get("macWaivers") or [],
        )
        for entry in list_app_profiles_with_mac_requests()
    ]
    return PlatformSecurityPolicyResponse(allowedMacWaivers=allowed, catalogueRequests=catalogue)


@router.put("/platform/security-policy", response_model=PlatformSecurityPolicyResponse)
async def put_platform_security_policy_route(
    body: PlatformSecurityPolicyUpdateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> PlatformSecurityPolicyResponse:
    _require_admin(user, settings)
    _require_platform_admin(user, settings)
    spec = {
        "allowedMacWaivers": [item.model_dump() for item in body.allowedMacWaivers],
    }
    try:
        replace_platform_security_policy(spec)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    await record_admin_audit(
        user,
        tenant=settings.kernel_realm,
        action="platform.security-policy.updated",
        target="PlatformSecurityPolicy/default",
        details={"allowedMacWaivers": len(body.allowedMacWaivers)},
    )
    return await get_platform_security_policy_route(user=user, settings=settings)


@router.get("/integrations", response_model=IntegrationsOverviewResponse)
async def list_integrations_overview(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    tenant: str | None = Depends(admin_tenant_query),
) -> IntegrationsOverviewResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    ns = tenant_namespace(resolved)
    try:
        bindings_raw = list_integration_bindings(ns)
        grants_raw = list_app_grants(ns)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    bindings = [
        IntegrationBindingResponse(
            name=item.get("metadata", {}).get("name", ""),
            contract=(item.get("spec") or {}).get("contract", ""),
            provider=((item.get("spec") or {}).get("provider") or {}).get("app", ""),
            consumer=((item.get("spec") or {}).get("consumer") or {}).get("app", ""),
            capabilities=(item.get("spec") or {}).get("capabilities") or [],
            state=(item.get("status") or {}).get("state", ""),
        )
        for item in bindings_raw
    ]
    grants = [
        AppGrantResponse(
            name=item.get("metadata", {}).get("name", ""),
            app=(item.get("spec") or {}).get("app", ""),
            consume=[
                ConsumeGrantModel(**c) for c in (item.get("spec") or {}).get("consume") or []
            ],
            allowConsumers=[
                AllowConsumerModel(**a)
                for a in (item.get("spec") or {}).get("allowConsumers") or []
            ],
            phase=(item.get("status") or {}).get("phase", ""),
        )
        for item in grants_raw
    ]
    grants_by_app = {
        (item.get("spec") or {}).get("app", ""): item for item in grants_raw
    }
    grants_resp_by_app = {g.app: g for g in grants}

    fga = OpenFGAClient(settings)
    effective_access: list[EffectiveAccessRow] = []
    for binding in bindings:
        grant_raw = grants_by_app.get(binding.consumer)
        grant_spec = grant_raw.get("spec") if grant_raw else None
        granted = effective_contract_capabilities(
            binding.capabilities,
            binding.contract,
            grant_spec,
            binding.consumer,
        )
        grant_phase = grants_resp_by_app.get(binding.consumer).phase if binding.consumer in grants_resp_by_app else ""
        openfga_granted: dict[str, bool] = {}
        if fga.enabled and granted:
            openfga_granted = await fga.capability_grants(
                tenant=resolved,
                consumer_app=binding.consumer,
                contract=binding.contract,
                capabilities=granted,
            )
        effective_access.append(
            EffectiveAccessRow(
                contract=binding.contract,
                consumer=binding.consumer,
                provider=binding.provider,
                bindingCapabilities=binding.capabilities,
                grantedCapabilities=granted,
                macAllowed=len(granted) > 0,
                grantPhase=grant_phase,
                openfgaGranted=openfga_granted,
            )
        )

    summary = IntegrationsSummaryResponse(
        bindingCount=len(bindings),
        grantCount=len(grants),
        grantReadyCount=sum(1 for g in grants if g.phase == "Ready"),
    )
    return IntegrationsOverviewResponse(
        bindings=bindings,
        grants=grants,
        summary=summary,
        effectiveAccess=effective_access,
    )


@router.put("/grants/{app_name}", response_model=AppGrantResponse)
async def update_app_grant(
    app_name: str,
    body: AppGrantUpdateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    tenant: str | None = Depends(admin_tenant_query),
) -> AppGrantResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    ns = tenant_namespace(resolved)
    existing = get_app_grant(ns, app_name)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AppGrant not found")
    spec = existing.get("spec") or {}
    spec["consume"] = [item.model_dump() for item in body.consume]
    spec["allowConsumers"] = [item.model_dump() for item in body.allowConsumers]
    try:
        updated = replace_app_grant(ns, app_name, spec)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    await record_admin_audit(
        user,
        tenant=resolved,
        action="app-grant.updated",
        target=app_name,
        details={"consume": len(body.consume), "allowConsumers": len(body.allowConsumers)},
    )
    return AppGrantResponse(
        name=app_name,
        app=spec.get("app", app_name),
        consume=body.consume,
        allowConsumers=body.allowConsumers,
        phase=(updated.get("status") or {}).get("phase", ""),
    )

