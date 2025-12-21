package httpserver

import (
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 5 * time.Second
	pongWait   = 10 * time.Second
	pingPeriod = (pongWait * 8) / 10 // pongWait보다 약간 짧게
)

type Rect struct {
	ID    string  `json:"id"`
	Owner string  `json:"owner"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
	Color int     `json:"color"` // 0~6
	Text  string  `json:"text,omitempty"`
}

type WSMessage struct {
	Type    string `json:"type"`             // "hello" | "rect" | "remove"
	UserID  string `json:"userId,omitempty"` // hello 때 사용
	Rect    *Rect  `json:"rect,omitempty"`   // rect 때 사용
	RectID  string `json:"rectId,omitempty"` // remove 때 사용
	Color   int    `json:"color,omitempty"`
	Message string `json:"message,omitempty"`
	Drop    *Drop  `json:"drop,omitempty"`
}

type Hub struct {
	mu        sync.Mutex
	rects     map[string]Rect
	conns     map[*websocket.Conn]bool
	connUser  map[*websocket.Conn]string // 추가
	userColor map[string]int             // userId -> color
}

type Drop struct {
	ID     string  `json:"id"`
	Owner  string  `json:"owner"`
	Text   string  `json:"text"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	FontPx float64 `json:"fontPx"`
}

func NewHub() *Hub {
	return &Hub{
		rects:     make(map[string]Rect),
		conns:     make(map[*websocket.Conn]bool),
		connUser:  make(map[*websocket.Conn]string),
		userColor: make(map[string]int),
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (h *Hub) pickFreeColorLocked() (int, bool) {
	used := make([]bool, 7)
	for _, c := range h.userColor {
		if 0 <= c && c < 7 {
			used[c] = true
		}
	}
	for i := 0; i < 7; i++ {
		if !used[i] {
			return i, true
		}
	}
	return -1, false
}

func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	// heartbeat 설정
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	h.mu.Lock()
	h.conns[conn] = true
	h.mu.Unlock()

	log.Println("ws connected")

	done := make(chan struct{})

	go func() {
		ticker := time.NewTicker(pingPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					select {
					case <-done:
					default:
						close(done)
					}
					return
				}
			case <-done:
				return
			}
		}
	}()

	defer func() {
		// ping goroutine 종료
		select {
		case <-done:
		default:
			close(done)
		}

		// ✅ 기존: disconnect cleanup (유저 rect 제거 + remove 브로드캐스트)
		h.mu.Lock()
		uid := h.connUser[conn]
		if uid != "" {
			for id, r := range h.rects {
				if r.Owner == uid {
					delete(h.rects, id)
					msg := WSMessage{Type: "remove", RectID: id}
					for c := range h.conns {
						_ = c.SetWriteDeadline(time.Now().Add(writeWait))
						_ = c.WriteJSON(msg)
					}
				}
			}
			delete(h.userColor, uid)
		}
		delete(h.connUser, conn)
		delete(h.conns, conn)
		h.mu.Unlock()

		_ = conn.Close()
		log.Println("ws disconnected")
	}()

	for {
		var msg WSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			return
		}

		switch msg.Type {

		case "hello":
			uid := msg.UserID
			if uid == "" {
				continue
			}

			h.mu.Lock()
			log.Printf("[HELLO] users=%v", h.userColor)

			// 최대 7명 + 색 배정
			if _, ok := h.userColor[uid]; !ok {
				if len(h.userColor) >= 7 {
					_ = conn.WriteJSON(WSMessage{Type: "error", Message: "최대 7명까지만 접속 가능"})
					h.mu.Unlock()
					return
				}

				c, ok := h.pickFreeColorLocked()
				if !ok {
					_ = conn.WriteJSON(WSMessage{Type: "error", Message: "사용 가능한 색상이 없음"})
					h.mu.Unlock()
					return
				}
				h.userColor[uid] = c

				// 모두에게 presence
				for cc := range h.conns {
					_ = cc.WriteJSON(WSMessage{Type: "presence", UserID: uid, Color: c})
				}
			}

			h.connUser[conn] = uid

			// 내 색(welcome)
			_ = conn.WriteJSON(WSMessage{Type: "welcome", UserID: uid, Color: h.userColor[uid]})

			// 신규 conn에게 스냅샷
			for u, c := range h.userColor {
				_ = conn.WriteJSON(WSMessage{Type: "presence", UserID: u, Color: c})
			}
			for _, rect := range h.rects {
				r := rect
				_ = conn.WriteJSON(WSMessage{Type: "rect", Rect: &r})
			}

			h.mu.Unlock()

		case "rect":
			if msg.Rect == nil {
				continue
			}

			h.mu.Lock()
			uid := h.connUser[conn]
			if uid == "" {
				h.mu.Unlock()
				continue
			}

			rect := *msg.Rect
			rect.Owner = uid
			rect.Color = h.userColor[uid] // 서버가 색 강제
			// rect.Text는 클라가 보낸 그대로

			if h.collides(rect) {
				h.mu.Unlock()
				continue
			}

			h.rects[rect.ID] = rect

			out := WSMessage{Type: "rect", Rect: &rect}
			for c := range h.conns {
				_ = c.SetWriteDeadline(time.Now().Add(writeWait))
				_ = c.WriteJSON(out)
			}
			h.mu.Unlock()

		case "drop":
			if msg.Drop == nil {
				continue
			}

			h.mu.Lock()
			uid := h.connUser[conn]
			if uid == "" {
				h.mu.Unlock()
				continue
			}

			d := *msg.Drop

			// 서버가 owner 강제 (클라가 다른 owner로 위조 못하게)
			d.Owner = uid

			// 너무 긴 텍스트 제한 (안 하면 폭탄 됨)
			if len([]rune(d.Text)) > 200 {
				d.Text = string([]rune(d.Text))[:200]
			}

			out := WSMessage{Type: "drop", Drop: &d}
			for c := range h.conns {
				_ = c.SetWriteDeadline(time.Now().Add(writeWait))
				_ = c.WriteJSON(out)
			}
			h.mu.Unlock()

		default:
			// ignore
		}
	}

}

func (h *Hub) collides(candidate Rect) bool {
	for id, r := range h.rects {
		if id == candidate.ID {
			continue
		}
		if intersects(candidate, r) {
			return true
		}
	}
	return false
}

func intersects(a, b Rect) bool {
	return !(a.X+a.W <= b.X ||
		b.X+b.W <= a.X ||
		a.Y+a.H <= b.Y ||
		b.Y+b.H <= a.Y)
}
