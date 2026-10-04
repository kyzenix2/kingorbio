/* Cozy block meadow. Contract address stays TBA. */
(function () {
  "use strict";
  if (!window.THREE) {
    var note = document.getElementById("loadnote");
    if (note) note.textContent = "The 3D engine did not load.";
    return;
  }

  var THREE = window.THREE;
  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var WATER = 1.15;
  var SAVE_KEY = "orbtopia-meadow-save";

  var HOTBAR = [
    { id: "grass", name: "Grass", key: "1", hot: true, top: "#86d464", side: "#8d5a32", bottom: "#6d4328" },
    { id: "soil", name: "Soil", key: "2", hot: true, top: "#a56b43", side: "#8d5a32", bottom: "#6d4328" },
    { id: "cobble", name: "Cobblestone", key: "3", hot: true, color: "#b7b1a8" },
    { id: "sand", name: "Sand", key: "4", hot: true, color: "#f0d7a4" },
    { id: "plank", name: "Wood Planks", key: "5", hot: true, color: "#e0b271" },
    { id: "log", name: "Log", key: "6", hot: true, fold: true, top: "#c8965f", side: "#6d4328" },
    { id: "brick", name: "Brick", key: "7", hot: true, fold: true, color: "#d07a62" },
    { id: "glass", name: "Glass", key: "8", hot: true, fold: true, color: "#d7f4ff", glass: true },
    { id: "roof", name: "Roof Tile", key: "9", hot: true, fold: true, color: "#d4533c" },
    { id: "leaf", name: "Leafy Block", key: "0", hot: true, fold: true, color: "#63b84a" },
    { id: "flower", name: "Flower Bed", key: "-", hot: true, fold: true, color: "#f48fb8" },
    { id: "lantern", name: "Lantern", key: "=", hot: true, fold: true, color: "#ffd56a", glow: true },
    { id: "snow", name: "Snow", key: "", hot: true, fold: true, color: "#f4fbff" },
    { id: "ice", name: "Ice", key: "", hot: true, fold: true, color: "#d5f1ff", glass: true }
  ];
  var EXTRAS = [
    { id: "path", name: "Path", top: "#e7c99a", side: "#d2b07a", bottom: "#c4a06a" },
    { id: "stone", name: "Stone", color: "#8d887f" }
  ];
  var DEFS = HOTBAR.concat(EXTRAS);
  var DEF = {};
  DEFS.forEach(function (d) { DEF[d.id] = d; });

  var ISLANDS = [
    { id: "meadow", name: "Sunny Meadow", cx: 0, cz: 0, rx: 18, rz: 15, build: false, biome: "grass" },
    { id: "dune", name: "Dune Isle", cx: 46, cz: 2, rx: 12, rz: 10, build: true, biome: "sand" },
    { id: "frost", name: "Frost Isle", cx: 4, cz: 46, rx: 11, rz: 10, build: true, biome: "snow" },
    { id: "bloom", name: "Bloom Isle", cx: -44, cz: 6, rx: 11, rz: 10, build: true, biome: "bloom" }
  ];

  var state = {
    started: false, sound: true, help: false, confirm: false, talk: false,
    slot: 0, minutes: 9 * 60 + 41, day: 1, preview: 0, moving: false, walk: 0
  };
  var keys = {};
  var yaw = 0.32;
  var pitch = 0.68;
  var dist = 17;
  var cells = new Map();
  var original = new Map();
  var tops = new Map();
  var meshes = {};
  var caps = {};
  var aabbs = [];
  var critters = [];
  var fires = [];
  var undoStack = [];
  var redoStack = [];
  var stickVec = { x: 0, y: 0 };
  var touchHold = false;
  var jumpQueued = false;
  var lastRegion = null;
  var stepAcc = 0;
  var seed = 11;

  var player = { x: 0, y: 6, z: 1.2, vy: 0, onGround: true, facing: Math.PI, mesh: null, legL: null, legR: null };
  var boat = { x: 24.2, z: 0.2, yaw: Math.PI / 2, speed: 0, boarded: false, mesh: null, homeX: 24.2, homeZ: 0.2, homeYaw: Math.PI / 2 };

  var scene, camera, renderer, sun, hemi, skyColor, ghost, water, stars, sunBall, moonBall;
  var gradientMap;
  var audio = { ctx: null, nodes: [], pad: null };
  var pointer = null;
  var clockTick = 0;

  function rnd() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  function setProgress(p) {
    var bar = $("barFill");
    if (bar) bar.style.width = p + "%";
  }
  function toast(msg) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  function speckle(base, spots) {
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var g = c.getContext("2d");
    g.fillStyle = base;
    g.fillRect(0, 0, 64, 64);
    for (var i = 0; i < 36; i++) {
      g.fillStyle = spots[i % spots.length];
      g.beginPath();
      g.arc((i * 17) % 64, (i * 29) % 64, 1 + (i % 3), 0, 6.28);
      g.fill();
    }
    var t = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    return t;
  }

  function makeGradient() {
    var c = document.createElement("canvas");
    c.width = 4;
    c.height = 1;
    var g = c.getContext("2d");
    ["#8d8d8d", "#b5b5b5", "#e6e6e6", "#ffffff"].forEach(function (col, i) {
      g.fillStyle = col;
      g.fillRect(i, 0, 1, 1);
    });
    var t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function toon(hex) {
    return new THREE.MeshToonMaterial({ color: hex, gradientMap: gradientMap });
  }

  var TEX = null;
  function matsFor(def) {
    function lambert(hex, map, glass, glow) {
      var m = new THREE.MeshLambertMaterial({ color: map ? 0xffffff : hex, map: map || null });
      if (glass) { m.transparent = true; m.opacity = 0.42; m.depthWrite = false; }
      if (glow) { m.emissive = new THREE.Color(hex); m.emissiveIntensity = 0.7; }
      return m;
    }
    var topMap = null;
    var sideMap = null;
    var top = lambert(def.top || def.color, topMap, def.glass, def.glow);
    var side = lambert(def.side || def.color, sideMap, def.glass, def.glow);
    var bot = lambert(def.bottom || def.side || def.color, sideMap, def.glass, def.glow);
    return [side, side, top, bot, side, side];
  }

  function islandAt(x, z) {
    var best = null, bestR = 99;
    for (var i = 0; i < ISLANDS.length; i++) {
      var isl = ISLANDS[i];
      var r = Math.hypot((x - isl.cx) / isl.rx, (z - isl.cz) / isl.rz);
      if (r <= 1 && r < bestR) { best = isl; bestR = r; }
    }
    return best;
  }
  function columnHeight(isl, x, z) {
    var r = Math.hypot((x + 0.5 - isl.cx) / isl.rx, (z + 0.5 - isl.cz) / isl.rz);
    if (r >= 1) return 0;
    if (r < 0.62) return 6;
    var e = (1 - r) / 0.38;
    var s = e * e * (3 - 2 * e);
    return Math.max(2, Math.round(2 + s * 4));
  }
  function surfaceOf(isl, h) {
    if (isl.biome === "sand") return "sand";
    if (isl.biome === "snow") return "snow";
    if (h <= 2) return "sand";
    return "grass";
  }
  function recomputeAllTops() {
    tops.clear();
    cells.forEach(function (c) {
      var k = c.x + "," + c.z;
      var prev = tops.get(k);
      if (prev == null || c.y > prev) tops.set(k, c.y);
    });
  }
  function recomputeTop(x, z) {
    var m = -1;
    for (var y = 0; y < 28; y++) if (cells.has(x + "," + y + "," + z)) m = y;
    if (m < 0) tops.delete(x + "," + z);
    else tops.set(x + "," + z, m);
  }
  function groundY(x, z) {
    var top = tops.get(Math.floor(x) + "," + Math.floor(z));
    return top == null ? null : top + 1;
  }

  function generate() {
    ISLANDS.forEach(function (isl) {
      var x0 = Math.floor(isl.cx - isl.rx - 1), x1 = Math.ceil(isl.cx + isl.rx + 1);
      var z0 = Math.floor(isl.cz - isl.rz - 1), z1 = Math.ceil(isl.cz + isl.rz + 1);
      for (var x = x0; x <= x1; x++) {
        for (var z = z0; z <= z1; z++) {
          var h = columnHeight(isl, x, z);
          if (!h) continue;
          for (var y = 0; y < h; y++) {
            var k = x + "," + y + "," + z;
            if (cells.has(k)) continue;
            var type;
            if (y === h - 1) type = surfaceOf(isl, h);
            else if (y <= 0) type = "stone";
            else if (isl.biome === "sand") type = "sand";
            else if (isl.biome === "snow" && y >= h - 3) type = "snow";
            else type = "soil";
            cells.set(k, { x: x, y: y, z: z, type: type });
          }
        }
      }
    });
    recomputeAllTops();
    paintPath([[-5, 0.2], [-1, 0.6], [0.2, 0.4], [1.2, -2], [2, -5], [4, -1], [7, 1.2], [12, 0.4]]);
    carveStairs();
    carveDock();
    recomputeAllTops();
    original.clear();
    cells.forEach(function (c, k) { original.set(k, c.type); });
  }

  function paintPath(points) {
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i], b = points[i + 1];
      var steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 3);
      for (var s = 0; s <= steps; s++) {
        var t = s / steps;
        stamp(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 1.15);
      }
    }
  }
  function stamp(x, z, r) {
    for (var ix = Math.floor(x - r); ix <= Math.ceil(x + r); ix++) {
      for (var iz = Math.floor(z - r); iz <= Math.ceil(z + r); iz++) {
        if (Math.hypot(ix + 0.5 - x, iz + 0.5 - z) > r) continue;
        var y = tops.get(ix + "," + iz);
        if (y == null) continue;
        var c = cells.get(ix + "," + y + "," + iz);
        if (c && c.type === "grass") c.type = "path";
      }
    }
  }
  function carveStairs() {
    for (var x = -1; x <= 1; x++) {
      for (var i = 0; i < 6; i++) {
        var z = 8 + i;
        var h = Math.max(2, 6 - i);
        for (var y = 0; y < 16; y++) if (y >= h) cells.delete(x + "," + y + "," + z);
        for (var y2 = 0; y2 < h; y2++) {
          var k = x + "," + y2 + "," + z;
          if (!cells.has(k)) cells.set(k, { x: x, y: y2, z: z, type: y2 === h - 1 ? "path" : "soil" });
          else if (y2 === h - 1) cells.get(k).type = "path";
        }
      }
    }
  }
  function carveDock() {
    for (var x = 15; x <= 22; x++) {
      for (var z = -1; z <= 1; z++) {
        for (var y = 0; y < 16; y++) cells.delete(x + "," + y + "," + z);
        var h = 3;
        for (var y2 = 0; y2 < h; y2++) {
          cells.set(x + "," + y2 + "," + z, { x: x, y: y2, z: z, type: y2 === h - 1 ? "plank" : "log" });
        }
      }
    }
  }

  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      (data.removed || []).forEach(function (k) { cells.delete(k); });
      (data.placed || []).forEach(function (p) {
        if (!DEF[p[3]]) return;
        cells.set(p[0] + "," + p[1] + "," + p[2], { x: p[0], y: p[1], z: p[2], type: p[3] });
      });
    } catch (e) { /* ignore broken saves */ }
  }
  function persist() {
    var placed = [], removed = [];
    original.forEach(function (type, k) {
      var c = cells.get(k);
      if (!c) removed.push(k);
      else if (c.type !== type) placed.push([c.x, c.y, c.z, c.type]);
    });
    cells.forEach(function (c, k) {
      if (!original.has(k)) placed.push([c.x, c.y, c.z, c.type]);
    });
    localStorage.setItem(SAVE_KEY, JSON.stringify({ placed: placed, removed: removed }));
  }
  var saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 180);
  }

  var BOX = null;
  function makeMeshes() {
    BOX = new THREE.BoxGeometry(1, 1, 1);
    var counts = {};
    cells.forEach(function (c) { counts[c.type] = (counts[c.type] || 0) + 1; });
    DEFS.forEach(function (def) {
      var cap = (counts[def.id] || 0) + (def.hot ? 700 : 40);
      cap = Math.max(1, cap);
      var mesh = new THREE.InstancedMesh(BOX, matsFor(def), cap);
      mesh.count = 0;
      mesh.castShadow = !def.glass;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      if (def.glass) mesh.renderOrder = 2;
      scene.add(mesh);
      meshes[def.id] = mesh;
      caps[def.id] = cap;
    });
  }
  function rebuildAll() {
    var lists = {};
    DEFS.forEach(function (d) { lists[d.id] = []; });
    cells.forEach(function (c) { if (lists[c.type]) lists[c.type].push(c); });
    DEFS.forEach(function (d) { fillMesh(d.id, lists[d.id]); });
  }
  function fillMesh(type, list) {
    var mesh = meshes[type];
    if (!mesh) return;
    var n = Math.min(list.length, caps[type]);
    var m = new THREE.Matrix4();
    var color = new THREE.Color();
    for (var i = 0; i < n; i++) {
      var b = list[i];
      m.makeTranslation(b.x + 0.5, b.y + 0.5, b.z + 0.5);
      mesh.setMatrixAt(i, m);
      var v = 0.94 + ((Math.abs(b.x * 13 + b.y * 7 + b.z * 3) % 10) / 100);
      color.setRGB(v, v, v);
      mesh.setColorAt(i, color);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  function rebuildType(type) {
    var list = [];
    cells.forEach(function (c) { if (c.type === type) list.push(c); });
    fillMesh(type, list);
  }
  function typeCount(type) {
    var n = 0;
    cells.forEach(function (c) { if (c.type === type) n++; });
    return n;
  }
  function writeCell(x, y, z, type, record) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    var k = x + "," + y + "," + z;
    var prev = cells.get(k);
    var before = prev ? prev.type : null;
    if (before === type) return false;
    if (type && typeCount(type) >= caps[type]) { toast("No room for more of those"); return false; }
    if (record) {
      undoStack.push({ x: x, y: y, z: z, before: before, after: type });
      if (undoStack.length > 80) undoStack.shift();
      redoStack.length = 0;
    }
    if (type == null) cells.delete(k);
    else cells.set(k, { x: x, y: y, z: z, type: type });
    recomputeTop(x, z);
    if (before) rebuildType(before);
    if (type && type !== before) rebuildType(type);
    scheduleSave();
    return true;
  }

  function box(parent, w, h, d, x, y, z, mat) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function prism(w, h, d) {
    var shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, h);
    shape.closePath();
    var geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    geo.translate(0, 0, -d / 2);
    return geo;
  }
  function stripeTex() {
    var c = document.createElement("canvas");
    c.width = 64; c.height = 32;
    var g = c.getContext("2d");
    for (var i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? "#e25a48" : "#fffaf4";
      g.fillRect(i * 8, 0, 8, 32);
    }
    var t = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function addTree(x, z, kind) {
    var y = groundY(x, z);
    if (y == null || y < 3.5) return;
    var g = new THREE.Group();
    g.position.set(x, y, z);
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, kind === "palm" ? 2.2 : 1.15, 7), toon(kind === "palm" ? 0xc8965f : 0x8d5a32));
    trunk.position.y = kind === "palm" ? 1.1 : 0.55;
    trunk.castShadow = true;
    g.add(trunk);
    if (kind === "pine") {
      var c1 = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.5, 8), toon(0x2f7a45));
      c1.position.y = 1.7; g.add(c1);
      var c2 = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.1, 8), toon(0x3e9454));
      c2.position.y = 2.55; g.add(c2);
      var cap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), toon(0xf7fbff));
      cap.position.y = 3.05; g.add(cap);
    } else if (kind === "bloom") {
      [[0, 1.55, 0, 0.78, 0xf7b7d0], [-0.35, 1.35, 0.1, 0.58, 0xff8eb8], [0.32, 1.4, -0.08, 0.62, 0xffd0e0]].forEach(function (p) {
        var s = new THREE.Mesh(new THREE.SphereGeometry(p[3], 12, 10), toon(p[4]));
        s.position.set(p[0], p[1], p[2]); s.castShadow = true; g.add(s);
      });
    } else if (kind === "palm") {
      for (var i = 0; i < 5; i++) {
        var leaf = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), toon(0x4ea24a));
        var a = i / 5 * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 0.45, 2.35, Math.sin(a) * 0.45);
        leaf.scale.set(1.15, 0.4, 0.7);
        g.add(leaf);
      }
    } else {
      [[0, 1.55, 0, 0.92, 0x67bf49], [-0.48, 1.32, 0.12, 0.7, 0x8ed86a], [0.42, 1.38, -0.1, 0.74, 0x4ea24a]].forEach(function (p) {
        var s2 = new THREE.Mesh(new THREE.SphereGeometry(p[3], 14, 10), toon(p[4]));
        s2.position.set(p[0], p[1], p[2]); s2.castShadow = true; g.add(s2);
      });
    }
    scene.add(g);
  }

  function cottage(x, z) {
    var y = groundY(x, z);
    if (y == null) return;
    var g = new THREE.Group();
    g.position.set(x, y, z);
    var wall = toon(0xf6e6cc), timber = toon(0x7a4e32), roofM = toon(0xd24b3a);
    box(g, 5.6, 0.16, 4.6, 0, 0.08, 0.7, toon(0xc8965f));
    box(g, 4.4, 2.45, 3.3, 0, 1.32, -0.15, wall);
    [[-2.05, -1.65], [2.05, -1.65], [-2.05, 1.35], [2.05, 1.35]].forEach(function (p) {
      box(g, 0.18, 2.5, 0.18, p[0], 1.32, p[1], timber);
    });
    var roof = new THREE.Mesh(prism(5.1, 1.45, 4.0), roofM);
    roof.position.set(0, 2.5, -0.15);
    roof.castShadow = true;
    g.add(roof);
    box(g, 0.86, 1.35, 0.1, 0, 0.74, 1.52, toon(0x8fd0ea));
    box(g, 0.7, 0.62, 0.08, -1.25, 1.5, 1.52, toon(0xc9ecff));
    box(g, 0.7, 0.62, 0.08, 1.25, 1.5, 1.52, toon(0xc9ecff));
    box(g, 0.38, 0.7, 0.38, 1.55, 3.2, -0.7, timber);
    box(g, 0.28, 0.7, 0.08, -2.5, 0.55, 1.7, toon(0x4f8fd0));
    scene.add(g);
    aabbs.push({ minX: x - 2.2, maxX: x + 2.2, minY: y + 0.3, maxY: y + 3.8, minZ: z - 1.8, maxZ: z + 1.2 });
  }

  function shack(x, z) {
    var y = groundY(x, z);
    if (y == null) return;
    var g = new THREE.Group();
    g.position.set(x, y, z);
    box(g, 3.2, 1.7, 2.6, 0, 0.95, 0, toon(0xf3e7cf));
    var roof = new THREE.Mesh(prism(3.6, 1.05, 3.0), toon(0x3aa8c4));
    roof.position.set(0, 1.75, 0);
    roof.castShadow = true;
    g.add(roof);
    scene.add(g);
    aabbs.push({ minX: x - 1.6, maxX: x + 1.6, minY: y + 0.2, maxY: y + 2.6, minZ: z - 1.3, maxZ: z + 1.3 });
  }

  function stall(x, z) {
    var y = groundY(x, z);
    if (y == null) return;
    var g = new THREE.Group();
    g.position.set(x, y, z);
    [[-1.25, -0.65], [1.25, -0.65], [-1.25, 0.65], [1.25, 0.65]].forEach(function (p) {
      box(g, 0.12, 1.85, 0.12, p[0], 0.92, p[1], toon(0x7a4e32));
    });
    box(g, 2.5, 0.12, 1.15, 0, 0.82, 0, toon(0xd7b07a));
    var awning = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.08, 1.7), new THREE.MeshToonMaterial({ map: stripeTex(), gradientMap: gradientMap }));
    awning.position.set(0, 1.82, 0);
    awning.castShadow = true;
    g.add(awning);
    box(g, 0.42, 0.42, 0.42, -1.55, 0.28, 0.95, toon(0x8d5a32));
    box(g, 0.36, 0.5, 0.36, 1.5, 0.32, 1.0, toon(0xc47a4a));
    scene.add(g);
    aabbs.push({ minX: x - 1.3, maxX: x + 1.3, minY: y + 0.75, maxY: y + 1.15, minZ: z - 0.6, maxZ: z + 0.6 });
  }

  function campfire(x, z) {
    var y = groundY(x, z);
    if (y == null) return;
    var g = new THREE.Group();
    g.position.set(x, y, z);
    for (var i = 0; i < 7; i++) {
      var a = i / 7 * Math.PI * 2;
      var s = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), toon(0x9a9188));
      s.position.set(Math.cos(a) * 0.5, 0.1, Math.sin(a) * 0.5);
      g.add(s);
    }
    var flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 6), new THREE.MeshBasicMaterial({ color: 0xffb14a, transparent: true, opacity: 0.9 }));
    flame.position.y = 0.42;
    g.add(flame);
    scene.add(g);
    var light = new THREE.PointLight(0xff9944, 0.7, 7);
    light.position.set(x, y + 0.7, z);
    scene.add(light);
    fires.push({ flame: flame, light: light });
  }

  function bench(x, z, rot) {
    var y = groundY(x, z);
    if (y == null) return;
    var g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rot || 0;
    box(g, 1.25, 0.1, 0.4, 0, 0.4, 0, toon(0xc8965f));
    box(g, 1.25, 0.38, 0.08, 0, 0.62, -0.16, toon(0xb5834e));
    scene.add(g);
  }
  function lamp(x, z) {
    var y = groundY(x, z);
    if (y == null) return;
    var g = new THREE.Group();
    g.position.set(x, y, z);
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.55, 6), toon(0x6b4a32));
    post.position.y = 0.78;
    post.castShadow = true;
    g.add(post);
    var glow = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.32, 0.26), new THREE.MeshToonMaterial({ color: 0xffe08a, emissive: 0xffc14a, emissiveIntensity: 0.8, gradientMap: gradientMap }));
    glow.position.y = 1.62;
    g.add(glow);
    scene.add(g);
  }
  function scatterFlowers(cx, cz, n) {
    var colors = [0xff8eb8, 0xffd34d, 0xfffaf0, 0xc9a6ff];
    for (var i = 0; i < n; i++) {
      var x = cx + (rnd() - 0.5) * 16;
      var z = cz + (rnd() - 0.5) * 12;
      var ix = Math.floor(x), iz = Math.floor(z);
      var yTop = tops.get(ix + "," + iz);
      if (yTop == null) continue;
      var cell = cells.get(ix + "," + yTop + "," + iz);
      if (!cell || cell.type !== "grass") continue;
      var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 4), toon(0x4ea24a));
      stem.position.set(x, yTop + 1 + 0.08, z);
      scene.add(stem);
      var bloom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), toon(colors[i % 4]));
      bloom.position.set(x, yTop + 1 + 0.18, z);
      scene.add(bloom);
    }
  }

  function dress() {
    seed = 11;
    cottage(-7.2, 0.4);
    stall(2.4, -6.4);
    shack(8.2, 6.4);
    campfire(6.2, 2.2);
    bench(7.4, 1.2, 0.4);
    bench(5.2, -4.6, -0.6);
    lamp(-2.2, -1.2);
    lamp(4.6, -2.2);
    lamp(11.5, 0.4);
    [[-12, -4], [-10, 5], [-4, -10], [7, -11], [12, -6], [13, 4], [-14, 1], [0, -12], [-6, 7]].forEach(function (p) { addTree(p[0], p[1], "puff"); });
    for (var i = 0; i < 3; i++) addTree(46 + (rnd() - 0.5) * 6, 2 + (rnd() - 0.5) * 5, "palm");
    for (var j = 0; j < 4; j++) addTree(4 + (rnd() - 0.5) * 6, 46 + (rnd() - 0.5) * 5, "pine");
    for (var k = 0; k < 4; k++) addTree(-44 + (rnd() - 0.5) * 6, 6 + (rnd() - 0.5) * 5, "bloom");
    scatterFlowers(0, 0, 40);
    scatterFlowers(-44, 6, 24);
    makeBoat();
  }

  function makeBoat() {
    var g = new THREE.Group();
    var hull = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.38, 2.3), toon(0xc8965f));
    hull.position.y = 0.2;
    g.add(hull);
    box(g, 0.9, 0.28, 1.5, 0, 0.42, -0.1, toon(0xf4e7cf));
    var sail = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.15), toon(0xfffaf4));
    sail.position.set(0, 1.15, -0.15);
    g.add(sail);
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), toon(0x7a4e32));
    mast.position.set(0, 1.05, -0.15);
    g.add(mast);
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    boat.mesh = g;
  }

  var eyeMat, whiteMat;
  function addEyes(g, y, z, s) {
    var L = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), eyeMat);
    L.scale.setScalar(s);
    L.position.set(-0.07, y, z);
    var R = L.clone();
    R.position.x = 0.07;
    g.add(L); g.add(R);
  }
  function makePlayer() {
    var g = new THREE.Group();
    var fur = toon(0x49c4c6), belly = toon(0xf4fffb);
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), fur);
    body.scale.set(1, 1.05, 0.9);
    body.position.y = 0.62;
    body.castShadow = true;
    g.add(body);
    var tum = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), belly);
    tum.position.set(0, 0.55, 0.16);
    g.add(tum);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), fur);
    head.position.y = 1.12;
    head.castShadow = true;
    g.add(head);
    var earL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), fur);
    earL.position.set(-0.18, 1.34, 0);
    var earR = earL.clone(); earR.position.x = 0.18;
    g.add(earL); g.add(earR);
    addEyes(g, 1.14, 0.22, 0.045);
    var feather = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.28, 5), toon(0xfffaf4));
    feather.position.set(0.12, 1.38, -0.08);
    feather.rotation.z = -0.6;
    g.add(feather);
    var pack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.16), toon(0xe0b56a));
    pack.position.set(0, 0.7, -0.28);
    g.add(pack);
    function leg(side) {
      var l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), fur);
      l.scale.set(1, 1.3, 1);
      l.position.set(side * 0.12, 0.16, 0);
      g.add(l);
      return l;
    }
    player.legL = leg(-1);
    player.legR = leg(1);
    var blob = new THREE.Mesh(new THREE.CircleGeometry(0.38, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.04;
    g.add(blob);
    scene.add(g);
    player.mesh = g;
    var gy = groundY(player.x, player.z);
    if (gy != null) player.y = gy;
  }

  function makeMochi(tint) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 10), toon(0xfffaf4));
    body.position.y = 0.36;
    body.castShadow = true;
    g.add(body);
    var bottom = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), toon(tint || 0x8edc8a));
    bottom.scale.y = 0.55;
    bottom.position.y = 0.18;
    g.add(bottom);
    addEyes(g, 0.42, 0.28, 0.04);
    return g;
  }
  function makeSheep() {
    var g = new THREE.Group();
    var wool = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 10), toon(0xfffaf8));
    wool.scale.set(1, 0.8, 1.15);
    wool.position.y = 0.48;
    wool.castShadow = true;
    g.add(wool);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), toon(0xf7f4f2));
    head.position.set(0, 0.62, 0.38);
    g.add(head);
    addEyes(g, 0.58, 0.56, 0.035);
    return g;
  }
  function makeFrog() {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), toon(0x5ec8e8));
    body.scale.set(1.1, 0.7, 1);
    body.position.y = 0.18;
    g.add(body);
    addEyes(g, 0.32, 0.16, 0.05);
    return g;
  }
  function makePerson(opt) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), toon(opt.body));
    body.scale.set(1, 1.15, 0.85);
    body.position.y = 0.55;
    body.castShadow = true;
    g.add(body);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), toon(opt.skin || 0xf3d2b5));
    head.position.y = 1.05;
    g.add(head);
    addEyes(g, 1.08, 0.16, 0.035);
    if (opt.hat) {
      var brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 12), toon(opt.hat));
      brim.position.y = 1.24;
      g.add(brim);
      var crown = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.18, 10), toon(opt.hat));
      crown.position.y = 1.34;
      g.add(crown);
    }
    return g;
  }

  function spawnCritter(kind, x, z, name, lines) {
    var y = groundY(x, z);
    if (y == null) y = WATER;
    var mesh = kind === "sheep" ? makeSheep() : kind === "frog" ? makeFrog() : kind === "mira" ? makePerson({ body: 0xf7b7c8, skin: 0xf3d2b5 }) : kind === "gus" ? makePerson({ body: 0x3d5f8a, hat: 0xf4f0e6, skin: 0xe7c2a4 }) : makeMochi(kind === "mochi" ? 0x9be7a0 : 0xf7b7d0);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    var c = { kind: kind, name: name, x: x, z: z, y: y, homeX: x, homeZ: z, mesh: mesh, tx: x, tz: z, wait: 1 + rnd() * 2, hop: 0, face: 0, phase: rnd() * 6, lines: lines || null, wander: !lines };
    critters.push(c);
    return c;
  }
  function spawnFolks() {
    spawnCritter("mochi", 1.6, -0.4, "Mochi");
    spawnCritter("mochi", 2.5, -1.6, "Bun");
    spawnCritter("sheep", 6.8, -0.6, "Wool");
    spawnCritter("frog", 1.2, 10.2, "Pebble");
    spawnCritter("mira", 2.2, -4.6, "Mira", [
      "Morning. The berries are sweet and the sheep are full of opinions.",
      "Sunny Meadow stays just as it is. Dune, Frost, and Bloom are yours to build on.",
      "If you sail, Captain Gus keeps the boats at the east dock."
    ]);
    spawnCritter("gus", 13.2, 1.4, "Captain Gus", [
      "Wind's fair. Press B when you're beside the skiff.",
      "W and S for the throttle, A and D to steer. Shift if you're in a hurry.",
      "The outer isles take new blocks kindly. This meadow does not."
    ]);
  }

  function setupThree() {
    var canvas = $("game");
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    scene = new THREE.Scene();
    skyColor = new THREE.Color(0xb7e4fb);
    scene.background = skyColor;
    scene.fog = new THREE.Fog(0xb7e4fb, 28, 95);
    camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 380);
    hemi = new THREE.HemisphereLight(0xd7f3ff, 0xc6e6a4, 0.95);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff4dd, 1.15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -22;
    sun.shadow.camera.right = sun.shadow.camera.top = 22;
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    scene.add(sun.target);
    gradientMap = makeGradient();
    eyeMat = new THREE.MeshBasicMaterial({ color: 0x2b2422 });
    whiteMat = new THREE.MeshBasicMaterial({ color: 0xfffaf4 });
    TEX = {
      grass: speckle("#7dce62", ["#68b850", "#9be07a", "#e7f8c4"]),
      dirt: speckle("#8d5a32", ["#6d4328", "#a56b43", "#c48a5a"]),
      sand: speckle("#f0d7a4", ["#e7c98a", "#f8e7c8"]),
      snow: speckle("#f7fbff", ["#e4eef8", "#ffffff"]),
      path: speckle("#e6c99a", ["#d7b888", "#f3e0c0"])
    };
    var sea = new THREE.Mesh(new THREE.CircleGeometry(180, 48), new THREE.MeshStandardMaterial({ color: 0x7ec8ea, transparent: true, opacity: 0.88, roughness: 0.18 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = WATER;
    scene.add(sea);
    water = sea;
    var bed = new THREE.Mesh(new THREE.CircleGeometry(180, 32), new THREE.MeshLambertMaterial({ color: 0xe7d2a4 }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = 0.35;
    bed.receiveShadow = true;
    scene.add(bed);
    sunBall = new THREE.Mesh(new THREE.SphereGeometry(4.2, 18, 12), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
    moonBall = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf4f7ff }));
    scene.add(sunBall); scene.add(moonBall);
    ghost = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), new THREE.MeshBasicMaterial({ color: 0xb6f5a0, transparent: true, opacity: 0.35, depthWrite: false }));
    ghost.visible = false;
    scene.add(ghost);
    var positions = new Float32Array(160 * 3);
    for (var i = 0; i < 160; i++) {
      var r = 80 + Math.random() * 30;
      var th = Math.random() * 6.28;
      var ph = 0.25 + Math.random() * 0.9;
      positions[i * 3] = Math.cos(th) * Math.cos(ph) * r;
      positions[i * 3 + 1] = Math.sin(ph) * r;
      positions[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * r;
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, transparent: true, opacity: 0 }));
    scene.add(stars);
    window.addEventListener("resize", resize);
  }
  function resize() {
    if (!renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  function cellSolid(x, y, z) {
    if (cells.has(Math.floor(x) + "," + Math.floor(y) + "," + Math.floor(z))) return true;
    for (var i = 0; i < aabbs.length; i++) {
      var c = aabbs[i];
      if (x >= c.minX && x <= c.maxX && y >= c.minY && y <= c.maxY && z >= c.minZ && z <= c.maxZ) return true;
    }
    return false;
  }
  function bodyBlocked(x, y, z) {
    var r = 0.26;
    var dys = [0.4, 0.9, 1.25];
    var offs = [[r, 0], [-r, 0], [0, r], [0, -r]];
    for (var i = 0; i < dys.length; i++) {
      for (var j = 0; j < offs.length; j++) {
        if (cellSolid(x + offs[j][0], y + dys[i], z + offs[j][1])) return true;
      }
    }
    return false;
  }
  function standY(x, z, y) {
    var best = null;
    var r = 0.22;
    var pts = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
    for (var i = 0; i < pts.length; i++) {
      var top = tops.get(Math.floor(x + pts[i][0]) + "," + Math.floor(z + pts[i][1]));
      if (top == null) continue;
      var surface = top + 1;
      if (surface <= y + 0.45 && (best == null || surface > best)) best = surface;
    }
    for (var a = 0; a < aabbs.length; a++) {
      var c = aabbs[a];
      if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && c.maxY <= y + 0.45 && (best == null || c.maxY > best)) best = c.maxY;
    }
    return best;
  }
  function tryStep(dx, dz) {
    var nx = player.x + dx, nz = player.z + dz;
    if (!bodyBlocked(nx, player.y, nz)) { player.x = nx; player.z = nz; return; }
    if (!bodyBlocked(nx, player.y, player.z)) { player.x = nx; return; }
    if (!bodyBlocked(player.x, player.y, nz)) { player.z = nz; return; }
    if (player.onGround && !bodyBlocked(nx, player.y + 1, nz)) { player.x = nx; player.z = nz; player.y += 1; }
  }
  function respawn() {
    boat.boarded = false;
    player.x = 0; player.z = 1.2; player.vy = 0;
    player.y = groundY(0, 1.2) || 6;
    toast("The meadow caught you");
  }
  function canSail(x, z) {
    var g = groundY(x, z);
    return g == null || g < WATER + 0.55;
  }
  function moveBoat(dt) {
    if (keys.KeyA || keys.ArrowLeft) boat.yaw += dt * 1.25;
    if (keys.KeyD || keys.ArrowRight) boat.yaw -= dt * 1.25;
    if (stickVec.x) boat.yaw -= stickVec.x * dt * 1.4;
    var throttle = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - stickVec.y;
    var boost = (keys.ShiftLeft || keys.ShiftRight) ? 1.7 : 1;
    boat.speed += (throttle * 7.2 * boost - boat.speed) * Math.min(1, dt * 2);
    var nx = boat.x + Math.sin(boat.yaw) * boat.speed * dt;
    var nz = boat.z + Math.cos(boat.yaw) * boat.speed * dt;
    if (canSail(nx, nz)) { boat.x = nx; boat.z = nz; } else boat.speed *= 0.2;
    player.x = boat.x; player.z = boat.z; player.y = WATER - 0.05; player.vy = 0; player.onGround = true;
  }
  function movePlayer(dt) {
    if (boat.boarded) { moveBoat(dt); return; }
    if (jumpQueued && player.onGround) {
      player.vy = 7.5; player.onGround = false; jumpQueued = false;
      blip(420, 0.08, "square", 0.03);
    }
    var speed = (keys.ShiftLeft || keys.ShiftRight) ? 7.3 : 4.25;
    var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    var rx = Math.cos(yaw), rz = -Math.sin(yaw);
    var ix = 0, iz = 0;
    if (keys.KeyW || keys.ArrowUp) { ix += fx; iz += fz; }
    if (keys.KeyS || keys.ArrowDown) { ix -= fx; iz -= fz; }
    if (keys.KeyD || keys.ArrowRight) { ix += rx; iz += rz; }
    if (keys.KeyA || keys.ArrowLeft) { ix -= rx; iz -= rz; }
    ix += rx * stickVec.x + fx * -stickVec.y;
    iz += rz * stickVec.x + fz * -stickVec.y;
    var len = Math.hypot(ix, iz);
    var swimming = standY(player.x, player.z, player.y + 0.2) == null && player.y < WATER + 0.45;
    if (len > 0.01) {
      tryStep(ix / len * (swimming ? speed * 0.55 : speed) * dt, iz / len * (swimming ? speed * 0.55 : speed) * dt);
      player.facing = Math.atan2(ix, iz);
      state.moving = true;
    } else state.moving = false;
    if (swimming) {
      player.vy = 0; player.onGround = false;
      player.y += (WATER - 0.45 - player.y) * Math.min(1, dt * 4);
      if (keys.Space || touchHold) player.y += dt * 2.4;
      if (player.y < -2) respawn();
      return;
    }
    var glide = (keys.Space || touchHold) && player.vy < 0 && !player.onGround;
    player.vy -= (glide ? 6 : 28) * dt;
    if (glide) player.vy = Math.max(player.vy, -2.3);
    var ny = player.y + player.vy * dt;
    if (player.vy <= 0) {
      var s = standY(player.x, player.z, player.y);
      if (s != null && ny <= s && player.y + 0.02 >= s - 0.5) {
        player.y = s; player.vy = 0; player.onGround = true;
      } else { player.y = ny; player.onGround = false; }
    } else if (bodyBlocked(player.x, ny, player.z)) player.vy = 0;
    else { player.y = ny; player.onGround = false; }
    if (player.y < -2) respawn();
  }

  function raycast(maxDist) {
    var o = camera.position;
    var d = new THREE.Vector3();
    camera.getWorldDirection(d);
    var x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    var stepX = d.x < 0 ? -1 : 1, stepY = d.y < 0 ? -1 : 1, stepZ = d.z < 0 ? -1 : 1;
    var inf = 1e9;
    var tMaxX = d.x === 0 ? inf : ((stepX > 0 ? x + 1 - o.x : o.x - x) / Math.abs(d.x));
    var tMaxY = d.y === 0 ? inf : ((stepY > 0 ? y + 1 - o.y : o.y - y) / Math.abs(d.y));
    var tMaxZ = d.z === 0 ? inf : ((stepZ > 0 ? z + 1 - o.z : o.z - z) / Math.abs(d.z));
    var tDeltaX = d.x === 0 ? inf : 1 / Math.abs(d.x);
    var tDeltaY = d.y === 0 ? inf : 1 / Math.abs(d.y);
    var tDeltaZ = d.z === 0 ? inf : 1 / Math.abs(d.z);
    var px = x, py = y, pz = z;
    for (var i = 0; i < 48; i++) {
      if (cells.has(x + "," + y + "," + z)) return { x: x, y: y, z: z, px: px, py: py, pz: pz };
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        if (tMaxX > maxDist) return null;
        px = x; py = y; pz = z; x += stepX; tMaxX += tDeltaX;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > maxDist) return null;
        px = x; py = y; pz = z; y += stepY; tMaxY += tDeltaY;
      } else {
        if (tMaxZ > maxDist) return null;
        px = x; py = y; pz = z; z += stepZ; tMaxZ += tDeltaZ;
      }
    }
    return null;
  }
  function canBuild(x, z) {
    var isl = islandAt(x + 0.5, z + 0.5);
    return !!(isl && isl.build);
  }
  function placeBlock() {
    var hit = raycast(8);
    if (!hit) return;
    if (cells.has(hit.px + "," + hit.py + "," + hit.pz)) return;
    if (!canBuild(hit.px, hit.pz)) { toast("The main island stays just as it is"); return; }
    if (player.x > hit.px - 0.3 && player.x < hit.px + 1.3 && player.z > hit.pz - 0.3 && player.z < hit.pz + 1.3 && player.y < hit.py + 1 && player.y + 1.3 > hit.py) return;
    writeCell(hit.px, hit.py, hit.pz, HOTBAR[state.slot].id, true);
    blip(540, 0.06, "triangle", 0.04);
  }
  function breakBlock() {
    var hit = raycast(8);
    if (!hit) return;
    if (!canBuild(hit.x, hit.z)) { toast("The main island stays just as it is"); return; }
    writeCell(hit.x, hit.y, hit.z, null, true);
    blip(180, 0.07, "square", 0.04);
  }
  function copyBlock() {
    var hit = raycast(8);
    if (!hit) return;
    var cell = cells.get(hit.x + "," + hit.y + "," + hit.z);
    if (!cell) return;
    var idx = -1;
    for (var i = 0; i < HOTBAR.length; i++) if (HOTBAR[i].id === cell.type) idx = i;
    if (idx < 0) { toast("That one stays put"); return; }
    selectSlot(idx);
  }
  function updateGhost() {
    if (!state.started || paused() || boat.boarded) { ghost.visible = false; return; }
    var hit = raycast(8);
    if (!hit || cells.has(hit.px + "," + hit.py + "," + hit.pz)) { ghost.visible = false; return; }
    ghost.visible = true;
    ghost.position.set(hit.px + 0.5, hit.py + 0.5, hit.pz + 0.5);
    ghost.material.color.set(canBuild(hit.px, hit.pz) ? 0xb6f5a0 : 0xff9a9a);
  }

  function nearest(maxDist, talkers) {
    var best = null, bestD = maxDist;
    for (var i = 0; i < critters.length; i++) {
      var c = critters[i];
      if (talkers ? !c.lines : !!c.lines) continue;
      var d = Math.hypot(player.x - c.x, player.z - c.z);
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }
  function setPrompt(key, label) {
    $("prompt").hidden = false;
    $("promptKey").textContent = key;
    $("promptLabel").textContent = label;
  }
  function updatePrompt() {
    if (!state.started || paused()) { $("prompt").hidden = true; return; }
    if (boat.boarded) { setPrompt("B", "Hop off"); return; }
    if (Math.hypot(player.x - boat.x, player.z - boat.z) < 2.4) { setPrompt("B", "Board"); return; }
    var npc = nearest(2.5, true);
    if (npc) { setPrompt("T", "Talk to " + npc.name); return; }
    var pet = nearest(2.2, false);
    if (pet) { setPrompt("F", "Pet"); return; }
    $("prompt").hidden = true;
  }
  var talk = null;
  function openTalk(npc) {
    talk = { npc: npc, i: 0 };
    state.talk = true;
    $("talk").hidden = false;
    $("talkName").textContent = npc.name;
    $("talkText").textContent = npc.lines[0];
  }
  function closeTalk() { state.talk = false; talk = null; $("talk").hidden = true; }
  function advanceTalk() {
    if (!talk) return;
    talk.i++;
    if (talk.i >= talk.npc.lines.length) closeTalk();
    else $("talkText").textContent = talk.npc.lines[talk.i];
  }
  function petNearest() {
    var pet = nearest(2.2, false);
    if (!pet) return;
    pet.hop = 0.7;
    blip(680, 0.1, "sine", 0.05);
    blip(880, 0.14, "sine", 0.04);
    var v = new THREE.Vector3(pet.x, pet.y + 1.1, pet.z).project(camera);
    var d = document.createElement("div");
    d.className = "heart";
    d.textContent = "♥";
    d.style.left = (v.x * 0.5 + 0.5) * innerWidth + "px";
    d.style.top = (-v.y * 0.5 + 0.5) * innerHeight + "px";
    d.style.color = "#ff7fa3";
    $("hearts").appendChild(d);
    setTimeout(function () { d.remove(); }, 1000);
    toast(pet.name + " liked that");
  }
  var FRIENDS = ["Pip", "Clover", "Noodle", "Bean", "Pudding", "Sprout"];
  function launchFriend() {
    if (critters.length > 16) { toast("The meadow is full of friends"); return; }
    var name = FRIENDS[critters.length % FRIENDS.length];
    var ang = Math.random() * 6.28;
    var c = spawnCritter("mochi", player.x + Math.cos(ang) * 1.5, player.z + Math.sin(ang) * 1.5, name);
    c.hop = 1;
    toast(name + " dropped in");
  }
  function toggleBoat() {
    if (boat.boarded) {
      boat.boarded = false;
      player.x = boat.x + Math.cos(boat.yaw) * 1.6;
      player.z = boat.z - Math.sin(boat.yaw) * 1.6;
      var g = groundY(player.x, player.z);
      player.y = g == null ? WATER - 0.4 : g;
      player.vy = 0;
      return;
    }
    if (Math.hypot(player.x - boat.x, player.z - boat.z) > 2.4) return;
    boat.boarded = true;
    blip(360, 0.08, "sine", 0.04);
  }

  function paused() { return state.help || state.confirm || state.talk; }
  function setHelp(open) {
    state.help = open;
    $("help").hidden = !open;
    $("scrim").hidden = !open && !state.confirm;
  }
  function openConfirm() {
    state.confirm = true;
    setHelp(false);
    $("confirm").hidden = false;
    $("scrim").hidden = false;
  }
  function closeConfirm() {
    state.confirm = false;
    $("confirm").hidden = true;
    $("scrim").hidden = !state.help;
  }
  function resetWorld() {
    cells.clear();
    original.forEach(function (type, k) {
      var p = k.split(",").map(Number);
      cells.set(k, { x: p[0], y: p[1], z: p[2], type: type });
    });
    recomputeAllTops();
    rebuildAll();
    localStorage.removeItem(SAVE_KEY);
    undoStack.length = 0;
    redoStack.length = 0;
    boat.x = boat.homeX; boat.z = boat.homeZ; boat.yaw = boat.homeYaw; boat.speed = 0;
    if (boat.boarded) respawn();
    closeConfirm();
    toast("The outer islands are fresh again");
  }
  function selectSlot(i) {
    state.slot = (i + HOTBAR.length) % HOTBAR.length;
    var slots = $("hotbar").children;
    for (var n = 0; n < slots.length; n++) slots[n].classList.toggle("sel", n === state.slot);
    var def = HOTBAR[state.slot];
    $("blockLabel").textContent = def.name;
    $("swatch").style.background = def.top || def.color;
  }
  function drawIcon(canvas, def) {
    var ctx = canvas.getContext("2d");
    var top = def.top || def.color, left = def.side || shade(def.color || top, -28), right = def.side ? shade(def.side, 18) : shade(def.color || top, -12);
    var w = canvas.width, cx = w / 2, cy = w / 2 + 8, s = w * 0.26;
    ctx.clearRect(0, 0, w, w);
    ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy - s / 2); ctx.lineTo(cx, cy); ctx.lineTo(cx - s, cy - s / 2); ctx.closePath();
    ctx.fillStyle = top; ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - s, cy - s / 2); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy + s / 2); ctx.closePath();
    ctx.fillStyle = left; ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + s, cy - s / 2); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx + s, cy + s / 2); ctx.closePath();
    ctx.fillStyle = right; ctx.fill();
  }
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
    return "rgb(" + r + "," + g + "," + b + ")";
  }
  function buildHotbar() {
    var bar = $("hotbar");
    HOTBAR.forEach(function (def, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "slot" + (def.fold ? " fold" : "") + (i === 0 ? " sel" : "");
      b.title = def.name;
      b.dataset.slot = String(i);
      var c = document.createElement("canvas");
      c.width = c.height = 128;
      b.appendChild(c);
      var n = document.createElement("span");
      n.className = "n";
      n.textContent = def.key || "";
      b.appendChild(n);
      bar.appendChild(b);
      drawIcon(c, def);
    });
    $("swatch").style.background = HOTBAR[0].top;
  }

  function showBanner(title, sub) {
    $("bannerTitle").textContent = title;
    $("bannerSub").textContent = sub;
    var b = $("banner");
    b.classList.add("show");
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(function () { b.classList.remove("show"); }, 2400);
  }
  function watchRegion() {
    var isl = islandAt(player.x, player.z);
    var name = isl ? isl.name : "Open water";
    var sub = isl ? (isl.build ? "Yours to build" : "Day " + state.day) : "Mind the wind";
    if (name !== lastRegion) {
      lastRegion = name;
      if (state.started) showBanner(name, sub);
    }
  }

  var SKY = [[0, 0x1a2144], [5, 0x24315f], [6.3, 0xf3b48a], [8, 0xb7e4fb], [16, 0x9fd4f8], [18.3, 0xf09a72], [20.2, 0x2c355c], [24, 0x1a2144]];
  function lerpHex(a, b, t) {
    var ar = a >> 16, ag = (a >> 8) & 255, ab = a & 255;
    var br = b >> 16, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }
  function skyAt(h) {
    if (h <= SKY[0][0]) return SKY[0][1];
    for (var i = 1; i < SKY.length; i++) {
      if (h <= SKY[i][0]) {
        var t = (h - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0]);
        return lerpHex(SKY[i - 1][1], SKY[i][1], t);
      }
    }
    return SKY[SKY.length - 1][1];
  }
  function cssHex(n) { return "#" + n.toString(16).padStart(6, "0"); }
  function updateClock(dt) {
    state.minutes += dt * 0.55;
    if (state.minutes >= 1440) { state.minutes -= 1440; state.day++; }
    var hour = (state.minutes / 60) % 24;
    var hh = Math.floor(hour);
    var mm = Math.floor(state.minutes % 60);
    var h12 = hh % 12; if (h12 === 0) h12 = 12;
    $("clock").textContent = h12 + ":" + String(mm).padStart(2, "0");
    $("ampm").textContent = hh < 12 ? "AM" : "PM";
    $("period").textContent = hh >= 5 && hh < 11 ? "Morning" : hh < 17 ? "Afternoon" : hh < 20 ? "Evening" : "Night";
    $("dayLabel").textContent = "Day " + state.day;
    var night = hh < 5 || hh >= 20;
    $("wxLabel").textContent = night ? "Clear" : (hh < 8 || hh >= 17 ? "Soft light" : "Sunny");
    $("wxIcon").classList.toggle("moon", night);
    var elev = Math.sin((hour - 6) / 12 * Math.PI);
    var col = skyAt(hour);
    skyColor.setHex(col);
    scene.fog.color.copy(skyColor);
    hemi.intensity = 0.38 + Math.max(0, elev) * 0.4;
    sun.intensity = 0.15 + Math.max(0, elev) * 1.65;
    var ang = ((hour - 6) / 12) * Math.PI;
    sunBall.visible = elev > -0.05;
    moonBall.visible = elev <= 0.15;
    sunBall.position.set(player.x + Math.cos(ang) * 70, Math.sin(ang) * 48 + 6, player.z - 24);
    moonBall.position.set(player.x - Math.cos(ang) * 70, Math.max(8, -Math.sin(ang) * 40 + 10), player.z - 20);
    stars.position.set(player.x, 0, player.z);
    stars.material.opacity = clamp(-elev, 0, 1);
    $("dialSky").style.background = "linear-gradient(" + cssHex(col) + ", #fff6ea)";
    $("dialStars").style.opacity = String(clamp(-elev * 1.4, 0, 1));
    var a = ((hour - 6) / 13) * Math.PI;
    $("orb").style.left = (50 - Math.cos(a) * 30) + "%";
    $("orb").style.top = (68 - Math.sin(Math.max(0, a) > 0 ? Math.sin(a) : 0) * 40) + "%";
    $("orb").className = night ? "orb moon" : "orb";
    sun.position.set(player.x + 14, player.y + 26, player.z + 8);
    sun.target.position.set(player.x, player.y, player.z);
  }

  function updateCamera() {
    var tx = boat.boarded ? boat.x : player.x;
    var ty = (boat.boarded ? WATER : player.y) + 1.15;
    var tz = boat.boarded ? boat.z : player.z;
    var cp = Math.cos(pitch);
    camera.position.set(tx + Math.sin(yaw) * cp * dist, ty + Math.sin(pitch) * dist, tz + Math.cos(yaw) * cp * dist);
    camera.lookAt(tx, ty, tz);
  }
  function dampAngle(a, b, t) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * Math.min(1, t);
  }
  function updateCritters(dt) {
    var now = performance.now() / 1000;
    for (var i = 0; i < critters.length; i++) {
      var c = critters[i];
      if (c.hop > 0) c.hop = Math.max(0, c.hop - dt);
      if (c.wander) {
        c.wait -= dt;
        if (c.wait <= 0) {
          var a = rnd() * 6.28;
          c.tx = c.homeX + Math.cos(a) * (1 + rnd() * 2.2);
          c.tz = c.homeZ + Math.sin(a) * (1 + rnd() * 2.2);
          c.wait = 2 + rnd() * 3;
        }
        var dx = c.tx - c.x, dz = c.tz - c.z, len = Math.hypot(dx, dz);
        if (len > 0.08) {
          var nx = c.x + dx / len * 0.7 * dt;
          var nz = c.z + dz / len * 0.7 * dt;
          var gy = groundY(nx, nz);
          var isl = islandAt(nx, nz);
          if (gy != null && isl && isl.id === "meadow" && gy > 3) { c.x = nx; c.z = nz; c.face = Math.atan2(dx, dz); }
        }
      }
      var gy2 = groundY(c.x, c.z);
      c.y = gy2 == null ? WATER - 0.2 : gy2;
      var bob = Math.abs(Math.sin(now * 3 + c.phase)) * 0.04;
      var hop = c.hop > 0 ? Math.sin((0.7 - c.hop) * 14) * 0.18 : 0;
      c.mesh.position.set(c.x, c.y + bob + hop, c.z);
      c.mesh.rotation.y = c.face;
    }
  }

  function ac() {
    if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.ctx.state === "suspended") audio.ctx.resume();
    return audio.ctx;
  }
  function blip(freq, dur, type, gain) {
    if (!state.sound || !state.started) return;
    try {
      var ctx = ac();
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.04, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur);
    } catch (e) { /* audio optional */ }
  }
  function startAmbient() {
    if (!state.sound || audio.pad) return;
    try {
      var ctx = ac();
      var g = ctx.createGain();
      g.gain.value = 0.012;
      g.connect(ctx.destination);
      [262, 330, 392].forEach(function (f) {
        var o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        o.connect(g);
        o.start();
        audio.nodes.push(o);
      });
      audio.pad = g;
    } catch (e) { /* ignore */ }
  }
  function stopAmbient() {
    audio.nodes.forEach(function (o) { try { o.stop(); } catch (e) {} });
    audio.nodes = [];
    audio.pad = null;
  }
  function refreshSound() {
    $("soundBtn").classList.toggle("muted", !state.sound);
    $("soundOn").hidden = !state.sound;
    $("soundOff").hidden = state.sound;
  }
  function toggleSound() {
    state.sound = !state.sound;
    refreshSound();
    if (state.sound) startAmbient(); else stopAmbient();
  }
  function takePhoto() {
    var url = renderer.domElement.toDataURL("image/jpeg", 0.85);
    $("polaroidImg").src = url;
    $("polaroid").hidden = false;
    clearTimeout(takePhoto._t);
    takePhoto._t = setTimeout(function () { $("polaroid").hidden = true; }, 2600);
    toast("Photo saved");
    var flash = document.createElement("div");
    flash.style.cssText = "position:fixed;inset:0;background:#fff;opacity:.85;z-index:28;pointer-events:none;transition:opacity .45s";
    document.body.appendChild(flash);
    requestAnimationFrame(function () { flash.style.opacity = "0"; });
    setTimeout(function () { flash.remove(); }, 500);
  }

  function refreshHotbar() {
    var isl = islandAt(player.x, player.z);
    var build = !!(isl && isl.build);
    var bar = $("hotbar");
    if (build) bar.classList.remove("compact");
    else if (!bar.matches(":hover")) bar.classList.add("compact");
    $("reticle").classList.toggle("show", state.started && !paused());
    $("reticle").classList.toggle("build", build);
  }

  var SLOT_KEYS = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9, Minus: 10, Equal: 11 };
  function onKeyDown(e) {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown" || e.code === "Backspace") e.preventDefault();
    if (!state.started) {
      if ($("splash").classList.contains("ready")) startGame();
      return;
    }
    if (e.code === "Escape") {
      if (state.talk) closeTalk();
      else if (state.confirm) closeConfirm();
      else if (state.help) setHelp(false);
      else if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    if (state.confirm) { if (e.code === "Enter") resetWorld(); return; }
    if (state.talk) { if (e.code === "Space" || e.code === "Enter") advanceTalk(); return; }
    if (state.help) { if (e.code === "KeyH") setHelp(false); return; }
    if (e.repeat) { keys[e.code] = true; return; }
    keys[e.code] = true;
    if (SLOT_KEYS[e.code] != null && SLOT_KEYS[e.code] < HOTBAR.length) selectSlot(SLOT_KEYS[e.code]);
    if (e.code === "BracketLeft") selectSlot(state.slot - 1);
    if (e.code === "BracketRight") selectSlot(state.slot + 1);
    if (e.code === "KeyH") setHelp(true);
    if (e.code === "KeyF") petNearest();
    if (e.code === "KeyT") { var n = nearest(2.5, true); if (n) openTalk(n); }
    if (e.code === "KeyB") toggleBoat();
    if (e.code === "KeyG") launchFriend();
    if (e.code === "KeyP") takePhoto();
    if (e.code === "KeyM") toggleSound();
    if (e.code === "KeyL") $("game").requestPointerLock();
    if (e.code === "KeyQ") {} 
    if (e.code === "Space" && player.onGround && !boat.boarded) { player.vy = 7.5; player.onGround = false; blip(420, 0.08, "square", 0.03); }
    if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    if ((e.code === "Delete" || e.code === "Backspace") && e.shiftKey) openConfirm();
  }
  function undo() {
    var a = undoStack.pop();
    if (!a) return;
    writeCell(a.x, a.y, a.z, a.before, false);
    redoStack.push(a);
  }
  function redo() {
    var a = redoStack.pop();
    if (!a) return;
    writeCell(a.x, a.y, a.z, a.after, false);
    undoStack.push(a);
  }
  function onKeyUp(e) { keys[e.code] = false; }

  function bindInput() {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    var canvas = $("game");
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    canvas.addEventListener("wheel", function (e) {
      if (!state.started) return;
      e.preventDefault();
      dist = clamp(dist + Math.sign(e.deltaY) * 0.7, 7, 26);
    }, { passive: false });
    canvas.addEventListener("pointerdown", function (e) {
      if (!state.started || paused()) return;
      pointer = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, btn: e.button };
    });
    window.addEventListener("pointermove", function (e) {
      var locked = document.pointerLockElement === canvas;
      if (!pointer && !locked) return;
      var dx = locked ? e.movementX : (pointer ? e.clientX - pointer.x : 0);
      var dy = locked ? e.movementY : (pointer ? e.clientY - pointer.y : 0);
      if (pointer && !locked) {
        if (Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 4) pointer.moved = true;
        if (!pointer.moved) return;
        pointer.x = e.clientX; pointer.y = e.clientY;
      }
      if (!state.started || paused()) return;
      yaw -= dx * 0.005;
      pitch = clamp(pitch + dy * 0.0032, 0.38, 1.15);
    });
    window.addEventListener("pointerup", function () {
      if (!pointer) return;
      var click = !pointer.moved, btn = pointer.btn;
      pointer = null;
      if (!click || !state.started || paused()) return;
      if (btn === 0) placeBlock();
      else if (btn === 2) breakBlock();
      else if (btn === 1) copyBlock();
    });
    $("hud").addEventListener("click", function (e) {
      var slot = e.target.closest(".slot");
      if (slot) { selectSlot(Number(slot.dataset.slot)); return; }
      var b = e.target.closest("[data-a]");
      if (!b) return;
      var a = b.dataset.a;
      if (a === "help") setHelp(!state.help);
      else if (a === "sound") toggleSound();
      else if (a === "photo") takePhoto();
      else if (a === "launch") launchFriend();
      else if (a === "keep") closeConfirm();
      else if (a === "reset") resetWorld();
    });
    $("scrim").addEventListener("click", function () { setHelp(false); closeConfirm(); });
    $("talk").addEventListener("click", advanceTalk);
    $("hotbar").addEventListener("mouseenter", function () { $("hotbar").classList.remove("compact"); });
    $("hotbar").addEventListener("mouseleave", function () { refreshHotbar(); });
    $("begin").addEventListener("click", function (e) { e.stopPropagation(); startGame(); });
    var stick = $("stick"), thumb = $("thumb"), sid = null;
    function moveStick(e) {
      var r = stick.getBoundingClientRect();
      var x = e.clientX - (r.left + r.width / 2);
      var y = e.clientY - (r.top + r.height / 2);
      var max = 36, l = Math.hypot(x, y) || 1;
      if (l > max) { x *= max / l; y *= max / l; }
      thumb.style.left = (36 + x) + "px";
      thumb.style.top = (36 + y) + "px";
      stickVec.x = x / max; stickVec.y = y / max;
    }
    stick.addEventListener("pointerdown", function (e) { sid = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
    stick.addEventListener("pointermove", function (e) { if (e.pointerId === sid) moveStick(e); });
    function endStick() { sid = null; stickVec.x = 0; stickVec.y = 0; thumb.style.left = "36px"; thumb.style.top = "36px"; }
    stick.addEventListener("pointerup", endStick);
    stick.addEventListener("pointercancel", endStick);
    $("jumpBtn").addEventListener("pointerdown", function (e) { e.preventDefault(); touchHold = true; jumpQueued = true; });
    $("jumpBtn").addEventListener("pointerup", function () { touchHold = false; });
  }

  function startGame() {
    if (state.started) return;
    state.started = true;
    $("splash").classList.add("hide");
    $("begin").hidden = true;
    $("hud").hidden = false;
    if (document.activeElement) document.activeElement.blur();
    lastRegion = null;
    watchRegion();
    if (state.sound) startAmbient();
  }
  function showReady() {
    setProgress(100);
    $("splash").classList.add("ready");
    $("begin").hidden = false;
  }

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.started) {
      state.preview += dt;
      yaw = 0.32 + Math.sin(state.preview * 0.22) * 0.22;
    } else if (!paused()) {
      if (keys.KeyQ) yaw += dt * 1.35;
      if (keys.KeyE) yaw -= dt * 1.35;
      movePlayer(dt);
      if (state.moving && player.onGround && !boat.boarded) {
        stepAcc += dt;
        if (stepAcc > 0.36) { stepAcc = 0; blip(160 + Math.random() * 30, 0.04, "triangle", 0.018); }
      }
    }
    updateCritters(dt);
    clockTick += dt;
    if (clockTick > 0.2) { clockTick = 0; updateClock(dt > 0 ? 0.2 : 0); watchRegion(); }
    else updateClock(0);
    var bob = state.moving && !boat.boarded ? Math.abs(Math.sin(state.walk)) * 0.07 : 0;
    if (state.moving) state.walk += dt * 9;
    player.mesh.position.set(player.x, player.y + bob, player.z);
    var face = boat.boarded ? boat.yaw : player.facing;
    player.mesh.rotation.y = dampAngle(player.mesh.rotation.y, face, dt * 10);
    if (player.legL) {
      var swing = state.moving && !boat.boarded ? Math.sin(state.walk) * 0.5 : 0;
      player.legL.rotation.x = swing;
      player.legR.rotation.x = -swing;
    }
    if (boat.mesh) {
      boat.mesh.position.set(boat.x, WATER - 0.05 + Math.sin(now / 400) * 0.04, boat.z);
      boat.mesh.rotation.y = boat.yaw;
    }
    for (var i = 0; i < fires.length; i++) {
      fires[i].flame.scale.y = 0.85 + Math.sin(now / 80 + i) * 0.2;
      fires[i].light.intensity = 0.55 + Math.sin(now / 90) * 0.2;
    }
    water.position.y = WATER + Math.sin(now / 700) * 0.03;
    updateCamera();
    updateGhost();
    if (state.started) { updatePrompt(); refreshHotbar(); }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function boot() {
    try {
      setProgress(8);
      buildHotbar();
      setupThree();
      setProgress(30);
      generate();
      loadSave();
      recomputeAllTops();
      setProgress(58);
      makeMeshes();
      rebuildAll();
      setProgress(78);
      dress();
      makePlayer();
      spawnFolks();
      bindInput();
      updateClock(0);
      updateCamera();
      renderer.render(scene, camera);
      setProgress(100);
      showReady();
      requestAnimationFrame(frame);
    } catch (err) {
      console.error(err);
      var n = $("loadnote");
      if (n) n.textContent = err && err.message ? err.message : "Could not start the world.";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
