# The concierge: static files, nothing to build. Served by the same small
# static server the consoles' web images run, as the same unprivileged user.
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94
RUN npm install -g serve@14.2.4
COPY serve.json /app/serve.json
COPY site /app/site
# No outbound call on start: serve otherwise asks the npm registry for a newer
# version of itself, from a pod that has no business talking to the internet.
ENV NO_UPDATE_CHECK=1
USER 65532
EXPOSE 8080
# No -s: there is no client-side routing, and an unknown path should be a 404
# rather than the page. config.json is replaced by the deployment's own.
CMD ["serve", "/app/site", "-l", "8080", "-c", "/app/serve.json"]
