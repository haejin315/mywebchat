(() => {
  const stage = document.getElementById("stage");
  const toast = document.getElementById("toast");

  // 창마다 고유 ID
  const myId = "u-" + Math.random().toString(16).slice(2, 8);
  const myRectId = myId + "-rect";

  // ===== WebSocket =====
  const ws = new WebSocket(
    (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws"
  );

  ws.onopen = () => {
    console.log("ws connected");
    ws.send(JSON.stringify({ type: "hello", userId: myId }));
  };
  ws.onclose = () => console.log("ws disconnected");
  ws.onerror = (e) => console.log("ws error", e);

  // ===== 상태 =====
  const rects = []; // { id, owner, x, y, w, h, color? }
  const domById = new Map();

  // ✅ 서버가 배정한 색: userId -> colorIndex(0~6)
  const colorByOwner = new Map();

    // 내 박스 한 줄 기준 높이(글씨 크기)
    let myBaseH = 0;
    let isEditing = false;
    let lastGoodText = "";

    const measureCanvas = document.createElement("canvas");
    const mctx = measureCanvas.getContext("2d");

  // ===== UI =====
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 700);
  }

  function clamp(v, min, max) {
    if (max < min) return min;
    return Math.max(min, Math.min(max, v));
  }

  function getMousePos(e) {
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y, w: rect.width, h: rect.height };
  }

  // ===== 색상(무지개 7색) =====
  const COLORS = [
    "#ff4d4d", // red
    "#ff9f1a", // orange
    "#ffd500", // yellow
    "#2ecc71", // green
    "#3498db", // blue
    "#6c5ce7", // indigo
    "#a55eea", // violet
  ];

  function colorFromIndex(idx) {
    const i = typeof idx === "number" ? idx : 0;
    return COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];
  }

  function colorForOwner(owner) {
    // ✅ 서버 presence/welcome로 받은 값만 사용
    return colorFromIndex(colorByOwner.get(owner));
  }

  function hexToRGBA(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  // ===== 충돌 =====
  function intersects(a, b) {
    return !(
      a.x + a.w <= b.x ||
      b.x + b.w <= a.x ||
      a.y + a.h <= b.y ||
      b.y + b.h <= a.y
    );
  }

  function collides(candidate, ignoreId = null) {
    for (const r of rects) {
      if (ignoreId && r.id === ignoreId) continue;
      if (intersects(candidate, r)) return true;
    }
    return false;
  }

  // ===== DOM 반영 =====
  function upsertRectDom(r) {
    let el = domById.get(r.id);
    if (!el) {
        el = document.createElement("div");
        el.className = "rect";
        stage.appendChild(el);
        domById.set(r.id, el);
    }

    // ✅ editor가 없으면 항상 생성 (기존 rect가 editor 없이 만들어졌어도 여기서 복구)
    let ed = el.querySelector(".editor");
    if (!ed) {
        ed = document.createElement("div");
        ed.className = "editor";
        ed.setAttribute("spellcheck", "false");
        el.appendChild(ed);

        if (r.owner === myId) {
        ed.setAttribute("contenteditable", "true");
        wireEditor(ed);
        } else {
        ed.setAttribute("contenteditable", "false");
        }
    }

    // 스타일/위치
    const color = colorForOwner(r.owner);
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
    el.style.border = `2px solid ${color}`;
    el.style.background = hexToRGBA(color, 0.15);

    // 글씨 크기 = 내 박스 높이(=myBaseH). 다른 유저는 r.h를 그대로 폰트로 쓰면 너무 커질 수 있어서
    // "내 기준"으로만 표시하고 싶으면 myBaseH, "각자 박스 높이"로 표시하고 싶으면 r.h 사용.
    const fontPx = (r.owner === myId) ? myBaseH : Math.max(12, Math.round(r.h));
    ed.style.fontSize = `${fontPx}px`;
    ed.style.lineHeight = `${fontPx}px`;

    // 내용 반영 (내가 입력 중이면 덮어쓰기 방지)
    if (!(r.owner === myId && isEditing)) {
        ed.textContent = (r.text || "").replace(/\r?\n/g, " ");
    }
  }


  function removeRect(id) {
    const idx = rects.findIndex((r) => r.id === id);
    if (idx >= 0) rects.splice(idx, 1);

    const el = domById.get(id);
    if (el) el.remove();
    domById.delete(id);
  }

  // ===== Preview =====
  let previewEl = null;

  function ensurePreview() {
    if (!previewEl) {
      previewEl = document.createElement("div");
      previewEl.className = "rect preview";
      stage.appendChild(previewEl);
    }
  }

  function updatePreview(x, y, w, h) {
    previewEl.style.left = `${x}px`;
    previewEl.style.top = `${y}px`;
    previewEl.style.width = `${w}px`;
    previewEl.style.height = `${h}px`;
  }

  function removePreview() {
    if (previewEl) previewEl.remove();
    previewEl = null;
  }

  // ===== 드래그 사각형 제약 =====
  // - 최소 높이 20
  // - width >= 2 * height
  // - 화면 밖으로 나가지 않게 보정
  function buildConstrainedRect(sx, sy, cx, cy, stageW, stageH) {
    cx = clamp(cx, 0, stageW);
    cy = clamp(cy, 0, stageH);

    const left = Math.min(sx, cx);
    const top = Math.min(sy, cy);
    const right = Math.max(sx, cx);
    const bottom = Math.max(sy, cy);

    const anchorRight = cx >= sx;
    const anchorDown = cy >= sy;

    let h = Math.max(20, bottom - top);

    // ✅ 비율 때문에 화면 밖으로 튀는 걸 방지(이거 없으면 0,0으로 빨려감)
    h = Math.min(h, stageH, stageW / 2);

    let w = Math.max(right - left, 2 * h);

    if (w > stageW) {
      w = stageW;
      h = Math.min(h, w / 2);
    }

    let x = anchorRight ? left : right - w;
    let y = anchorDown ? top : bottom - h;

    x = clamp(x, 0, stageW - w);
    y = clamp(y, 0, stageH - h);

    return { x, y, w, h };
  }


  function setMeasureFont(px) {
    // editor와 같은 폰트로 맞추고 싶으면 여기 font-family를 CSS와 동일하게 맞춰줘
    mctx.font = `${px}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  }

  function measureTextWidth(text, px) {
    setMeasureFont(px);
    return mctx.measureText(text).width;
  }

  function splitToCharWidths(text, px) {
    setMeasureFont(px);
    const widths = [];
    for (const ch of text) {
      widths.push(mctx.measureText(ch).width);
    }
    return widths;
  }

  // ===== falling letters =====
  let lastAnimT = 0;
  const falling = []; // {el, y, vy, g}
  let animRunning = false;

  function startAnimLoop() {
    if (animRunning) return;
    animRunning = true;
    lastAnimT = performance.now();
    requestAnimationFrame(tick);
  }

  function tick(t) {
    const dt = Math.min(0.05, (t - lastAnimT) / 1000);
    lastAnimT = t;

    const stageH = stage.getBoundingClientRect().height;

    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.vy += f.g * dt;
      f.y += f.vy * dt;

      f.el.style.transform = `translateY(${f.y}px)`;

      // 화면 아래로 충분히 내려가면 제거
      const box = f.el.getBoundingClientRect();
      if (box.top > stageH + 200) {
        f.el.remove();
        falling.splice(i, 1);
      }
    }

    if (falling.length > 0) requestAnimationFrame(tick);
    else animRunning = false;
  }

  // Enter 시: 현재 문장을 "딱 문장 크기 컨테이너"로 만들고 글자를 떨어뜨림
  function spawnFallingSentence(text, atX, atY, fontPx, owner) {
    if (!text) return;

    // 문장 크기(컨테이너 크기)
    const sentenceW = Math.ceil(measureTextWidth(text, fontPx));
    const sentenceH = Math.ceil(fontPx);

    // 컨테이너(테두리 없음)
    const drop = document.createElement("div");
    drop.className = "drop";
    drop.style.left = `${atX}px`;
    drop.style.top = `${atY}px`;
    drop.style.width = `${sentenceW}px`;
    drop.style.height = `${sentenceH}px`;
    stage.appendChild(drop);

    // 문자별 span 생성
    const widths = splitToCharWidths(text, fontPx);
    let x = 0;
    const col = owner ? colorForOwner(owner) : "white";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const span = document.createElement("span");
      span.className = "ch";
      span.textContent = ch;

      span.style.left = `${x}px`;
      span.style.fontSize = `${fontPx}px`;
      span.style.lineHeight = `${fontPx}px`;
      span.style.color = col;

      drop.appendChild(span);

      // 떨어뜨릴 대상 등록 (각 글자마다 다른 초기 속도/중력)
      falling.push({
        el: span,
        y: 0,
        vy: 0,
        g: 1200 + Math.random() * 600, // 중력(px/s^2)
      });

      x += widths[i];
    }

    startAnimLoop();

    // 컨테이너는 글자들이 살아있는 동안만 유지해도 되고, 안 지워도 됨.
    // 여기선 글자 다 내려가면 span이 지워지지만 drop 자체는 남을 수 있음.
    // 필요하면 일정 시간 후 drop 제거:
    setTimeout(() => {
      if (drop.parentNode) drop.remove();
    }, 8000);
  }

  // ===== WS 수신 =====
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === "error") {
      showToast(msg.message || "접속할 수 없어.");
      try {
        ws.close();
      } catch {}
      return;
    }

    // ✅ 내 색 배정
    if (msg.type === "welcome") {
      colorByOwner.set(msg.userId, msg.color);
      return;
    }

    // ✅ 다른 유저 색 배정/공지
    if (msg.type === "presence") {
      colorByOwner.set(msg.userId, msg.color);
      return;
    }

    // ✅ 유저 나감(색 반납)
    if (msg.type === "left") {
      colorByOwner.delete(msg.userId);

      // 혹시 남아있는 그 유저 rect가 있으면 지우고 싶으면(서버가 remove를 보내주면 없어도 됨)
      // for (const r of [...rects]) if (r.owner === msg.userId) removeRect(r.id);
      return;
    }

    // ✅ rect 업데이트
    if (msg.type === "rect" && msg.rect) {
      const rect = msg.rect;

      const idx = rects.findIndex((r) => r.id === rect.id);
      if (idx >= 0) rects[idx] = rect;
      else rects.push(rect);

      upsertRectDom(rect);
      return;
    }

    if (msg.type === "remove" && msg.rectId) {
      removeRect(msg.rectId);
      return;
    }

    if (msg.type === "drop" && msg.drop) {
      const d = msg.drop;

      // owner 색 쓰고 싶으면 여기서 색 선택 가능
      // spawnFallingSentence 내부에서 span.style.color를 owner 색으로 바꾸는 것도 OK
      spawnFallingSentence(d.text, d.x, d.y, d.fontPx, d.owner);
      return;
    }
  };

  // ===== Pointer Drag =====
  let dragging = false;
  let startX = 0;
  let startY = 0;

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;

    stage.setPointerCapture(e.pointerId);

    const p = getMousePos(e);
    dragging = true;
    startX = clamp(p.x, 0, p.w);
    startY = clamp(p.y, 0, p.h);

    ensurePreview();
    updatePreview(startX, startY, 40, 20);
  });

  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;

    const p = getMousePos(e);
    const r = buildConstrainedRect(startX, startY, p.x, p.y, p.w, p.h);

    ensurePreview();
    updatePreview(r.x, r.y, r.w, r.h);
  });

  stage.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;

    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {}

    const p = getMousePos(e);
    const candidate = buildConstrainedRect(startX, startY, p.x, p.y, p.w, p.h);

    removePreview();

    if (collides(candidate, myRectId)) {
      showToast("겹치면 안 돼서 배치할 수 없어.");
      return;
    }

    removeRect(myRectId);

    myBaseH = candidate.h;
    const newRect = { id: myRectId, owner: myId, ...candidate };
    rects.push(newRect);
    upsertRectDom(newRect);

    setTimeout(focusMyEditor, 0);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "rect", rect: newRect }));
    }

  });

  window.addEventListener("beforeunload", () => {
    try { ws.close(); } catch {}
    });


function wireEditor(ed) {
  lastGoodText = (ed.textContent || "").replace(/\r?\n/g, " ");
  // Enter 막기 + 붙여넣기 줄바꿈 제거
  ed.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const text = (ed.textContent || "").replace(/\r?\n/g, " ").trim();
      if (!text) return;

      const my = rects.find(r => r.id === myRectId);
      if (!my) return;

      const dropMsg = {
        type: "drop",
        drop: {
          id: `${myId}-${Date.now()}-${Math.random().toString(16).slice(2,6)}`,
          owner: myId,          // 서버가 강제로 덮어씀
          text,
          x: my.x + 4,
          y: my.y,
          fontPx: myBaseH
        }
      };

      // ✅ 서버에만 보냄 (내 화면 spawn은 onmessage에서 drop 받으면 그때 실행)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(dropMsg));
      }

      // 입력칸 비우기 + 내 rect text 비우기(이건 기존대로 서버에 rect로 반영)
      lastGoodText = "";
      ed.textContent = "";

      my.text = "";
      upsertRectDom(my);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "rect",
          rect: { id: myRectId, owner: myId, x: my.x, y: my.y, w: my.w, h: my.h, text: "" }
        }));
      }
    }
  });

  ed.addEventListener("paste", (e) => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData("text");
    document.execCommand("insertText", false, (t || "").replace(/\r?\n/g, " "));
  });

  // 입력 제한: "박스 너비 안에 들어가는 글자까지만"
  ed.addEventListener("input", () => {
    const my = rects.find(r => r.id === myRectId);
    if (!my) return;

    // 줄바꿈 제거(혹시 생기면)
    const text = (ed.textContent || "").replace(/\r?\n/g, " ");

    // 측정해서 넘치면 롤백
    if (fitsInBox(text, my.w, myBaseH)) {
      lastGoodText = text;
    } else {
      setPlainText(ed, lastGoodText);
      return;
    }

    // 서버 전송(텍스트만 바뀌면 rect 업데이트로 보내기)
    my.text = lastGoodText;
    upsertRectDom(my);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "rect",
        rect: { id: myRectId, owner: myId, x: my.x, y: my.y, w: my.w, h: my.h, text: my.text }
      }));
    }
  });
  ed.addEventListener("focus", () => {
    isEditing = true;
    });

  ed.addEventListener("blur", () => {
    isEditing = false;
    });

    ed.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();

      // 현재 입력 텍스트(박스 안에 들어가는 최종 텍스트)
      const text = (ed.textContent || "").replace(/\r?\n/g, " ").trim();
      if (!text) return;

      // 내 rect 위치에 문장 떨어뜨리기
      const my = rects.find(r => r.id === myRectId);
      if (!my) return;

      // 문장을 "내 박스 내부" 기준으로 떨어뜨리고 싶으면 padding(4px)만큼 더해줘
      const atX = my.x + 4;
      const atY = my.y; // 상단에서 시작

      spawnFallingSentence(text, atX, atY, myBaseH, myId);

      // 입력칸 비우기 (서버에도 빈 text로 업데이트)
      lastGoodText = "";
      ed.textContent = "";

      my.text = "";
      upsertRectDom(my);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "rect",
          rect: { id: myRectId, owner: myId, x: my.x, y: my.y, w: my.w, h: my.h, text: "" }
        }));
      }
      return;
    }
  });
}

    const measureSpan = document.createElement("span");
    measureSpan.style.position = "fixed";
    measureSpan.style.left = "-10000px";
    measureSpan.style.top = "-10000px";
    measureSpan.style.whiteSpace = "nowrap";
    measureSpan.style.visibility = "hidden";
    document.body.appendChild(measureSpan);

    function fitsInBox(text, boxW, baseH) {
    // editor padding: 좌우 4px씩 줬으니 그만큼 빼기(총 8)
    const usableW = Math.max(0, boxW - 8);

    measureSpan.style.fontSize = `${baseH}px`;
    measureSpan.style.lineHeight = `${baseH}px`;
    measureSpan.textContent = text;

    return measureSpan.getBoundingClientRect().width <= usableW;
    }

    function setPlainText(ed, text) {
    ed.textContent = text;
    // 커서 맨 끝
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    }

    function focusMyEditor() {
    const el = domById.get(myRectId);
    if (!el) return;
    const ed = el.querySelector(".editor");
    if (!ed) return;
    if (ed.getAttribute("contenteditable") !== "true") return;

    // 포커스 + 커서를 맨 끝으로
    ed.focus();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    }


})();
