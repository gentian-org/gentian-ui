"""Gentian Admin Console API — Members and Groups (P1)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.core.admin_context import admin_tenant_query, resolve_admin_tenant
from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.gentian_groups import (
    is_bootstrap_tenant_admin,
    is_platform_superadmin,
    is_tenant_admin,
    is_tenant_managed_group,
    normalize_groups,
    tenant_admins_group,
    tenant_members_group,
    tenant_prefix,
    tenant_admin_tenants,
)
from app.services.admin_store import AdminStore, Member, get_admin_store
from app.services.security_policy_store import SecurityPolicyStore, get_security_policy_store

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


class TotpEnableRequest(BaseModel):
    sendEmail: bool = True


class MemberUpdateRequest(BaseModel):
    email: EmailStr | None = None
    firstName: str | None = None
    lastName: str | None = None
    enabled: bool | None = None


class GroupCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class GroupUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


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


def _require_admin(user: dict[str, Any], settings: Settings) -> None:
    if settings.auth_disabled:
        return
    groups = normalize_groups(user)
    if is_platform_superadmin(groups) or is_tenant_admin(groups):
        return
    if is_bootstrap_tenant_admin(user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin Console access requires tenant or platform administrator privileges",
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
    )


def _validate_group_name(name: str, tenant: str) -> str:
    normalized = name.strip()
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
    return normalized


async def _managed_groups(store: AdminStore, tenant: str) -> list[Any]:
    realm = _realm_for_tenant(tenant)
    groups = await store.list_groups(realm)
    return [g for g in groups if is_tenant_managed_group(g.name, tenant)]


async def _invite_group_ids(
    store: AdminStore,
    tenant: str,
    requested: list[str],
) -> list[str]:
    realm = _realm_for_tenant(tenant)
    allowed = {g.id for g in await _managed_groups(store, tenant)}
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
        isPlatformAdmin=settings.auth_disabled or is_platform_superadmin(groups),
        isTenantAdmin=settings.auth_disabled or is_tenant_admin(groups),
        availableTenants=available,
        storeConfigured=settings.auth_disabled
        or bool(settings.keycloak_admin_url and settings.keycloak_admin_password),
    )


@router.get("/members", response_model=list[MemberResponse])
async def list_members(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
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
    store: AdminStore = Depends(get_admin_store),
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
    return _member_response(member)


@router.post("/members/invite", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def invite_member(
    body: MemberInviteRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    group_ids = await _invite_group_ids(store, resolved, body.groupIds)
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
    return _member_response(member)


@router.post("/members/{member_id}/totp/enable", response_model=MemberResponse)
async def enable_member_totp(
    member_id: str,
    body: TotpEnableRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    member = await store.enable_totp(
        _realm_for_tenant(resolved),
        member_id,
        send_email=body.sendEmail,
    )
    return _member_response(member)


@router.delete("/members/{member_id}/totp", response_model=MemberResponse)
async def remove_member_totp(
    member_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    member = await store.remove_totp(_realm_for_tenant(resolved), member_id)
    return _member_response(member)


@router.post("/members/{member_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_member_password(
    member_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> None:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    await store.send_password_reset(_realm_for_tenant(resolved), member_id)


@router.get("/members/{member_id}", response_model=MemberResponse)
async def get_member(
    member_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
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
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    member = await store.update_member(
        _realm_for_tenant(resolved),
        member_id,
        email=str(body.email) if body.email is not None else None,
        first_name=body.firstName,
        last_name=body.lastName,
        enabled=body.enabled,
    )
    return _member_response(member)


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_member(
    member_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> None:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    await store.delete_member(_realm_for_tenant(resolved), member_id)


@router.put("/members/{member_id}/groups", response_model=MemberResponse)
async def update_member_groups(
    member_id: str,
    body: MemberGroupsUpdateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> MemberResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    allowed = {g.id for g in await _managed_groups(store, resolved)}
    invalid = [gid for gid in body.groupIds if gid not in allowed]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One or more groups are outside this tenant scope",
        )
    member = await store.set_member_groups(realm, member_id, body.groupIds)
    return _member_response(member)


@router.get("/groups", response_model=list[GroupResponse])
async def list_groups(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> list[GroupResponse]:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    groups = await _managed_groups(store, resolved)
    return [_group_response(group) for group in groups]


@router.post("/groups", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    body: GroupCreateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> GroupResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    name = _validate_group_name(body.name, resolved)
    group = await store.create_group(_realm_for_tenant(resolved), name=name)
    return _group_response(group)


@router.patch("/groups/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: str,
    body: GroupUpdateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> GroupResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    existing = await store.get_group(realm, group_id)
    if not is_tenant_managed_group(existing.name, resolved):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Group is not manageable")
    name = _validate_group_name(body.name, resolved)
    group = await store.update_group(realm, group_id, name=name)
    return _group_response(group)


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> None:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    realm = _realm_for_tenant(resolved)
    existing = await store.get_group(realm, group_id)
    if not is_tenant_managed_group(existing.name, resolved):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Group is not manageable")
    await store.delete_group(realm, group_id)


@router.get("/security-policies", response_model=SecurityPoliciesResponse)
async def get_security_policies(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    policy_store: SecurityPolicyStore = Depends(get_security_policy_store),
    tenant: str | None = Depends(admin_tenant_query),
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
    policy_store: SecurityPolicyStore = Depends(get_security_policy_store),
    store: AdminStore = Depends(get_admin_store),
    tenant: str | None = Depends(admin_tenant_query),
) -> SecurityPoliciesResponse:
    _require_admin(user, settings)
    resolved = resolve_admin_tenant(user, settings, tenant)
    policies = await policy_store.update_security_policies(
        _realm_for_tenant(resolved),
        resolved,
        _security_policies_from_request(body),
        store,
    )
    return _security_policies_response(policies)
