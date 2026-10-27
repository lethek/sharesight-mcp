FROM node:24-alpine AS build
WORKDIR /app

# The release version, stamped into package.json so the server reports it (see src/version.ts)
ARG VERSION=0.0.0-dev

# --ignore-scripts because the prepare script runs the build, which needs the source copied below
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm version "$VERSION" --no-git-tag-version --allow-same-version && npm run build

FROM node:24-alpine AS dependencies
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=3000

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000

# The server will not start without MCP_AUTH_TOKEN, because it listens on all interfaces here
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${MCP_PORT}/healthz" || exit 1

ENTRYPOINT ["node", "dist/index.js"]
CMD ["serve"]
