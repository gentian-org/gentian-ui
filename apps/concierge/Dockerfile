# The concierge: static files, nothing to build. Served by the same small
# static server the consoles' web images run, as the same unprivileged user.
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4
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
