// Apple Maps style bottom sheet with three detents (peek, half, full). On wide
// screens the same element is a floating sidebar card and none of this applies.
//
// Touch events rather than pointer events: when the sheet is full its body scrolls
// natively, and we need preventDefault() on touchmove to take the gesture back for
// a drag-down once the content is scrolled to the top.

const WIDE = matchMedia("(min-width: 760px)");

// env(safe-area-inset-bottom) can't be read from JS directly; measure a probe.
let probe;
function safeBottom() {
  if (!probe) {
    probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;height:env(safe-area-inset-bottom,0px)";
    document.body.append(probe);
  }
  return probe.offsetHeight;
}

export class Sheet {
  constructor(el, { onChange } = {}) {
    this.el = el;
    this.head = el.querySelector(".sheet-head");
    this.body = el.querySelector(".sheet-body");
    this.onChange = onChange ?? (() => {});
    this.detent = "peek";
    this.y = 0;
    this.drag = null;
    this.bind();
    WIDE.addEventListener("change", () => this.set(this.detent, false));
    addEventListener("resize", () => this.set(this.detent, false));
    new ResizeObserver(() => this.detent === "peek" && this.set("peek", false)).observe(this.head);
  }

  get wide() {
    return WIDE.matches;
  }

  get sheetH() {
    return this.el.offsetHeight;
  }

  // Visible height of the sheet at each detent.
  heightFor(detent) {
    if (this.wide) return 0;
    const peek = Math.min(this.head.offsetHeight + 20 + Math.max(safeBottom(), 10), this.sheetH);
    if (detent === "peek") return peek;
    if (detent === "half") return Math.max(peek, Math.round(innerHeight * 0.46));
    return this.sheetH;
  }

  visibleHeight() {
    return this.wide ? 0 : this.sheetH - this.y;
  }

  set(detent, animate = true) {
    this.detent = detent;
    this.el.classList.toggle("is-full", detent === "full");
    this.el.dataset.detent = detent;
    if (this.wide) {
      this.onChange(this);
      return;
    }
    this.el.classList.toggle("is-animating", animate);
    this.setY(this.sheetH - this.heightFor(detent));
    if (detent !== "full") this.body.scrollTop = 0;
    this.onChange(this);
  }

  setY(y) {
    this.y = y;
    this.el.style.setProperty("--sheet-y", `${y}px`);
  }

  bind() {
    const el = this.el;
    el.addEventListener("transitionend", () => el.classList.remove("is-animating"));

    el.addEventListener(
      "touchstart",
      (e) => {
        if (this.wide || e.touches.length > 1) return;
        const t = e.touches[0];
        this.drag = {
          x0: t.clientX, y0: t.clientY, base: this.y, decided: false, active: false,
          inBody: this.body.contains(e.target), inChips: !!e.target.closest?.(".chips"),
          samples: [[t.clientY, e.timeStamp]],
        };
      },
      { passive: true },
    );

    el.addEventListener(
      "touchmove",
      (e) => {
        const d = this.drag;
        if (!d) return;
        const t = e.touches[0];
        const dy = t.clientY - d.y0;
        const dx = t.clientX - d.x0;
        if (!d.decided) {
          // Decide on the very first move: iOS ignores preventDefault once a native
          // scroll has begun, so we can't wait for a distance threshold.
          const scrolling = d.inBody && this.detent === "full" && (this.body.scrollTop > 0 || dy < 0);
          const horizontal = Math.abs(dx) > Math.abs(dy);
          if (scrolling || (horizontal && d.inChips)) {
            this.drag = null;
            return;
          }
          e.preventDefault();
          if (Math.hypot(dx, dy) < 6) return;
          d.decided = true;
          if (horizontal) {
            this.drag = null;
            return;
          }
          d.active = true;
          d.y0 = t.clientY;
          el.classList.remove("is-animating");
          document.activeElement?.blur?.();
        }
        e.preventDefault();
        const min = 0;
        const max = this.sheetH - this.heightFor("peek");
        let y = d.base + (t.clientY - d.y0);
        // Rubber-band past the end detents.
        if (y < min) y = min - Math.sqrt(min - y) * 3;
        if (y > max) y = max + Math.sqrt(y - max) * 3;
        this.setY(y);
        d.samples.push([t.clientY, e.timeStamp]);
        if (d.samples.length > 5) d.samples.shift();
      },
      { passive: false },
    );

    const end = () => {
      const d = this.drag;
      this.drag = null;
      if (!d?.active) return;
      const [a, b] = [d.samples[0], d.samples[d.samples.length - 1]];
      const v = (b[0] - a[0]) / Math.max(1, b[1] - a[1]); // px/ms, + = downward
      const order = ["full", "half", "peek"];
      const ys = order.map((k) => this.sheetH - this.heightFor(k));
      let target;
      if (Math.abs(v) > 0.45) {
        // A flick goes to the next detent in the flick direction (ys ascend full→peek).
        const i = v > 0 ? ys.findIndex((y) => y > this.y + 1) : ys.findLastIndex((y) => y < this.y - 1);
        target = order[i === -1 ? (v > 0 ? 2 : 0) : i];
      } else {
        const proj = this.y + v * 120;
        target = order[ys.reduce((bi, y, i) => (Math.abs(y - proj) < Math.abs(ys[bi] - proj) ? i : bi), 0)];
      }
      this.set(target);
    };
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);

    // Grabber tap cycles detents, like the system sheet.
    el.querySelector(".sheet-grabber").addEventListener("click", () => {
      this.set(this.detent === "peek" ? "half" : this.detent === "half" ? "full" : "peek");
    });
  }
}
