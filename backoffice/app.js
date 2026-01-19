(() => {
  const { qs, qsa, nowIso, fmtDT, downloadText, toCsv, fetchJson } = window.BO_UTILS;
  const { setText, renderBasket, renderOps } = window.BO_UI;

  const LS_PREFIX = "bo_v3_";

  let SETTINGS = {};
  let AFISHA = [];
  let current = null;
  let seance = null;
  let currency = "грн";

  // локальное состояние
  let basket = []; // [{key,label,price}]
  let ops = [];
  let zoom = 1;

  /* -------------------- helpers -------------------- */

  function lsKey(name) {
    const showKey = current ? `${current.id}_${current.date}` : "no_show";
    return `${LS_PREFIX}${name}_${showKey}`;
  }

  function totalBasket() {
    return basket.reduce((s, i) => s + Number(i.price || 0), 0);
  }

  function humanActionName(status) {
    if (status === "quota") return "КВОТА";
    return status;
  }

  /* -------------------- iframe / hall-cash -------------------- */

  function cashFrame() { return qs("#cashFrame"); }
  function cashHint() { return qs("#cashHint"); }

  function setCashVisible(v) {
    if (cashFrame()) cashFrame().style.display = v ? "block" : "none";
    if (cashHint()) cashHint().style.display = v ? "none" : "flex";
  }

  function buildCashUrl(show) {
    const base = "../spectacles/hall-cash.html";
    const url = new URL(base, location.href);
    url.searchParams.set("show", show.id);
    url.searchParams.set("embed", "1"); // ❗ убираем кассовые кнопки
    return url.toString();
  }

  function postToCash(type, payload) {
    const fr = cashFrame();
    if (!fr || !fr.contentWindow) return;
    fr.contentWindow.postMessage(
      { source: "backoffice", type, payload },
      "*"
    );
  }

  function openCash(show) {
    const fr = cashFrame();
    if (!fr) return;
    fr.src = buildCashUrl(show);
    setCashVisible(true);
  }

  /* -------------------- ops -------------------- */

  function loadOps() {
    try {
      ops = JSON.parse(localStorage.getItem(lsKey("ops"))) || [];
    } catch {
      ops = [];
    }
  }

  function saveOps() {
    localStorage.setItem(lsKey("ops"), JSON.stringify(ops));
  }

  /* -------------------- UI sync -------------------- */

  function syncUI() {
    setText("#basketTotal", totalBasket());
    renderBasket(qs("#basketList"), basket, currency);
    renderOps(qs("#opsList"), ops);
  }

  /* -------------------- ACTION: QUOTA -------------------- */

  function applyQuota() {
    if (!current) {
      alert("Оберіть сеанс.");
      return;
    }
    if (!basket.length) return;

    const seats = basket.map(x => x.key);

    ops.push({
      ts: nowIso(),
      tsHuman: fmtDT(Date.now()),
      action: "КВОТА",
      status: "quota",
      showId: current.id,
      showLabel: `${current.title} — ${current.date} ${current.time}`,
      count: seats.length,
      total: totalBasket(),
      currency,
      seats
    });

    saveOps();

    // ❗ передаём ТОЛЬКО квоту
    postToCash("apply_status", {
      status: "quota",
      seats
    });

    basket = [];
    syncUI();
  }

  /* -------------------- data loading -------------------- */

  async function loadSettings() {
    SETTINGS = await fetchJson("../data/settings.json").catch(() => ({}));
    currency = SETTINGS?.theatre?.currency || "грн";
    setText(
      "#boTitle",
      SETTINGS?.theatre?.name
        ? `Білетний відділ — ${SETTINGS.theatre.name}`
        : "Білетний відділ"
    );
  }

  async function loadAfisha() {
    AFISHA = await fetchJson("../data/afisha.json").catch(() => []);
  }

  function fillShowSelect() {
    const sel = qs("#showSelect");
    if (!sel) return;

    sel.innerHTML = `<option value="">— обрати —</option>`;
    AFISHA.forEach(s => {
      const o = document.createElement("option");
      o.value = `${s.id}__${s.date}`;
      o.textContent = `${s.title} — ${s.date} ${s.time}`;
      sel.appendChild(o);
    });

    sel.addEventListener("change", () => {
      if (!sel.value) {
        current = null;
        setCashVisible(false);
        basket = [];
        ops = [];
        syncUI();
        return;
      }
      const [id, date] = sel.value.split("__");
      current = AFISHA.find(x => x.id === id && x.date === date);
      loadOps();
      basket = [];
      syncUI();
      openCash(current);
    });
  }

  /* -------------------- toolbar -------------------- */

  function initToolbar() {
    qs("#btnQuota")?.addEventListener("click", applyQuota);
    qs("#btnClearBasket")?.addEventListener("click", () => {
      basket = [];
      syncUI();
    });

    qs("#seatSearch")?.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      const key = e.target.value.trim();
      if (!key) return;
      postToCash("seat_search", { key });
    });
  }

  /* -------------------- basket from iframe -------------------- */
  // hall-cash сам отправляет выбранные места

  window.addEventListener("message", ev => {
    const msg = ev.data;
    if (!msg || msg.source !== "hall-cash") return;

    if (msg.type === "basket") {
      basket = msg.payload || [];
      syncUI();
    }
  });

  /* -------------------- tabs -------------------- */

  function setTab(name) {
    qsa("#tabs .tabbtn").forEach(b =>
      b.classList.toggle("active", b.dataset.tab === name)
    );
    qsa("[data-pane]").forEach(p =>
      p.hidden = p.dataset.pane !== name
    );
  }

  function initTabs() {
    qs("#tabs")?.addEventListener("click", e => {
      const b = e.target.closest(".tabbtn");
      if (!b) return;
      setTab(b.dataset.tab);
    });
  }

  /* -------------------- boot -------------------- */

  async function init() {
    initTabs();
    initToolbar();
    await loadSettings();
    await loadAfisha();
    fillShowSelect();
    setCashVisible(false);
    syncUI();
    setTab("events");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
