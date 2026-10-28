FROM golang:1.22-alpine AS build
WORKDIR /src
COPY services/gateway/go.mod ./
COPY services/gateway ./
RUN go test ./... && go build -o /gateway ./cmd/gateway

FROM alpine:3.20
RUN adduser -D -u 10001 gateway
USER gateway
COPY --from=build /gateway /gateway
EXPOSE 8088
ENTRYPOINT ["/gateway"]
