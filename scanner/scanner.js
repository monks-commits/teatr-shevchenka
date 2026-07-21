"use strict";

const LS_SECRET_KEY = "va_scanner_secret_v1";

let cfg = null;
let qr = null;
let scannerStarting = false;
let scannerRunning = false;

let lastQr = "";
let lastScanAt = 0;
const cooldownMs = 1400;

let audioCtx = null;
let audioUnlocked = false;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

    beep({ freq:440, duration:0.03, type:"sine", gain:0.001 });
    audioUnlocked = true;
  } catch {}
}

async function soundOk() {
  await ensureAudio();
  beep({ freq:1046, duration:0.14, gain:0.30 });
  setTimeout(() => beep({ freq:1318, duration:0.12, gain:0.24 }), 110);
}

async function soundBad() {
  await ensureAudio();
  beep({ freq:220, duration:0.18, type:"square", gain:0.24 });
  setTimeout(() => beep({ freq:196, duration:0.20, type:"square", gain:0.22 }), 180);
}

function vibrateBad() {
  try {
    if (navigator.vibrate) navigator.vibrate([80,40,120]);
  } catch {}
}

function setStatus(kind, title, details, qrText) {
  const box = $("statusBox");
  box.classList.remove("ok","warn","bad");
  if (kind) box.classList.add(kind);

  $("stText").textContent = title || "";
  $("stDetails").textContent = details || "—";
  $("stQr").textContent = qrText || "—";
}

function stopVideoTracks(){
  document.querySelectorAll("video").forEach(video => {
    try {
      const stream = video.srcObject;
      if (stream && typeof stream.getTracks === "function") {
        stream.getTracks().forEach(track => {
          try { track.stop(); } catch {}
        });
      }
      video.srcObject = null;
    } catch {}
  });
}

async function releaseCamera({ showStatus = false } = {}){
  /*
    Сначала синхронно освобождаем MediaStream.
    Это важно при уходе назад, сворачивании браузера и переходе
    между обычным и Recovery Scanner.
  */
  stopVideoTracks();

  const instance = qr;
  qr = null;
  scannerRunning = false;
  scannerStarting = false;

  if (instance) {
    try { await instance.stop(); } catch {}
    try { await instance.clear(); } catch {}
  }

  stopVideoTracks();

  const reader = $("reader");
  if (reader) reader.innerHTML = "";

  if ($("btnStart")) $("btnStart").disabled = false;
  if ($("btnStop")) $("btnStop").disabled = true;

  if (showStatus) {
    setStatus("ok", "Камеру звільнено", "Можна запустити повторно.", "");
  }
}

function chooseRearCamera(cameras){
  if (!Array.isArray(cameras) || !cameras.length) return null;

  const rearPattern =
    /(back|rear|environment|задн|основн|camera 0)/i;

  return (
    cameras.find(c => rearPattern.test(String(c.label || ""))) ||
    cameras[cameras.length - 1]
  );
}

function waitForVideoFrame(timeoutMs = 7000){
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const check = () => {
      const video = document.querySelector("#reader video");

      if (
        video &&
        video.srcObject &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        resolve(video);
        return;
      }

      if (Date.now() - started >= timeoutMs) {
        reject(new Error(
          "Камера відкрита, але відеокадр не з'явився. Натисніть «Запустити камеру» ще раз."
        ));
        return;
      }

      requestAnimationFrame(check);
    };

    check();
  });
}

async function startQrEngine(onSuccess){
  const scanConfig = {
    fps:10,
    qrbox:(viewWidth, viewHeight) => {
      const edge = Math.max(
        180,
        Math.min(280, Math.floor(Math.min(viewWidth, viewHeight) * 0.72))
      );
      return { width:edge, height:edge };
    },
    disableFlip:false
  };

  let instance = new Html5Qrcode("reader", { verbose:false });

  try {
    await instance.start(
      { facingMode:{ ideal:"environment" } },
      scanConfig,
      onSuccess,
      () => {}
    );
    return instance;
  } catch(firstError) {
    try { await instance.clear(); } catch {}
    stopVideoTracks();
    await sleep(350);

    const cameras = await Html5Qrcode.getCameras();
    const rear = chooseRearCamera(cameras);

    if (!rear?.id) throw firstError;

    instance = new Html5Qrcode("reader", { verbose:false });

    await instance.start(
      rear.id,
      scanConfig,
      onSuccess,
      () => {}
    );

    return instance;
  }
}

