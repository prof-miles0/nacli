# syntax=docker/dockerfile:1

# Build on Debian (glibc), where every native build tool has a binary.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# Run on Alpine with production dependencies only.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production CONFIG=/app/config/config.toml
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
USER node
EXPOSE 7080
# /api/auth/me answers without a session; assumes the default listen port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:7080/api/auth/me >/dev/null || exit 1
CMD ["node_modules/.bin/tsx", "server/index.ts"]
