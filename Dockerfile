# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS source-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM source-dependencies AS frontend-build

COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.server.json postcss.config.js tailwind.config.js ./
COPY public ./public
COPY src ./src
COPY shared ./shared

ARG VITE_SITE_URL=http://localhost:8080
ENV VITE_SITE_URL=${VITE_SITE_URL}

RUN npm run build:frontend

FROM source-dependencies AS backend-build

COPY tsconfig.server.json ./
COPY server/src ./server/src
COPY shared ./shared
RUN npm run build:backend

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS production-dependencies

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM nginxinc/nginx-unprivileged:1.30.3-alpine@sha256:b3f2436575bd5be7386518084d842dac414ab4962712afa31e99e0942a56e3b2 AS frontend-runtime

ARG VCS_REF=unverified
LABEL org.opencontainers.image.revision="${VCS_REF}"

USER root
RUN apk del --no-network curl

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf docker/proxy-params.conf /etc/nginx/
COPY --from=frontend-build /app/dist /usr/share/nginx/html

USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS backend-runtime

ARG VCS_REF=unverified
LABEL org.opencontainers.image.revision="${VCS_REF}"

ENV NODE_ENV=production
WORKDIR /app

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /opt/yarn-v1.22.22 \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=backend-build /app/server/dist ./server/dist
COPY --from=frontend-build /app/dist/index.html ./public/index.html
COPY shared ./shared
COPY server/migrations ./server/migrations
COPY server/package.json ./package.json

RUN mkdir -p /app/uploads/current && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/ready >/dev/null || exit 1

CMD ["node", "server/dist/index.js"]
