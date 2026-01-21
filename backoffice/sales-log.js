// Читаем локальные продажи из localStorage
// Ожидаемый ключ: "cash_sales_log" (массив объектов)

const tbody = document.getElementById("sales-body");

// Попробуем несколько ключей — безопасно
function readLocalSales() {
  const keys = ["cash_sales_log", "sales_log", "cash_log"];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
  }
  return [];
}

function render() {
  const rows = readLocalSales();
  tbody.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6">Поки що немає продажів (localStorage)</td>`;
    tbody.appendChild(tr);
    return;
  }

  rows
    .slice()
    .reverse() // последние сверху
    .forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.date || ""}</td>
        <td>${r.seance || ""}</td>
        <td>${(r.seats || []).join(", ")}</td>
        <td class="right">${r.amount || 0} грн</td>
        <td>${r.type || "каса"}</td>
        <td>${r.comment || ""}</td>
      `;
      tbody.appendChild(tr);
    });
}

render();
