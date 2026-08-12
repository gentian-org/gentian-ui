#!/bin/sh
# SPDX-FileCopyrightText: 2026 Gentian Organization
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Assemble the served document root at container start, injecting runtime
# configuration that must not be baked into the image.
#
# Why config arrives at run time
# ------------------------------
# Vite substitutes import.meta.env.VITE_* at BUILD time, so anything passed as a
# build arg is frozen into the JavaScript bundle. One portal image is published
# and deployed to every cluster, so a baked-in value can only ever be right for
# the cluster that built it — and the SPA derives the kernel domain from the
# OIDC issuer and treats <tenant>.<kernel-domain> as the host to send sessions
# to, so a wrong issuer sends users to an entirely different deployment.
#
# Config therefore comes from the environment at container start (12-factor III).
# The image is identical across clusters; only its environment differs.
#
# Why it copies the document root
# -------------------------------
# The Pod runs with readOnlyRootFilesystem: true, so /app/dist cannot be written
# to. The static files are copied once into a writable emptyDir and config.js is
# generated alongside them, which keeps the container immutable where it matters
# and still lets configuration arrive at run time. The payload is a few hundred
# kilobytes, so the copy costs milliseconds.
#
# index.html loads /config.js as a plain classic script BEFORE the module bundle,
# so window.__GENTIAN_CONFIG__ is populated before any application code reads it.
set -eu

SRC_DIR="${GENTIAN_SRC_DIR:-/app/dist}"
WWW_DIR="${GENTIAN_WWW_DIR:-/app/www}"
CONFIG_PATH="${WWW_DIR}/config.js"

# Fail loudly rather than serve a portal that cannot authenticate. An empty
# issuer degrades into "auth is not configured" screens that look like a Keycloak
# fault; refusing to start points at the actual cause.
if [ -z "${OIDC_ISSUER:-}" ] && [ "${AUTH_DISABLED:-false}" != "true" ]; then
    echo "FATAL: OIDC_ISSUER is unset and AUTH_DISABLED is not true." >&2
    echo "       Set OIDC_ISSUER to https://id.<kernel-domain>/auth/realms/<realm>" >&2
    echo "       on the web Deployment, or set AUTH_DISABLED=true for local dev." >&2
    exit 1
fi

if [ ! -d "${WWW_DIR}" ]; then
    echo "FATAL: ${WWW_DIR} does not exist. The Deployment must mount a writable" >&2
    echo "       volume there (emptyDir), because readOnlyRootFilesystem is set." >&2
    exit 1
fi

# cp, then verify. A failed redirect does NOT trip `set -e` on its own, so every
# step here is checked explicitly: an unverified failure would print "runtime
# config written" and leave the SPA to request /config.js, receive index.html
# from the catch-all rewrite with a 200, and run with no configuration at all.
#
# -R, not -a: the destination is an emptyDir owned by the runtime user, and
# preserving ownership from the image layer is both impossible unprivileged and
# pointless. `cp -a` logs "can't preserve ownership" for every file and risks a
# non-zero exit on stricter filesystems.
cp -R "${SRC_DIR}/." "${WWW_DIR}/" || {
    echo "FATAL: could not populate ${WWW_DIR} from ${SRC_DIR}" >&2
    exit 1
}

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
    # Only scopes the realm defines. The kernel realm has no "groups" scope;
    # requesting an undefined scope returns invalid_scope and traps the user in
    # a login loop.
    emit 'oidcScopes'   "${OIDC_SCOPES:-openid profile email}"
    emit 'authDisabled' "${AUTH_DISABLED:-false}"
    emit 'kernelDomain' "${KERNEL_DOMAIN:-}"
    echo '};'
} > "${CONFIG_PATH}" || {
    echo "FATAL: could not write ${CONFIG_PATH}" >&2
    exit 1
}

# Prove it landed. Without this check the only symptom is the SPA silently
# receiving index.html where it expects its configuration.
if [ ! -s "${CONFIG_PATH}" ]; then
    echo "FATAL: ${CONFIG_PATH} is missing or empty after generation." >&2
    exit 1
fi
if ! grep -q '__GENTIAN_CONFIG__' "${CONFIG_PATH}"; then
    echo "FATAL: ${CONFIG_PATH} does not define window.__GENTIAN_CONFIG__." >&2
    exit 1
fi

echo "runtime config written to ${CONFIG_PATH} (issuer=${OIDC_ISSUER:-<none>}, kernelDomain=${KERNEL_DOMAIN:-<none>})"
exec "$@"
