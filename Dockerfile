# One image, one Cloud Run service: the bot, on Bun.

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
EXPOSE 8080
# Bun is PID 1, so Cloud Run's SIGTERM reaches the bot directly: it releases its locks and
# reports an interrupted scan (see shutdown in src/index.ts)
CMD ["bun", "src/index.ts"]
