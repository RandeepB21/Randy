/* Embedded report viewer.
   <section class="report-viewer" data-pdf="reports/x.pdf" hidden> stays hidden until the PDF exists.
   Collapsed until opened; pages are drawn with PDF.js (works on phones, unlike an <iframe>), only when they scroll into view. */
(function () {
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/";

  let libPromise = null;
  function loadLib() {
    if (!libPromise) {
      libPromise = import(PDFJS + "pdf.min.mjs").then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
        return lib;
      });
    }
    return libPromise;
  }

  document.querySelectorAll(".report-viewer[data-pdf]").forEach((sec) => {
    const url = sec.dataset.pdf;
    fetch(url, { method: "HEAD" })
      .then((r) => {
        if (!r.ok) return;
        sec.hidden = false;
        // collapsed until the reader asks for it; the PDF loads on first open
        const btn = sec.querySelector(".rv-toggle");
        const pages = sec.querySelector(".rv-pages");
        let started = false;
        btn.addEventListener("click", () => {
          const open = !sec.classList.contains("open");
          sec.classList.toggle("open", open);
          pages.hidden = !open;
          btn.setAttribute("aria-expanded", String(open));
          btn.textContent = open ? "Hide the report" : "Read the report";
          if (open && !started) { started = true; start(sec, url); }
        });
      })
      .catch(() => {});
  });

  async function start(sec, url) {
    const pagesEl = sec.querySelector(".rv-pages");
    const status = sec.querySelector(".rv-status");
    const pageNo = sec.querySelector(".rv-page");
    const zoomVal = sec.querySelector(".rv-zoom-val");
    status.textContent = "Loading report…";

    let doc;
    try {
      const lib = await loadLib();
      doc = await lib.getDocument({ url }).promise;
    } catch (e) {
      status.textContent = "The viewer couldn't load here. Use Open PDF.";
      return;
    }
    status.textContent = "";
    const n = doc.numPages;
    sec.querySelector(".rv-count").textContent = n;

    const first = await doc.getPage(1);
    const v1 = first.getViewport({ scale: 1 });
    const slots = [];
    for (let i = 1; i <= n; i++) {
      const d = document.createElement("div");
      d.className = "rv-sheet";
      d.style.aspectRatio = `${v1.width} / ${v1.height}`;
      d.dataset.page = i;
      d.setAttribute("role", "img");
      d.setAttribute("aria-label", `Report page ${i} of ${n}`);
      pagesEl.appendChild(d);
      slots.push(d);
    }

    let zoom = 1;
    const drawn = new Map();          // page -> zoom it was drawn at
    async function render(d) {
      const i = +d.dataset.page, z = zoom;
      if (drawn.get(i) === z) return;
      drawn.set(i, z);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (d.clientWidth / base.width) * dpr });
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      await page.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: vp }).promise;
      if (drawn.get(i) !== z) return;   // zoom changed while drawing
      d.style.aspectRatio = `${base.width} / ${base.height}`;
      d.replaceChildren(c);
    }

    const near = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) render(e.target).catch(() => {}); });
    }, { root: pagesEl, rootMargin: "600px 0px" });
    slots.forEach((s) => near.observe(s));

    const seen = new Map();
    const current = new IntersectionObserver((es) => {
      es.forEach((e) => seen.set(e.target, e.intersectionRatio));
      let best = null, r = 0;
      seen.forEach((v, k) => { if (v > r) { r = v; best = k; } });
      if (best) pageNo.textContent = best.dataset.page;
    }, { root: pagesEl, threshold: [0, 0.25, 0.5, 0.75, 1] });
    slots.forEach((s) => current.observe(s));

    function setZoom(z) {
      const pos = pagesEl.scrollTop / Math.max(1, pagesEl.scrollHeight);
      zoom = Math.round(Math.min(2.5, Math.max(0.5, z)) * 100) / 100;
      pagesEl.style.setProperty("--rv-zoom", zoom);
      zoomVal.textContent = Math.round(zoom * 100) + "%";
      requestAnimationFrame(() => {
        pagesEl.scrollTop = pos * pagesEl.scrollHeight;
        const R = pagesEl.getBoundingClientRect();
        slots.forEach((s) => {
          const b = s.getBoundingClientRect();
          if (b.bottom > R.top - 600 && b.top < R.bottom + 600) render(s).catch(() => {});
        });
      });
    }
    sec.querySelector(".rv-in").addEventListener("click", () => setZoom(zoom + 0.25));
    sec.querySelector(".rv-out").addEventListener("click", () => setZoom(zoom - 0.25));
  }
})();
