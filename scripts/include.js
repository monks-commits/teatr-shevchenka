const path = window.location.pathname;

// Все страницы, которые лежат в подпапках репозитория
const isSubdir =
  /\/spectacles\//.test(path) ||
  /\/docs\//.test(path) ||
  /\/admin\//.test(path) ||
  /\/cashier\//.test(path) ||
  /\/scanner\//.test(path) ||
  /\/toggle\//.test(path) ||
  /\/ticket-admin\//.test(path);

const base = isSubdir ? ".." : ".";

function inject(id, url) {
  const el = document.getElementById(id);
  if (!el) return;
  fetch(url)
    .then(r => r.text())
    .then(html => { el.innerHTML = html; })
    .catch(() => { /* молча */ });
}

inject("site-header", `${base}/header.html`);
inject("site-footer", `${base}/footer.html`);
