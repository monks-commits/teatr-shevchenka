/* hall-cash.js — КАССА
   - локальная корзина
   - печать
   - передача корзины в backoffice
*/

(function () {
  const qs = (id) => document.getElementById(id);

  const hallRoot = qs("hallRoot");
  const basketList = qs("basketList");
  const sumAmount = qs("sumAmount");

  const btnSell = qs("btnSell");
  const btnReserve = qs("btnReserve");
  const btnClear = qs("btnClear");

  let basket = []; // ← ЕДИНСТВЕННАЯ корзина

  // =========================
  // HELPERS
  // =========================
  function seatKey(row, seat) {
    return `${row}-${seat}`;
  }

  function fmtUAH(n) {
    return `${Number(n || 0)} грн`;
  }

  function notifyParentBasket() {
    if (window.parent === window) return;

    const payload = basket.map((x) => ({
      key: x.key,
      label: x.label,
      price: x.price,
    }));

    console.log("HALL → PARENT basket:", payload);

    window.parent.postMessage(
      {
        source: "hall-cash",
        type: "basket",
        payload,
      },
      "*"
    );
  }

  // =========================
  // BASKET LOGIC
  // =========================
  function inBasket(k) {
    return basket.some((x) => x.key === k);
  }

  function toggleBasket(row, seat) {
    const k = seatKey(row, seat);

    if (inBasket(k)) {
      basket = basket.filter((x) => x.key !== k);
    } else {
      basket.push({
        key: k,
        row,
        seat,
        label: `Ряд ${row}, місце ${seat}`,
        price: 10, // цена для примера
      });
    }

    renderBasket();
    renderHall();
    sendBasketToParent(); // ← ВАЖНО
  }

  function clearBasket() {
    basket = [];
    renderBasket();
    renderHall();
    notifyParentBasket();
  }

  // =========================
  // RENDER
  // =========================
  function renderBasket() {
    if (!basket.length) {
      basketList.textContent = "Кошик порожній";
      sumAmount.innerHTML = "<b>0 грн</b>";
      btnSell.disabled = true;
      btnReserve.disabled = true;
      btnClear.disabled = true;
      return;
    }

    btnSell.disabled = false;
    btnReserve.disabled = false;
    btnClear.disabled = false;

    const total = basket.reduce((s, x) => s + x.price, 0);
    sumAmount.innerHTML = `<b>${fmtUAH(total)}</b>`;

    basketList.innerHTML = basket
      .map(
        (x) => `
      <div class="basket-item">
        ${x.label} — <b>${fmtUAH(x.price)}</b>
      </div>`
      )
      .join("");
  }

  function renderHall() {
    hallRoot.innerHTML = "";

    for (let row = 1; row <= 5; row++) {
      const line = document.createElement("div");
      line.className = "rowline";

      for (let seat = 1; seat <= 10; seat++) {
        const btn = document.createElement("div");
        btn.className = "seat";

        const k = seatKey(row, seat);
        btn.textContent = seat;

        if (inBasket(k)) {
          btn.style.background = "#2563eb";
          btn.style.color = "#fff";
        }

        btn.onclick = () => toggleBasket(row, seat);
        line.appendChild(btn);
      }

      hallRoot.appendChild(line);
    }
  }

  // =========================
  // BUTTONS
  // =========================
  btnClear.onclick = clearBasket;

  btnReserve.onclick = () => {
    if (!basket.length) return;
    alert("РЕЗЕРВ (локально)");
    clearBasket();
  };

  btnSell.onclick = () => {
    if (!basket.length) return;
    alert("ПРОДАЖ (локально)");
    clearBasket();
  };

  // =========================
  // INIT
  // =========================
  renderBasket();
  renderHall();
})();
