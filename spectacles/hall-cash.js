/* ===============================
   HALL CASH — BASKET → BACKOFFICE
   =============================== */

let basket = [];

/* ===============================
   SEND BASKET TO BACKOFFICE
   =============================== */
function sendBasketToBackoffice() {
  if (!window.parent) return;

  const payload = {
    seats: basket.map(item => ({
      key: item.key,
      label: item.label,
      price: item.price,
      zone: item.zone
    })),
    total: basket.reduce((s, i) => s + (Number(i.price) || 0), 0)
  };

  window.parent.postMessage(
    {
      source: "hall-cash",
      type: "basket:update",
      payload
    },
    "*"
  );
}

/* ===============================
   BASKET HELPERS
   =============================== */
function inBasket(key) {
  return basket.some(x => x.key === key);
}

/* ===============================
   TOGGLE SEAT
   =============================== */
function toggleBasket(row, seat) {
  const key = seatKey(row, seat);
  const status = getSeatStatus(row, seat);

  if (status === "sold" || status === "blocked") return;

  if (inBasket(key)) {
    basket = basket.filter(x => x.key !== key);
    setSeatStatus(row, seat, "free");
  } else {
    const info = {
      key,
      row: Number(row),
      seat: Number(seat),
      label: `Ряд ${row}, місце ${seat}`,
      price: priceFor(row),
      zone: zoneFor(row)
    };
    basket.push(info);
    setSeatStatus(row, seat, "basket");
  }

  renderBasket();
  renderHall();
}

/* ===============================
   CLEAR BASKET
   =============================== */
function clearBasket() {
  for (const item of basket) {
    const [r, s] = item.key.split("-").map(Number);
    setSeatStatus(r, s, "free");
  }
  basket = [];
  renderBasket();
  renderHall();
}

/* ===============================
   APPLY STATUS
   =============================== */
function applyBasketStatus(toStatus) {
  for (const item of basket) {
    const [r, s] = item.key.split("-").map(Number);
    setSeatStatus(r, s, toStatus);
  }
  basket = [];
  renderBasket();
  renderHall();
}

/* ===============================
   RENDER BASKET
   =============================== */
function renderBasket() {
  const list = document.getElementById("basketList");
  const totalEl = document.getElementById("basketTotal");

  if (!list || !totalEl) return;

  list.innerHTML = "";

  if (!basket.length) {
    list.innerHTML = "<div class='muted'>Кошик порожній</div>";
    totalEl.textContent = "0";
    sendBasketToBackoffice(); // ← ВАЖНО
    return;
  }

  let total = 0;

  for (const item of basket) {
    total += Number(item.price) || 0;

    const div = document.createElement("div");
    div.className = "basket-item";
    div.textContent = `${item.label} — ${item.price} грн`;
    list.appendChild(div);
  }

  totalEl.textContent = total;

  // 🔴 ОТПРАВКА В BACKOFFICE
  sendBasketToBackoffice();
}

/* ===============================
   DUMMY PLACEHOLDERS
   (оставь, если они уже есть)
   =============================== */
function seatKey(row, seat) {
  return `${row}-${seat}`;
}
function getSeatStatus() { return "free"; }
function setSeatStatus() {}
function priceFor() { return 0; }
function zoneFor() { return ""; }
function renderHall() {}
