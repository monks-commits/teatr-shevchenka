// admin/seance-create.js

document.getElementById("seanceForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const showSlug = document.getElementById("showSlug").value.trim();
  const date = document.getElementById("date").value;
  const time = document.getElementById("time").value;

  if (!showSlug || !date || !time) {
    alert("Заповніть усі поля");
    return;
  }

  const timeSafe = time.replace(":", "-");
  const seanceId = `${showSlug}-${date}-${timeSafe}`;

  const seance = {
    seance_id: seanceId,
    show_slug: showSlug,
    date,
    time,
    created_at: new Date().toISOString(),
    status: "draft" // draft | ready | published
  };

  // сохраняем список сеансов локально
  const key = "admin_seances";
  const list = JSON.parse(localStorage.getItem(key) || "[]");

  if (list.find(s => s.seance_id === seanceId)) {
    alert("Такий сеанс вже існує");
    return;
  }

  list.push(seance);
  localStorage.setItem(key, JSON.stringify(list));

  // переход к схеме зала (чистой)
  window.location.href =
    `../spectacles/hall-cash.html?seance=${seanceId}&mode=admin`;
});
