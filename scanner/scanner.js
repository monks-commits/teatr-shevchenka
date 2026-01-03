const LS_SECRET_KEY = "va_scanner_secret_v1";

let cfg = null;
let qr = null;
let lastQr = "";
let cooldownMs = 1400;
let lastScanAt = 0;

const $ = (id) => document.getElementById(id);

function setStatus(kind, title, details, qrText) {
  const box = $("statusBox");
  box.classList.remove("ok","warn","bad");
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

  // подхватим secret из localStorage
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
    throw new Error("secret required");
  }

  // сохранить secret
  if (secret) localStorage.setItem(LS_SECRET_KEY, secret);

  const body = {
    qr_payload,
    checked_in_by: gate
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-scanner-secret": secret
    },
    body: JSON.stringify(body)
  });

  const data = await r.json().catch(() => ({}));

  // Унифицируем вывод
  if (r.status === 401) {
    setStatus("bad", "Доступ заборонено", "Невірний SCANNER_SECRET (401).", qr_payload);
    return;
  }

  if (r.status === 404) {
    setStatus("bad", "Недійсний квиток", "Ticket not found (404).", qr_payload);
    return;
  }

  if (r.status === 409) {
    // already_used / race
    const at = data?.checked_in_at || data?.ticket?.checked_in_at || "";
    setStatus("warn", "Вже використано", at ? `Погашено: ${at}` : "Квиток вже погашений.", qr_payload);
    return;
  }

  if (!r.ok || data?.ok === false) {
    setStatus("bad", "Помилка", data?.error ? String(data.error) : `HTTP ${r.status}`, qr_payload);
    return;
  }

  const at = data?.checked_in_at || data?.ticket?.checked_in_at || "";
  const seat = data?.ticket?.seat_label ? `Місце: ${data.ticket.seat_label}` : "";
  setStatus("ok", "Пропустити", [seat, at ? `Погашено: ${at}` : ""].filter(Boolean).join(" • "), qr_payload);
}

async function onScanSuccess(decodedText) {
  const now = Date.now();
  if (now - lastScanAt < cooldownMs) return;
  lastScanAt = now;

  const text = normalizeQr(decodedText);
  if (!text) return;

  // антидубль: один и тот же QR подряд не спамим
  if (text === lastQr) return;
  lastQr = text;

  $("stQr").textContent = text;

  try {
    await sendToServer(text);
  } catch (e) {
    // статус уже выставлен выше
  }
}

async function start() {
  $("btnStart").disabled = true;

  const readerId = "reader";
  qr = new Html5Qrcode(readerId);

  try {
    await qr.start(
      { facingMode: "environment" },
      {
        fps: 12,
        qrbox: { width: 280, height: 280 },
        disableFlip: false
      },
      onScanSuccess
    );

    $("btnStop").disabled = false;
    setStatus("ok", "Камера працює", "Скануйте QR квитка.", "");
  } catch (err) {
    $("btnStart").disabled = false;
    $("btnStop").disabled = true;
    setStatus("bad", "Помилка камери", String(err?.message || err), "");
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
