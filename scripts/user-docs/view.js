// Runs inside a frozen view of the app (scripts/capture-docs-views.mjs). The docs page
// posts {docsTheme, docsMode, docsRing}: the view takes the docs theme and rings the
// control a step names, scrolling it into sight inside its own scroll box.
(function () {
  "use strict";

  document.querySelectorAll("[data-docs-scroll]").forEach((el) => {
    const [top, left] = el.dataset.docsScroll.split(",").map(Number);
    el.scrollTop = top;
    el.scrollLeft = left;
  });

  const ring = document.createElement("div");
  ring.setAttribute("aria-hidden", "true");
  ring.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid var(--accent);border-radius:10px;box-shadow:0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);display:none";
  document.body.appendChild(ring);

  function scrollBox(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
  }
  function show(key) {
    const el = key && document.querySelector('[data-docs-ring~="' + key + '"]');
    if (!el) { ring.style.display = "none"; return; }
    let r = el.getBoundingClientRect();
    const box = scrollBox(el);
    if (box && (r.top < 0 || r.bottom > innerHeight)) {
      box.scrollTop += r.top - innerHeight / 3;
      r = el.getBoundingClientRect();
    }
    Object.assign(ring.style, {
      display: "block",
      left: r.left - 6 + "px",
      top: r.top - 6 + "px",
      width: r.width + 12 + "px",
      height: r.height + 12 + "px",
    });
  }

  window.addEventListener("message", (e) => {
    const d = e.data || {};
    if (d.docsTheme) document.documentElement.dataset.theme = d.docsTheme;
    if (d.docsMode) document.documentElement.dataset.mode = d.docsMode;
    if ("docsRing" in d) requestAnimationFrame(() => show(d.docsRing));
  });
})();
