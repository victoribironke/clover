# One image, one Cloud Run service: the bot (Bun) and the web panel (Next.js on Node).
# start.sh runs both; the bot is the public entry point and passes panel requests through.

FROM oven/bun:1 AS bot-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Panel packages are installed with Bun; Next.js is built and served with Node, its supported runtime
FROM oven/bun:1 AS web-deps
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile

FROM node:22-slim AS web-build
WORKDIR /app/web
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=web-deps /app/web/node_modules ./node_modules
COPY web/ ./
RUN node node_modules/next/dist/bin/next build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

# bot
COPY --from=bot-deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

# panel: Next's standalone server plus its static files
COPY --from=web-build /app/web/.next/standalone ./web
COPY --from=web-build /app/web/.next/static ./web/.next/static
COPY --from=web-build /app/web/public ./web/public

COPY start.sh ./
RUN chmod +x start.sh
EXPOSE 8080
CMD ["./start.sh"]
