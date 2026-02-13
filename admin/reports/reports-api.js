// admin/reports/reports-api.js

const SUPABASE_URL = "https://fhusjlkneckbvnrdhbil.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nCCfptJOb8Lzy1uAwGBJzA_OJtDneTS";

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  if (!res.ok) throw new Error("Supabase error");
  return await res.json();
}

export async function getSales(params = {}) {

  const { fromDate, toDate, seance, channel } = params;

  let url =
    `${SUPABASE_URL}/rest/v1/orders` +
    `?select=order_id,created_at,amount,show_slug,seance_id,buyer_name,status` +
    `&status=eq.paid`;

  if (fromDate) {
    url += `&created_at=gte.${fromDate}T00:00:00`;
  }

  if (toDate) {
    url += `&created_at=lte.${toDate}T23:59:59`;
  }

  if (seance) {
    url += `&seance_id=eq.${encodeURIComponent(seance)}`;
  }

  const orders = await fetchJson(url);

  if (!orders.length) {
    return {
      rows: [],
      totals: { count: 0, sum: 0, online: 0, cash: 0 }
    };
  }

  // получаем билеты по order_id
  const ids = orders.map(o => o.order_id).join(",");

  const tickets = await fetchJson(
    `${SUPABASE_URL}/rest/v1/tickets?order_id=in.(${ids})&select=order_id,seat_label`
  );

  const rows = orders.map(o => {

    const seats = tickets
      .filter(t => t.order_id === o.order_id)
      .map(t => t.seat_label);

    const isCash = o.order_id.startsWith("CASH-");

    return {
      date: o.created_at,
      seance: o.seance_id,
      title: o.show_slug,
      channel: isCash ? "cash" : "online",
      seats,
      amount: o.amount,
      cashier: isCash ? "КАСА" : "—"
    };
  });

  const totals = {
    count: rows.length,
    sum: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
    online: rows.filter(r => r.channel === "online").length,
    cash: rows.filter(r => r.channel === "cash").length
  };

  return { rows, totals };
}
