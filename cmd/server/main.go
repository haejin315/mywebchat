package main

import (
	"log"

	"mywebchat/internal/config"
	"mywebchat/internal/httpserver"
)

func main() {
	cfg := config.Load()

	handler := httpserver.Routes()
	srv := httpserver.New(httpserver.Options{
		Addr:    cfg.Addr(),
		Handler: handler,
	})

	log.Printf("server listening on http://%s", cfg.Addr())
	log.Printf("health check:      http://%s/healthz", cfg.Addr())

	if err := srv.Start(); err != nil {
		log.Fatal(err)
	}
}
