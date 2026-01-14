/* scripts/hallRenderer.js
   Единый рендер зала из data/halls/*.json

   seat_label формат (ЕДИНЫЙ):
     Партер:  P{row}-M{seat}
     Амфи:    A{row}-M{seat}
     Балкон:  B{row}-M{seat}
     Ложа A:  A0-M{seat}
     Ложа B:  B0-M{seat}

   hall.json ожидается в виде:
   {
     "id":"shevchenko-big",
     "rows":[
       {"zone":"parter","row":1,"seats":20,"aisle_after":10,"price_group":"p_parter_1_6"},
       {"zone":"amphi","row":19,"seats_left":11,"seats_right":11,"price_group":"p_amphi_all"},
       {"zone":"balcony","row":1,"seats":28,"aisle_after":14,"price_group":"p_balcony_1_5"},
       {"zone":"balcony","row":6,"seats_left":10,"seats_right":10,"aisle_after":10,"price_group":"p_balcony_6"}
     ],
     "boxes":[
       {"id":"boxA","seats":18,"price_group":"p_boxes"},
       {"id":"boxB","seats":18,"price_group":"p_boxes"}
     ]
   }
*/

(function () {
  function seatKey(zone, row, seat) {
    if (zone === "parter") return `P${row}-M${seat}`;
    if (zone === "amphi") return `A${row}-M${seat}`;
    if (zone === "balcony") return `B${row}-M${seat}`;
    return `P${row}-M${seat}`;
  }

  function boxSeatKey(boxId, seat) {
    const id = String(boxId || "").toLowerCase();
    if (id === "boxa") return `A0-M${seat}`;
    if (id === "boxb") return `B0-M${seat}`;
    // fallback
    return `A0-M${seat}`;
  }

  function humanizeSeatKey(key) {
    const m = String(key).match(/^([PAB])(\d+)-M(\d+)$/i);
    if (!m) return key;
    const pref = m[1].toUpperCase();
    const row = Number(m[2]);
    const seat = Number(m[3]);

    if (pref === "P") return `Ряд ${row}, місце ${seat} (Партер)`;
    if (pref === "A") return row === 0 ? `Ложа А, місце ${seat}` : `Ряд ${row}, місце ${seat} (Амфітеатр)`;
    if (pref === "B") return row === 0 ? `Ложа Б, місце ${seat}` : `Ряд ${row}, місце ${seat} (Балкон)`;
    return key;
  }

  function priceClass(price) {
    const p = Number(price) || 0;
    return `seat--p${p}`;
  }

  function makeSeatButton({ key, label, price, extraClass, status, onClick }) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seat";

    // базовые классы
    if (extraClass) btn.className += " " + extraClass;

    // цена -> цвет (у тебя в styles.css есть seat--p200, seat--p160 и т.д.)
    btn.className += " " + priceClass(price);

    btn.textContent = String(label);
    btn.dataset.key = key;
    btn.dataset.price = String(price);

    // статус поверх цены
    if (status === "sold") {
      btn.classList.add("seat--sold");
      btn.disabled = true;
    } else if (status === "reserved") {
      btn.classList.add("seat--reserved");
    } else if (status === "blocked") {
      btn.classList.add("seat--blocked");
      btn.disabled = true;
    } else if (status === "external") {
      btn.classList.add("seat--external");
      btn.disabled = true;
    }

    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  function renderRows({ container, hall, zone, getPrice, getStatus, onToggle }) {
    const seatButtons = new Map();
    const rows = (hall.rows || []).filter((r) => r.zone === zone);

    rows.forEach((r) => {
      const rowLine = document.createElement("div");
      rowLine.className = "row-line";

      const lab = document.createElement("div");
      lab.className = "row-label";
      lab.textContent = String(r.row);
      rowLine.appendChild(lab);

      const isSplit = r.seats_left != null || r.seats_right != null;

      if (isSplit) {
        const left = document.createElement("div");
        left.className = "seats-row";

        const gap = document.createElement("div");
        gap.className = "amphi-gap";

        const right = document.createElement("div");
        right.className = "seats-row";

        const L = Number(r.seats_left || 0);
        const R = Number(r.seats_right || 0);

        for (let s = 1; s <= L; s++) {
          const key = seatKey(zone, Number(r.row), s);
          const price = getPrice({ zone, row: Number(r.row), seat: s, rowCfg: r });
          const status = getStatus(key, { zone, row: Number(r.row), seat: s, rowCfg: r });

          const extra = zone === "amphi" ? "seat--amphi" : (zone === "balcony" ? "seat--balcony" : "");
          const btn = makeSeatButton({
            key,
            label: s,
            price,
            extraClass: extra,
            status,
            onClick: () => onToggle && onToggle(key, { zone, row: Number(r.row), seat: s, price, status }),
          });

          seatButtons.set(key, btn);
          left.appendChild(btn);
        }

        for (let i = 1; i <= R; i++) {
          const seatNum = L + i; // справа продолжает нумерацию
          const key = seatKey(zone, Number(r.row), seatNum);
          const price = getPrice({ zone, row: Number(r.row), seat: seatNum, rowCfg: r });
          const status = getStatus(key, { zone, row: Number(r.row), seat: seatNum, rowCfg: r });

          const extra = zone === "amphi" ? "seat--amphi" : (zone === "balcony" ? "seat--balcony" : "");
          const btn = makeSeatButton({
            key,
            label: seatNum,
            price,
            extraClass: extra,
            status,
            onClick: () => onToggle && onToggle(key, { zone, row: Number(r.row), seat: seatNum, price, status }),
          });

          seatButtons.set(key, btn);
          right.appendChild(btn);
        }

        rowLine.appendChild(left);
        rowLine.appendChild(gap);
        rowLine.appendChild(right);
        container.appendChild(rowLine);
        return;
      }

      // обычные ряды
      const seatsRow = document.createElement("div");
      seatsRow.className = "seats-row";

      const cnt = Number(r.seats || 0);
      const aisleAfter = Number(r.aisle_after || 0);

      for (let s = 1; s <= cnt; s++) {
        const key = seatKey(zone, Number(r.row), s);
        const price = getPrice({ zone, row: Number(r.row), seat: s, rowCfg: r });
        const status = getStatus(key, { zone, row: Number(r.row), seat: s, rowCfg: r });

        let extra = "";
        if (zone === "parter") extra = "seat--parter-front";
        if (zone === "balcony") extra = "seat--balcony";

        if (aisleAfter && s === aisleAfter) extra = (extra ? extra + " " : "") + "seat--gap-right";

        const btn = makeSeatButton({
          key,
          label: s,
          price,
          extraClass: extra,
          status,
          onClick: () => onToggle && onToggle(key, { zone, row: Number(r.row), seat: s, price, status }),
        });

        seatButtons.set(key, btn);
        seatsRow.appendChild(btn);
      }

      rowLine.appendChild(seatsRow);
      container.appendChild(rowLine);
    });

    return seatButtons;
  }

  function renderBoxes({ lodgeAEl, lodgeBEl, hall, getPrice, getStatus, onToggle }) {
    const seatButtons = new Map();
    const boxes = Array.isArray(hall.boxes) ? hall.boxes : [];

    function renderOne(boxCfg, container) {
      if (!boxCfg || !container) return;
      const seats = Number(boxCfg.seats || 0);

      for (let i = 1; i <= seats; i++) {
        const key = boxSeatKey(boxCfg.id, i);
        const price = getPrice({ zone: "boxes", boxId: boxCfg.id, seat: i, boxCfg });
        const status = getStatus(key, { zone: "boxes", boxId: boxCfg.id, seat: i, boxCfg });

        const btn = makeSeatButton({
          key,
          label: i,
          price,
          extraClass: "seat--lodge",
          status,
          onClick: () => onToggle && onToggle(key, { zone: "boxes", boxId: boxCfg.id, seat: i, price, status }),
        });

        seatButtons.set(key, btn);
        container.appendChild(btn);
      }
    }

    const boxA = boxes.find((b) => String(b.id || "").toLowerCase() === "boxa");
    const boxB = boxes.find((b) => String(b.id || "").toLowerCase() === "boxb");

    renderOne(boxA, lodgeAEl);
    renderOne(boxB, lodgeBEl);

    return seatButtons;
  }

  function renderHall(opts) {
    const {
      hall,
      parterEl,
      amphiEl,
      balconyEl,
      lodgeAEl,
      lodgeBEl,
      getPrice,
      getStatus,
      onToggle,
    } = opts;

    if (!hall) throw new Error("HallRenderer: hall is required");

    if (parterEl) parterEl.innerHTML = "";
    if (amphiEl) amphiEl.innerHTML = "";
    if (balconyEl) balconyEl.innerHTML = "";
    if (lodgeAEl) lodgeAEl.innerHTML = "";
    if (lodgeBEl) lodgeBEl.innerHTML = "";

    const buttons = new Map();

    // Boxes
    const b = renderBoxes({ lodgeAEl, lodgeBEl, hall, getPrice, getStatus, onToggle });
    b.forEach((v, k) => buttons.set(k, v));

    // Zones
    if (parterEl) {
      const m = renderRows({ container: parterEl, hall, zone: "parter", getPrice, getStatus, onToggle });
      m.forEach((v, k) => buttons.set(k, v));
    }
    if (amphiEl) {
      const m = renderRows({ container: amphiEl, hall, zone: "amphi", getPrice, getStatus, onToggle });
      m.forEach((v, k) => buttons.set(k, v));
    }
    if (balconyEl) {
      const m = renderRows({ container: balconyEl, hall, zone: "balcony", getPrice, getStatus, onToggle });
      m.forEach((v, k) => buttons.set(k, v));
    }

    return buttons;
  }

  window.HallRenderer = {
    renderHall,
    humanizeSeatKey,
  };
})();
