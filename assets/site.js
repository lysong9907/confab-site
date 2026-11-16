/* Confab product page.
   One number drives the film: p in [0, 1], the scroll progress through #journey (GSAP ScrollTrigger),
   damped each frame. Scenes fade by their data-at ranges, portal scenes step through beats, and a
   2D canvas draws the bars: a wide voice waveform that gathers into the seven-bar mascot and flies
   to whichever [data-anchor] the current scene offers. Without .is-cine none of this runs. */
(function () {
  "use strict";
  var root = document.documentElement;

  // ---------------------------------------------------------------- language (works in every mode)
  function setLang(lang) {
    root.dataset.lang = lang;
    root.lang = lang === "en" ? "en" : "zh-CN";
    try { localStorage.setItem("confab-lang", lang); } catch (e) {}
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  }
  var toggle = document.querySelector("[data-lang-toggle]");
  if (toggle) toggle.addEventListener("click", function () { setLang(root.dataset.lang === "en" ? "zh" : "en"); });

  if (!root.classList.contains("is-cine")) return;
  var fallback = window.__confabFallback || function () {};
  if (!window.gsap || !window.ScrollTrigger) return fallback();

  try { init(); window.__confabReady = true; } catch (err) { if (window.console) console.error("[confab] film failed, static page shown", err); fallback(); }

  function init() {
    var gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);

    var clamp01 = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
    var lin = function (x, a, b) { return b <= a ? (x >= a ? 1 : 0) : clamp01((x - a) / (b - a)); };
    var smooth = function (x) { x = clamp01(x); return x * x * (3 - 2 * x); };
    var mix = function (a, b, t) { return a + (b - a) * t; };

    var journey = document.getElementById("journey");
    var stage = journey.querySelector(".stage");
    var canvas = document.getElementById("world");
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");

    // ---------------------------------------------------------------- storyboard, read from the markup
    var scenes = [].map.call(journey.querySelectorAll(".scene"), function (el) {
      var at = el.dataset.at.split(",").map(function (v) { return v === "" ? null : parseFloat(v); });
      var beats = el.dataset.beats ? el.dataset.beats.split(",").map(parseFloat) : null;
      var demo = el.querySelector(".demo");
      return {
        el: el, id: el.id, at: at, ch: +el.dataset.ch, beats: beats, demo: demo, last: -1, step: -1, beat: -1,
        anchor: el.querySelector("[data-anchor]"), wave: el.querySelector("[data-wave]"),
        lanes: !!el.querySelector("[data-lanes]"),
        byBeat: [].slice.call(el.querySelectorAll("[data-b]")),
        shows: [].map.call(el.querySelectorAll("[data-show]"), function (n) { return { el: n, k: +n.dataset.show, on: null }; }),
      };
    });
    var CH = [["00", "开场", "Opening"], ["01", "说", "Speak"], ["02", "写", "Write"], ["03", "会", "Meet"], ["04", "交给 agent", "Hand over"], ["05", "Just say it.", "Just say it."]];
    var hud = { el: stage.querySelector(".hud"), num: stage.querySelector("[data-hud-num]"), label: stage.querySelector("[data-hud-label]"), fill: stage.querySelector("[data-hud-fill]"), ch: -1, lang: "" };

    function sceneOpacity(s, p) {
      var a = s.at, fin = lin(p, a[0], a[1]), fout = a[2] == null ? 1 : 1 - lin(p, a[2], a[3]);
      return Math.min(fin, fout);
    }

    // Mascot mood per scene and step, as the app shows it in the capsule.
    function moodFor(s) {
      if (!s) return "idle";
      if (s.id === "s-write") return ["listen", "think", "done"][s.step % 3] || "listen";
      if (s.id === "s-meet") return s.step === 3 ? "think" : "listen";
      if (s.id === "s-work") return s.step < 3 ? "idle" : s.step === 6 ? "think" : s.step >= 7 ? "done" : "idle";
      if (s.id === "s-end") return "done";
      return "idle";
    }

    function updateScenes(p) {
      var best = null, bestA = 0;
      for (var i = 0; i < scenes.length; i++) {
        var s = scenes[i], a = sceneOpacity(s, p);
        if (a !== s.last) {
          s.el.style.opacity = a.toFixed(3);
          s.el.style.visibility = a > 0.001 ? "visible" : "hidden";
          s.el.style.setProperty("--in", smooth(a).toFixed(3));
          s.last = a;
        }
        if (a > bestA) { bestA = a; best = s; }
        if (!s.beats || a <= 0.001) continue;
        // beats: crossfade centred on each boundary; three steps inside each beat
        var n = s.beats.length - 1, d = 0.012, bi = 0;
        for (var b = 0; b < n; b++) if (p >= s.beats[b]) bi = b;
        var local = lin(p, s.beats[bi], s.beats[bi + 1]);
        var ls = local < 0.3 ? 0 : local < 0.6 ? 1 : 2;
        var step = bi * 3 + ls;
        for (var j = 0; j < s.byBeat.length; j++) {
          var el = s.byBeat[j], k = +el.dataset.b;
          var o = (k === 0 ? 1 : lin(p, s.beats[k] - d / 2, s.beats[k] + d / 2)) * (k === n - 1 ? 1 : 1 - lin(p, s.beats[k + 1] - d / 2, s.beats[k + 1] + d / 2));
          el.style.opacity = o.toFixed(3);
          el.style.visibility = o > 0.001 ? "visible" : "hidden";
          if (el.classList.contains("ex")) el.dataset.ls = k < bi ? 2 : k > bi ? 0 : ls;
        }
        if (step !== s.step) {
          s.step = step;
          if (s.demo) s.demo.dataset.ls = ls;
          for (var m = 0; m < s.shows.length; m++) {
            var sh = s.shows[m], on = step >= sh.k;
            if (on !== sh.on) { sh.el.classList.toggle("is-on", on); sh.on = on; }
          }
        }
        if (bi !== s.beat) { s.beat = bi; s.el.dataset.beat = bi; }
      }
      return { scene: best, alpha: bestA };
    }

    // ---------------------------------------------------------------- the bars
    var HEIGHTS = [0.34, 0.66, 1, 0.86, 1, 0.66, 0.34]; // same numbers as the app's mascot
    var W = 0, H = 0, dpr = 1, N = 41;
    var cur = { g: 0, wave: 1, lanes: 0, mx: 0, my: 0, ms: 120, wx: 0, wy: 0, ww: 0, wh: 0, mAlpha: 0, init: false };
    var moodMix = { listen: 0, think: 0, done: 0, idle: 1 };

    function resize() {
      var r = stage.getBoundingClientRect();
      W = r.width; H = r.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      N = W < 700 ? 27 : W < 1100 ? 37 : 49;
    }

    function colorAt(u) { // teal → blue → violet
      var a = [64, 226, 200], b = [110, 176, 255], c = [150, 128, 255], t, x, y;
      if (u < 0.55) { t = u / 0.55; x = a; y = b; } else { t = (u - 0.55) / 0.45; x = b; y = c; }
      return [Math.round(mix(x[0], y[0], t)), Math.round(mix(x[1], y[1], t)), Math.round(mix(x[2], y[2], t))];
    }
    function rr(x, y, w, h) {
      var r = Math.min(w, h) / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    function star(cx, cy, R, angle, alpha) {
      if (alpha <= 0.01 || R < 0.5) return;
      ctx.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = angle + (i * Math.PI) / 4 - Math.PI / 2, q = i % 2 === 0 ? R : R * 0.3;
        var x = cx + Math.cos(a) * q, y = cy + Math.sin(a) * q;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, "#fff"); g.addColorStop(0.5, "#ffe3a1"); g.addColorStop(1, "#ffb054");
      ctx.globalAlpha = alpha; ctx.fillStyle = g;
      ctx.shadowColor = "rgba(255,214,140,.7)"; ctx.shadowBlur = R * 0.9;
      ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }

    function draw(t, dt, active) {
      var s = active.scene, sr = stage.getBoundingClientRect();
      var k = 1 - Math.exp(-dt * 6.5);
      // targets from the layout of the scene in view
      var tg = s && s.anchor ? 1 : 0, tw = s && s.wave ? 1 : 0, tl = s && s.lanes ? 1 : 0;
      if (s && s.anchor) {
        var ar = s.anchor.getBoundingClientRect();
        var size = Math.min(ar.width, ar.height), ax = ar.left - sr.left + (ar.width - size) / 2, ay = ar.top - sr.top + (ar.height - size) / 2;
        if (!cur.init || cur.mAlpha < 0.02) { cur.mx = ax; cur.my = ay; cur.ms = size; }
        cur.mx += (ax - cur.mx) * k; cur.my += (ay - cur.my) * k; cur.ms += (size - cur.ms) * k;
      }
      if (s && s.wave) {
        var wr = s.wave.getBoundingClientRect();
        var wx = wr.left - sr.left, wy = wr.top - sr.top;
        if (!cur.init || cur.wave < 0.02) { cur.wx = wx; cur.wy = wy; cur.ww = wr.width; cur.wh = wr.height; }
        cur.wx += (wx - cur.wx) * k; cur.wy += (wy - cur.wy) * k; cur.ww += (wr.width - cur.ww) * k; cur.wh += (wr.height - cur.wh) * k;
      }
      if (!cur.init) { cur.g = tg; cur.wave = tw; cur.lanes = tl; cur.init = true; }
      cur.g += (tg - cur.g) * k; cur.wave += (tw - cur.wave) * k; cur.lanes += (tl - cur.lanes) * k;
      cur.mAlpha += ((s && s.anchor ? 1 : 0) - cur.mAlpha) * Math.min(1, k * 1.6);
      var mood = moodFor(s);
      for (var key in moodMix) moodMix[key] += ((key === mood ? 1 : 0) - moodMix[key]) * k;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var g = smooth(cur.g), c0 = (N - 7) / 2;
      var waveAlpha = cur.wave; // the bars stay on screen while the text of two scenes changes over
      var pitch = cur.ww / N, bw = Math.max(3, Math.min(pitch * 0.42, 12));
      var cy = cur.wy + cur.wh / 2;

      // mascot geometry (from Buddy.swift)
      var ms = cur.ms, mw = ms * 0.083, gap = ms * 0.0375, maxH = ms * 0.66, mcy = cur.my + ms * 0.585;
      var mx0 = cur.mx + (ms - (7 * mw + 6 * gap)) / 2;
      var hop = -Math.abs(Math.sin(t * 5)) * ms * 0.03 * moodMix.done;
      var eyes = [];

      for (var i = 0; i < N; i++) {
        var u = (i + 0.5) / N, m = i - c0, isM = m >= 0 && m < 7;
        var env = 0.25 + 0.75 * Math.pow(Math.sin(Math.PI * u), 1.4);
        var v = 0.5 + 0.5 * Math.sin(t * 2.3 + i * 0.9) * Math.sin(t * 1.3 + i * 0.37);
        v = 0.22 + 0.78 * Math.abs(Math.sin(t * 3.1 + i * 1.7)) * v;
        var wxp = cur.wx + u * cur.ww - bw / 2, wh = Math.max(bw, cur.wh * env * v), wyc = cy;
        var col = colorAt(u), alpha = waveAlpha * (0.55 + 0.45 * env);
        if (cur.lanes > 0.01) { // two voices: alternate bars form the "Me" lane and the "Them" lane
          var top = i % 2 === 0, L = cur.lanes;
          var talk = top ? 0.5 + 0.5 * Math.sin(t * 0.9) : 0.5 - 0.5 * Math.sin(t * 0.9);
          wyc = mix(cy, cur.wy + cur.wh * (top ? 0.25 : 0.75), L);
          wh = mix(wh, Math.max(bw, cur.wh * 0.44 * (0.25 + 0.75 * talk) * (0.3 + 0.7 * Math.abs(Math.sin(t * 4 + i * 1.3)))), L);
          var lc = top ? [64, 226, 200] : [150, 128, 255];
          col = [mix(col[0], lc[0], L) | 0, mix(col[1], lc[1], L) | 0, mix(col[2], lc[2], L) | 0];
        }
        var x = wxp, w = bw, h = wh, yc = wyc;
        if (isM) {
          var f = moodMix.idle * (0.84 + 0.05 * Math.sin(t * 1.8 + m * 0.6)) + moodMix.listen * (0.34 + 0.6 * Math.abs(Math.sin(t * 7.5 + m * 0.95))) + moodMix.think * (0.3 + 0.6 * Math.max(0, Math.sin(t * 5.5 - m * 0.75))) + moodMix.done * 0.9;
          var mh = Math.max(mw, maxH * HEIGHTS[m] * f);
          var mxp = mx0 + m * (mw + gap);
          x = mix(wxp, mxp, g); w = mix(bw, mw, g); h = mix(wh, mh, g); yc = mix(wyc, mcy + hop, g);
          alpha = mix(alpha, cur.mAlpha, g);
          var mc = colorAt(0.1 + (m / 6) * 0.8);
          col = [mix(col[0], mc[0], g) | 0, mix(col[1], mc[1], g) | 0, mix(col[2], mc[2], g) | 0];
          if (m === 2 || m === 4) eyes.push({ x: x + w / 2, top: yc - h / 2, mid: yc, h: h, w: w });
        }
        if (alpha <= 0.01) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgb(" + col[0] + "," + col[1] + "," + col[2] + ")";
        rr(x, yc - h / 2, w, h); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // eyes on the two tall bars
      var ea = g * cur.mAlpha;
      if (ea > 0.02) {
        var er = ms * 0.03, look = Math.sin(t * 3.5) * mw * 0.18 * moodMix.think;
        var blink = moodMix.idle > 0.6 && t % 4.2 > 4.05;
        ctx.globalAlpha = ea; ctx.fillStyle = "#0a1119"; ctx.strokeStyle = "#0a1119"; ctx.lineCap = "round"; ctx.lineWidth = er * 0.8;
        for (var e = 0; e < eyes.length; e++) {
          var b = eyes[e]; if (b.h < er * 4) continue;
          var ex = b.x + look, ey = Math.min(b.mid, Math.max(b.top + er * 2.2, mcy - maxH * 0.16 + hop));
          if (moodMix.done > 0.6) { ctx.beginPath(); ctx.moveTo(ex - er, ey + er * 0.4); ctx.quadraticCurveTo(ex, ey - er * 1.5, ex + er, ey + er * 0.4); ctx.stroke(); }
          else { ctx.beginPath(); ctx.ellipse(ex, ey, er, blink ? er * 0.15 : er, 0, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.globalAlpha = 1;
      }

      // the gold star: above the waveform, then above the mascot
      var R1 = Math.max(7, cur.wh * 0.085), R2 = ms * 0.085 * (1 + 0.18 * Math.sin(t * 6) * moodMix.listen + 0.25 * moodMix.done + 0.05 * Math.sin(t * 1.8) * moodMix.idle);
      var sx = mix(cur.wx + cur.ww / 2, cur.mx + ms / 2, g), sy = mix(cur.wy - R1 * 0.4, cur.my + ms * 0.115 + hop, g);
      var sAlpha = mix(waveAlpha * (1 - cur.lanes), cur.mAlpha, g);
      star(sx, sy, mix(R1, R2, g), t * 3 * moodMix.think, sAlpha);
    }

    // ---------------------------------------------------------------- scroll → progress → frame
    var state = { target: 0, p: 0 };
    var st = ScrollTrigger.create({ trigger: journey, start: "top top", end: "bottom bottom", onUpdate: function (self) { state.target = self.progress; } });
    state.target = state.p = st.progress || 0;

    var lastScene = scenes[0], visible = true, lastNow = performance.now(), time = 0;
    function frame() {
      var now = performance.now(), dt = Math.min((now - lastNow) / 1000, 0.1);
      lastNow = now; time += dt;
      if (!visible) return;
      state.p += (state.target - state.p) * (1 - Math.exp(-dt * 8));
      if (Math.abs(state.target - state.p) < 1e-5) state.p = state.target;
      var p = state.p;
      var active = updateScenes(p);
      if (active.scene) lastScene = active.scene; else active.scene = lastScene; // between two scenes the last one keeps the bars
      stage.style.setProperty("--p", p.toFixed(4));
      hud.fill.style.transform = "scaleX(" + p.toFixed(4) + ")";
      var ch = active.scene ? active.scene.ch : hud.ch, lang = root.dataset.lang;
      if (ch !== hud.ch || lang !== hud.lang) {
        hud.ch = ch; hud.lang = lang;
        if (CH[ch]) { hud.num.textContent = CH[ch][0]; hud.label.textContent = CH[ch][lang === "en" ? 2 : 1]; }
      }
      draw(time, dt, active);
    }

    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }).observe(journey);
    resize();
    window.addEventListener("resize", function () { resize(); ScrollTrigger.refresh(); });
    gsap.ticker.add(frame);
    frame();

    // ---------------------------------------------------------------- the long page
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    [].forEach.call(document.querySelectorAll("[data-reveal]"), function (el) { io.observe(el); });
    // screenshots drift a little slower than the text beside them
    if (window.matchMedia("(min-width: 900px)").matches) {
      [].forEach.call(document.querySelectorAll(".fn__shot"), function (el) {
        gsap.fromTo(el, { y: 50 }, { y: -50, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true } });
      });
    }
    // test hook: ?p=0.4 jumps to that progress
    var qp = parseFloat(new URLSearchParams(location.search).get("p"));
    if (!isNaN(qp)) {
      var go = function () { window.scrollTo(0, journey.offsetTop + qp * (journey.offsetHeight - window.innerHeight)); state.target = state.p = qp; };
      go(); window.addEventListener("load", go);
    }
  }
})();
