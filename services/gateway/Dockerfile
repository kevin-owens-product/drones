FROM golang:1.23-alpine@sha256:383395b794dffa5b53012a212365d40c8e37109a626ca30d6151c8348d380b5f AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
COPY services/gateway/go.mod services/gateway/go.sum ./
RUN go mod download
COPY services/gateway ./
RUN go test ./... && go build -o /gateway ./cmd/gateway

FROM alpine:3.20
RUN adduser -D -u 10001 gateway
USER gateway
COPY --from=build /gateway /gateway
EXPOSE 8088
ENTRYPOINT ["/gateway"]
