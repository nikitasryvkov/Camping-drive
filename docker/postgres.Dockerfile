# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193

ARG VCS_REF=unverified
LABEL org.opencontainers.image.revision="${VCS_REF}"

RUN apk add --no-cache su-exec=0.3-r0 \
  && sed -i 's/exec gosu postgres/exec su-exec postgres/' /usr/local/bin/docker-entrypoint.sh \
  && rm -f /usr/local/bin/gosu
