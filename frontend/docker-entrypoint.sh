#!/bin/sh
# SPDX-FileCopyrightText: 2026 Gentian Organization
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Render runtime configuration into /app/dist/config.js before serving.
#
# Why this exists
# ---------------
# Vite substitutes import.meta.env.VITE_* at BUILD time, so anything passed as a
# build arg is frozen into the JavaScript bundle. One portal image is published
# and deployed to every cluster, so a baked-in value can only ever be right for
# the cluster it was built for. It was built for the test cluster:
#
#   VITE_OIDC_ISSUER=https://id.desk.gentian.org/auth/realms/kernel
#
# Every other cluster therefore ran a bundle that believed it lived on
# desk.gentian.org. The visible symptom was a tenant on corp.gtn.host being
# redirected to corp.desk.gentian.org — an entirely different deployment —
# because the SPA derives the kernel domain from the issuer and treats
# <tenant>.<kernel-domain> as the canonical host to send sessions to.
#
# Config now arrives at container start instead, from the environment, which is
# where deployment-specific values belong (12-factor III). The image stays
# identical across clusters; only its environment differs.
#
# index.html loads /config.js as a plain classic script BEFORE the module
# bundle, so window.__GENTIAN_CONFIG__ is populated before any application code
# reads it. It must not be cached: it is the one file whose contents legitimately
# differ between deployments of the same image.
set -eu

CONFIG_PATH="${GENTIAN_CONFIG_PATH:-/app/dist/config.js}"

# json_escape emits a JSON string literal for an arbitrary shell value, so a
# stray quote or backslash in an env var cannot break out and inject script.
json_escape() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g'
}

emit() {
    printf '  %s: "%s",\n' "$1" "$(json_escape "$2")"
}

{
    echo '// GENERATED AT CONTAINER START by docker-entrypoint.sh — do not edit.'
    echo '// Values come from the environment, never from the image build.'
    echo 'window.__GENTIAN_CONFIG__ = {'
    emit 'oidcIssuer'   "${OIDC_ISSUER:-}"
    emit 'oidcClientId' "${OIDC_CLIENT_ID:-gentian-portal}"
    emit 'oidcScopes'   "${OIDC_SCOPES:-openid profile email}"
    emit 'authDisabled' "${AUTH_DISABLED:-false}"
    emit 'kernelDomain' "${KERNEL_DOMAIN:-}"
    echo '};'
} > "${CONFIG_PATH}"

# Fail loudly rather than serve a portal that cannot authenticate. An empty
# issuer previously degraded into "auth is not configured" screens that looked
# like a Keycloak problem; refusing to start points at the actual cause.
if [ -z "${OIDC_ISSUER:-}" ] && [ "${AUTH_DISABLED:-false}" != "true" ]; then
    echo "FATAL: OIDC_ISSUER is unset and AUTH_DISABLED is not true." >&2
    echo "       Set OIDC_ISSUER to https://id.<kernel-domain>/auth/realms/<realm>" >&2
    echo "       on the web Deployment, or set AUTH_DISABLED=true for local dev." >&2
    exit 1
fi

echo "runtime config written to ${CONFIG_PATH} (issuer=${OIDC_ISSUER:-<none>})"
exec "$@"
