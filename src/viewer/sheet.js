// On a phone (≤760px) both panels are sheets at the bottom of the screen, as on Studio G's site. The project's sheet
// shows its name, numbers and search (peek); slide it up for the colours, filters and AI. A building's sheet opens half
// way, so you still see it in the city; slide it up to read it all, down to close it. Wider screens keep the side
// panels: none of this runs there.
import { reducedMotion } from "./util.js";

export const TOP = 64; // the top row (the way back, Reset view, the theme) and its margins

export function createSheets(app) {
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const left = document.querySelector(".panel.left");
  const right = document.getElementById("detail");
  const tallest = () => innerHeight - TOP - 12;
  // The project's sheet at peek: down to the end of the search field.
  const peek = () => {
    const s = left.querySelector(".search");
    return Math.min(tallest(), s.offsetTop + s.offsetHeight + 16);
  };
  const half = () => Math.round(innerHeight * 0.5);
  const sheets = new Map([
    [left, { low: "peek", lowH: peek, close: null }],
    [right, { low: "half", lowH: half, close: () => app.panel.select(null) }],
  ]);

  const set = (el, state, animate = true, h) => {
    const s = sheets.get(el);
    const to = h ?? (state === "full" ? tallest() : state === "closed" ? 0 : s.lowH());
    el.classList.toggle("is-dragging", !animate || reducedMotion());
    el.style.height = `${to}px`;
    if (h === undefined) {
      el.dataset.snap = state;
      if (state !== "full") el.scrollTop = 0;
      grabOf(el).setAttribute("aria-label", state === "full" ? "Show less" : "Show all");
    }
  };
  const grabOf = (el) => el.querySelector(":scope > .grab");
  const clear = (el) => { el.style.removeProperty("height"); delete el.dataset.snap; el.classList.remove("is-dragging"); };

  for (const [el, s] of sheets) {
    const grab = document.createElement("button");
    grab.type = "button";
    grab.className = "grab";
    grab.setAttribute("aria-label", "Show all");
    grab.addEventListener("click", () => set(el, el.dataset.snap === "full" ? s.low : "full"));
    el.prepend(grab);
    // Searching, or a field: it all opens.
    el.addEventListener("focusin", (e) => { if (phone() && el.dataset.snap !== "full" && e.target.matches("input")) set(el, "full"); });
    // Dragging: from the handle always; from the sheet itself when it's low, or when it's open all the way and
    // scrolled to its top (then only a pull down moves it; a push up scrolls).
    let d = null;
    el.addEventListener("touchstart", (e) => {
      if (!phone() || e.touches.length > 1) return;
      const onGrab = !!e.target.closest(".grab");
      if (el.dataset.snap === "full" && !onGrab && el.scrollTop > 0) return (d = null);
      const y = e.touches[0].clientY;
      d = { y0: y, base: el.offsetHeight, t0: performance.now(), last: y, tl: performance.now(), on: false, onGrab };
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      if (!d) return;
      const y = e.touches[0].clientY;
      const dy = y - d.y0;
      if (!d.on) {
        if (Math.abs(dy) < 6) return;
        if (el.dataset.snap === "full" && !d.onGrab && dy < 0) return (d = null);
        d.on = true;
      }
      e.preventDefault();
      d.last = y;
      d.tl = performance.now();
      const h = d.base - dy;
      const max = tallest();
      set(el, el.dataset.snap, false, Math.max(s.close ? 0 : s.lowH() * 0.85, h > max ? max + (h - max) / 4 : h));
    }, { passive: false });
    el.addEventListener("touchend", () => {
      if (!d) return;
      const was = d;
      d = null;
      if (!was.on) return;
      const h = el.offsetHeight;
      const low = s.lowH();
      const v = (was.last - was.y0) / Math.max(1, was.tl - was.t0); // px per ms, + is down
      let to;
      if (v < -0.5) to = "full";
      else if (v > 0.5) to = el.dataset.snap === "full" && h > low * 0.6 ? s.low : "closed";
      else to = h > (low + tallest()) / 2 ? "full" : h > low * 0.6 ? s.low : "closed";
      if (to === "closed" && !s.close) to = s.low; // the project's sheet stays
      if (to === "closed") { set(el, "closed"); setTimeout(s.close, 200); }
      else set(el, to);
    });
  }

  // A building's sheet opened or closed (panel.js): it opens half way; the project's sheet steps back meanwhile.
  const detail = (open) => {
    document.body.classList.toggle("detail-open", open);
    if (!phone()) return;
    if (open) {
      set(right, "closed", false);
      void right.offsetHeight;
      requestAnimationFrame(() => set(right, "half"));
    }
  };
  // Where the camera can draw on a phone: between the top row and the sheet's low height.
  const reserved = () => (!phone() ? 0 : (document.body.classList.contains("detail-open") ? half() : peek()) + 12);

  const layout = () => {
    if (!phone()) { for (const el of sheets.keys()) clear(el); return; }
    for (const [el, s] of sheets) set(el, el.dataset.snap === "full" ? "full" : s.low, false);
  };
  addEventListener("resize", layout);
  layout();
  document.fonts?.ready.then(() => { layout(); app.view.resize(); });

  return { detail, reserved };
}
