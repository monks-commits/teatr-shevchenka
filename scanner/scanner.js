// scanner.js (FULL REPLACE)

const LS_SECRET_KEY = "va_scanner_secret_v1";

let cfg = null;
let qr = null;
let lastQr = "";
let cooldownMs = 1400;
let lastScanAt = 0;

// --- Sound (WebAudio) ---
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // иногда контекст "suspended" пока не будет user gesture
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
}

function beep({ freq = 880, duration = 0.10, type = "sine", gain = 0.12 } = {}) {
  try {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    setTimeout(() => {
      try { o.stop(); } catch {}
    }, duration * 1000);
  } catch {}
}

function soundOk() {
  // красивый короткий "пик"
  beep({ freq: 1046, duration: 0.08, type: "sine", gain: 0.12 }); // C6
}

function soundBad() {
  // грубый двойной низкий сигнал
  beep({ freq: 220, duration: 0.12, type: "square", gain: 0.10 });
  setTimeout(() => beep({ freq: 196, duration: 0.14, type: "square", gain: 0.10 }), 140);
}

function vibrateBad() {
  try {
    if (navigator.vibrate) navigator.vibrate([80, 40, 120]);
  } catch {}
}

const $ = (id) => document.getElementById(id);

function setStatus(kind, title, details, qrText) {
  const box = $("statusBox");
  box.classList.remove("ok", "warn", "bad");
  box.classList.add(kind);

  $("stText").textContent = title || "";
  $("stDetails").textContent = details || "—";
  $("stQr").textContent = qrText || "—";
}

async function loadConfig() {
  const res = await fetch("./config.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Не вдалося завантажити scanner/config.json");
  cfg = await res.json();

  $("theatreName").textContent = cfg.theatreName || "Сканер квитків";

  const saved = localStorage.getItem(LS_SECRET_KEY) || "";
  if (saved) $("secret").value = saved;

  setStatus("ok", "Готово", "Запустіть камеру і скануйте QR.", "");
}

function normalizeQr(text) {
  return String(text || "").trim();
}

async function sendToServer(qr_payload) {
  const endpoint = cfg.endpoint;
  const gate = ($("gate").value || "gate-1").trim();

  const secret = ($("secret").value || "").trim();
  if (cfg.requireSecret && !secret) {
    setStatus("warn", "Потрібен secret", "Вставте SCANNER_SECRET і повторіть сканування.", qr_payload);
    soundBad();
    vibrateBad();
    throw new Error("secret required");
  }

  if (secret) localStorage.setItem(LS_SECRET_KEY, secret);

  const body = { qr_payload, checked_in_by: gate };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-scanner-secret": secret,
    },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));

  // 401
  if (r.status === 401) {
    setStatus("bad", "Доступ заборонено", "Невірний SCANNER_SECRET (401).", qr_payload);
    soundBad();
    vibrateBad();
    return;
  }

  // 404 — билет не найден в Supabase
if (r.status === 404) {

  // ⛔ если это НЕ касса — ошибка
  if (!qr_payload.startsWith("order:CASH-")) {
    setStatus("bad", "Недійсний квиток", "Ticket not found (404).", qr_payload);
    soundBad();
    vibrateBad();
    return;
  }

  // ✅ кассовый офлайн-билет
  setStatus(
    "ok",
    "Пропустити (каса)",
    "Офлайн-квиток • не синхронізований",
    qr_payload
  );
  soundOk();
  return;
}

  // 409 (already_used / race)
  if (r.status === 409) {
    const at = data?.checked_in_at || data?.ticket?.checked_in_at || "";
    setStatus("warn", "Вже використано", at ? `Погашено: ${at}` : "Квиток вже погашений.", qr_payload);
    soundBad();
    vibrateBad();
    return;
  }

  // other errors
  if (!r.ok || data?.ok === false) {
    setStatus("bad", "Помилка", data?.error ? String(data.error) : `HTTP ${r.status}`, qr_payload);
    soundBad();
    vibrateBad();
    return;
  }

  // OK
  const at = data?.checked_in_at || data?.ticket?.checked_in_at || "";
  const seat = data?.ticket?.seat_label ? `Місце: ${data.ticket.seat_label}` : "";
  setStatus("ok", "Пропустити", [seat, at ? `Погашено: ${at}` : ""].filter(Boolean).join(" • "), qr_payload);
  soundOk();
}

async function onScanSuccess(decodedText) {
  const now = Date.now();
  if (now - lastScanAt < cooldownMs) return;
  lastScanAt = now;

  const text = normalizeQr(decodedText);
  if (!text) return;

  if (text === lastQr) return;
  lastQr = text;

  $("stQr").textContent = text;

  try {
    await sendToServer(text);
  } catch {
    // статус уже выставлен
  }
}

async function start() {
  // ВАЖНО: именно тут включаем аудио (после user gesture)
  ensureAudio();

  $("btnStart").disabled = true;

  const readerId = "reader";
  qr = new Html5Qrcode(readerId);

  try {
    await qr.start(
      { facingMode: "environment" },
      { fps: 12, qrbox: { width: 280, height: 280 }, disableFlip: false },
      onScanSuccess,
    );

    $("btnStop").disabled = false;
    setStatus("ok", "Камера працює", "Скануйте QR квитка.", "");
    // маленький стартовый "тик"
    beep({ freq: 660, duration: 0.05, type: "sine", gain: 0.06 });
  } catch (err) {
    $("btnStart").disabled = false;
    $("btnStop").disabled = true;
    setStatus("bad", "Помилка камери", String(err?.message || err), "");
    soundBad();
  }
}

async function stop() {
  $("btnStop").disabled = true;
  try {
    if (qr) {
      await qr.stop();
      await qr.clear();
      qr = null;
    }
    $("btnStart").disabled = false;
    setStatus("ok", "Зупинено", "Камеру зупинено.", "");
  } catch (e) {
    $("btnStart").disabled = false;
    setStatus("warn", "Зупинено з попередженням", String(e?.message || e), "");
  }
}

function clearSecret() {
  localStorage.removeItem(LS_SECRET_KEY);
  $("secret").value = "";
  setStatus("ok", "Secret очищено", "Вставте SCANNER_SECRET знову при потребі.", "");
}

window.addEventListener("load", async () => {
  await loadConfig();

  $("btnStart").addEventListener("click", start);
  $("btnStop").addEventListener("click", stop);
  $("btnClear").addEventListener("click", clearSecret);
});
