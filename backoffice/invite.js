const fnUrl = "https://ТВОЙ_PROJECT_ID.supabase.co/functions/v1/invite-create";

document.getElementById("invite-btn").onclick = async () => {
  const seance_id = document.querySelector('input[placeholder*="сеансу"]').value;
  const seatsRaw = document.querySelector('input[placeholder*="P2"]').value;
  const comment = document.querySelector('textarea').value;

  const seats = seatsRaw.split(",").map(s => s.trim()).filter(Boolean);

  const res = await fetch(fnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seance_id, seats, comment })
  });

  alert(res.ok ? "Готово" : "Помилка");
};
