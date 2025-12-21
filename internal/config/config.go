package config

import (
	"os"
)

type Config struct {
	Host string // e.g. "0.0.0.0"
	Port string // e.g. "8080"
}

func Load() Config {
	// AWS 옮길 때도 그대로 ENV만 바꿔주면 됨
	host := getenv("HOST", "0.0.0.0") // 외부에서 접속 가능하도록 기본값 0.0.0.0
	port := getenv("PORT", "8080")
	return Config{
		Host: host,
		Port: port,
	}
}

func (c Config) Addr() string {
	return c.Host + ":" + c.Port
}

func getenv(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}
