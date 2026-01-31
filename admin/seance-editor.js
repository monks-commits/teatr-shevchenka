let SEANCE = {
  seance_id: "",
  pricing: {},
  seat_overrides: {},
  meta: {}
};

const $ = id => document.getElementById(id);

$("load").onclick = loadSeance;
$("save").onclick = saveSeance;
$("add-pricing").onclick = addPricingRow;
$("add-override").onclick = addOverrideRow;

// -------------------------

async function loadSeance() {
  const id = $("seance-id").value.trim();
  if (!id) return alert("Введи seance id");

  const res = await fetch(`../data/seances/${id}.json`, { cache: "no-store" });
  if (!res.ok) return alert("seance.json не знайдено");

  SEANCE = await res.json();
  renderPricing();
  renderOverrides();
}

// -------------------------

function renderPricing() {
  const box = $("pricing-list");
  box.innerHTML = "";

  Object.entries(SEANCE.pricing || {}).forEach(([key, val]) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <input value="${key}" data-k="key" style="width:80px">
      <input type="number" value="${val.price ?? ""}" data-k="price" style="width:70px">
      <label>
        <input type="checkbox" ${val.sale !== false ? "checked" : ""} data-k="sale">
        продаж
      </label>
      <button>✖</button>
    `;

    row.querySelector("button").onclick = () => {
      delete SEANCE.pricing[key];
      renderPricing();
    };

    row.querySelectorAll("input").forEach(i => {
      i.onchange = () => syncPricing(row, key);
    });

    box.appendChild(row);
  });
}

function syncPricing(row, oldKey) {
  const inputs = row.querySelectorAll("input");
  const newKey = inputs[0].value.trim();
  const price = Number(inputs[1].value);
  const sale = inputs[2].checked;

  delete SEANCE.pricing[oldKey];
  SEANCE.pricing[newKey] = { price, sale };
  renderPricing();
}

function addPricingRow() {
  SEANCE.pricing["P1-1"] = { price: 0, sale: true };
  renderPricing();
}

// -------------------------

function renderOverrides() {
  const box = $("overrides-list");
  box.innerHTML = "";

  Object.entries(SEANCE.seat_overrides || {}).forEach(([key, val]) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <input value="${key}" style="width:90px">
      <input type="number" value="${val.price ?? ""}" style="width:70px">
      <label>
        <input type="checkbox" ${val.sale !== false ? "checked" : ""}>
        продаж
      </label>
      <button>✖</button>
    `;

    row.querySelector("button").onclick = () => {
      delete SEANCE.seat_overrides[key];
      renderOverrides();
    };

    row.querySelectorAll("input").forEach(() => {
      row.onchange = () => syncOverride(row, key);
    });

    box.appendChild(row);
  });
}

function syncOverride(row, oldKey) {
  const i = row.querySelectorAll("input");
  const key = i[0].value.trim();
  const price = i[1].value ? Number(i[1].value) : undefined;
  const sale = i[2].checked;

  delete SEANCE.seat_overrides[oldKey];
  SEANCE.seat_overrides[key] = { price, sale };
  renderOverrides();
}

function addOverrideRow() {
  SEANCE.seat_overrides["P1-M1"] = { sale: false };
  renderOverrides();
}

// -------------------------

function saveSeance() {
  const json = JSON.stringify(SEANCE, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${SEANCE.seance_id || "seance"}.json`;
  a.click();
}
