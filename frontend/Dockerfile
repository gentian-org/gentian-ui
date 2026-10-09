# Pin digest to avoid flaky Docker Hub tag resolution in CI (node:24-alpine).
#
# BUILDPLATFORM keeps npm and vite on the native runner. This stage emits
# nothing but JavaScript in /app/dist, which is the same bytes whatever the
# target architecture, so running it under QEMU for the arm64 leg would buy an
# identical bundle for several times the wall clock. Only the runtime stage
# below is built per target platform, where the architecture actually shows up
# in the `serve` install.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build
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
# /app/www is the served document root, populated from /app/dist at start. It
# must be a writable volume: the Pod runs readOnlyRootFilesystem: true, so the
# entrypoint cannot generate config.js inside the image layer. Created here so a
# plain `docker run` without a mount still works.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/www \
    && chown -R 65532:65532 /app/www
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
# cleanUrls: false is load-bearing, not a preference. serve-handler turns
# cleanUrls ON when the key is absent, which 301s any path matching
# /(\.html|\/index)$/ to its extensionless form. Combined with `serve -s`, the
# extensionless path is then answered by the single-page rewrite instead of
# resolving back to the file — so every real .html file except index.html
# becomes unreachable over HTTP while sitting perfectly well on disk.
#
# portal-sso.html is exactly such a file. The Nextcloud post-installation hook
# fetches it with `curl -sfLo` and copies it into the app's docroot to hand a
# portal session over to the app. With cleanUrls on it followed the 301 and
# received index.html — the SPA shell — which references /assets/* and
# /config.js as absolute paths that do not exist on the app's origin. The tile
# opened a page whose JavaScript 404ed, so no session was ever exchanged and no
# user was provisioned in the app.
#
# Without this `serve` sends only an ETag and browsers fall back to heuristic
# caching, which is exactly how the stale-bundle breakage happened.
CMD ["serve", "-s", "/app/www", "-l", "8080", "-c", "/app/www/serve.json"]
