/* NMOS instrument for the home page.
   A CRT screen shows the device cross-section and its circuit symbol, driven by
   two knobs (V_GS, V_DS). The physics is the long-channel square-law model with
   the gradual-channel charge profile, using parameters from my GF180MCU runs:
   V_th = 0.69 V, un*Cox = 167 uA/V^2 (from 5.95 uA/um at V_OV = 0.2 V, L = 0.56 um),
   lambda = 0.035 /V, W/L = 5.04/0.56 um (the folded cascode's input device).

   Cross-section: electrons (green) enter from the source and drift to the drain.
   Channel charge falls along the channel as Q(x) ~ sqrt(1 - (1-(1-a)^2) x/L);
   because current is continuous, electrons speed up where the channel thins and
   race across the pinch-off gap in saturation.
   Symbol: conventional current I_D (amber) flows drain to source. */

(function () {
  "use strict";
  const el = document.querySelector(".instrument[data-nmos]");
  if (!el) return;

  const canvas = el.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const readout = el.querySelector(".nmos-readout");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- device model ----------------
     If data/nmos_iv.txt (an LTspice .dc sweep of Id(M1) over VDS and VGS, GF180 BSIM)
     is present, I_D and g_m come from it and V_th is extracted from it. Otherwise the
     square-law model below is used. Regions: subthreshold if V_GS < V_th, triode if
     V_DS < V_GS - V_th, otherwise saturation. */
  const M = { VTH: 0.69, KP: 166.6e-6, W: 5.04, L: 0.56, LAM: 0.035 };
  const K = (M.KP * M.W) / M.L;
  const state = { vgs: 1.0, vds: 1.5 };
  let IV = null;                                  // { vgs: [...], c: [{ v: [...], i: [...] }], vth }

  function squareLaw(vgs, vds) {
    const vov = vgs - M.VTH;
    if (vov <= 0) {
      const id = 1e-7 * Math.exp(vov / 0.045) * (1 - Math.exp(-vds / 0.026));
      return { id, gm: id / (1.5 * 0.026) };
    }
    if (vds < vov) return { id: K * (vov * vds - (vds * vds) / 2) * (1 + M.LAM * vds), gm: K * vds * (1 + M.LAM * vds) };
    return { id: 0.5 * K * vov * vov * (1 + M.LAM * vds), gm: K * vov * (1 + M.LAM * vds) };
  }

  function curveAt(c, vds) {
    const v = c.v, n = v.length;
    if (vds <= v[0]) return c.i[0];
    if (vds >= v[n - 1]) return c.i[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (v[m] <= vds) lo = m; else hi = m; }
    return c.i[lo] + ((vds - v[lo]) / (v[hi] - v[lo])) * (c.i[hi] - c.i[lo]);
  }
  function idData(vgs, vds) {
    const G = IV.vgs, n = G.length;
    if (vgs <= G[0]) return curveAt(IV.c[0], vds);
    if (vgs >= G[n - 1]) return curveAt(IV.c[n - 1], vds);
    let j = 0;
    while (G[j + 1] < vgs) j++;
    const t = (vgs - G[j]) / (G[j + 1] - G[j]);
    const a = curveAt(IV.c[j], vds), b = curveAt(IV.c[j + 1], vds);
    // below threshold the current is exponential in V_GS, so interpolate it geometrically
    if (a > 0 && b > 0 && Math.max(a, b) < 1e-6) return a * Math.pow(b / a, t);
    return a + (b - a) * t;
  }

  function model(vgs, vds) {
    const vth = IV ? IV.vth : M.VTH;
    const vov = vgs - vth;
    let id, gm;
    if (IV) {
      id = Math.max(idData(vgs, vds), 0);
      gm = Math.max((idData(vgs + 0.005, vds) - idData(vgs - 0.005, vds)) / 0.01, 0);
    } else ({ id, gm } = squareLaw(vgs, vds));
    const region = vov <= 0 ? "subthreshold" : vds < vov ? "triode" : "saturation";
    return { vov, id, gm, region, vth };
  }

  /* LTspice "Export data as text" of a stepped .dc sweep: columns VDS and Id(M1),
     one "Step Information: VGS=..." block per gate voltage. */
  const SPICE = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, meg: 1e6 };
  function spiceNum(s) {
    const m = /^([-+]?[\d.]+(?:e[-+]?\d+)?)(meg|[fpnuµmk])?/i.exec(String(s).trim());
    return m ? parseFloat(m[1]) * (m[2] ? SPICE[m[2].toLowerCase()] : 1) : NaN;
  }
  function parseIV(text) {
    const curves = []; let cur = null;
    for (const line of text.split(/\r?\n/)) {
      const st = /^Step Information:.*?VGS=(\S+)/i.exec(line);
      if (st) { cur = { vgs: spiceNum(st[1]), v: [], i: [] }; curves.push(cur); continue; }
      const m = /^\s*([-+\d.eE]+)\s+([-+\d.eE]+)\s*$/.exec(line);
      if (m && cur) { cur.v.push(parseFloat(m[1])); cur.i.push(parseFloat(m[2])); }
    }
    const good = curves.filter((c) => c.v.length > 2 && isFinite(c.vgs)).sort((x, y) => x.vgs - y.vgs);
    if (good.length < 4) return null;
    const iv = { vgs: good.map((c) => c.vgs), c: good };
    // V_th by maximum-g_m linear extrapolation at V_DS = 50 mV
    const vd = 0.05, ids = good.map((c) => curveAt(c, vd));
    let best = 1, gmax = -1;
    for (let k = 1; k < good.length - 1; k++) {
      const g = (ids[k + 1] - ids[k - 1]) / (iv.vgs[k + 1] - iv.vgs[k - 1]);
      if (g > gmax) { gmax = g; best = k; }
    }
    iv.vth = iv.vgs[best] - ids[best] / gmax - vd / 2;
    return iv;
  }
  async function loadIV(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf.length > 3 && buf[1] === 0 && buf[3] === 0);
    return parseIV(new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(buf));
  }

  const fmtI = (i) => (i < 1e-9 ? (i * 1e12).toFixed(1) + " pA" : i < 1e-6 ? (i * 1e9).toFixed(1) + " nA"
    : i < 1e-3 ? (i * 1e6).toFixed(1) + " µA" : (i * 1e3).toFixed(2) + " mA");
  const fmtG = (g) => (g < 1e-9 ? "≈ 0" : g < 1e-6 ? (g * 1e9).toFixed(1) + " nS" : g < 1e-5 ? (g * 1e6).toFixed(2) + " µS"
    : g < 1e-3 ? (g * 1e6).toFixed(0) + " µS" : (g * 1e3).toFixed(2) + " mS");

  /* ---------------- colours (the CRT is the same in both themes) ---------------- */
  const C = {
    crt: "#07130C", fade: "rgba(7,19,12,0.38)",
    ph: "#9CFFB4", trace: "#4FD47A", label: "#5FA37A",
    grat: "rgba(46,107,69,0.30)", gratAxis: "rgba(46,107,69,0.55)",
    dim: "#2E6B45", amber: "#FFB547",
  };
  const FONT = '"Share Tech Mono", ui-monospace, Menlo, monospace';

  /* ---------------- layout ---------------- */
  let LW = 900, LH = 340, wide = true, crossO = { x: 0, y: 0 }, symO = { x: 560, y: 0 };
  function layout() {
    const cssW = canvas.parentElement.clientWidth;
    wide = cssW >= 620;
    if (wide) { LW = 900; LH = 340; crossO = { x: 0, y: 0 }; symO = { x: 560, y: 0 }; }
    else { LW = 560; LH = 690; crossO = { x: 0, y: 0 }; symO = { x: 110, y: 340 }; }
    const cssH = (cssW * LH) / LW;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const s = (cssW / LW) * dpr;
    ctx.setTransform(s, 0, 0, s, 0, 0);
  }

  /* ---------------- cross-section geometry (local box 560 x 340) ---------------- */
  const Y0 = 130;                 // silicon surface
  const CX0 = 200, CX1 = 360;     // channel under the gate
  const LPX = CX1 - CX0;
  const SRC = { x0: 70, x1: 200, c: 130 }, DRN = { x0: 360, x1: 490, c: 425 };
  const NDEPTH = 48;

  function channel(m) {
    if (m.vov <= 0) return null;
    const a = Math.min(state.vds, m.vov) / m.vov;          // 1 in saturation
    const sat = state.vds >= m.vov;
    const clm = sat ? Math.min((state.vds - m.vov) / 2.5, 1) : 0;
    const leff = LPX * (1 - 0.13 * clm);                      // pinch-off point moves toward the source
    const tmax = 6 + 24 * Math.min(m.vov / 0.9, 1);
    const b = 1 - (1 - a) * (1 - a);
    const q = (x) => Math.sqrt(Math.max(0, 1 - (b * (x - CX0)) / leff));
    return { sat, leff, xp: CX0 + leff, tmax, q, th: (x) => tmax * q(x) };
  }

  /* ---------------- electrons ---------------- */
  const KV = 339700;   // speed scale: about 80 px/s at the default bias
  const KN = 0.8;      // density scale: about 0.25 electrons/px at the default bias
  let parts = [], acc = 0, symPhase = 0;

  function speedAt(x, m, ch, vsrc) {
    if (x < CX0) return vsrc;
    if (x < ch.xp) return Math.min(vsrc / Math.max(ch.q(x), 0.12), 600);
    if (x < CX1) return 520;                                 // across the pinch-off gap
    return Math.max(vsrc, 140);
  }
  function yAt(p, ch) {
    const deep = Y0 + 6 + p.r * 30;
    const lerp = (a, b, t) => a + (b - a) * t;
    if (p.x < CX0) {
      const top = Y0 + 1 + p.r * Math.max(ch.th(CX0) - 2, 0.5);
      return p.x < CX0 - 30 ? deep : lerp(deep, top, (p.x - (CX0 - 30)) / 30);
    }
    if (p.x < ch.xp) return Y0 + 1 + p.r * Math.max(ch.th(p.x) - 2, 0.5);
    if (p.x < CX1) return Y0 + 1 + p.r * 2.5;
    return lerp(Y0 + 1 + p.r * 2.5, deep, Math.min(1, (p.x - CX1) / 30));
  }

  function step(dt) {
    const m = model(state.vgs, state.vds);
    const ch = channel(m);
    if (!ch) { parts.length = 0; acc = 0; return; }
    const vsrc = (KV * m.id) / Math.max(m.vov, 0.02);
    acc += KN * KV * m.id * dt;
    while (acc >= 1) {
      acc -= 1;
      if (parts.length < 420) parts.push({ x: 96 + Math.random() * 30, r: Math.random() });
    }
    for (const p of parts) p.x += speedAt(p.x, m, ch, vsrc) * dt;
    parts = parts.filter((p) => p.x < DRN.c);
    symPhase += (20 + 3e5 * m.id) * dt;
  }
  function settle(seconds) { for (let i = 0; i < seconds * 60; i++) step(1 / 60); }

  /* ---------------- drawing helpers ---------------- */
  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  // Draws text; "_XY" renders XY as a subscript (e.g. "V_GS", "I_D").
  function text(s, x, y, color, align = "left", size = 13) {
    ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = color; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    const parts = s.split(/_([A-Za-z0-9]+)/);   // even index: normal, odd: subscript
    size = Math.round(size * (wide ? 1 : 1.45));             // small screens: keep labels legible
    const fontN = size + "px " + FONT, fontS = Math.round(size * 0.74) + "px " + FONT;
    let w = 0;
    parts.forEach((t, i) => { ctx.font = i % 2 ? fontS : fontN; w += ctx.measureText(t).width; });
    let cx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    parts.forEach((t, i) => {
      ctx.font = i % 2 ? fontS : fontN;
      ctx.fillText(t, cx, i % 2 ? y + size * 0.28 : y);
      cx += ctx.measureText(t).width;
    });
    ctx.restore();
  }
  function glow(color, blur = 5) { ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = blur; }
  function noGlow() { ctx.shadowBlur = 0; }
  function nPath(r) {
    const d = Y0 + NDEPTH, k = 20;
    ctx.beginPath();
    ctx.moveTo(r.x0, Y0); ctx.lineTo(r.x0, d - k);
    ctx.quadraticCurveTo(r.x0, d, r.x0 + k, d); ctx.lineTo(r.x1 - k, d);
    ctx.quadraticCurveTo(r.x1, d, r.x1, d - k); ctx.lineTo(r.x1, Y0);
  }
  function hatch(r) {
    ctx.save(); nPath(r); ctx.closePath(); ctx.clip();
    noGlow(); ctx.strokeStyle = "rgba(79,212,122,0.22)"; ctx.lineWidth = 1;
    for (let x = r.x0 - 60; x < r.x1 + 10; x += 9) line(x, Y0 + NDEPTH + 4, x + 56, Y0 - 4);
    ctx.restore();
  }
  function depletion(r, extra) {
    const d = Y0 + NDEPTH + extra, k = 20 + extra;
    ctx.save(); noGlow(); ctx.strokeStyle = C.dim; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(r.x0 - extra, Y0); ctx.lineTo(r.x0 - extra, d - k);
    ctx.quadraticCurveTo(r.x0 - extra, d, r.x0 - extra + k, d); ctx.lineTo(r.x1 + extra - k, d);
    ctx.quadraticCurveTo(r.x1 + extra, d, r.x1 + extra, d - k); ctx.lineTo(r.x1 + extra, Y0);
    ctx.stroke(); ctx.restore();
  }

  function graticule() {
    noGlow(); ctx.lineWidth = 1;
    ctx.strokeStyle = C.grat;
    for (let x = 40; x < LW; x += 40) line(x + 0.5, 0, x + 0.5, LH);
    for (let y = 40; y < LH; y += 40) line(0, y + 0.5, LW, y + 0.5);
    ctx.strokeStyle = C.gratAxis;
    const cx = Math.round(LW / 2 / 40) * 40, cy = Math.round(LH / 2 / 40) * 40;
    for (let x = 8; x < LW; x += 8) line(x + 0.5, cy - 3, x + 0.5, cy + 4);
    for (let y = 8; y < LH; y += 8) line(cx - 3, y + 0.5, cx + 4, y + 0.5);
  }

  /* ---------------- cross-section ---------------- */
  function drawCross(m, ch) {
    ctx.save(); ctx.translate(crossO.x, crossO.y);
    if (wide) text("CROSS-SECTION", 30, 16, C.label, "left", 12);

    // substrate and surface
    ctx.lineWidth = 1.5; glow(C.trace, 4);
    ctx.beginPath(); ctx.moveTo(30, Y0); ctx.lineTo(30, 300); ctx.lineTo(530, 300); ctx.lineTo(530, Y0); ctx.stroke();
    line(30, Y0, 530, Y0);
    text("p-substrate, body at 0 V", 42, 286, C.label, "left", 12);

    // depletion edges: the drain's widens with V_DS
    depletion(SRC, 5);
    depletion(DRN, 5 + 13 * Math.sqrt(Math.max(state.vds, 0)));
    const dd = 5 + 13 * Math.sqrt(Math.max(state.vds, 0));
    if (wide && state.vds > 0.6) text("depletion", DRN.c, Y0 + NDEPTH + dd + 12, C.label, "center", 11);

    // n+ diffusions
    for (const r of [SRC, DRN]) { hatch(r); glow(C.trace, 4); ctx.lineWidth = 1.5; nPath(r); ctx.stroke(); }
    text("n+", SRC.x0 + 18, Y0 + 38, C.ph, "center", 13);
    text("n+", DRN.x1 - 18, Y0 + 38, C.ph, "center", 13);

    // gate stack
    glow(C.trace, 4); ctx.lineWidth = 1.5;
    ctx.strokeRect(CX0, Y0 - 8, LPX, 8);                       // oxide
    ctx.fillStyle = "rgba(79,212,122,0.10)"; ctx.fillRect(CX0, Y0 - 34, LPX, 26);
    ctx.strokeRect(CX0, Y0 - 34, LPX, 26);                     // poly
    text("poly gate", (CX0 + CX1) / 2, Y0 - 21, C.label, "center", 12);

    // contacts and terminal labels
    glow(C.trace, 4); ctx.lineWidth = 1.5;
    line(SRC.c, 58, SRC.c, Y0); line(DRN.c, 58, DRN.c, Y0); line((CX0 + CX1) / 2, 58, (CX0 + CX1) / 2, Y0 - 34);
    noGlow(); ctx.fillStyle = C.trace;
    for (const x of [SRC.c, DRN.c, (CX0 + CX1) / 2]) ctx.fillRect(x - 4, 54, 8, 5);
    text("S", SRC.c, 28, C.ph, "center", 15); text("0 V", SRC.c, 44, C.label, "center", 12);
    text("G", (CX0 + CX1) / 2, 28, C.ph, "center", 15); text(state.vgs.toFixed(2) + " V", (CX0 + CX1) / 2, 44, C.label, "center", 12);
    text("D", DRN.c, 28, C.ph, "center", 15); text(state.vds.toFixed(2) + " V", DRN.c, 44, C.label, "center", 12);

    // inversion channel
    if (ch) {
      ctx.beginPath(); ctx.moveTo(CX0, Y0);
      for (let x = CX0; x <= ch.xp; x += 2) ctx.lineTo(x, Y0 + ch.th(x));
      ctx.lineTo(ch.xp, Y0); ctx.closePath();
      noGlow(); ctx.fillStyle = "rgba(79,212,122,0.34)"; ctx.fill();
      glow(C.ph, 6); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(CX0, Y0 + ch.th(CX0));
      for (let x = CX0; x <= ch.xp; x += 2) ctx.lineTo(x, Y0 + ch.th(x));
      ctx.stroke();
      if (ch.sat) {
        noGlow(); ctx.strokeStyle = C.amber; ctx.lineWidth = 1;
        line(ch.xp, Y0 + 3, ch.xp, Y0 + 70);
        text("pinch-off", ch.xp, Y0 + 82, C.amber, "center", 12);
      } else {
        text("inversion channel", (CX0 + CX1) / 2, Y0 + 82, C.label, "center", 12);
      }
    } else {
      text("subthreshold: V_GS < V_th, no channel", (CX0 + CX1) / 2, Y0 + 82, C.amber, "center", 12);
    }

    // electrons, with phosphor afterglow from the frame fade
    noGlow();
    if (ch) {
      for (const p of parts) {
        const y = yAt(p, ch);
        ctx.fillStyle = "rgba(156,255,180,0.22)"; ctx.beginPath(); ctx.arc(p.x, y, 3.6, 0, 6.2832); ctx.fill();
        ctx.fillStyle = C.ph; ctx.beginPath(); ctx.arc(p.x, y, 1.6, 0, 6.2832); ctx.fill();
      }
      text("e⁻ →", 42, Y0 + 106, C.ph, "left", 13);
    }
    ctx.restore();
  }

  /* ---------------- symbol ---------------- */
  function drawSymbol(m) {
    ctx.save(); ctx.translate(symO.x, symO.y);
    if (wide) text("SYMBOL", 24, 16, C.label, "left", 12);
    const on = m.vov > 0;
    glow(C.trace, 5); ctx.lineWidth = 2;
    line(44, 170, 120, 170);                     // gate lead
    line(120, 118, 120, 222);                    // gate plate
    if (!on) glow(C.dim, 0);                     // channel dims when the device is off
    line(136, 112, 136, 228);
    glow(C.trace, 5);
    ctx.beginPath(); ctx.moveTo(136, 122); ctx.lineTo(210, 122); ctx.lineTo(210, 52); ctx.stroke();   // drain
    ctx.beginPath(); ctx.moveTo(136, 218); ctx.lineTo(210, 218); ctx.lineTo(210, 292); ctx.stroke(); // source
    ctx.fillStyle = C.trace; ctx.beginPath(); ctx.moveTo(186, 218); ctx.lineTo(171, 211); ctx.lineTo(171, 225); ctx.closePath(); ctx.fill();
    noGlow();
    text("G", 30, 170, C.ph, "center", 15);
    text("D", 210, 36, C.ph, "center", 15);
    text("S", 210, 310, C.ph, "center", 15);
    if (wide) {
      text("V_GS " + state.vgs.toFixed(2) + " V", 44, 192, C.label, "left", 12);
      text("V_DS " + state.vds.toFixed(2) + " V", 226, 170, C.label, "left", 12);
    }

    // conventional current I_D, drain to source
    if (on) {
      ctx.strokeStyle = C.amber; ctx.fillStyle = C.amber; ctx.lineWidth = 1.5;
      line(232, 62, 232, 104);
      ctx.beginPath(); ctx.moveTo(232, 110); ctx.lineTo(227, 100); ctx.lineTo(237, 100); ctx.closePath(); ctx.fill();
      text("I_D " + fmtI(m.id), 242, 84, C.amber, "left", 13);

      const pts = [[210, 52], [210, 122], [136, 122], [136, 218], [210, 218], [210, 292]];
      const segs = []; let total = 0;
      for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); total += d; }
      const gap = 22;
      for (let s = symPhase % gap; s < total; s += gap) {
        let u = s, i = 0;
        while (u > segs[i]) { u -= segs[i]; i++; }
        const t = u / segs[i];
        const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
        ctx.fillStyle = "rgba(255,181,71,0.25)"; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.2832); ctx.fill();
        ctx.fillStyle = C.amber; ctx.beginPath(); ctx.arc(x, y, 2, 0, 6.2832); ctx.fill();
      }
    }
    ctx.restore();
  }

  function draw(fresh) {
    noGlow();
    ctx.fillStyle = fresh ? C.crt : C.fade;
    ctx.fillRect(0, 0, LW, LH);
    graticule();
    const m = model(state.vgs, state.vds);
    drawCross(m, channel(m));
    drawSymbol(m);
  }

  /* ---------------- readout and controls ---------------- */
  const presetBtns = Array.from(el.querySelectorAll(".presets button"));
  const knobs = {};

  function update() {
    const m = model(state.vgs, state.vds);
    readout.innerHTML =
      `<span>V<sub>GS</sub> <b>${state.vgs.toFixed(2)} V</b></span>` +
      `<span>V<sub>DS</sub> <b>${state.vds.toFixed(2)} V</b></span>` +
      `<span>I<sub>D</sub> <b>${fmtI(m.id)}</b></span>` +
      `<span>g<sub>m</sub> <b>${fmtG(m.gm)}</b></span>` +
      `<span class="region">Region <b>${m.region}</b></span>` +
      `<span class="src">V<sub>th</sub> <b>${m.vth.toFixed(3)} V</b> ${IV ? "from LTspice sweep" : "<i>square-law model</i>"}</span>`;
    presetBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.region === m.region)));
    for (const key in knobs) knobs[key].describe(m);
    if (reduce) { parts = []; acc = 0; settle(6); draw(true); }
  }

  function makeKnob(node, key) {
    const min = parseFloat(node.dataset.min), max = parseFloat(node.dataset.max), stp = parseFloat(node.dataset.step);
    const valueEl = node.parentElement.querySelector(".ctl-value");
    let ticks = "";
    for (let i = 0; i <= 20; i++) {
      const a = ((-135 + 13.5 * i) * Math.PI) / 180, major = i % 5 === 0;
      const r1 = major ? 41 : 44, r2 = 49;
      ticks += `<line class="${major ? "major" : ""}" x1="${50 + r1 * Math.sin(a)}" y1="${50 - r1 * Math.cos(a)}" x2="${50 + r2 * Math.sin(a)}" y2="${50 - r2 * Math.cos(a)}"/>`;
    }
    node.innerHTML = `<svg class="scale" viewBox="0 0 100 100" aria-hidden="true">${ticks}</svg><div class="skirt"></div><div class="cap"></div>`;
    node.setAttribute("role", "slider");
    node.tabIndex = 0;
    node.setAttribute("aria-valuemin", min);
    node.setAttribute("aria-valuemax", max);

    function set(v) {
      v = Math.min(max, Math.max(min, Math.round(v / stp) * stp));
      state[key] = v;
      node.style.setProperty("--a", -135 + (270 * (v - min)) / (max - min) + "deg");
      node.setAttribute("aria-valuenow", v.toFixed(2));
      if (valueEl) valueEl.textContent = v.toFixed(2) + " V";
      update();
    }
    function describe(m) {
      node.setAttribute("aria-valuetext", `${state[key].toFixed(2)} volts, ${m.region}, drain current ${fmtI(m.id)}`);
    }

    let y0 = 0, x0 = 0, v0 = 0;
    node.addEventListener("pointerdown", (e) => {
      node.setPointerCapture(e.pointerId); y0 = e.clientY; x0 = e.clientX; v0 = state[key]; e.preventDefault(); node.focus();
    });
    node.addEventListener("pointermove", (e) => {
      if (!node.hasPointerCapture(e.pointerId)) return;
      set(v0 + ((y0 - e.clientY) + (e.clientX - x0)) * ((max - min) / 220));
    });
    node.addEventListener("keydown", (e) => {
      const big = (max - min) / 10;
      const moves = { ArrowUp: 2 * stp, ArrowRight: 2 * stp, ArrowDown: -2 * stp, ArrowLeft: -2 * stp, PageUp: big, PageDown: -big };
      if (e.key in moves) { e.preventDefault(); set(state[key] + moves[e.key]); }
      else if (e.key === "Home") { e.preventDefault(); set(min); }
      else if (e.key === "End") { e.preventDefault(); set(max); }
    });
    return { set, describe };
  }

  el.querySelectorAll(".knob[data-param]").forEach((n) => { knobs[n.dataset.param] = makeKnob(n, n.dataset.param); });
  presetBtns.forEach((b) => b.addEventListener("click", () => {
    knobs.vgs.set(parseFloat(b.dataset.vgs));
    knobs.vds.set(parseFloat(b.dataset.vds));
  }));

  /* ---------------- run ---------------- */
  let running = false, last = 0, raf = 0, visible = true;
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    step(dt); draw(false);
    raf = requestAnimationFrame(frame);
  }
  function start() { if (running || reduce) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  function sync() { (visible && !document.hidden) ? start() : stop(); }

  layout();
  knobs.vgs.set(state.vgs); knobs.vds.set(state.vds);
  if (!reduce) settle(3);
  draw(true);

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; sync(); }).observe(canvas);
  }
  document.addEventListener("visibilitychange", sync);
  sync();
  let rt = 0;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { layout(); draw(true); }, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => draw(true));

  // Swap in the BSIM sweep once it loads.
  if (el.dataset.iv) loadIV(el.dataset.iv).then((iv) => {
    if (!iv) return;
    IV = iv; parts = []; acc = 0;
    update(); if (!reduce) settle(2); draw(true);
  }).catch(() => {});
})();
