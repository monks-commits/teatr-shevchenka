// backoffice/ui.js
(function(){
  const { qs } = window.BO_UTILS;

  function setText(id, text){
    const el = qs(id);
    if (el) el.textContent = text;
  }

  function clear(el){
    if (el) el.innerHTML = '';
  }

  function renderBasket(listEl, items, currency){
    clear(listEl);
    if (!listEl) return;
    if (!items.length) return;

    for (const it of items){
      const row = document.createElement('div');
      row.className = 'bItem';
      row.innerHTML = `<span>${it.label}</span><span><strong>${it.price}</strong> ${currency}</span>`;
      listEl.appendChild(row);
    }
  }

  function renderOps(listEl, ops){
    clear(listEl);
    if (!listEl) return;

    if (!ops.length){
      listEl.innerHTML = `<div class="muted">Поки що немає операцій.</div>`;
      return;
    }

    for (const o of ops.slice().reverse()){
      const div = document.createElement('div');
      div.className = 'op';
      div.innerHTML = `
        <div class="t">${o.action} • ${o.count} • ${o.total} ${o.currency}</div>
        <div class="m">${o.showLabel || ''} • ${o.tsHuman || o.ts}</div>
        <div class="m">${(o.seats||[]).join(', ')}</div>
      `;
      listEl.appendChild(div);
    }
  }

  window.BO_UI = {
    setText,
    renderBasket,
    renderOps
  };
})();
