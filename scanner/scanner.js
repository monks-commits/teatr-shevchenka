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

  const sid = expectedSeance();
  if ($("seanceLine")) {
    $("seanceLine").textContent = sid
      ? `Контроль сеансу: ${sid}`
      : "Сеанс не передано. Відкрийте сканер через «Місце контролера».";
  }

  setStatus(
    sid ? "ok" : "warn",
    sid ? "Готово" : "Сеанс не визначено",
    sid
      ? "Сканер прив'язаний до поточного сеансу. Запустіть камеру."
      : "Для штатного входу відкрийте сканер через робоче місце контролера.",
    ""
  );
}

function expectedSeance() {
  const params = new URLSearchParams(location.search);
  return String(
    params.get("seance") ||
    params.get("seance_id") ||
    cfg?.expectedSeanceId ||
    ""
  ).trim();
}

function normalizeQr(text) {
  return String(text || "").trim();
}

async function sendToServer(qr_payload) {
  const endpoint = cfg.endpoint;
  const gate = ($("gate").value || "gate-1").trim();
  const sid = expectedSeance();

  const secret = ($("secret").value || "").trim();
  if (cfg.requireSecret && !secret) {
    setStatus("warn", "Потрібен secret", "Вставте SCANNER_SECRET і повторіть сканування.", qr_payload);
    await soundBad();
    vibrateBad();
    throw new Error("secret required");
  }

  if (secret) localStorage.setItem(LS_SECRET_KEY, secret);

  const body = { qr_payload, checked_in_by: gate };
  if (sid) body.expected_seance_id = sid;

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-scanner-secret": secret,
    },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));

  if (r.status === 401) {
    setStatus("bad", "Доступ заборонено", "Невірний SCANNER_SECRET (401).", qr_payload);
    await soundBad();
    vibrateBad();
    return;
  }

  if (r.status === 404) {
    // Якщо сканер прив'язаний до конкретного сеансу, невідомий квиток
    // не можна пропускати як "офлайн касу": його сеанс неможливо перевірити.
    if (sid) {
      const looksCash = /^order:CASH-/i.test(qr_payload) || /^TK-/i.test(qr_payload);
      setStatus(
        looksCash ? "warn" : "bad",
        looksCash ? "Квиток не синхронізовано" : "Недійсний квиток",
        looksCash
          ? "Касовий квиток не знайдено у центральній базі. Виконайте SYNC у касі та повторіть сканування."
          : "Квиток не знайдено для перевірки поточного сеансу.",
        qr_payload
      );
      await soundBad();
      vibrateBad();
      return;
    }

    // Лише прямий технічний запуск без прив'язки до сеансу зберігає
    // стару сумісність для legacy order:CASH- QR.
    if (!qr_payload.startsWith("order:CASH-")) {
      setStatus("bad", "Недійсний квиток", "Ticket not found (404).", qr_payload);
      await soundBad();
      vibrateBad();
      return;
    }

    setStatus(
      "warn",
      "Квиток не синхронізовано",
      "Legacy касовий QR не перевірений по сеансу. Для штатного входу використовуйте «Місце контролера» після SYNC.",
      qr_payload
    );
    await soundBad();
    vibrateBad();
    return;
  }

  if (r.status === 409) {
    if (data?.error === "wrong_seance" || data?.response_code === "wrong_seance") {
      setStatus(
        "bad",
        "Інший сеанс",
        "Цей квиток належить іншому сеансу. Не пропускати.",
        qr_payload
      );
      await soundBad();
      vibrateBad();
      return;
    }

    const at = data?.checked_in_at || data?.ticket?.checked_in_at || "";
    setStatus("warn", "Вже використано", at ? `Погашено: ${at}` : "Квиток вже погашений.", qr_payload);
    await soundBad();
    vibrateBad();
    return;
  }

  if (!r.ok || data?.ok === false) {
    setStatus("bad", "Помилка", data?.error ? String(data.error) : `HTTP ${r.status}`, qr_payload);
    await soundBad();
    vibrateBad();
    return;
  }

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
