FROM rust:1.82-slim-bookworm as builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake pkg-config libssl-dev libsasl2-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/target/release/rspring-viewer /app/
COPY static ./static
COPY config ./config
RUN mkdir -p models
EXPOSE 3050
CMD ["./rspring-viewer"]
