(async () => {
  const sel = document.getElementById("show");
  const btn = document.getElementById("open-hall");
  const hint = document.getElementById("hint");

  let items = [];
  try {
    const res = await fetch("../data/seances/index.json", { cache: "no-store" });
    items = res.ok ? await res.json() : [];
  } catch {
    items = [];
  }

  if (!items.length) {
    hint.textContent = "Немає сеансів у data/seances/index.json";
    return;
  }

  items.forEach(it => {
    const opt = document.createElement("option");
    opt.value = it.id;
    opt.textContent = `${it.title} • ${it.date} ${it.time}`;
    opt.dataset.seance = it.seance;
    sel.appendChild(opt);
  });

  btn.onclick = () => {
    const opt = sel.selectedOptions[0];
    if (!opt) return alert("Оберіть сеанс");

    const url = new URL("../spectacles/hall-cash.html", location.href);
    url.searchParams.set("show", opt.value);
    url.searchParams.set("seance", opt.dataset.seance);
    location.href = url.toString();
  };
})();
