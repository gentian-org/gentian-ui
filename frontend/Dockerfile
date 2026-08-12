# Pin digest to avoid flaky Docker Hub tag resolution in CI (node:24-alpine).
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build
WORKDIR /app

# No VITE_* build args. Vite substitutes import.meta.env.VITE_* at BUILD time,
# so anything passed here is frozen into the bundle — and one image is deployed
# to every cluster. VITE_OIDC_ISSUER used to be baked in as the test cluster's
# https://id.desk.gentian.org/auth/realms/kernel, so every other cluster ran a
# portal that believed it lived on desk.gentian.org and redirected tenants to a
# different deployment entirely.
#
# Deployment-specific values now arrive from the environment at container start
# (docker-entrypoint.sh -> /config.js), which is where they belong. The image is
# byte-identical across clusters.

COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd
RUN npm install -g serve@14.2.4
COPY --from=build /app/dist /app/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    # The entrypoint writes /app/dist/config.js at start, and the container runs
    # unprivileged, so that directory has to be writable by the runtime user.
    && chown -R 65532:65532 /app/dist
USER 65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# -c serve.json applies the cache headers. public/serve.json carries no comments
# because `serve` validates it against a strict schema and rejects unknown keys
# (including "$comment"), so the reasoning lives here:
#
#   config.js   no-store  — per-cluster runtime config, must never be reused
#   index.html  no-cache  — names the current asset hashes; a stale copy asks for
#                           hashes that no longer exist, and the SPA rewrite
#                           answers those with index.html at 200, so the browser
#                           gets HTML where it expects JavaScript and the app
#                           fails to boot until a hard reload
#   assets/**   immutable — content-addressed filenames, safe to keep forever
#
# Without this `serve` sends only an ETag and browsers fall back to heuristic
# caching, which is exactly how the stale-bundle breakage happened.
CMD ["serve", "-s", "/app/dist", "-l", "8080", "-c", "/app/dist/serve.json"]
