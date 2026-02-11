// admin/reports/reports-api.js
// ЕДИНЫЙ интерфейс для ВСЕХ продуктов

export async function getSales(params = {}) {
  /*
    params = {
      fromDate,
      toDate,
      seance,
      channel
    }
  */

  // ⛔ НИКАКОЙ логики тут в lab
  // Реализация будет в конкретных репо

  return {
    rows: [],        // массив продаж
    totals: {
      count: 0,
      sum: 0,
      online: 0,
      cash: 0
    }
  };
}
