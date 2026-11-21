# The concierge: static files, nothing to build. Served by the same small
# static server the consoles' web images run, as the same unprivileged user.
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
# serve 14.2.4 serves with serve-handler 6.1.6, the version the header tests
# run serve.json against (package.json): bump the two together.
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
