// scanner.js (FULL REPLACE)

const LS_SECRET_KEY = "va_scanner_secret_v1";

let cfg = null;
let qr = null;
let lastQr = "";
let cooldownMs = 1400;
let lastScanAt = 0;

// --- Sound (WebAudio) ---
let audioCtx = null;
let audioUnlocked = false;

function ensureAudio() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioCtx.state === "suspended") {
      return audioCtx.resume().catch(() => {});
    }

    return Promise.resolve();
  } catch {
    return Promise.resolve();
  }
}

function beep({ freq = 880, duration = 0.12, type = "sine", gain = 0.20 } = {}) {
  try {
    if (!audioCtx || audioCtx.state !== "running") return;

    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    o.type = type;
    o.frequency.value = freq;

    // мягкий вход/выход сигнала
    const now = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0001), now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    o.connect(g);
    g.connect(audioCtx.destination);

    o.start(now);
    o.stop(now + duration + 0.02);
  } catch {}
}

async function unlockAudio() {
  try {
    await ensureAudio();
    if (!audioCtx || audioCtx.state !== "running") return;

    // очень короткий почти беззвучный сигнал для разблокировки
    beep({ freq: 440, duration: 0.03, type: "sine", gain: 0.001 });
    audioUnlocked = true;
  } catch {}
}

async function soundOk() {
  try {
    await ensureAudio();
    beep({ freq: 1046, duration: 0.14, type: "sine", gain: 0.30 });
    setTimeout(() => {
      beep({ freq: 1318, duration: 0.12, type: "sine", gain: 0.24 });
    }, 110);
  } catch {}
}

async function soundBad() {
  try {
    await ensureAudio();
    beep({ freq: 220, duration: 0.18, type: "square", gain: 0.24 });
    setTimeout(() => {
      beep({ freq: 196, duration: 0.20, type: "square", gain: 0.22 });
    }, 180);
  } catch {}
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
    await soundBad();
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
    await soundBad();
    vibrateBad();
    return;
  }

  // 404 — билет не найден в Supabase
  if (r.status === 404) {
    // ⛔ если это НЕ касса — ошибка
    if (!qr_payload.startsWith("order:CASH-")) {
      setStatus("bad", "Недійсний квиток", "Ticket not found (404).", qr_payload);
      await soundBad();
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
    await soundOk();
    return;
  }

  // 409 (already_used / race)
  if (r.status === 409) {
    const at = data?.checked_in_at || data?.ticket?.checked_in_at || "";
    setStatus("warn", "Вже використано", at ? `Погашено: ${at}` : "Квиток вже погашений.", qr_payload);
    await soundBad();
    vibrateBad();
    return;
  }

  // other errors
  if (!r.ok || data?.ok === false) {
    setStatus("bad", "Помилка", data?.error ? String(data.error) : `HTTP ${r.status}`, qr_payload);
    await soundBad();
    vibrateBad();
    return;
  }

// COMPENSATION
if (data?.mode === "compensation") {
  const seat = data?.ticket?.seat_label
    ? `Компенсація • ${data.ticket.seat_label}`
    : "Компенсаційний прохід";

  setStatus(
    "warn",
    "КОМПЕНСАЦІЙНИЙ ПРОХІД",
    seat,
    qr_payload
  );

  await soundBad();
  return;
}
  
  // OK
  const at = data?.checked_in_at || data?.ticket?.checked_in_at || "";
  const seat = data?.ticket?.seat_label ? `Місце: ${data.ticket.seat_label}` : "";
  setStatus("ok", "Пропустити", [seat, at ? `Погашено: ${at}` : ""].filter(Boolean).join(" • "), qr_payload);
  await soundOk();
}

async function onScanSuccess(decodedText) {
  await ensureAudio();

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
  $("btnStart").disabled = true;

  try {
    await ensureAudio();
    await unlockAudio();

    const readerId = "reader";
    qr = new Html5Qrcode(readerId);

    await qr.start(
      { facingMode: "environment" },
      { fps: 12, qrbox: { width: 280, height: 280 }, disableFlip: false },
      onScanSuccess,
    );

    $("btnStop").disabled = false;
    setStatus("ok", "Камера працює", "Скануйте QR квитка.", "");

    // стартовый тестовый сигнал
    beep({ freq: 880, duration: 0.16, type: "sine", gain: 0.32 });
  } catch (err) {
    $("btnStart").disabled = false;
    $("btnStop").disabled = true;
    setStatus("bad", "Помилка камери", String(err?.message || err), "");
    await soundBad();
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

  // Доп. разблокировка аудио при первом касании экрана
  document.addEventListener("click", async () => {
    if (!audioUnlocked) {
      await unlockAudio();
    }
  }, { once: true });

  document.addEventListener("touchstart", async () => {
    if (!audioUnlocked) {
      await unlockAudio();
    }
  }, { once: true, passive: true });
});
