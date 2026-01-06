import { fmt, fmtDT } from "./utils.js";

export function renderOrders(listEl, orders, activeId, onPick){
  listEl.innerHTML = "";
  if(!orders.length){
    listEl.innerHTML = `<div class="muted">Нічого не знайдено.</div>`;
    return;
  }

  for(const o of orders){
    const div = document.createElement("div");
    div.className = "item" + (o.id === activeId ? " active" : "");
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div>
          <div style="font-weight:800">${fmt(o.order_id || o.id)}</div>
          <div class="muted">${fmtDT(o.created_at)}</div>
        </div>
        <div style="text-align:right">
          <div><span class="pill">${fmt(o.status)}</span></div>
          <div style="margin-top:6px;font-weight:800">${fmt(o.amount)} ${fmt(o.currency || "грн")}</div>
        </div>
      </div>
      <div class="muted" style="margin-top:8px">
        ${fmt(o.email)} ${o.phone ? "• " + fmt(o.phone) : ""} ${o.channel ? "• " + fmt(o.channel) : ""}
      </div>
    `;
    div.addEventListener("click", ()=>onPick(o));
    listEl.appendChild(div);
  }
}

export function renderDetails(detailsEl, order, tickets){
  if(!order){
    detailsEl.innerHTML = `<div class="muted">Оберіть замовлення.</div>`;
    return;
  }

  const seats = tickets?.map(t=>fmt(t.seat_label || `${t.zone||""} ${t.row||""}-${t.seat||""}`)).join(", ");

  detailsEl.innerHTML = `
    <div class="kv">
      <div class="k">order_id</div><div>${fmt(order.order_id || order.id)}</div>
      <div class="k">Статус</div><div>${fmt(order.status)}</div>
      <div class="k">Канал</div><div>${fmt(order.channel)}</div>
      <div class="k">Сума</div><div><b>${fmt(order.amount)} ${fmt(order.currency || "грн")}</b></div>
      <div class="k">Email</div><div>${fmt(order.email)}</div>
      <div class="k">Телефон</div><div>${fmt(order.phone)}</div>
      <div class="k">Створено</div><div>${fmtDT(order.created_at)}</div>
    </div>

    <hr/>

    <div style="font-weight:800;margin-bottom:8px">Квитки (${tickets?.length || 0})</div>
    <div class="muted" style="margin-bottom:8px">${seats || "—"}</div>

    ${(tickets||[]).map(t=>`
      <div class="item" style="cursor:default">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div>
            <div style="font-weight:800">${fmt(t.seat_label || `${t.zone||""} ${t.row||""}-${t.seat||""}`)}</div>
            <div class="muted">${fmt(t.price)} ${fmt(t.currency || "грн")}</div>
          </div>
          <div style="text-align:right">
            <div><span class="pill">${fmt(t.status)}</span></div>
            <div class="muted" style="margin-top:6px">${t.checked_in_at ? "✅ " + fmtDT(t.checked_in_at) : "—"}</div>
          </div>
        </div>

        <div class="muted" style="margin-top:8px">
          ticket_id: ${fmt(t.id)}${t.qr_payload ? " • qr: " + fmt(t.qr_payload) : ""}
        </div>

        ${t.pdf_url ? `<div style="margin-top:8px"><a href="${t.pdf_url}" target="_blank" rel="noopener">PDF</a></div>` : ``}
      </div>
    `).join("")}
  `;
}
