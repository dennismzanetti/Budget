/**
 * partials.js — fetch and inject all html/ partial files into the DOM shell.
 * Called once before app init. Runs all fetches in parallel for speed.
 */
export async function loadPartials() {
  const partials = [
    { file: "login",        container: "loggedOutView",   method: "innerHTML" },
    { file: "dashboard",    container: "page-dashboard",  method: "outerHTML" },
    { file: "transactions", container: "page-transactions",method: "outerHTML" },
    { file: "accounts",     container: "page-accounts",   method: "outerHTML" },
    { file: "categories",   container: "page-categories",  method: "outerHTML" },
    { file: "reports",      container: "page-reports",    method: "outerHTML" },
    { file: "import",       container: "page-import",     method: "outerHTML" },
    { file: "settings",     container: "page-settings",   method: "outerHTML" },
    { file: "help",         container: "page-help",       method: "outerHTML" }
  ];

  await Promise.all(partials.map(async ({ file, container, method }) => {
    try {
      const res = await fetch(`./html/${file}.html`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const el = document.getElementById(container);
      if (!el) { console.warn(`[partials] container #${container} not found`); return; }
      if (method === "outerHTML") {
        el.outerHTML = html;
      } else {
        el.innerHTML = html;
      }
    } catch (err) {
      console.error(`[partials] failed to load ${file}.html:`, err);
    }
  }));
}
