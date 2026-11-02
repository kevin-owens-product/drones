FROM golang:1.26-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0
COPY services/gateway ./
RUN go mod tidy && go test ./... && go build -o /gateway ./cmd/gateway

FROM alpine:3.20
RUN adduser -D -u 10001 gateway
USER gateway
COPY --from=build /gateway /gateway
EXPOSE 8088
ENTRYPOINT ["/gateway"]
