/* Shared behaviour for every page:
   1. Bode plot (measured data, or a pole/zero model) with hover/touch readout
   2. Accessible image lightbox for .gallery groups
   3. Optional figures that hide themselves if the image is missing */

(function () {
  "use strict";

  /* ---------------- formatting ---------------- */
  function fmtFreq(f) {
    const units = [[1e9, "GHz"], [1e6, "MHz"], [1e3, "kHz"], [1, "Hz"]];
    for (const [s, u] of units) {
      if (f >= s) {
        const v = f / s;
        return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + " " + u;
      }
    }
    return f.toFixed(2) + " Hz";
  }
  const minus = (s) => String(s).replace("-", "−");

  /* ---------------- Bode plot ---------------- */
  function initBode(el) {
    const A0 = Math.pow(10, parseFloat(el.dataset.a0db) / 20);
    const p1 = parseFloat(el.dataset.p1);
    const p2 = parseFloat(el.dataset.p2);
    const p3 = el.dataset.p3 ? parseFloat(el.dataset.p3) : Infinity; // optional third pole
    const z = el.dataset.z ? parseFloat(el.dataset.z) : Infinity; // RHP zero; Infinity = cancelled

    // Either measured data (a <script class="bode-data"> holding [[f, dB, deg], ...])
    // or the pole/zero model above.
    const dataEl = el.querySelector("script.bode-data");
    let H;
    if (dataEl) {
      const pts = JSON.parse(dataEl.textContent);
      const lf = pts.map((r) => Math.log10(r[0]));
      H = (f) => {
        const x = Math.log10(f);
        if (x <= lf[0]) return { db: pts[0][1], deg: pts[0][2] };
        if (x >= lf[lf.length - 1]) { const r = pts[pts.length - 1]; return { db: r[1], deg: r[2] }; }
        let i = 1;
        while (lf[i] < x) i++;
        const t = (x - lf[i - 1]) / (lf[i] - lf[i - 1]);
        return { db: pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]),
                 deg: pts[i - 1][2] + t * (pts[i][2] - pts[i - 1][2]) };
      };
    } else {
      H = (f) => {
        const w1 = f / p1, w2 = f / p2, w3 = f / p3, wz = f / z;
        const mag = A0 * Math.sqrt(1 + wz * wz) /
          (Math.sqrt(1 + w1 * w1) * Math.sqrt(1 + w2 * w2) * Math.sqrt(1 + w3 * w3));
        const ph = -Math.atan(wz) - Math.atan(w1) - Math.atan(w2) - Math.atan(w3); // RHP zero adds lag
        return { db: 20 * Math.log10(mag), deg: ph * 180 / Math.PI };
      };
    }

    // unity-gain frequency by bisection in log space
    const fmin = parseFloat(el.dataset.fmin || 10), fmax = 1e9;
    let lo = fmin, hi = fmax;
    for (let i = 0; i < 80; i++) {
      const mid = Math.sqrt(lo * hi);
      if (H(mid).db > 0) lo = mid; else hi = mid;
    }
    const fu = Math.sqrt(lo * hi);
    const pm = 180 + H(fu).deg;

    // geometry
    const W = el.clientWidth && el.clientWidth < 560 ? 480 : 760, L = 54, R = 16;
    const mag = { top: 14, bot: 214, min: -60, max: 100, step: 20 };
    const ph = { top: 252, bot: 412, min: parseFloat(el.dataset.phmin || -180), max: 0, step: 45 };
    const X = (f) => L + (Math.log10(f) - Math.log10(fmin)) / (Math.log10(fmax) - Math.log10(fmin)) * (W - L - R);
    const Finv = (x) => Math.pow(10, Math.log10(fmin) + (x - L) / (W - L - R) * (Math.log10(fmax) - Math.log10(fmin)));
    const Y = (p, v) => p.bot - (v - p.min) / (p.max - p.min) * (p.bot - p.top);

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} 454`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label",
      `Bode plot. DC gain ${el.dataset.a0db} dB, unity-gain frequency ${fmtFreq(fu)}, phase margin ${pm.toFixed(1)} degrees.`);
    const add = (tag, attrs, parent = svg) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      parent.appendChild(n);
      return n;
    };
    const text = (x, y, s, cls, anchor = "end") => {
      const t = add("text", { x, y, class: cls, "text-anchor": anchor });
      t.textContent = s;
      return t;
    };

    // grids
    for (let d = Math.round(Math.log10(fmin)); d <= 9; d++) {
      const f = Math.pow(10, d);
      const x = X(f);
      for (const p of [mag, ph]) add("line", { x1: x, x2: x, y1: p.top, y2: p.bot, class: "gridline" });
      const lab = d < 3 ? f + "" : d < 6 ? Math.pow(10, d - 3) + "k" : d < 9 ? Math.pow(10, d - 6) + "M" : "1G";
      if (W > 600 || d % 2 === 1) text(x, 432, lab, "tick", "middle");
    }
    for (const p of [mag, ph]) {
      for (let v = p.min; v <= p.max; v += p.step) {
        add("line", { x1: L, x2: W - R, y1: Y(p, v), y2: Y(p, v), class: "gridline" });
        text(L - 8, Y(p, v) + 4, minus(v), "tick");
      }
      add("rect", { x: L, y: p.top, width: W - L - R, height: p.bot - p.top, class: "axis" });
    }
    const yt1 = text(14, (mag.top + mag.bot) / 2, "Gain (dB)", "axis-title", "middle");
    yt1.setAttribute("transform", `rotate(-90 14 ${(mag.top + mag.bot) / 2})`);
    const yt2 = text(14, (ph.top + ph.bot) / 2, "Phase (°)", "axis-title", "middle");
    yt2.setAttribute("transform", `rotate(-90 14 ${(ph.top + ph.bot) / 2})`);
    text((L + W - R) / 2, 446, "Frequency (Hz)", "axis-title", "middle").setAttribute("y", 450);

    // reference lines
    add("line", { x1: L, x2: W - R, y1: Y(mag, 0), y2: Y(mag, 0), class: "ref" });
    add("line", { x1: X(fu), x2: X(fu), y1: mag.top, y2: ph.bot, class: "ref" });

    // traces
    const N = 400;
    let dM = "", dP = "";
    for (let i = 0; i <= N; i++) {
      const f = Math.pow(10, Math.log10(fmin) + i / N * (Math.log10(fmax) - Math.log10(fmin)));
      const h = H(f);
      const ym = Math.max(mag.top, Math.min(mag.bot, Y(mag, h.db)));
      const yp = Math.max(ph.top, Math.min(ph.bot, Y(ph, h.deg)));
      dM += (i ? "L" : "M") + X(f).toFixed(1) + " " + ym.toFixed(1);
      dP += (i ? "L" : "M") + X(f).toFixed(1) + " " + yp.toFixed(1);
    }
    const tm = add("path", { d: dM, class: "trace-mag" });
    const tp = add("path", { d: dP, class: "trace-phase" });

    // annotations: unity-gain point and phase margin
    add("circle", { cx: X(fu), cy: Y(mag, 0), r: 4, class: "marker" });
    add("circle", { cx: X(fu), cy: Y(ph, H(fu).deg), r: 4, class: "marker" });
    text(X(fu) - 8, Y(mag, 0) - 10, "fᵤ = " + fmtFreq(fu), "note");
    text(X(fu) - 8, Y(ph, H(fu).deg) + 18, "PM = " + pm.toFixed(1) + "°", "note");
    text(X(fmin) + 10, Y(mag, H(fmin).db) - 10, "A₀ = " + el.dataset.a0db + " dB", "note", "start");

    // cursor
    const cur = add("line", { y1: mag.top, y2: ph.bot, class: "cursor" });
    const dm = add("circle", { r: 4, class: "dot-mag" });
    const dp = add("circle", { r: 4, class: "dot-phase" });

    const fig = el.querySelector(".plot");
    fig.appendChild(svg);

    // one-time draw-in
    for (const p of [tm, tp]) p.style.setProperty("--len", Math.ceil(p.getTotalLength()));
    el.classList.add("draw");

    // readout
    const ro = el.querySelector(".readout");
    const setReadout = (f, h, live) => {
      if (!ro) return;
      ro.innerHTML =
        `<span>${live ? "f" : "Unity gain"} <b>${fmtFreq(f)}</b></span>` +
        `<span class="k-mag">Gain <b>${minus(h.db.toFixed(1))} dB</b></span>` +
        `<span class="k-phase">Phase <b>${minus(h.deg.toFixed(1))}°</b></span>` +
        (live ? "" : `<span>Phase margin <b>${pm.toFixed(1)}°</b></span>`);
    };
    setReadout(fu, H(fu), false);

    const move = (clientX) => {
      const r = svg.getBoundingClientRect();
      const x = (clientX - r.left) / r.width * W;
      if (x < L || x > W - R) return;
      const f = Finv(x), h = H(f);
      cur.setAttribute("x1", x); cur.setAttribute("x2", x);
      dm.setAttribute("cx", x); dm.setAttribute("cy", Math.max(mag.top, Math.min(mag.bot, Y(mag, h.db))));
      dp.setAttribute("cx", x); dp.setAttribute("cy", Math.max(ph.top, Math.min(ph.bot, Y(ph, h.deg))));
      el.classList.add("active");
      setReadout(f, h, true);
    };
    const leave = () => { el.classList.remove("active"); setReadout(fu, H(fu), false); };
    svg.addEventListener("pointermove", (e) => move(e.clientX));
    svg.addEventListener("pointerdown", (e) => move(e.clientX));
    svg.addEventListener("pointerleave", leave);
  }

  document.querySelectorAll(".bode").forEach(initBode);

  /* ---------------- Optional figures ---------------- */
  document.querySelectorAll("figure.optional img").forEach((img) => {
    const hide = () => { img.closest("figure").hidden = true; };
    if (img.complete && img.naturalWidth === 0) hide();
    img.addEventListener("error", hide);
  });

  /* ---------------- Lightbox ---------------- */
  const buttons = Array.from(document.querySelectorAll(".gallery button"));
  if (buttons.length) {
    const lb = document.createElement("div");
    lb.className = "lightbox";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.setAttribute("aria-label", "Image viewer");
    lb.innerHTML =
      '<img alt="">' +
      '<button class="lb-close" type="button">Close</button>' +
      '<button class="lb-prev" type="button" aria-label="Previous image">&#8249;</button>' +
      '<button class="lb-next" type="button" aria-label="Next image">&#8250;</button>' +
      '<div class="lb-count" aria-live="polite"></div>';
    document.body.appendChild(lb);
    const big = lb.querySelector("img");
    const count = lb.querySelector(".lb-count");
    let i = 0, opener = null;

    const show = (n) => {
      i = (n + buttons.length) % buttons.length;
      const img = buttons[i].querySelector("img");
      big.src = img.src;
      big.alt = img.alt;
      count.textContent = `${img.alt} (${i + 1} of ${buttons.length})`;
    };
    const open = (n) => {
      opener = document.activeElement;
      show(n);
      lb.classList.add("open");
      document.body.style.overflow = "hidden";
      lb.querySelector(".lb-close").focus();
    };
    const close = () => {
      lb.classList.remove("open");
      document.body.style.overflow = "";
      if (opener) opener.focus();
    };

    buttons.forEach((b, n) => b.addEventListener("click", () => open(n)));
    lb.querySelector(".lb-close").addEventListener("click", close);
    lb.querySelector(".lb-prev").addEventListener("click", () => show(i - 1));
    lb.querySelector(".lb-next").addEventListener("click", () => show(i + 1));
    lb.addEventListener("click", (e) => { if (e.target === lb) close(); });
    document.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") show(i + 1);
      else if (e.key === "ArrowLeft") show(i - 1);
    });
    let x0 = 0;
    lb.addEventListener("touchstart", (e) => { x0 = e.changedTouches[0].screenX; }, { passive: true });
    lb.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].screenX - x0;
      if (dx < -50) show(i + 1); else if (dx > 50) show(i - 1);
    });
  }
})();
