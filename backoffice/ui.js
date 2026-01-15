(() => {
  const { qs } = window.BO_UTILS;

  function setText(sel, text) {
    const el = qs(sel);
    if (el) el.textContent = text ?? "";
  }

  function renderBasket(rootEl, basket, currency) {
    if (!rootEl) return;
    if (!Array.isArray(basket) || !basket.length) {
      rootEl.innerHTML = `<div class="muted small">Кошик порожній.</div>`;
      return;
    }

    rootEl.innerHTML = basket.map(i => `
      <div class="item">
        <div>
          <div style="font-weight:800">${i.key}</div>
          <div class="small muted">${i.label || ""}</div>
        </div>
        <div style="font-weight:900;white-space:nowrap">${Number(i.price||0)} ${currency}</div>
      </div>
    `).join("");
  }

  function renderOps(rootEl, ops) {
    if (!rootEl) return;
    if (!Array.isArray(ops) || !ops.length) {
      rootEl.innerHTML = `<div class="muted small">Поки що порожньо.</div>`;
      return;
    }

    const list = ops.slice().reverse().slice(0, 200);
    rootEl.innerHTML = list.map(o => `
      <div class="op">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div><b>${o.action || ""}</b> <span class="pill">${o.status || ""}</span></div>
          <div class="muted">${o.tsHuman || ""}</div>
        </div>
        <div class="small muted">${o.showLabel || ""}</div>
        <div class="small">Місць: <b>${o.count || 0}</b> • Сума: <b>${o.total || 0}</b> ${o.currency || ""}</div>
        <div class="small muted" style="margin-top:4px;word-break:break-word">
          ${(o.seats || []).join(", ")}
        </div>
      </div>
    `).join("");
  }

  window.BO_UI = { setText, renderBasket, renderOps };
})();
