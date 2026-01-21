document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("invite-btn");
  if (!btn) return;

  const FN_URL = "https://fhusjlkneckbvnrdhbil.supabase.co/functions/v1/invite-create";

  btn.addEventListener("click", async () => {
    const seance = document.getElementById("invite-seance").value.trim();
    const seatsRaw = document.getElementById("invite-seats").value.trim();
    const comment = document.getElementById("invite-comment").value.trim();

    if (!seance || !seatsRaw) {
      alert("Заповніть сеанс і місця");
      return;
    }

    const seats = seatsRaw
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    try {
      const res = await fetch(FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seance_id: seance,
          seats,
          comment
        })
      });

      if (!res.ok) {
        const t = await res.text();
        alert("Помилка: " + t);
        return;
      }

      alert("Запрошення оформлено");
    } catch (e) {
      alert("Fetch error: " + e.message);
    }
  });
});
