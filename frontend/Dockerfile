# Pin digest to avoid flaky Docker Hub tag resolution in CI (node:24-alpine).
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build
WORKDIR /app

ARG VITE_OIDC_ISSUER=""
ARG VITE_OIDC_CLIENT_ID=""
ARG VITE_OIDC_REDIRECT_URI=""
ARG VITE_OIDC_SCOPES="openid profile email"
ARG VITE_AUTH_DISABLED="false"

ENV VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER
ENV VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID
ENV VITE_OIDC_REDIRECT_URI=$VITE_OIDC_REDIRECT_URI
ENV VITE_OIDC_SCOPES=$VITE_OIDC_SCOPES
ENV VITE_AUTH_DISABLED=$VITE_AUTH_DISABLED

COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd
RUN npm install -g serve@14.2.4
COPY --from=build /app/dist /app/dist
USER 65532
EXPOSE 8080
CMD ["serve", "-s", "/app/dist", "-l", "8080"]
