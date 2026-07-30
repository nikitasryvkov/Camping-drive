# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM golang:1.26.5-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS build

WORKDIR /src

COPY docker/caddy-build/go.mod docker/caddy-build/go.sum ./
RUN go mod download

COPY docker/caddy-build/main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/caddy .

FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

ARG VCS_REF=unverified
LABEL org.opencontainers.image.revision="${VCS_REF}"

USER root
RUN apk del --no-network curl \
    && addgroup -S -g 10001 caddy-runtime \
    && adduser -S -D -H -u 10001 -G caddy-runtime caddy-runtime \
    && chown -R caddy-runtime:caddy-runtime /data /config

COPY --from=build /out/caddy /usr/bin/caddy

USER 10001:10001
