#
# LocalChat UI — review container.
#
# Builds the renderer against the in-process mock service and serves the static bundle, so
# the team, the supervisor and BEUMER can open the interface in a browser without installing
# Node, without the RAG backend, and without a GPU. It is a review and demo target, not the
# shipping artefact: the product ships as the Electron installer built by `npm run package`.
#
# Build:  docker build -f docker/Dockerfile -t localchat-ui .
# Run:    docker run --rm -p 8080:8080 localchat-ui

# ---------------------------------------------------------------------------
# Stage 1 — install dependencies
# Copying only the manifests first means a source edit does not invalidate the
# dependency layer, which is the difference between a 5 second and a 90 second rebuild.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/tokens/package.json ./packages/tokens/
COPY apps/renderer/package.json ./apps/renderer/
COPY apps/desktop/package.json ./apps/desktop/

# The Electron binary is a ~100 MB download that this image never runs.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 2 — build the renderer
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/renderer/node_modules ./apps/renderer/node_modules
COPY . .

# Fail the image rather than shipping a bundle that does not typecheck.
RUN npm run build --workspace @localchat/contracts \
 && npx tsc --noEmit -p apps/renderer/tsconfig.json

# LOCALCHAT_MOCKS keeps the mock service in this build. It is the only reason
# this image can run with no backend, and the only build where that flag is set.
ENV LOCALCHAT_MOCKS=1
RUN npm run build --workspace @localchat/renderer

# ---------------------------------------------------------------------------
# Stage 3 — serve
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="BEUMER LocalChat UI" \
      org.opencontainers.image.description="Review build of the LocalChat interface, running against the mock service." \
      org.opencontainers.image.source="https://github.com/samosusa/BEUMER-GROUP-LocalChat"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/renderer/dist /usr/share/nginx/html

# Runs unprivileged: nginx:alpine ships an nginx user, and there is nothing here worth root.
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx \
 && touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid
USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
