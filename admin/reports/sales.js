// admin/reports/sales.js
import { getSales } from "./reports-api.js";

const tableBody = document.querySelector("#salesTable tbody");
const btnApply = document.getElementById("btnApply");

btnApply.addEventListener("click", loadSales);

async function loadSales() {
  tableBody.innerHTML = `<tr><td colspan="7">Завантаження…</td></tr>`;

  const params = {
    fromDate: document.getElementById("fromDate").value,
    toDate: document.getElementById("toDate").value,
    seance: document.getElementById("seanceFilter").value,
    channel: document.getElementById("channelFilter").value
  };

  const result = await getSales(params);

  renderTable(result.rows);
}

function renderTable(rows) {
  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="7" class="muted">Немає даних</td></tr>`;
    return;
  }

  tableBody.innerHTML = rows.map(r => `
    <tr>
      <td>${fmt(r.date)}</td>
      <td>${r.seance}</td>
      <td>${r.title}</td>
      <td>${channelLabel(r.channel)}</td>
      <td>${r.seats.join(", ")}</td>
      <td><b>${r.amount} грн</b></td>
      <td>${r.cashier || "—"}</td>
    </tr>
  `).join("");
}

function channelLabel(c) {
  if (c === "online") return "Онлайн";
  if (c === "cash") return "Каса";
  return c || "—";
}

function fmt(v) {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleString("uk-UA");
}
