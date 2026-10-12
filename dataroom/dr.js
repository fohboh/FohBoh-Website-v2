// Shared helpers for the data room pages. The pages hold no secrets; the server decides everything.
(function () {
  const LOGO = '<svg width="24" height="24" viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="4" width="48" height="44" fill="#0B1F3B"></rect><rect x="46" y="52" width="48" height="44" fill="#6D28D9"></rect><rect x="27" y="29" width="46" height="42" fill="#00A7A7" stroke="#FFFFFF" stroke-width="7"></rect></svg>';
  async function api(op, data) {
    const opts = data === undefined ? { method: "GET", credentials: "same-origin" }
      : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
    const r = await fetch("/api/dataroom/" + op, opts);
    let j = {};
    try { j = await r.json(); } catch (e) { /* empty */ }
    if (!r.ok) { const err = new Error((j.error && j.error.message) || "Something went wrong."); err.status = r.status; err.code = j.error && j.error.code; throw err; }
    return j;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function show(el, text, kind) { el.textContent = text || ""; el.className = "msg" + (text ? " " + (kind || "err") : ""); }
  function busy(btn, on) { btn.disabled = on; }
  window.DR = { api, esc, show, busy, LOGO };
})();
