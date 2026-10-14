/* Shared behaviour for every page:
   1. Bode plot (measured data, a pole/zero model, or a live model) with hover/touch readout
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

  /* ---------------- Bode plot ----------------
     makeBode(el, H, opts) draws into el's .plot and .readout and returns
     { update(H) } so a live page can redraw it. H(f) -> { db, deg } with
     continuous (unwrapped) phase. */
  function makeBode(el, H, opts = {}) {
    const fmin = parseFloat(el.dataset.fmin || 10), fmax = 1e9;
    const W = el.clientWidth && el.clientWidth < 560 ? 480 : 760, L = 54, R = 16;
    const mag = { top: 14, bot: 214, min: -60, max: 100, step: 20 };
    const ph = { top: 252, bot: 412, min: parseFloat(el.dataset.phmin || -180), max: 0, step: 45 };
    const X = (f) => L + (Math.log10(f) - Math.log10(fmin)) / (Math.log10(fmax) - Math.log10(fmin)) * (W - L - R);
    const Finv = (x) => Math.pow(10, Math.log10(fmin) + (x - L) / (W - L - R) * (Math.log10(fmax) - Math.log10(fmin)));
    const Y = (p, v) => p.bot - (v - p.min) / (p.max - p.min) * (p.bot - p.top);
    const clampY = (p, v) => Math.max(p.top, Math.min(p.bot, Y(p, v)));

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} 454`);
    svg.setAttribute("role", "img");
    const add = (tag, attrs, parent = svg) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      parent.appendChild(n);
      return n;
    };
    const text = (x, y, s, cls, anchor = "end", parent = svg) => {
      const t = add("text", { x, y, class: cls, "text-anchor": anchor }, parent);
      t.textContent = s;
      return t;
    };

    // static grid
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
    text((L + W - R) / 2, 450, "Frequency (Hz)", "axis-title", "middle");
    add("line", { x1: L, x2: W - R, y1: Y(mag, 0), y2: Y(mag, 0), class: "ref" });

    const g = add("g", {});                         // everything that depends on H
    const cur = add("line", { y1: mag.top, y2: ph.bot, class: "cursor" });
    const dm = add("circle", { r: 4, class: "dot-mag" });
    const dp = add("circle", { r: 4, class: "dot-phase" });
    el.querySelector(".plot").appendChild(svg);
    const ro = el.querySelector(".readout");

    let st = {};
    function analyze() {
      const a0 = H(fmin).db;
      let fu = null, pm = null, f180 = null, gm = null;
      if (a0 > 0 && H(fmax).db < 0) {
        let lo = fmin, hi = fmax;
        for (let i = 0; i < 80; i++) { const m = Math.sqrt(lo * hi); if (H(m).db > 0) lo = m; else hi = m; }
        fu = Math.sqrt(lo * hi); pm = 180 + H(fu).deg;
      }
      // first -180 degree crossing, found on a sweep then refined
      let prev = fmin;
      for (let i = 1; i <= 300; i++) {
        const f = Math.pow(10, Math.log10(fmin) + i / 300 * (Math.log10(fmax) - Math.log10(fmin)));
        if (H(f).deg <= -180) {
          let lo = prev, hi = f;
          for (let k = 0; k < 60; k++) { const m = Math.sqrt(lo * hi); if (H(m).deg > -180) lo = m; else hi = m; }
          f180 = Math.sqrt(lo * hi); gm = -H(f180).db; break;
        }
        prev = f;
      }
      st = { a0, fu, pm, f180, gm };
    }

    const fmtDeg = (d) => minus(d.toFixed(1)) + "°";
    function readoutIdle() {
      if (!ro) return;
      const { fu, pm, gm } = st;
      ro.innerHTML =
        (fu ? `<span>Unity gain <b>${fmtFreq(fu)}</b></span>` : "") +
        (fu ? `<span class="k-phase">Phase <b>${fmtDeg(H(fu).deg)}</b></span>` : "") +
        (pm !== null ? `<span>Phase margin <b${pm < 0 ? ' class="warn"' : ""}>${fmtDeg(pm)}</b></span>` : "") +
        (opts.gm && gm !== null ? `<span>Gain margin <b${gm < 0 ? ' class="warn"' : ""}>${minus(gm.toFixed(1))} dB</b></span>` : "") +
        (pm !== null && pm < 0 ? `<span><b class="warn">Unstable in unity-gain feedback</b></span>` : "");
    }

    function render(first) {
      analyze();
      while (g.firstChild) g.removeChild(g.firstChild);
      const { a0, fu, pm } = st;
      if (fu) add("line", { x1: X(fu), x2: X(fu), y1: mag.top, y2: ph.bot, class: "ref" }, g);
      const N = 400;
      let dM = "", dP = "";
      for (let i = 0; i <= N; i++) {
        const f = Math.pow(10, Math.log10(fmin) + i / N * (Math.log10(fmax) - Math.log10(fmin)));
        const h = H(f);
        dM += (i ? "L" : "M") + X(f).toFixed(1) + " " + clampY(mag, h.db).toFixed(1);
        dP += (i ? "L" : "M") + X(f).toFixed(1) + " " + clampY(ph, h.deg).toFixed(1);
      }
      const tm = add("path", { d: dM, class: "trace-mag" }, g);
      const tp = add("path", { d: dP, class: "trace-phase" }, g);
      if (fu) {
        add("circle", { cx: X(fu), cy: Y(mag, 0), r: 4, class: "marker" }, g);
        add("circle", { cx: X(fu), cy: clampY(ph, H(fu).deg), r: 4, class: "marker" }, g);
        text(X(fu) - 8, Y(mag, 0) - 10, "fᵤ = " + fmtFreq(fu), "note", "end", g);
        text(X(fu) - 8, clampY(ph, H(fu).deg) + 18, "PM = " + fmtDeg(pm), pm < 0 ? "note warn" : "note", "end", g);
      }
      text(X(fmin) + 10, clampY(mag, a0) - 10, "A₀ = " + a0.toFixed(1) + " dB", "note", "start", g);
      svg.setAttribute("aria-label", `Bode plot. DC gain ${a0.toFixed(1)} dB` +
        (fu ? `, unity-gain frequency ${fmtFreq(fu)}, phase margin ${pm.toFixed(1)} degrees.` : "."));
      if (first) {
        for (const p of [tm, tp]) p.style.setProperty("--len", Math.ceil(p.getTotalLength()));
        el.classList.add("draw");
      } else {
        el.classList.remove("draw");
      }
      readoutIdle();
    }

    const move = (clientX) => {
      const r = svg.getBoundingClientRect();
      const x = (clientX - r.left) / r.width * W;
      if (x < L || x > W - R) return;
      const f = Finv(x), h = H(f);
      cur.setAttribute("x1", x); cur.setAttribute("x2", x);
      dm.setAttribute("cx", x); dm.setAttribute("cy", clampY(mag, h.db));
      dp.setAttribute("cx", x); dp.setAttribute("cy", clampY(ph, h.deg));
      el.classList.add("active");
      if (ro) ro.innerHTML =
        `<span>f <b>${fmtFreq(f)}</b></span>` +
        `<span class="k-mag">Gain <b>${minus(h.db.toFixed(1))} dB</b></span>` +
        `<span class="k-phase">Phase <b>${fmtDeg(h.deg)}</b></span>`;
    };
    const leave = () => { el.classList.remove("active"); readoutIdle(); };
    svg.addEventListener("pointermove", (e) => move(e.clientX));
    svg.addEventListener("pointerdown", (e) => move(e.clientX));
    svg.addEventListener("pointerleave", leave);

    render(true);
    return { update(Hn) { H = Hn; render(false); }, stats: () => st };
  }

  // Interpolates a table of [f, dB, deg] rows (log frequency).
  function tableH(pts) {
    const lf = pts.map((r) => Math.log10(r[0]));
    return (f) => {
      const x = Math.log10(f);
      if (x <= lf[0]) return { db: pts[0][1], deg: pts[0][2] };
      if (x >= lf[lf.length - 1]) { const r = pts[pts.length - 1]; return { db: r[1], deg: r[2] }; }
      let lo = 0, hi = lf.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lf[m] < x) lo = m; else hi = m; }
      const t = (x - lf[lo]) / (lf[hi] - lf[lo]);
      return { db: pts[lo][1] + t * (pts[hi][1] - pts[lo][1]), deg: pts[lo][2] + t * (pts[hi][2] - pts[lo][2]) };
    };
  }
  /* LTspice "Export data as text" (AC, dB/phase format). Handles plain and .step
     exports, UTF-8 or UTF-16 files. Returns [{ params, rows: [[f, dB, deg], ...] }]
     with phase unwrapped and referenced to 0 or 180 degrees at the first point. */
  const SPICE = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, meg: 1e6, g: 1e9, t: 1e12 };
  function spiceNum(s) {
    const m = /^([-+]?[\d.]+(?:e[-+]?\d+)?)(meg|[fpnuµmkgt])?/i.exec(String(s).trim());
    return m ? parseFloat(m[1]) * (m[2] ? SPICE[m[2].toLowerCase()] : 1) : NaN;
  }
  function parseLT(text) {
    const runs = []; let cur = null;
    for (const line of text.split(/\r?\n/)) {
      if (/^Step Information:/i.test(line)) {
        const params = {};
        line.replace(/\(Run.*$/, "").replace(/(\w+)=(\S+)/g, (_, k, v) => { params[k] = spiceNum(v); });
        cur = { params, rows: [] }; runs.push(cur); continue;
      }
      const m = /^\s*([\d.eE+-]+)\s+\(\s*([\d.eE+-]+)\s*dB\s*,\s*([\d.eE+-]+)/.exec(line);
      if (!m) continue;
      if (!cur) { cur = { params: {}, rows: [] }; runs.push(cur); }
      cur.rows.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
    }
    for (const r of runs) {
      let prev = null, off = 0;
      for (const row of r.rows) {
        let ph = row[2] + off;
        if (prev !== null) {
          while (ph - prev > 180) { off -= 360; ph -= 360; }
          while (ph - prev < -180) { off += 360; ph += 360; }
        }
        row[2] = ph; prev = ph;
      }
      if (r.rows.length) {
        const ref = Math.round(r.rows[0][2] / 180) * 180;
        if (ref) for (const row of r.rows) row[2] -= ref;
      }
    }
    return runs.filter((r) => r.rows.length > 1);
  }
  async function loadLT(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(url + ": " + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf.length > 3 && buf[1] === 0 && buf[3] === 0);
    return parseLT(new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(buf));
  }

  window.Bode = { make: makeBode, table: tableH, parseLT, loadLT };

  // Static plots: measured data in a <script class="bode-data">, or a pole/zero model.
  document.querySelectorAll(".bode:not([data-live])").forEach((el) => {
    const dataEl = el.querySelector("script.bode-data");
    let H;
    if (dataEl) H = tableH(JSON.parse(dataEl.textContent));
    else {
      const A0 = Math.pow(10, parseFloat(el.dataset.a0db) / 20);
      const p1 = parseFloat(el.dataset.p1), p2 = parseFloat(el.dataset.p2);
      const p3 = el.dataset.p3 ? parseFloat(el.dataset.p3) : Infinity;
      const z = el.dataset.z ? parseFloat(el.dataset.z) : Infinity;      // RHP zero; Infinity = cancelled
      H = (f) => {
        const w1 = f / p1, w2 = f / p2, w3 = f / p3, wz = f / z;
        const m = A0 * Math.sqrt(1 + wz * wz) / (Math.sqrt(1 + w1 * w1) * Math.sqrt(1 + w2 * w2) * Math.sqrt(1 + w3 * w3));
        const d = -Math.atan(wz) - Math.atan(w1) - Math.atan(w2) - Math.atan(w3);
        return { db: 20 * Math.log10(m), deg: d * 180 / Math.PI };
      };
    }
    const plot = makeBode(el, H);
    if (el.dataset.src) {                       // the LTspice export in data/ replaces the inline copy
      loadLT(el.dataset.src)
        .then((runs) => { if (runs.length) plot.update(tableH(runs[0].rows)); })
        .catch(() => {});                       // keep the inline curve (e.g. page opened from disk)
    }
  });

  /* ---------------- Optional figures ---------------- */
  document.querySelectorAll("figure.optional img").forEach((img) => {
    const hide = () => { img.closest("figure").hidden = true; };
    if (img.complete && img.naturalWidth === 0) hide();
    img.addEventListener("error", hide);
  });

  /* ---------------- Optional report links ----------------
     A link marked .report-link stays hidden until its PDF exists in the repo. */
  document.querySelectorAll("a.report-link[hidden]").forEach((a) => {
    fetch(a.getAttribute("href"), { method: "HEAD" })
      .then((r) => { if (r.ok) a.hidden = false; })
      .catch(() => {});
  });

  /* ---------------- Lightbox ----------------
     Opens any gallery thumbnail or figure image. Figure images that are
     hidden (file not uploaded yet) are skipped when paging. */
  const triggers = Array.from(document.querySelectorAll(".gallery button, figure.figure:not(.bode) img"));
  const imgOf = (t) => (t.tagName === "IMG" ? t : t.querySelector("img"));
  const visible = () => triggers.filter((t) => !t.closest("figure[hidden]"));

  if (triggers.length) {
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
    const prev = lb.querySelector(".lb-prev"), next = lb.querySelector(".lb-next");
    let list = [], i = 0, opener = null;

    const show = (n) => {
      i = (n + list.length) % list.length;
      const img = imgOf(list[i]);
      big.src = img.currentSrc || img.src;
      big.alt = img.alt;
      count.textContent = list.length > 1 ? `${img.alt} (${i + 1} of ${list.length})` : img.alt;
    };
    const open = (t) => {
      list = visible();
      opener = document.activeElement;
      prev.hidden = next.hidden = list.length < 2;
      show(list.indexOf(t));
      lb.classList.add("open");
      document.body.style.overflow = "hidden";
      lb.querySelector(".lb-close").focus();
    };
    const close = () => {
      lb.classList.remove("open");
      document.body.style.overflow = "";
      if (opener) opener.focus();
    };

    triggers.forEach((t) => {
      if (t.tagName === "IMG") {          // figure image: make it behave like a button
        t.classList.add("zoomable");
        t.tabIndex = 0;
        t.setAttribute("role", "button");
        t.setAttribute("aria-label", "Enlarge: " + t.alt);
        t.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(t); }
        });
      }
      t.addEventListener("click", () => open(t));
    });
    lb.querySelector(".lb-close").addEventListener("click", close);
    prev.addEventListener("click", () => show(i - 1));
    next.addEventListener("click", () => show(i + 1));
    lb.addEventListener("click", (e) => { if (e.target === lb) close(); });
    document.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" && list.length > 1) show(i + 1);
      else if (e.key === "ArrowLeft" && list.length > 1) show(i - 1);
    });
    let x0 = 0;
    lb.addEventListener("touchstart", (e) => { x0 = e.changedTouches[0].screenX; }, { passive: true });
    lb.addEventListener("touchend", (e) => {
      if (list.length < 2) return;
      const dx = e.changedTouches[0].screenX - x0;
      if (dx < -50) show(i + 1); else if (dx > 50) show(i - 1);
    });
  }
})();
