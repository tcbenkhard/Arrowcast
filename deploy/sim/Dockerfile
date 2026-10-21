FROM node:24.13.0-bookworm AS build
WORKDIR /opt/arrowcast/current
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/scoring/package.json packages/scoring/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY apps apps
COPY packages packages
COPY migrations migrations
RUN npm run build && npm prune --omit=dev

FROM node:24.13.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends nginx python3 supervisor \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system arrowcast && useradd --system --gid arrowcast arrowcast
WORKDIR /opt/arrowcast/current
COPY --from=build /opt/arrowcast/current ./
COPY deploy/pi/stage-arrowcast/00-install/files/network.py /usr/local/lib/arrowcast/network.py
COPY deploy/pi/stage-arrowcast/00-install/files/nginx.conf /etc/nginx/sites-enabled/default
COPY deploy/sim /opt/sim
RUN sed -i 's|error_log syslog:server=unix:/dev/log,tag=arrowcast_web warn;|error_log /var/log/arrowcast/frontend.log warn;|' /etc/nginx/sites-enabled/default \
    && ln -s /opt/sim/journalctl.py /usr/local/bin/journalctl \
    && ln -s /opt/sim/simctl.py /usr/local/bin/simctl \
    && ln -s /bin/true /usr/local/bin/rfkill \
    && chmod +x /opt/sim/journalctl.py /opt/sim/simctl.py
ENV NODE_ENV=production HOST=127.0.0.1 PORT=3000 DATABASE_PATH=/var/lib/arrowcast/arrowcast.sqlite
EXPOSE 80
CMD ["python3", "/opt/sim/start.py"]
