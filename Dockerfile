# Source pipeline image (docs/adr/0006). Same command on a laptop or the VM:
#   docker compose run --rm sources --source=hospital-angeles
# Playwright's base image carries Chromium and its system libraries for the
# browser sources (Star Médica, CONACEM). Keep its tag equal to the
# "playwright" version pinned in package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts && chown -R pwuser /app

COPY scripts/sources ./scripts/sources

# Runs go to a mounted volume, never into the image.
ENV SOURCES_DATA_DIR=/data
VOLUME /data

USER pwuser
ENTRYPOINT ["node", "--import", "tsx", "scripts/sources/run.ts"]
