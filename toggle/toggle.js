const LS_KEY = "va_toggle_secret_v1";

let cfg = null;
const $ = (id) => document.getElementById(id);

function setState(kind, title, details) {
  const box = $("stateBox");
  box.classList.remove("ok", "off", "unknown");
  box.classList.add(kind);

  $("stText").textContent = title || "—";
  $("stDetails").textContent = details || "—";
}

async function loadConfig() {
  const res = await fetch("./config.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Не вдалося завантажити toggle/config.json");
  cfg = await res.json();

  $("theatreName").textContent = cfg.theatreName || "Онлайн-продажі";

  const saved = localStorage.getItem(LS_KEY) || "";
  if (saved) $("secret").value = saved;

  setState("unknown", "—", "Натисніть “Оновити”, щоб зчитати стан.");
}

function getSecret() {
  const secret = ($("secret").value || "").trim();
  if (cfg.requireSecret && !secret) {
    setState("unknown", "Потрібен secret", "Вставте TOGGLE_SECRET і повторіть.");
    throw new Error("secret required");
  }
  if (secret) localStorage.setItem(LS_KEY, secret);
  return secret;
}

async function api(method, body) {
  const secret = getSecret();

  const r = await fetch(cfg.endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-toggle-secret": secret,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await r.json().catch(() => ({}));

  if (r.status === 401) {
    setState("unknown", "Доступ заборонено", "Невірний TOGGLE_SECRET (401).");
    return null;
  }

  if (!r.ok || data?.ok === false) {
    setState("unknown", "Помилка", data?.error ? String(data.error) : `HTTP ${r.status}`);
    return null;
  }

  return data;
}

function render(settings) {
  const enabled = settings?.online_sales_enabled;
  const at = settings?.updated_at ? `Оновлено: ${settings.updated_at}` : "";

  if (enabled === true) setState("ok", "Онлайн УВІМКНЕНО", at);
  else if (enabled === false) setState("off", "Онлайн ВИМКНЕНО", at);
  else setState("unknown", "—", "Немає даних.");
}

async function refresh() {
  setState("unknown", "Зчитую…", "Зачекайте…");
  const data = await api("GET");
  if (data?.settings) render(data.settings);
}

async function setEnabled(val) {
  setState("unknown", "Застосовую…", val ? "Вмикаю онлайн…" : "Вимикаю онлайн…");
  const data = await api("POST", { online_sales_enabled: !!val });
  if (data?.settings) render(data.settings);
}

function clearSecret() {
  localStorage.removeItem(LS_KEY);
  $("secret").value = "";
  setState("unknown", "Secret очищено", "Вставте TOGGLE_SECRET знову при потребі.");
}

window.addEventListener("load", async () => {
  try {
    await loadConfig();
  } catch (e) {
    setState("unknown", "Помилка", String(e?.message || e));
    return;
  }

  $("btnRefresh").addEventListener("click", refresh);
  $("btnOn").addEventListener("click", () => setEnabled(true));
  $("btnOff").addEventListener("click", () => setEnabled(false));
  $("btnClear").addEventListener("click", clearSecret);
});
