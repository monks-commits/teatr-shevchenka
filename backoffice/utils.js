(() => {
  function qs(sel, root=document){ return root.querySelector(sel); }
  function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

  function nowIso(){ return new Date().toISOString(); }
  function pad(n){ return String(n).padStart(2,"0"); }
  function fmtDT(ts){
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function fetchJson(url){
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  }

  function downloadText(filename, text){
    const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 500);
  }

  function toCsv(rows){
    return rows.map(r => r.map(x => {
      const s = String(x ?? "");
      if(/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
      return s;
    }).join(",")).join("\n");
  }

  window.BO_UTILS = { qs, qsa, nowIso, fmtDT, fetchJson, downloadText, toCsv };
})();
