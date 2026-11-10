# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# helm: .containers.sourcebot
# ------ Global scope variables ------

# Set of global build arguments.
# These are considered "public" and will be baked into the image.
# The convention is to prefix these with `NEXT_PUBLIC_` so that
# they can be optionally be passed as client-side environment variables
# in the webapp.
# @see: https://docs.docker.com/build/building/variables/#scoping

ARG NEXT_PUBLIC_BUILD_COMMIT_SHA

FROM node:24-alpine3.23@sha256:0efee1e068d21f6edcab7fa8c962fc4ecd50d4e28727bc23963379b63ee318ab AS node-alpine
FROM golang:1.27-alpine@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18 AS go-alpine
# ----------------------------------

# ------ Build Zoekt ------
FROM go-alpine AS zoekt-builder
RUN apk add --no-cache ca-certificates
WORKDIR /zoekt
COPY vendor/zoekt/go.mod vendor/zoekt/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod,id=gomod \
    go mod download
COPY vendor/zoekt ./
RUN --mount=type=cache,target=/go/pkg/mod,id=gomod \
    --mount=type=cache,target=/root/.cache/go-build,id=gobuild \
    CGO_ENABLED=0 GOOS=linux go build -o /cmd/ ./cmd/...
# -------------------------

# ------ Build shared libraries ------
FROM node-alpine AS shared-libs-builder
WORKDIR /app
# Store fetched packages in Yarn's global cache (/root/.yarn/berry) so it can
# live in a BuildKit cache mount shared across builds, instead of the
# project-local .yarn/cache which Yarn prunes on every install.
ENV YARN_ENABLE_GLOBAL_CACHE=true

COPY package.json yarn.lock* .yarnrc.yml ./
COPY .yarn ./.yarn
COPY ./packages/db ./packages/db
COPY ./packages/schemas ./packages/schemas
COPY ./packages/shared ./packages/shared
COPY ./packages/queryLanguage ./packages/queryLanguage

# A Yarn install is project-wide, so a single install fetches and builds all of
# the workspaces copied above.
RUN --mount=type=cache,target=/root/.yarn,id=yarn \
    yarn install
# ------------------------------------

# ------ Build Web ------
FROM node-alpine AS web-builder
ENV SKIP_ENV_VALIDATION=1
# -----------
ARG NEXT_PUBLIC_BUILD_COMMIT_SHA
ENV NEXT_PUBLIC_BUILD_COMMIT_SHA=$NEXT_PUBLIC_BUILD_COMMIT_SHA
# -----------

RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV YARN_ENABLE_GLOBAL_CACHE=true

COPY package.json yarn.lock* .yarnrc.yml ./
COPY .yarn ./.yarn
COPY --from=shared-libs-builder /app/node_modules ./node_modules
COPY --from=shared-libs-builder /app/packages/db ./packages/db
COPY --from=shared-libs-builder /app/packages/schemas ./packages/schemas
COPY --from=shared-libs-builder /app/packages/shared ./packages/shared
COPY --from=shared-libs-builder /app/packages/queryLanguage ./packages/queryLanguage
# Only the manifest is needed to install dependencies. Copying the sources
# afterwards keeps this layer cached when only web code changes.
COPY ./packages/web/package.json ./packages/web/package.json

# Fixes arm64 timeouts
RUN --mount=type=cache,target=/root/.yarn,id=yarn \
    yarn workspace @sourcebot/web install

COPY ./packages/web ./packages/web

ENV NEXT_TELEMETRY_DISABLED=1

# .next/cache holds the Turbopack/Next.js build cache, reused across builds.
# - sharing=private: Turbopack's persistent cache is not safe for concurrent
#   writers, so parallel builds on the same builder each get their own cache
#   instance instead of corrupting a shared one.
# - If the build fails (e.g. a corrupt cache from an interrupted build makes
#   Turbopack panic with "Restore failures"), retry once with a clean cache.
RUN --mount=type=cache,target=/app/packages/web/.next/cache,id=sourcebot-next,sharing=private \
    yarn workspace @sourcebot/web build \
    || { echo "Web build failed; retrying with a clean Turbopack cache"; \
         rm -rf /app/packages/web/.next/cache/turbopack; \
         yarn workspace @sourcebot/web build; }
ENV SKIP_ENV_VALIDATION=0
# ------------------------------

# ------ Build Backend ------
FROM node-alpine AS backend-builder
ENV SKIP_ENV_VALIDATION=1

WORKDIR /app
ENV YARN_ENABLE_GLOBAL_CACHE=true

COPY package.json yarn.lock* .yarnrc.yml ./
COPY .yarn ./.yarn
COPY --from=shared-libs-builder /app/node_modules ./node_modules
COPY --from=shared-libs-builder /app/packages/db ./packages/db
COPY --from=shared-libs-builder /app/packages/schemas ./packages/schemas
COPY --from=shared-libs-builder /app/packages/shared ./packages/shared
COPY --from=shared-libs-builder /app/packages/queryLanguage ./packages/queryLanguage
# Install from the manifest only, then copy sources, so backend code changes
# don't invalidate the install layer.
COPY ./packages/backend/package.json ./packages/backend/package.json
RUN --mount=type=cache,target=/root/.yarn,id=yarn \
    yarn workspace @sourcebot/backend install
