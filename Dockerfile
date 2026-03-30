FROM rust:1.82-slim-bookworm as builder
WORKDIR /app
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
