// LordScape Wiki: search, sortable and filterable tables, the theme switch, the world map.
(function () {
  "use strict";
  var BASE = window.WIKI_BASE || "";

  // Theme: light / dark, remembered on this browser.
  var themeBtn = document.getElementById("theme");
  if (themeBtn) themeBtn.addEventListener("click", function () {
    var root = document.documentElement;
    var dark = root.dataset.theme ? root.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("wiki-theme", root.dataset.theme); } catch (e) {}
  });

  // Search: every page's title, loaded once.
  var q = document.getElementById("q"), box = document.getElementById("results");
  var index = null, sel = -1, hits = [];
  function load() {
    if (index) return Promise.resolve(index);
    return fetch(BASE + "/static/search.json").then(function (r) { return r.json(); }).then(function (a) { index = a; return a; });
  }
  function score(t, s) {
    t = t.toLowerCase();
    if (t === s) return 0;
    if (t.indexOf(s) === 0) return 1;
    if (t.indexOf(" " + s) >= 0) return 2;
    if (t.indexOf(s) >= 0) return 3;
    return -1;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function show() {
    var s = q.value.trim().toLowerCase();
    if (!s) { box.classList.remove("open"); return; }
    load().then(function (a) {
      hits = [];
      for (var i = 0; i < a.length; i++) {
        var sc = score(a[i].t, s);
        if (sc >= 0) hits.push([sc, a[i].t.length, a[i]]);
      }
      hits.sort(function (x, y) { return x[0] - y[0] || x[1] - y[1]; });
      hits = hits.slice(0, 12).map(function (h) { return h[2]; });
      sel = hits.length ? 0 : -1;
      box.innerHTML = hits.map(function (h, i) {
        return '<a href="' + BASE + h.u + '"' + (i === sel ? ' class="sel"' : "") + ">" +
          (h.i ? '<img src="' + BASE + h.i + '" alt="">' : "") + esc(h.t) + "<small>" + esc(h.k) + "</small></a>";
      }).join("") || '<a class="none">No pages match</a>';
      box.classList.add("open");
    });
  }
  if (q) {
    q.addEventListener("input", show);
    q.addEventListener("focus", show);
    q.addEventListener("keydown", function (e) {
      var links = box.querySelectorAll("a[href]");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!links.length) return;
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
        links.forEach(function (l, i) { l.classList.toggle("sel", i === sel); });
      } else if (e.key === "Enter") {
        if (sel >= 0 && links[sel]) location.href = links[sel].getAttribute("href");
      } else if (e.key === "Escape") {
        box.classList.remove("open"); q.blur();
      }
    });
    document.addEventListener("click", function (e) { if (!e.target.closest(".search")) box.classList.remove("open"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement !== q && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault(); q.focus();
      }
    });
  }

  // [[Page title]] links in hand-written notes.
  var wl = document.querySelectorAll("a.wl");
  if (wl.length) fetch(BASE + "/static/pages.json").then(function (r) { return r.json(); }).then(function (pages) {
    wl.forEach(function (a) {
      var u = pages[a.dataset.title.toLowerCase()];
      if (u) a.href = BASE + u; else a.classList.add("none");
    });
  });

  // Sortable tables: click a heading. Cells may carry data-sort.
  function cellValue(td) {
    var v = td.dataset.sort != null ? td.dataset.sort : td.textContent.trim();
    var n = parseFloat(String(v).replace(/,/g, "").replace(/^1\//, ""));
    if (/^1\//.test(td.textContent.trim()) && td.dataset.sort == null) n = 1 / n;
    return isNaN(n) ? String(v).toLowerCase() : n;
  }
  document.querySelectorAll("table.sortable").forEach(function (table) {
    var ths = table.querySelectorAll("thead th");
    ths.forEach(function (th, col) {
      th.addEventListener("click", function () {
        var asc = !th.classList.contains("asc");
        ths.forEach(function (h) { h.classList.remove("asc", "desc"); });
        th.classList.add(asc ? "asc" : "desc");
        var body = table.tBodies[0];
        var rows = Array.prototype.slice.call(body.rows);
        rows.sort(function (a, b) {
          var x = cellValue(a.cells[col]), y = cellValue(b.cells[col]);
          if (typeof x !== typeof y) { x = String(x); y = String(y); }
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
        rows.forEach(function (r) { body.appendChild(r); });
      });
    });
  });

  // Filter boxes: the table right after.
  document.querySelectorAll("input.tfilter").forEach(function (inp) {
    var table = inp.nextElementSibling;
    while (table && table.tagName !== "TABLE") table = table.nextElementSibling;
    if (!table) return;
    inp.addEventListener("input", function () {
      var s = inp.value.trim().toLowerCase();
      Array.prototype.forEach.call(table.tBodies[0].rows, function (r) {
        r.style.display = !s || r.textContent.toLowerCase().indexOf(s) >= 0 ? "" : "none";
      });
    });
  });

  // Wide tables scroll on their own.
  document.querySelectorAll(".body > table.wikitable, .body > div > table.wikitable").forEach(function (t) {
    var w = document.createElement("div");
    w.className = "table-wrap";
    t.parentNode.insertBefore(w, t);
    w.appendChild(t);
  });

  // World map: drag to pan, wheel to zoom; #x,y in the address centres on a tile with a pin.
  var wm = document.querySelector(".worldmap");
  if (wm) {
    var inner = wm.querySelector(".wm-inner");
    var origin = (wm.dataset.origin || "0,0").split(",").map(Number);
    var scale = 1, tx = 0, ty = 0, drag = null;
    function apply() {
      inner.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
      var f = Math.max(0.6, Math.min(2.2, 1 / Math.sqrt(scale)));
      inner.querySelectorAll("a").forEach(function (a) {
        a.style.transform = "translate(-50%,-50%) scale(" + f + ")";
        a.style.display = scale < 0.8 && !a.classList.contains("big") ? "none" : "";  // (small names once zoomed in)
      });
    }
    function centre(x, y, s) {
      scale = s; tx = wm.clientWidth / 2 - x * s; ty = wm.clientHeight / 2 - y * s; apply();
    }
    var m = /^#(-?\d+),(-?\d+)$/.exec(location.hash);
    var img = inner.querySelector("img");
    function start() {
      if (m) {
        var x = +m[1] - origin[0], y = +m[2] - origin[1];
        var pin = document.createElement("div");
        pin.className = "pin"; pin.style.left = x + "px"; pin.style.top = y + "px";
        inner.appendChild(pin);
        centre(x, y, 3);
      } else {
        var s = Math.min(wm.clientWidth / img.naturalWidth, wm.clientHeight / img.naturalHeight);
        centre(img.naturalWidth / 2, img.naturalHeight / 2, s);
      }
    }
    if (img.complete) start(); else img.addEventListener("load", start);
    wm.addEventListener("pointerdown", function (e) {
      if (e.target.tagName === "A") return;
      drag = { x: e.clientX - tx, y: e.clientY - ty }; wm.classList.add("dragging"); wm.setPointerCapture(e.pointerId);
    });
    wm.addEventListener("pointermove", function (e) { if (drag) { tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); } });
    wm.addEventListener("pointerup", function () { drag = null; wm.classList.remove("dragging"); });
    wm.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = wm.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      var ns = Math.max(0.25, Math.min(12, scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      tx = px - (px - tx) * ns / scale; ty = py - (py - ty) * ns / scale; scale = ns; apply();
    }, { passive: false });
  }
})();