COPY ./schemas ./schemas
COPY ./packages/backend ./packages/backend
RUN yarn workspace @sourcebot/backend build

ENV SKIP_ENV_VALIDATION=0
# ------------------------------

# ------ Runner ------
FROM node-alpine AS runner
# -----------
ARG NEXT_PUBLIC_BUILD_COMMIT_SHA
ENV NEXT_PUBLIC_BUILD_COMMIT_SHA=$NEXT_PUBLIC_BUILD_COMMIT_SHA
# -----------

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/data
ENV DATA_CACHE_DIR=$DATA_DIR/.sourcebot
# Valid values are: debug, info, warn, error
ENV SOURCEBOT_LOG_LEVEL=info


# Configure dependencies
RUN apk add --no-cache git ca-certificates bind-tools tini jansson wget supervisor curl perl openssl util-linux unzip && \
    apk upgrade --no-cache

# Remove npm (unused — we use Yarn). The Node.js base image bundles npm
# with its own transitive dependencies (minimatch, tar, picomatch, etc.)
# that Trivy flags as vulnerable. Since npm is never invoked at runtime,
# removing it eliminates these false positives and reduces image size.
RUN rm -rf /usr/local/lib/node_modules/npm && \
    rm -rf /usr/local/bin/npm && \
    rm -rf /usr/local/bin/npx && \
    rm -rf /root/.npm && \
    rm -rf /root/.node-gyp

# Configure zoekt
# Built from source, so keep it ahead of any COPY of frequently-changing files
# (package.json, yarn.lock, ...) to keep this layer cached.
COPY vendor/zoekt/install-ctags-alpine.sh .
RUN ./install-ctags-alpine.sh && rm install-ctags-alpine.sh && \
    # Clean up ctags build artifacts
    rm -rf /tmp/*

ARG UID=1500
ARG GID=1500

# Always create the non-root user to support runtime user switching
# The container can be run as root (default) or as sourcebot user using docker run --user
RUN addgroup -g $GID sourcebot && \
    adduser -D -u $UID -h /app -S sourcebot && \
    chown -R sourcebot /app && \
    adduser sourcebot node && \
    mkdir /var/log/sourcebot && \
    chown sourcebot /var/log/sourcebot

COPY package.json yarn.lock* .yarnrc.yml ./
COPY .yarn ./.yarn

RUN mkdir -p ${DATA_CACHE_DIR}
COPY --from=zoekt-builder \
/cmd/zoekt-git-index \
/cmd/zoekt-indexserver \
/cmd/zoekt-mirror-github \
/cmd/zoekt-mirror-gitiles \
/cmd/zoekt-mirror-bitbucket-server \
/cmd/zoekt-mirror-gitlab \
/cmd/zoekt-mirror-gerrit \
/cmd/zoekt-webserver \
/cmd/zoekt-index \
/usr/local/bin/

RUN chown -R sourcebot:sourcebot /app

# Copy zoekt proto files (needed for gRPC client at runtime)
COPY --chown=sourcebot:sourcebot vendor/zoekt/grpc/protos /app/vendor/zoekt/grpc/protos

# Copy OpenAPI docs
COPY --chown=sourcebot:sourcebot docs/api-reference/sourcebot-public.openapi.json /app/docs/api-reference/sourcebot-public.openapi.json

# Copy all of the things
COPY --chown=sourcebot:sourcebot --from=web-builder /app/packages/web/public ./packages/web/public
COPY --chown=sourcebot:sourcebot --from=web-builder /app/packages/web/.next/standalone ./
COPY --chown=sourcebot:sourcebot --from=web-builder /app/packages/web/.next/static ./packages/web/.next/static

COPY --chown=sourcebot:sourcebot --from=backend-builder /app/node_modules ./node_modules
COPY --chown=sourcebot:sourcebot --from=backend-builder /app/packages/backend ./packages/backend

COPY --chown=sourcebot:sourcebot --from=shared-libs-builder /app/packages/db ./packages/db
COPY --chown=sourcebot:sourcebot --from=shared-libs-builder /app/packages/schemas ./packages/schemas
COPY --chown=sourcebot:sourcebot --from=shared-libs-builder /app/packages/shared ./packages/shared
COPY --chown=sourcebot:sourcebot --from=shared-libs-builder /app/packages/queryLanguage ./packages/queryLanguage

# Fixes git "dubious ownership" issues when the volume is mounted with different permissions to the container.
RUN git config --system safe.directory "*"

# Make app directory accessible to both root and sourcebot user
RUN chown -R sourcebot /app \
	&& chgrp -R 0  /app \
	&& chmod -R g=u /app
# Make data directory accessible to both root and sourcebot user
RUN chown -R sourcebot /data

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY prefix-output.sh ./prefix-output.sh
RUN chmod +x ./prefix-output.sh
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Note: for back-compat cases, we do _not_ set the USER directive here.
# Instead, the user can be overridden at runtime with --user flag.
# USER sourcebot

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENTRYPOINT ["/sbin/tini", "--", "./entrypoint.sh"]
# ------------------------------