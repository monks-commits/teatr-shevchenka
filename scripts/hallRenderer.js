/* scripts/hallRenderer.js
   Единый рендер зала из data/halls/*.json
   Возвращает Map seatKey -> button
   seatKey:
     Партер:  P{row}-M{seat}
     Амфи:    A{row}-M{seat}
     Балкон:  B{row}-M{seat}
     Ложи:    boxA-{n}, boxB-{n}
*/
(function () {
  function zonePrefix(zone) {
    if (zone === "parter") return "P";
    if (zone === "amphi") return "A";
    if (zone === "balcony") return "B";
    return "P";
  }

  function seatKeyFrom(zone, row, seat) {
    const pref = zonePrefix(zone);
    return `${pref}${row}-M${seat}`;
  }

  function humanizeSeatKey(key) {
    // boxA-5 / boxB-3
    const bm = String(key).match(/^(boxA|boxB)-(\d+)$/i);
    if (bm) {
      const box = bm[1].toLowerCase() === "boxa" ? "Ложа А" : "Ложа Б";
      return `${box}, місце ${Number(bm[2])}`;
    }

    // P12-M7 / A19-M3 / B6-M14
    const m = String(key).match(/^([PAB])(\d+)-M(\d+)$/i);
    if (!m) return key;

    const pref = m[1].toUpperCase();
    const row = Number(m[2]);
    const seat = Number(m[3]);

    if (pref === "P") return `Ряд ${row}, місце ${seat} (Партер)`;
    if (pref === "A") return `Ряд ${row}, місце ${seat} (Амфітеатр)`;
    if (pref === "B") return `Ряд ${row}, місце ${seat} (Балкон)`;
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
    if (extraClass) btn.className += " " + extraClass;

    // цена -> цвет (как у тебя в styles.css)
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
    } else if (status === "blocked" || status === "external") {
      // external = Карабас/внешний канал
      btn.classList.add(status === "external" ? "seat--external" : "seat--blocked");
      btn.disabled = true;
    }

    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  // hall.rows содержит и партер, и амфи, и балкон.
  // В твоём JSON отличаем амфи по seats_left/seats_right.
  function renderRowsBlock({ container, hall, zone, getPrice, getStatus, onToggle }) {
    const seatButtons = new Map();

    const rows = (hall.rows || []).filter((r) => r.zone === zone);

    rows.forEach((r) => {
      const rowLine = document.createElement("div");
      rowLine.className = "row-line";

      const lab = document.createElement("div");
      lab.className = "row-label";
      lab.textContent = String(r.row);
      rowLine.appendChild(lab);

      // Амфи: left + gap + right (если есть seats_left/seats_right)
      const isAmphiSplit = (r.seats_left != null) || (r.seats_right != null);

      if (isAmphiSplit) {
        const left = document.createElement("div");
        left.className = "seats-row";

        const gap = document.createElement("div");
        gap.className = "amphi-gap";

        const right = document.createElement("div");
        right.className = "seats-row";

        const leftCount = Number(r.seats_left || 0);
        const rightCount = Number(r.seats_right || 0);

        // слева 1..leftCount
        for (let s = 1; s <= leftCount; s++) {
          const key = seatKeyFrom(zone, r.row, s);
          const price = getPrice({ zone, row: r.row, seat: s, rowCfg: r });
          const status = getStatus(key, { zone, row: r.row, seat: s, rowCfg: r });
          const btn = makeSeatButton({
            key,
            label: s,
            price,
            extraClass: "seat--amphi",
            status,
            onClick: () => onToggle && onToggle(key, { zone, row: r.row, seat: s, price, status }),
          });
          seatButtons.set(key, btn);
          left.appendChild(btn);
        }

        // справа (нумерация как у тебя: после 11 → 12..)
        for (let i = 1; i <= rightCount; i++) {
          const seatNum = leftCount + i;
          const key = seatKeyFrom(zone, r.row, seatNum);
          const price = getPrice({ zone, row: r.row, seat: seatNum, rowCfg: r });
          const status = getStatus(key, { zone, row: r.row, seat: seatNum, rowCfg: r });
          const btn = makeSeatButton({
            key,
            label: seatNum,
            price,
            extraClass: "seat--amphi",
            status,
            onClick: () => onToggle && onToggle(key, { zone, row: r.row, seat: seatNum, price, status }),
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

      // Обычные ряды (партер/балкон)
      const seatsRow = document.createElement("div");
      seatsRow.className = "seats-row";

      // Балкон ряд 6 у тебя “особый” (seats_left/seats_right в JSON тоже есть),
      // но если он задан как seats:20 + seats_left/right — мы это уже обработали выше.
      // Здесь стандартный вариант: seats = N.
      const seatsCount = Number(r.seats || 0);
      const aisleAfter = Number(r.aisle_after || 0);

      for (let s = 1; s <= seatsCount; s++) {
        const key = seatKeyFrom(zone, r.row, s);
        const price = getPrice({ zone, row: r.row, seat: s, rowCfg: r });
        const status = getStatus(key, { zone, row: r.row, seat: s, rowCfg: r });

        let extraClass = "";
        if (zone === "parter") extraClass = "seat--parter-front";
        if (zone === "balcony") extraClass = "seat--balcony";
        if (aisleAfter && s === aisleAfter) extraClass += " seat--gap-right";

        const btn = makeSeatButton({
          key,
          label: s,
          price,
          extraClass: extraClass.trim(),
          status,
          onClick: () => onToggle && onToggle(key, { zone, row: r.row, seat: s, price, status }),
        });

        seatButtons.set(key, btn);
        seatsRow.appendChild(btn);
      }

      rowLine.appendChild(seatsRow);
      container.appendChild(rowLine);
    });

    return seatButtons;
  }

  function renderBoxes({ containerA, containerB, hall, getPrice, getStatus, onToggle }) {
    const seatButtons = new Map();
    const boxes = hall.boxes || [];

    function renderOne(box, container) {
      if (!box || !container) return;
      const boxId = String(box.id || "");
      const seats = Number(box.seats || 0);

      for (let n = 1; n <= seats; n++) {
        const key = `${boxId}-${n}`;
        const price = getPrice({ zone: "boxes", box: boxId, seat: n, boxCfg: box });
        const status = getStatus(key, { zone: "boxes", box: boxId, seat: n, boxCfg: box });

        const btn = makeSeatButton({
          key,
          label: n,
          price,
          extraClass: "seat--lodge",
          status,
          onClick: () => onToggle && onToggle(key, { zone: "boxes", box: boxId, seat: n, price, status }),
        });

        seatButtons.set(key, btn);
        container.appendChild(btn);
      }
    }

    const boxA = boxes.find((b) => String(b.id).toLowerCase() === "boxa");
    const boxB = boxes.find((b) => String(b.id).toLowerCase() === "boxb");

    renderOne(boxA, containerA);
    renderOne(boxB, containerB);

    return seatButtons;
  }

  function renderHall(opts) {
    const {
      hall,
      // DOM containers:
      parterEl,
      amphiEl,
      balconyEl,
      lodgeAEl,
      lodgeBEl,
      // pricing/status callbacks:
      getPrice,
      getStatus,
      onToggle,
    } = opts;

    if (!hall) throw new Error("renderHall: hall is required");

    parterEl && (parterEl.innerHTML = "");
    amphiEl && (amphiEl.innerHTML = "");
    balconyEl && (balconyEl.innerHTML = "");
    lodgeAEl && (lodgeAEl.innerHTML = "");
    lodgeBEl && (lodgeBEl.innerHTML = "");

    const buttons = new Map();

    // Boxes
    if (lodgeAEl || lodgeBEl) {
      const b = renderBoxes({
        containerA: lodgeAEl,
        containerB: lodgeBEl,
        hall,
        getPrice,
        getStatus,
        onToggle,
      });
      b.forEach((v, k) => buttons.set(k, v));
    }

    // Parter / Amphi / Balcony from hall.rows
    if (parterEl) {
      const b = renderRowsBlock({
        container: parterEl,
        hall,
        zone: "parter",
        getPrice,
        getStatus,
        onToggle,
      });
      b && b.forEach((v, k) => buttons.set(k, v));
    }

    if (amphiEl) {
      const b = renderRowsBlock({
        container: amphiEl,
        hall,
        zone: "amphi",
        getPrice,
        getStatus,
        onToggle,
      });
      b && b.forEach((v, k) => buttons.set(k, v));
    }

    if (balconyEl) {
      const b = renderRowsBlock({
        container: balconyEl,
        hall,
        zone: "balcony",
        getPrice,
        getStatus,
        onToggle,
      });
      b && b.forEach((v, k) => buttons.set(k, v));
    }

    return buttons;
  }

  window.HallRenderer = {
    renderHall,
    humanizeSeatKey,
    seatKeyFrom,
  };
})();
