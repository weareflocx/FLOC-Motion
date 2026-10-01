FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ffmpeg ca-certificates fonts-liberation gosu \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    HYPERFRAMES_NO_UPDATE_CHECK=1 \
    HYPERFRAMES_NO_AUTO_INSTALL=1 \
    HYPERFRAMES_NO_TELEMETRY=1 \
    HYPERFRAMES_SKIP_SKILLS=1
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/.data/engine ./.data/engine
RUN chown node:node /app /app/.data
COPY --chown=node:node server/docker-entrypoint.sh /usr/local/bin/floc-entrypoint
RUN chmod +x /usr/local/bin/floc-entrypoint
ENTRYPOINT ["floc-entrypoint"]
EXPOSE 8080
CMD ["npm", "start"]
