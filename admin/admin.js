// admin/admin.js
// Простая офлайн-адмінка касира поверх уже намальованої схеми залу.
// Працюємо з елементами .seat, які створює скрипт hall.js / hall-admin.js.
//
// Потрібні елементи в HTML:
//  - контейнер з місцями: <div id="hall">…</div> (або будь-який, головне всередині є .seat)
//  - кнопки:
//      #btnSell            – «Продати (каса)»
//      #btnReserve         – «Поставити на бронь»
//      #btnCancelReserve   – «Скасувати бронь»
//      #btnClear           – «Очистити кошик»
//  - таблиця/список кошика: <tbody id="basketBody">…</tbody>
//  - підсумок: <span id="basketTotal"></span>
//
// Стан місць зберігаємо в localStorage, щоб касир не втратив позначки
// при перезавантаженні сторінки.

(function () {
  const hallRoot =
    document.getElementById("hall") ||
    document.querySelector(".hall-wrapper") ||
    document.body;

  const btnSell = document.getElementById("btnSell");
  const btnReserve = document.getElementById("btnReserve");
  const btnCancelReserve = document.getElementById("btnCancelReserve");
  const btnClear = document.getElementById("btnClear");

  const basketBody = document.getElementById("basketBody");
  const basketTotal = document.getElementById("basketTotal");

  // Набір обраних ключів місць
  const selectedKeys = new Set();

  // Стан місць: { "<key>": { status, price, row, seat, zone } }
  let placesState = {};

  // Префікс для localStorage – щоб для різних сеансів була окрема корзина
  const STORAGE_KEY =
    "admin_places_" +
    (document.body.dataset.seance ||
      new URLSearchParams(location.search).get("seance") ||
      "default");

  // ---- Ініціалізація ----
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    collectInitialStateFromDOM();
    restoreFromStorage();
    attachSeatHandlers();
    attachButtons();
    renderBasket();
  }

  // Збираємо початковий стан по розмітці .seat
  function collectInitialStateFromDOM() {
    const seats = hallRoot.querySelectorAll(".seat");

    seats.forEach((el) => {
      const key =
        el.dataset.key ||
        (el.dataset.box
          ? `box${el.dataset.box}-${el.dataset.seat || el.textContent.trim()}`
          : el.dataset.row && el.dataset.seat
          ? `${el.dataset.row}-${el.dataset.seat}`
          : null);

      if (!key) return;

      const status = getStatusFromClasses(el); // free / sold / reserved / blocked

      const row = el.dataset.row || "";
      const seat = el.dataset.seat || el.textContent.trim() || "";
      const zone = el.dataset.zone || "";

      // Ціна може зберігатись або окремо, або в data-price / data-priceGroup
      let price = 0;
      if (el.dataset.price) {
        price = Number(el.dataset.price) || 0;
      } else if (el.dataset.priceGroup && window.SEANCE && SEANCE.prices) {
        const grp = el.dataset.priceGroup;
        price = Number(SEANCE.prices[grp] || 0);
      }

      placesState[key] = {
        status,
        row,
        seat,
        zone,
        price,
      };

      // Синхронізуємо CSS-класи по статусу (на випадок, якщо розмітка "гола")
      applyStatusClass(el, status);
    });
  }

  function getStatusFromClasses(el) {
    if (el.classList.contains("seat--sold")) return "sold";
    if (el.classList.contains("seat--reserved")) return "reserved";
    if (el.classList.contains("seat--blocked")) return "blocked";
    // Якщо явно нічого немає – вважаємо місце вільним
    return "free";
  }

  // Відновити стан з localStorage (якщо є)
  function restoreFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;

      Object.entries(saved).forEach(([key, val]) => {
        if (!placesState[key]) return;
        placesState[key].status = val.status || "free";

        const el = findSeatElementByKey(key);
        if (el) {
          applyStatusClass(el, placesState[key].status);
        }
      });
    } catch (e) {
      console.warn("Не вдалося прочитати стан каси з localStorage", e);
    }
  }

  function saveToStorage() {
    try {
      const mapToSave = {};
      Object.entries(placesState).forEach(([key, val]) => {
        mapToSave[key] = { status: val.status };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mapToSave));
    } catch (e) {
      console.warn("Не вдалося зберегти в localStorage", e);
    }
  }

  // ---- Робота з місцями ----

  function attachSeatHandlers() {
    hallRoot.addEventListener("click", (ev) => {
      const seat = ev.target.closest(".seat");
      if (!seat) return;

      const key =
        seat.dataset.key ||
        (seat.dataset.box
          ? `box${seat.dataset.box}-${seat.dataset.seat || seat.textContent.trim()}`
          : seat.dataset.row && seat.dataset.seat
          ? `${seat.dataset.row}-${seat.dataset.seat}`
          : null);

      if (!key || !placesState[key]) return;

      const curStatus = placesState[key].status;

      // Забороняємо вибирати заблоковані місця
      if (curStatus === "blocked") return;

      // Тогл виділення
      if (selectedKeys.has(key)) {
        selectedKeys.delete(key);
        seat.classList.remove("seat--selected");
      } else {
        selectedKeys.add(key);
        seat.classList.add("seat--selected");
      }

      renderBasket();
    });
  }

  function attachButtons() {
    if (btnSell)
      btnSell.addEventListener("click", () => applyStatusToSelection("sold"));
    if (btnReserve)
      btnReserve.addEventListener("click", () =>
        applyStatusToSelection("reserved")
      );
    if (btnCancelReserve)
      btnCancelReserve.addEventListener("click", cancelReserve);
    if (btnClear) btnClear.addEventListener("click", clearSelection);
  }

  // Застосувати статус до всіх виділених місць
  function applyStatusToSelection(status) {
    if (!selectedKeys.size) {
      alert("Спочатку оберіть хоча б одне місце.");
      return;
    }

    selectedKeys.forEach((key) => {
      const place = placesState[key];
      if (!place) return;

      // Не даємо перезаписувати заблоковані місця
      if (place.status === "blocked") return;

      place.status = status;

      const el = findSeatElementByKey(key);
      if (el) {
        applyStatusClass(el, status);
        el.classList.remove("seat--selected");
      }
    });

    selectedKeys.clear();
    saveToStorage();
    renderBasket();
  }

  // НОВА ФУНКЦІЯ: скасувати бронь для виділених місць
  function cancelReserve() {
    if (!selectedKeys.size) {
      alert("Спочатку оберіть хоча б одне заброньоване місце.");
      return;
    }

    let changed = false;

    selectedKeys.forEach((key) => {
      const place = placesState[key];
      if (!place) return;

      if (place.status === "reserved") {
        place.status = "free";
        const el = findSeatElementByKey(key);
        if (el) {
          applyStatusClass(el, "free");
          el.classList.remove("seat--selected");
        }
        changed = true;
      }
    });

    selectedKeys.clear();
    if (!changed) {
      alert("Серед обраних місць немає броні.");
      renderBasket();
      return;
    }

    saveToStorage();
    renderBasket();
    alert("Бронь для обраних місць скасовано.");
  }

  // Зняти тільки виділення (кошик) – статуси не міняємо
  function clearSelection() {
    selectedKeys.forEach((key) => {
      const el = findSeatElementByKey(key);
      if (el) el.classList.remove("seat--selected");
    });
    selectedKeys.clear();
    renderBasket();
  }

  // Пошук DOM-елемента місця за ключем
  function findSeatElementByKey(key) {
    // Спочатку пробуємо знайти по data-key
    let el = hallRoot.querySelector(`.seat[data-key="${key}"]`);
    if (el) return el;

    // Для лож – ключ виду boxA-5
    if (key.startsWith("box")) {
      const [boxId, seatNum] = key.split("-");
      const box = boxId.replace("box", "");
      el = hallRoot.querySelector(
        `.seat[data-box="${box}"][data-seat="${seatNum}"]`
      );
      if (el) return el;
    }

    // Для звичайних рядів: "ряд-місце"
    const [row, seat] = key.split("-");
    if (row && seat) {
      el = hallRoot.querySelector(
        `.seat[data-row="${row}"][data-seat="${seat}"]`
      );
    }
    return el || null;
  }

  // Проставити CSS-класи за статусом
  function applyStatusClass(el, status) {
    el.classList.remove(
      "seat--free",
      "seat--sold",
      "seat--reserved",
      "seat--blocked"
    );

    switch (status) {
      case "sold":
        el.classList.add("seat--sold");
        break;
      case "reserved":
        el.classList.add("seat--reserved");
        break;
      case "blocked":
        el.classList.add("seat--blocked");
        break;
      default:
        el.classList.add("seat--free");
    }
  }

  // ---- Рендер кошика ----

  function renderBasket() {
    if (!basketBody) return;

    basketBody.innerHTML = "";

    let total = 0;

    const rows = [];

    selectedKeys.forEach((key) => {
      const place = placesState[key];
      if (!place) return;

      const rowLabel = place.row || "-";
      const seatLabel = place.seat || "-";
      const zoneLabel = place.zone || "";

      const price = Number(place.price || 0);
      total += price;

      rows.push(
        `<tr>
          <td>${zoneLabel}</td>
          <td>${rowLabel}</td>
          <td>${seatLabel}</td>
          <td>${price ? price + " грн" : "-"}</td>
        </tr>`
      );
    });

    basketBody.innerHTML = rows.join("");

    if (basketTotal) {
      basketTotal.textContent = total ? total + " грн" : "0 грн";
    }
  }
})();
