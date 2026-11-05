# Standalone image: docker build -t jardin . && docker run -p 8787:8787 -v jardin-data:/data jardin
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/core ./src/core
VOLUME /data
EXPOSE 8787
CMD ["node", "server/index.ts"]
