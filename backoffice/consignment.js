const SUPABASE_URL = "https://fhusjlkneckbvnrdhbil.supabase.co";
const SUPABASE_ANON_KEY = "ВСТАВЬ_ANON_PUBLIC_KEY";

const supabase = supabaseJs.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

document.getElementById("con-btn").onclick = async () => {
  const agent = document.getElementById("con-agent").value.trim();
  const seance = document.getElementById("con-seance").value.trim();
  const seatsRaw = document.getElementById("con-seats").value.trim();
  const comment = document.getElementById("con-comment").value.trim();

  if (!agent || !seance || !seatsRaw) {
    alert("Заповніть агента, сеанс і місця");
    return;
  }

  const seats = seatsRaw.split(",").map(s => s.trim()).filter(Boolean);
  const order_id = "CON-" + Date.now();

  // orders
  await supabase.from("orders").insert({
    order_id,
    seance_id: seance,
    amount: 0,
    status: "consignment",
  });

  // tickets
  await supabase.from("tickets").insert(
    seats.map(seat => ({
      order_id,
      seance_id: seance,
      seat_label: seat,
      price: 0,
    }))
  );

  // journal
  await supabase.from("cash_ops").insert({
    op_id: order_id,
    payload: {
      type: "consignment",
      agent,
      seance_id: seance,
      seats,
      comment,
    },
  });

  alert("Передано агенту");
};
