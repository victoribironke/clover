FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV RUN_MODE=cloud
ENV TELEGRAM_MODE=webhook
EXPOSE 8080
CMD ["bun", "src/index.ts"]
