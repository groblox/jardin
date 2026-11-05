# Home Assistant add-on image. The add-on build context is only this folder,
# so the app source is fetched from the repository at build time.
FROM node:22-alpine AS build
ARG JARDIN_REPO=https://github.com/groblox/jardin.git
ARG JARDIN_REF=main
RUN apk add --no-cache git
RUN git clone --depth 1 --branch "$JARDIN_REF" "$JARDIN_REPO" /app
WORKDIR /app
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
# /data is the add-on's persistent storage; SUPERVISOR_TOKEN is injected by Home Assistant.
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/core ./src/core
CMD ["node", "server/index.ts"]
