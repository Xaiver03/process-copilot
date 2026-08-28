FROM node:22-bookworm-slim AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /workspace

RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
RUN pnpm --filter web build
RUN mkdir -p /tmp/web-public \
    && if [ -d apps/web/public ]; then cp -a apps/web/public/. /tmp/web-public/; fi

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system --gid 10001 process \
    && useradd --system --uid 10001 --gid process --home-dir /app --shell /usr/sbin/nologin process

COPY --from=build --chown=process:process /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=process:process /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=process:process /tmp/web-public ./apps/web/public

USER process
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
