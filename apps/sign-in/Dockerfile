# The sign-in router: static files, nothing to build. Served by the same small
# static server the consoles' web images run, as the same unprivileged user.
FROM node:22-alpine
RUN npm install -g serve@14.2.4
COPY serve.json /app/serve.json
COPY site /app/site
USER 65532
EXPOSE 8080
# No -s: there is no client-side routing, and an unknown path should be a 404
# rather than the page. config.json is replaced by the deployment's own.
CMD ["serve", "/app/site", "-l", "8080", "-c", "/app/serve.json"]
