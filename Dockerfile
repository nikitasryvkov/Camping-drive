# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SITE_URL=https://camping.drivebro.ru
ARG VITE_WEB3FORMS_ACCESS_KEY
ARG VITE_YANDEX_METRIKA_ID=

ENV VITE_SITE_URL=${VITE_SITE_URL}
ENV VITE_WEB3FORMS_ACCESS_KEY=${VITE_WEB3FORMS_ACCESS_KEY}
ENV VITE_YANDEX_METRIKA_ID=${VITE_YANDEX_METRIKA_ID}

RUN test -n "$VITE_WEB3FORMS_ACCESS_KEY" || (echo "VITE_WEB3FORMS_ACCESS_KEY is required" >&2 && exit 1)
RUN npm run build

FROM nginx:1.30.3-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
