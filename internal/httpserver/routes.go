package httpserver

import "net/http"

func Routes() http.Handler {
	mux := http.NewServeMux()
	hub := NewHub()

	fs := http.FileServer(http.Dir("./web/static"))
	mux.Handle("/", fs)

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("ok"))
	})

	// WebSocket endpoint
	mux.HandleFunc("/ws", hub.HandleWS)

	return mux
}
