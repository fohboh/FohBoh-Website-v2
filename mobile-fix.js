/* ============================================================
   FohBoh.ai — Mobile Responsive Fix v1 (behavior)
   Adds a hamburger toggle to the primary nav on phones/tablets.
   Polls briefly because the nav is rendered client-side by the
   dc-runtime, so it may not exist yet at DOMContentLoaded.
   ============================================================ */
(function () {
  function enhance() {
    var navs = document.querySelectorAll('nav[style*="padding: 14px 64px"]');
    if (!navs.length) return false;
    navs.forEach(function (nav) {
      if (nav.querySelector(".fb-hamburger")) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fb-hamburger";
      btn.setAttribute("aria-label", "Menu");
      btn.innerHTML = "&#9776;";
      btn.addEventListener("click", function () {
        nav.classList.toggle("fb-nav-open");
      });
      nav.appendChild(btn);
    });
    return true;
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (enhance() || tries > 40) clearInterval(timer);
  }, 150);

  document.addEventListener("DOMContentLoaded", enhance);
})();
