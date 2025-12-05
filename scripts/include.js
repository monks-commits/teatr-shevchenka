const path = window.location.pathname;
const isSubdir = /\/spectacles\//.test(path) || /\/docs\//.test(path);
const base = isSubdir ? ".." : ".";

function inject(id, url){
  const el = document.getElementById(id);
  if (!el) return;
  fetch(url).then(r => r.text()).then(html => { el.innerHTML = html; });
}

inject("site-header", `${base}/header.html`);
inject("site-footer", `${base}/footer.html`);
