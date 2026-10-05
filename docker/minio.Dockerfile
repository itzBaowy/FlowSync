# MinIO no longer distributes these community images reliably.
# Build the upstream tagged source, as documented in its release notes.
FROM golang:1.25-bookworm AS build
ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z
RUN CGO_ENABLED=0 go install github.com/minio/minio@${MINIO_VERSION}
RUN CGO_ENABLED=0 go install github.com/minio/mc@${MC_VERSION}

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /go/bin/minio /usr/local/bin/minio
COPY --from=build /go/bin/mc /usr/local/bin/mc
RUN groupadd --gid 10001 minio && useradd --uid 10001 --gid minio --create-home minio && mkdir /data && chown minio:minio /data
USER minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
