# build
FROM golang:1.22 AS builder
WORKDIR /src
COPY . .
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o app .

# run
FROM alpine:3.20
WORKDIR /app
COPY --from=builder /src/app /app/app
EXPOSE 8080
ENV PORT=8080
CMD ["/app/app"]
