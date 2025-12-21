package httpserver

import (
	"context"
	"net/http"
	"time"
)

type Server struct {
	httpServer *http.Server
}

type Options struct {
	Addr    string
	Handler http.Handler
}

func New(opts Options) *Server {
	s := &http.Server{
		Addr:              opts.Addr,
		Handler:           opts.Handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	return &Server{httpServer: s}
}

func (s *Server) Start() error {
	// 나중에 TLS(HTTPS) 붙일 때도 여기만 바꾸면 됨
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}
