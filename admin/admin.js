(async function () {
  const elSelect = document.getElementById("showSelect");
  const btnCashier = document.getElementById("openCashier");
  const btnBuyer = document.getElementById("openBuyer");
  const btnScanner = document.getElementById("openScanner");
  const btnToggle = document.getElementById("openToggle");

  function setDisabled(disabled) {
    btnCashier.disabled = disabled;
    btnBuyer.disabled = disabled;
    btnScanner.disabled = disabled;
  }

  function baseUrl(path) {
    // /admin/ -> "../"
    return `../${path}`.replace(/\/{2,}/g, "/");
  }

  function selectedShow() {
    return (elSelect && elSelect.value) ? elSelect.value : "";
  }

  async function loadAfisha() {
    try {
      const res = await fetch(baseUrl("data/afisha.json"), { cache: "no-store" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.error("afisha load error:", e);
      return [];
    }
  }

  function renderOptions(items) {
    const opts = [`<option value="">— обрати —</option>`];

    // сортировка по дате/времени
    items.sort((a, b) => {
      const da = `${a.date || ""} ${a.time || ""}`.trim();
      const db = `${b.date || ""} ${b.time || ""}`.trim();
      return da.localeCompare(db);
    });

    for (const s of items) {
      const id = s.id || "";
      if (!id) continue;
      const when = [s.date, s.time].filter(Boolean).join(" ");
      const title = s.title || id;
      const stage = s.stage ? ` • ${s.stage}` : "";
      opts.push(`<option value="${encodeURIComponent(id)}">${when} • ${title}${stage}</option>`);
    }

    elSelect.innerHTML = opts.join("");
  }

  // --- init ---
  setDisabled(true);
  renderOptions(await loadAfisha());
  setDisabled(false);
  setDisabled(true); // снова true до выбора

  elSelect.addEventListener("change", () => {
    const id = selectedShow();
    setDisabled(!id);
  });

  btnCashier.addEventListener("click", () => {
    const id = selectedShow();
    if (!id) return;
    // касса работает на РЕАЛЬНОЙ схеме сайта
    window.location.href = baseUrl(`spectacles/hall.html?show=${id}&role=cashier`);
  });

  btnBuyer.addEventListener("click", () => {
    const id = selectedShow();
    if (!id) return;
    // открыть как обычный покупатель
    window.location.href = baseUrl(`spectacles/hall.html?show=${id}`);
  });

  btnScanner.addEventListener("click", () => {
    const id = selectedShow();
    if (!id) return;
    // если сканеру не нужен show — просто откроется страница
    window.location.href = baseUrl(`scanner/?show=${id}`);
  });

  btnToggle.addEventListener("click", () => {
    window.location.href = baseUrl(`toggle/`);
  });
})();
