/* Live compensation demo for the two-stage op-amp page.
   Curves come from the LTspice sweep exports in data/ at each C_C click-stop;
   any setting without a sweep falls back to the fitted small-signal model below.


   The plot is the exact small-signal response of the two-stage op-amp, solved
   at each frequency from KCL at three nodes:
     v1 (first-stage output), vx (between R_Z and C_C), vo (output).
   g_m and r_o come from the LTspice operating point. C1, C2, C_gd6 and one
   high-frequency pole (the current-mirror node) were fitted so the model
   reproduces the simulated f_t, phase margin, -3 dB frequency and gain margin
   for all four cases in the report (within 1.6 degrees and 2%). */

(function () {
  "use strict";
  const el = document.querySelector("[data-comp-demo]");
  if (!el || !window.Bode) return;

  const P = {
    gm1: 86.5e-6, gm6: 676e-6, R1: 1.18e6, R2: 178.3e3,     // from the .op table
    C1: 29.87e-15, C2: 1.1294e-12, Cgd: 1.85e-15, fhf: 1.0917e9, // fitted to LTspice
  };
  const RZ = { none: 0, ideal: 1479, mz: 1770 };              // 1/g_m6, and M_Z at R_Z*g_m6 = 1.2
  const state = { cc: 350e-15, rz: "mz" };

  /* complex helpers: [re, im] */
  const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  const cabs = (a) => Math.hypot(a[0], a[1]);

  // Gaussian elimination with partial pivoting on a small complex system.
  function solve(A, b) {
    const n = b.length;
    for (let k = 0; k < n; k++) {
      let p = k;
      for (let i = k + 1; i < n; i++) if (cabs(A[i][k]) > cabs(A[p][k])) p = i;
      [A[k], A[p]] = [A[p], A[k]]; [b[k], b[p]] = [b[p], b[k]];
      for (let i = k + 1; i < n; i++) {
        const m = cdiv(A[i][k], A[k][k]);
        for (let j = k; j < n; j++) A[i][j] = csub(A[i][j], cmul(m, A[k][j]));
        b[i] = csub(b[i], cmul(m, b[k]));
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < n; j++) s = csub(s, cmul(A[i][j], x[j]));
      x[i] = cdiv(s, A[i][i]);
    }
    return x;
  }

  // vo / vin at frequency f
  function response(f, cc, rz) {
    const w = 2 * Math.PI * f;
    const s = (c) => [0, w * c];                               // admittance of a capacitor
    const g = (r) => [1 / r, 0];
    let vo;
    if (rz === 0) {                                            // C_C straight from v1 to vo
      const cf = s(cc + P.Cgd);
      const A = [
        [cadd(cadd(g(P.R1), s(P.C1)), cf), [-cf[0], -cf[1]]],
        [csub([P.gm6, 0], cf), cadd(cadd(g(P.R2), s(P.C2)), cf)],
      ];
      vo = solve(A, [[-P.gm1, 0], [0, 0]])[1];
    } else {
      const gz = g(rz), cg = s(P.Cgd), c = s(cc);
      const A = [
        [cadd(cadd(cadd(g(P.R1), s(P.C1)), gz), cg), [-gz[0], 0], [-cg[0], -cg[1]]],
        [[-gz[0], 0], cadd(gz, c), [-c[0], -c[1]]],
        [csub([P.gm6, 0], cg), [-c[0], -c[1]], cadd(cadd(cadd(g(P.R2), s(P.C2)), c), cg)],
      ];
      vo = solve(A, [[-P.gm1, 0], [0, 0], [0, 0]])[2];
    }
    return cdiv(vo, [1, f / P.fhf]);                           // mirror-node pole
  }

  // Sweep, unwrap the phase, and reference it to 0 degrees at DC.
  function table(cc, rz) {
    const rows = [], N = 700, lo = 0, hi = 9.3;
    let prev = null, off = 0, ref = null;
    for (let i = 0; i <= N; i++) {
      const f = Math.pow(10, lo + (i / N) * (hi - lo));
      const h = response(f, cc, rz);
      let deg = (Math.atan2(h[1], h[0]) * 180) / Math.PI;
      if (prev !== null) { while (deg + off - prev > 180) off -= 360; while (deg + off - prev < -180) off += 360; }
      deg += off; prev = deg;
      if (ref === null) ref = Math.round(deg / 180) * 180;    // 0 deg at DC (two inverting stages)
      rows.push([f, 20 * Math.log10(cabs(h)), deg - ref]);
    }
    return rows;
  }

  /* ---------------- data: LTspice sweeps from data/, the model otherwise ----------------
     The two-stage page lists its sweep files on the figure:
       data-sweep-rz  stepped over Cc and Rz (Rz below 10 ohm counts as "no R_Z")
       data-sweep-mz  stepped over Cc, triode M_Z
     The knob's click-stops are the C_C values found in the files. */
  const SIM = { none: {}, ideal: {}, mz: {} };
  let STOPS = [0, 50, 100, 150, 200, 233.8, 250, 300, 350, 400, 450, 500, 600];  // fF, until files load
  const ccKey = (farads) => { const v = Math.round(farads * 1e16) / 10; return v < 0.01 ? 0 : v; };
  function curve(ccfF, mode) {
    const rows = SIM[mode][ccfF];
    if (rows) return { rows, sim: true };
    return { rows: table(ccfF * 1e-15, RZ[mode]), sim: false };
  }
  async function loadSweeps() {
    const jobs = [];
    if (el.dataset.sweepRz) jobs.push(window.Bode.loadLT(el.dataset.sweepRz).then((runs) => {
      for (const r of runs) {
        if (r.params.Cc === undefined) continue;
        const mode = r.params.Rz !== undefined && r.params.Rz < 10 ? "none" : "ideal";
        SIM[mode][ccKey(r.params.Cc)] = r.rows;
      }
    }).catch(() => {}));
    if (el.dataset.sweepMz) jobs.push(window.Bode.loadLT(el.dataset.sweepMz).then((runs) => {
      for (const r of runs) if (r.params.Cc !== undefined) SIM.mz[ccKey(r.params.Cc)] = r.rows;
    }).catch(() => {}));
    await Promise.all(jobs);
    const found = new Set();
    for (const m in SIM) for (const k in SIM[m]) found.add(parseFloat(k));
    return [...found].sort((x, y) => x - y);
  }

  /* ---------------- controls ---------------- */
  let idx = STOPS.indexOf(350);
  const first = curve(STOPS[idx], state.rz);
  const plotEl = el.querySelector(".bode");
  const bode = window.Bode.make(plotEl, window.Bode.table(first.rows), { gm: true });
  const zeroEl = el.querySelector(".comp-zero");
  const rzBtns = Array.from(el.querySelectorAll("[data-rz]"));
  const presetBtns = Array.from(el.querySelectorAll("[data-preset-cc]"));
  const knob = el.querySelector(".knob[data-param=cc]");
  const valueEl = knob.parentElement.querySelector(".ctl-value");

  const fmtF = (f) => (f >= 1e9 ? (f / 1e9).toFixed(2) + " GHz" : f >= 1e6 ? (f / 1e6).toFixed(1) + " MHz" : (f / 1e3).toFixed(1) + " kHz");

  function describeZero(sim) {
    // z = 1 / (C_C (1/g_m6 - R_Z)); C_gd6 is small enough to leave out here
    const cc = state.cc, rz = RZ[state.rz];
    const src = sim ? `<span class="src">LTspice sweep</span>` : `<span class="src model">fitted model</span>`;
    if (cc < 1e-15) return `Zero: none without C<sub>C</sub>${src}`;
    const d = 1 / P.gm6 - rz;
    if (Math.abs(d) < 5) return `Zero: <b>cancelled</b>, pushed to infinity${src}`;
    const fz = 1 / (2 * Math.PI * cc * Math.abs(d));
    return (d > 0 ? `Zero: <b class="warn">right half-plane, ${fmtF(fz)}</b>` : `Zero: <b>left half-plane, ${fmtF(fz)}</b>`) + src;
  }

  let pending = 0;
  function redraw() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      const c = curve(STOPS[idx], state.rz);
      bode.update(window.Bode.table(c.rows));
      const st = bode.stats();
      if (zeroEl) zeroEl.innerHTML = describeZero(c.sim);
      knob.setAttribute("aria-valuetext",
        `${STOPS[idx]} femtofarads` + (st.pm !== null ? `, phase margin ${st.pm.toFixed(1)} degrees` : ""));
    });
    rzBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rz === state.rz)));
    presetBtns.forEach((b) => b.setAttribute("aria-pressed",
      String(parseFloat(b.dataset.presetCc) === STOPS[idx] && b.dataset.presetRz === state.rz)));
  }

  // C_C knob: a rotary switch with one click-stop per simulated value, evenly spaced over 270 degrees
  let n = 0, span = 0;
  function buildKnob() {
    n = STOPS.length; span = 270 / (n - 1);
    let ticks = "";
    for (let i = 0; i < n; i++) {
      const a = ((-135 + span * i) * Math.PI) / 180, major = STOPS[i] % 100 === 0, r1 = major ? 40 : 43;
      ticks += `<line class="${major ? "major" : ""}" x1="${50 + r1 * Math.sin(a)}" y1="${50 - r1 * Math.cos(a)}" x2="${50 + 49 * Math.sin(a)}" y2="${50 - 49 * Math.cos(a)}"/>`;
    }
    knob.innerHTML = `<svg class="scale" viewBox="0 0 100 100" aria-hidden="true">${ticks}</svg><div class="skirt"></div><div class="cap"></div>`;
    knob.setAttribute("aria-valuemin", STOPS[0]); knob.setAttribute("aria-valuemax", STOPS[n - 1]);
  }
  buildKnob();
  knob.setAttribute("role", "slider"); knob.tabIndex = 0;

  function setIdx(i) {
    i = Math.min(n - 1, Math.max(0, Math.round(i)));
    const changed = i !== idx;
    idx = i;
    const fF = STOPS[idx];
    state.cc = fF * 1e-15;
    knob.style.setProperty("--a", -135 + span * idx + "deg");
    knob.setAttribute("aria-valuenow", fF);
    valueEl.textContent = (fF % 1 ? fF.toFixed(1) : fF.toFixed(0)) + " fF";
    if (changed) { knob.classList.remove("click"); void knob.offsetWidth; knob.classList.add("click"); }
    redraw();
  }
  // Drag by turning: follow the pointer's angle around the knob centre; each stop is `span` degrees.
  let cx = 0, cy = 0, lastA = 0, turned = 0, i0 = 0;
  const angleOf = (e) => (Math.atan2(e.clientX - cx, cy - e.clientY) * 180) / Math.PI;     // 0 at top, clockwise +
  knob.addEventListener("pointerdown", (e) => {
    const r = knob.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    lastA = angleOf(e); turned = 0; i0 = idx;
    knob.setPointerCapture(e.pointerId); e.preventDefault(); knob.focus();
  });
  knob.addEventListener("pointermove", (e) => {
    if (!knob.hasPointerCapture(e.pointerId)) return;
    if (Math.hypot(e.clientX - cx, e.clientY - cy) < 8) return;
    const a = angleOf(e);
    let d = a - lastA;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    lastA = a;
    turned = Math.min((n - 1 - i0) * span, Math.max(-i0 * span, turned + d));          // no wind-up past the end stops
    setIdx(i0 + turned / span);
  });
  knob.addEventListener("keydown", (e) => {
    const moves = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 3, PageDown: -3 };
    if (e.key in moves) { e.preventDefault(); setIdx(idx + moves[e.key]); }
    else if (e.key === "Home") { e.preventDefault(); setIdx(0); }
    else if (e.key === "End") { e.preventDefault(); setIdx(n - 1); }
  });

  rzBtns.forEach((b) => b.addEventListener("click", () => { state.rz = b.dataset.rz; redraw(); }));
  presetBtns.forEach((b) => b.addEventListener("click", () => {
    state.rz = b.dataset.presetRz; setIdx(STOPS.indexOf(parseFloat(b.dataset.presetCc)));
  }));

  setIdx(idx);

  // Swap in the LTspice sweeps once they load; the knob takes its stops from them.
  loadSweeps().then((stops) => {
    if (!stops.length) return;
    const keep = STOPS[idx];
    STOPS = stops;
    buildKnob();
    const j = STOPS.indexOf(keep);
    idx = -1;                                   // force a redraw
    setIdx(j >= 0 ? j : STOPS.indexOf(350) >= 0 ? STOPS.indexOf(350) : Math.floor(STOPS.length / 2));
  });
})();
