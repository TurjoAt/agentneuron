# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts ./scripts
COPY src ./src
COPY ui ./ui
RUN node scripts/build.mjs --strict

FROM node:22-alpine
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="agentneuron" \
      org.opencontainers.image.description="AI context control center for CLAUDE.md, AGENTS.md, Cursor/Copilot rules, skills and agent configs" \
      org.opencontainers.image.source="https://github.com/TurjoAt/agentneuron" \
      org.opencontainers.image.url="https://github.com/TurjoAt/agentneuron" \
      org.opencontainers.image.documentation="https://github.com/TurjoAt/agentneuron#readme" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.authors="Rezaul Hoque Turjo <hi@turjo.me>" \
      org.opencontainers.image.vendor="Rezaul Hoque Turjo" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
RUN mkdir -p /app /project && chown node:node /project
COPY --from=build /src/dist/agentneuron.mjs /app/agentneuron.mjs
USER node
WORKDIR /project
EXPOSE 4747
# Binding 0.0.0.0 makes agentneuron auto-generate an access token (printed in the logs).
# Mount your project at /project; add ":ro" to keep it strictly read-only.
ENTRYPOINT ["node", "/app/agentneuron.mjs"]
CMD ["start", "/project", "--host", "0.0.0.0"]
