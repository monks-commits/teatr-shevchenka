(async () => {
  const sel = document.getElementById("show");
  const btn = document.getElementById("open-hall");
  const hint = document.getElementById("hint");

  function labelOf(item) {
    const when = [item.date, item.time].filter(Boolean).join(" ");
    return `${item.title || item.id} • ${when}`.trim();
  }

  let items = [];
  try {
    const res = await fetch("../data/afisha.json", { cache: "no-store" });
    items = res.ok ? await res.json() : [];
  } catch (e) {
    console.error(e);
    items = [];
  }

  if (!Array.isArray(items) || !items.length) {
    hint.textContent = "Немає сеансів у data/afisha.json";
  } else {
    items.forEach((it) => {
      const opt = document.createElement("option");
      opt.value = it.id;
      opt.textContent = labelOf(it);
      sel.appendChild(opt);
    });
  }

  btn.addEventListener("click", () => {
    const id = sel.value;
    if (!id) {
      alert("Оберіть сеанс.");
      return;
    }
    // Реальна схема (та сама, що і для покупця), але в режимі каси:
    window.location.href = `../spectacles/hall.html?show=${encodeURIComponent(id)}&role=cashier`;
  });
})();
