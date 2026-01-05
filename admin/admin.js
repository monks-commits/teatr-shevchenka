// admin/admin.js
// Панель касира: только выбор сеанса и redirect на реальную схему сайта.

async function safeJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("[admin] fetch error:", url, e);
    return null;
  }
}

function formatWhen(item) {
  const when = [item.date, item.time].filter(Boolean).join(" • ");
  const place = [item.theatre, item.stage].filter(Boolean).join(" • ");
  return [when, place].filter(Boolean).join(" — ");
}

(function init() {
  const elTheatre = document.getElementById("admin-theatre-name");
  const elStatus = document.getElementById("kassa-status");
  const showSelect = document.getElementById("showSelect");

  const btnCashier = document.getElementById("btn-open-hall-cashier");
  const btnCustomer = document.getElementById("btn-open-hall-customer");

  let afisha = [];
  let selectedShow = "";

  function setEnabled(enabled) {
    btnCashier.disabled = !enabled;
    btnCustomer.disabled = !enabled;
  }

  function openHall({ role }) {
    if (!selectedShow) return;

    const base = "../spectacles/hall.html";
    const url = new URL(base, window.location.href);
    url.searchParams.set("show", selectedShow);
    if (role) url.searchParams.set("role", role);

    window.location.href = url.toString();
  }

  async function load() {
    // Важно: admin/ лежит в подпапке, поэтому только ../data/...
    const settings = await safeJson("../data/settings.json");
    const items = await safeJson("../data/afisha.json");

    if (settings?.theatre?.name) elTheatre.textContent = settings.theatre.name;

    if (!Array.isArray(items) || items.length === 0) {
      elStatus.textContent = "Немає подій у afisha.json";
      setEnabled(false);
      return;
    }

    afisha = items;

    // наполняем select
    const opts = ['<option value="">— обрати —</option>']
      .concat(
        afisha.map((s) => {
          const id = s.id || "";
          const title = s.title || id || "Без назви";
          const extra = formatWhen(s);
          const label = extra ? `${title} — ${extra}` : title;
          return `<option value="${encodeURIComponent(id)}">${escapeHtml(label)}</option>`;
        })
      );

    showSelect.innerHTML = opts.join("");

    elStatus.textContent = "Оберіть спектакль і відкрийте схему.";
    setEnabled(false);
  }

  showSelect.addEventListener("change", () => {
    const val = decodeURIComponent(showSelect.value || "");
    selectedShow = val;

    if (!selectedShow) {
      setEnabled(false);
      elStatus.textContent = "Сеанс не обрано.";
      return;
    }

    setEnabled(true);

    const item = afisha.find((x) => (x.id || "") === selectedShow);
    elStatus.textContent = item
      ? `Обрано: ${item.title || selectedShow} (${[item.date, item.time].filter(Boolean).join(" ")})`
      : `Обрано: ${selectedShow}`;
  });

  btnCashier.addEventListener("click", () => openHall({ role: "cashier" }));
  btnCustomer.addEventListener("click", () => openHall({ role: "" }));

  load();

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
