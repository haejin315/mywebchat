# =========================
# 1) Build
# =========================
FROM golang:1.22 AS builder
WORKDIR /src

# 모듈 캐시 최적화
COPY go.mod go.sum ./
RUN go mod download

# 소스 전체 복사
COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/app ./cmd/server

# =========================
# 2) Run
# =========================
FROM alpine:3.20
WORKDIR /app

COPY --from=builder /out/app /app/app

EXPOSE 8080
ENV PORT=8080

CMD ["/app/app"]
