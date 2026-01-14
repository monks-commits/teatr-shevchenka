(() => {
  const { qs } = window.BO_UTILS;

  function setText(sel, text){
    const el = qs(sel);
    if(el) el.textContent = text ?? "";
  }

  function renderBasket(root, basket, currency){
    if(!root) return;
    if(!basket || !basket.length){
      root.innerHTML = `<div class="muted">Поки що нічого не обрано.</div>`;
      return;
    }
    root.innerHTML = basket
      .slice()
      .sort((a,b)=> String(a.key).localeCompare(String(b.key)))
      .map(x => `
        <div class="item">
          <div>${x.label}</div>
          <div><b>${x.price}</b> ${currency}</div>
        </div>
      `).join("");
  }

  function renderOps(root, ops){
    if(!root) return;
    if(!ops || !ops.length){
      root.innerHTML = `<div class="muted">Поки немає операцій.</div>`;
      return;
    }
    root.innerHTML = ops.slice().reverse().map(o => `
      <div class="op">
        <div><b>${o.action}</b> <span class="pill">${o.count}</span></div>
        <div class="muted">${o.tsHuman} • ${o.showLabel}</div>
        <div class="muted">Seats: ${(o.seats||[]).join(", ")}</div>
      </div>
    `).join("");
  }

  window.BO_UI = { setText, renderBasket, renderOps };
})();
