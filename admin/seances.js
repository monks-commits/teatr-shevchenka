function loadSeances() {
  try {
    return JSON.parse(localStorage.getItem("admin_seances")) || [];
  } catch {
    return [];
  }
}

function saveSeances(arr) {
  localStorage.setItem("admin_seances", JSON.stringify(arr));
}

function renderSeances() {
  const tbody = document.querySelector("#seancesTable tbody");
  const emptyMsg = document.getElementById("emptyMsg");

  const seances = loadSeances();
  tbody.innerHTML = "";

  if (!seances.length) {
    emptyMsg.style.display = "block";
    return;
  }

  emptyMsg.style.display = "none";

  seances.forEach(s => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><b>${s.show_slug}</b></td>
      <td>${s.date}</td>
      <td>${s.time}</td>
      <td>${s.hall_id || "—"}</td>
      <td>
        <button class="btn btn-ghost" data-open="${s.seance_id}">
          Відкрити зал
        </button>
        <button class="btn btn-ghost" data-del="${s.seance_id}">
          ✖
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

document.addEventListener("click", e => {
  const openId = e.target.dataset.open;
  const delId  = e.target.dataset.del;

  if (openId) {
    location.href =
      `../spectacles/hall-cash.html?seance=${openId}&mode=admin`;
  }

  if (delId) {
    if (!confirm("Видалити сеанс?")) return;

    let seances = loadSeances();
    seances = seances.filter(s => s.seance_id !== delId);
    saveSeances(seances);

    // удаляем состояние зала
    localStorage.removeItem(`hall_state_${delId}`);

    renderSeances();
  }
});

renderSeances();
