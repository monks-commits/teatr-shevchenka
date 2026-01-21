const FN_URL = "https://ТВОЙ_PROJECT_ID.supabase.co/functions/v1/invite-create";

document.getElementById("invite-btn").onclick = async () => {
  const seance = document.getElementById("invite-seance").value.trim();
  const seatsRaw = document.getElementById("invite-seats").value.trim();
  const comment = document.getElementById("invite-comment").value.trim();

  if (!seance || !seatsRaw) {
    alert("Заповніть сеанс і місця");
    return;
  }

  const seats = seatsRaw.split(",").map(s => s.trim()).filter(Boolean);

  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seance_id: seance, seats, comment })
  });

  if (!res.ok) {
    alert("Помилка оформлення");
    return;
  }

  alert("Запрошення оформлено");
};