async function loadConfig() {
  const res = await fetch("./config.json", { cache:"no-store" });
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
    setStatus(
      "warn",
      "Потрібен secret",
      "Вставте SCANNER_SECRET і повторіть сканування.",
      qr_payload
    );
    await soundBad();
    vibrateBad();
    return;
  }

  if (secret) localStorage.setItem(LS_SECRET_KEY, secret);

  const r = await fetch(endpoint, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-scanner-secret":secret
    },
    body:JSON.stringify({
      qr_payload,
      checked_in_by:gate
    })
  });

  const data = await r.json().catch(() => ({}));

  if (r.status === 401) {
    setStatus("bad", "Доступ заборонено", "Невірний SCANNER_SECRET (401).", qr_payload);
    await soundBad();
    vibrateBad();
    return;
  }

  if (r.status === 404) {
    if (!qr_payload.startsWith("order:CASH-")) {
      setStatus("bad", "Недійсний квиток", "Ticket not found (404).", qr_payload);
      await soundBad();
      vibrateBad();
      return;
    }

    setStatus(
      "ok",
      "Пропустити (каса)",
      "Офлайн-квиток • не синхронізований",
      qr_payload
    );
    await soundOk();
    return;
  }

  if (r.status === 409) {
    const at = data?.checked_in_at || data?.ticket?.checked_in_at || "";
    setStatus(
      "warn",
      "Вже використано",
      at ? `Погашено: ${at}` : "Квиток вже погашений.",
      qr_payload
    );
    await soundBad();
    vibrateBad();
    return;
  }

  if (!r.ok || data?.ok === false) {
    setStatus(
      "bad",
      "Помилка",
      data?.error ? String(data.error) : `HTTP ${r.status}`,
      qr_payload
    );
    await soundBad();
    vibrateBad();
    return;
  }

  if (data?.mode === "compensation") {
    const seat = data?.ticket?.seat_label
      ? `Компенсація • ${data.ticket.seat_label}`
      : "Компенсаційний прохід";

    setStatus("warn", "КОМПЕНСАЦІЙНИЙ ПРОХІД", seat, qr_payload);
    await soundBad();
    return;
  }

  const at = data?.checked_in_at || data?.ticket?.checked_in_at || "";
  const seat = data?.ticket?.seat_label
    ? `Місце: ${data.ticket.seat_label}`
    : "";

  setStatus(
    "ok",
    "Пропустити",
    [seat, at ? `Погашено: ${at}` : ""].filter(Boolean).join(" • "),
    qr_payload
  );

  await soundOk();
}

async function onScanSuccess(decodedText) {
  await ensureAudio();

  const now = Date.now();
  const text = normalizeQr(decodedText);
  if (!text) return;

  if (text === lastQr && now - lastScanAt < cooldownMs) return;

  lastQr = text;
  lastScanAt = now;
  $("stQr").textContent = text;

  try {
    await sendToServer(text);
  } catch(e) {
    console.error("scan request error", e);
  }
}

async function start() {
  if (scannerStarting || scannerRunning) return;

  scannerStarting = true;
  $("btnStart").disabled = true;
  $("btnStop").disabled = true;

  try {
    await ensureAudio();
    await unlockAudio();

    await releaseCamera();
    await sleep(350);

    scannerStarting = true;
    $("btnStart").disabled = true;

    qr = await startQrEngine(onScanSuccess);

    const video = await waitForVideoFrame();
    video.setAttribute("playsinline", "");
    video.muted = true;

    try { await video.play(); } catch {}

    scannerRunning = true;
    scannerStarting = false;

    $("btnStop").disabled = false;
    setStatus("ok", "Камера працює", "Скануйте QR квитка.", "");

    beep({ freq:880, duration:0.12, gain:0.22 });

  } catch(err) {
    await releaseCamera();

    setStatus(
      "bad",
      "Помилка камери",
      String(err?.message || err),
      ""
    );

    await soundBad();
  }
}

async function stop() {
  await releaseCamera({ showStatus:true });
}

function clearSecret() {
  localStorage.removeItem(LS_SECRET_KEY);
  $("secret").value = "";
  setStatus("ok", "Secret очищено", "Вставте SCANNER_SECRET знову при потребі.", "");
}

function emergencyRelease(){
  stopVideoTracks();
  releaseCamera().catch(() => {});
}

window.addEventListener("load", async () => {
  await loadConfig();

  $("btnStart").addEventListener("click", start);
  $("btnStop").addEventListener("click", stop);
  $("btnClear").addEventListener("click", clearSecret);

  document.addEventListener("click", async () => {
    if (!audioUnlocked) await unlockAudio();
  }, { once:true });

  document.addEventListener("touchstart", async () => {
    if (!audioUnlocked) await unlockAudio();
  }, { once:true, passive:true });
});

window.addEventListener("pagehide", emergencyRelease);
window.addEventListener("beforeunload", emergencyRelease);

document.addEventListener("visibilitychange", () => {
  if (document.hidden && (scannerRunning || scannerStarting)) {
    emergencyRelease();
  }
});

window.addEventListener("pageshow", event => {
  if (event.persisted) {
    emergencyRelease();
    setStatus(
      "warn",
      "Камеру було звільнено",
      "Після повернення на сторінку запустіть камеру повторно.",
      ""
    );
  }
});
