export function fmt(v){
  if(v === null || v === undefined || v === "") return "—";
  return String(v);
}
export function fmtDT(ts){
  try{ return new Date(ts).toLocaleString("uk-UA"); }catch{ return fmt(ts); }
}
export function downloadText(filename, text){
  const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 300);
}
export function toCsv(rows){
  const esc = (v)=>{
    const s = String(v ?? "");
    if(/[",\n;]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  };
  return rows.map(r=>r.map(esc).join(";")).join("\n");
}
