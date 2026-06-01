FROM ubuntu:22.04

WORKDIR /usr/src/bems

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        libgrpc++-dev \
        libprotobuf-dev \
        pkg-config \
        procps \
        protobuf-compiler \
        protobuf-compiler-grpc \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY edge-core ./edge-core
COPY proto ./proto

RUN cmake -S edge-core -B /opt/bems-edge-build \
    && cmake --build /opt/bems-edge-build

EXPOSE 50051
EXPOSE 47808/udp

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD pgrep edge-core || exit 1
CMD ["/opt/bems-edge-build/edge-core"]
