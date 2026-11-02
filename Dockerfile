# Source pipeline image (docs/adr/0006). Same command on a laptop or the VM:
#   docker compose run --rm sources --source=hospital-angeles
# Moves to the Playwright base image when the first browser-rendered source
# (Star Médica, roadmap phase 3) lands.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

COPY scripts/sources ./scripts/sources

# Runs go to a mounted volume, never into the image.
ENV SOURCES_DATA_DIR=/data
VOLUME /data

USER node
ENTRYPOINT ["node", "--import", "tsx", "scripts/sources/run.ts"]
