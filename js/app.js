/* ============================================================
 *  中日武将大单挑 — 主程序 / UI 控制
 * ============================================================ */
(() => {
  "use strict";

  const DB_KEY = "wujiang_db_v1";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------------- 数据库（localStorage 持久化，可增删改） ---------------- */
  const DB = {
    list: [],
    load() {
      const saved = localStorage.getItem(DB_KEY);
      if (saved) {
        try { this.list = JSON.parse(saved); }
        catch { this.list = clone(ALL_GENERALS); }
      } else {
        this.list = clone(ALL_GENERALS);
      }
      this._nextId = this.list.reduce((m, g) => Math.max(m, g.id), 0) + 1;
    },
    save() { localStorage.setItem(DB_KEY, JSON.stringify(this.list)); },
    bySide(side) { return this.list.filter(g => g.side === side); },
    get(id) { return this.list.find(g => g.id === id); },
    add(g) { g.id = this._nextId++; this.list.push(g); this.save(); return g; },
    update(id, data) { const g = this.get(id); if (g) Object.assign(g, data); this.save(); },
    remove(id) { this.list = this.list.filter(g => g.id !== id); this.save(); },
    resetDefault() { this.list = clone(ALL_GENERALS); this._nextId = this.list.length + 1; this.save(); },
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- 通用工具 ---------------- */
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove("show"), 1800);
  }
  function avatarChar(name) { return name[0]; }
  function hpColor(ratio) { return ratio > 0.5 ? "var(--hp-good)" : ratio > 0.22 ? "var(--hp-mid)" : "var(--hp-low)"; }

  /* 六维评级：SS≥100 S≥95 A≥90 B≥80 C≥70 D≥60 E<60 */
  function rateLetter(v) {
    if (v >= 100) return "SS";
    if (v >= 95) return "S";
    if (v >= 90) return "A";
    if (v >= 80) return "B";
    if (v >= 70) return "C";
    if (v >= 60) return "D";
    return "E";
  }
  const DIMS = [["ti", "体力"], ["wu", "武力"], ["tong", "统帅"], ["zhi", "智力"], ["zheng", "政治"], ["mei", "魅力"]];
  function sumStats(g) { return g.ti + g.wu + g.tong + g.zhi + g.zheng + g.mei; }
  function gradeChip(v) { const r = rateLetter(v); return `<span class="g grade-${r}">${r}</span>`; }
  // 武将评分 = 六维之和 + 单项突出加成（每项达 S 及以上：(该项数值-95)×4，未达 S 不加分）
  function ratingScore(g) {
    let s = sumStats(g);
    DIMS.forEach(([k]) => { s += Math.max(0, (g[k] - 95) * 4); });
    return s;
  }
  // 武将评级：以六维平均分为基底，单项越突出(A及以上)加权越多，体现「一招鲜」，再按评级阈值定级
  function gradeBasis(g) {
    let s = sumStats(g) / 6;
    DIMS.forEach(([k]) => {
      const v = g[k];
      if (v >= 100) s += 9;        // 单项 SS
      else if (v >= 95) s += 6;    // 单项 S
      else if (v >= 90) s += 4;    // 单项 A
      else if (v >= 80) s += 1.5;  // 单项 B
    });
    return s;
  }
  function warriorRating(g) { return rateLetter(Math.round(gradeBasis(g))); }
  function ratingChip(g) { const r = warriorRating(g); return `<span class="g grade-${r}">${r}</span>`; }
  const GRADE_COLOR = { SS: "#f4c430", S: "#ff4d3d", A: "#ff9020", B: "#3b9aff", C: "#46c357", D: "#c7923f", E: "#b0705a" };
  function gradeColor(v) { return GRADE_COLOR[rateLetter(v)]; }

  const BGM = {
    select: "assets/bgm/player_select.mp3",   // 选将
    battle: "assets/bgm/single_combat.mp3",   // 单挑
    war: "assets/bgm/tactics.mp3",            // 阵营大战
    cup: "assets/bgm/tactics.mp3",            // 世界杯（沿用战术曲）
  };
  function showScreen(id) {
    $$(".screen").forEach(s => s.classList.remove("active"));
    $("#screen-" + id).classList.add("active");
    if (id !== "battle" && typeof Duel !== "undefined" && Duel.stop) Duel.stop();
    // 按界面切换背景乐：指定界面用 OST，其余回退芯片乐
    if (BGM[id]) AudioSystem.playFile(BGM[id]);
    else AudioSystem.playChip();
    AudioSystem.resume();
  }

  /* ---------------- 弹窗 ---------------- */
  const overlay = $("#overlay");
  function openOverlay(html) { $("#overlay-content").innerHTML = html; overlay.classList.add("show"); }
  function closeOverlay() { overlay.classList.remove("show"); }
  overlay.addEventListener("click", e => { if (e.target === overlay) closeOverlay(); });

  /* ---------------- 雷达图 (SVG) ---------------- */
  function radarSVG(g, size = 200) {
    const dims = [["武力", g.wu], ["统帅", g.tong], ["智力", g.zhi], ["政治", g.zheng], ["魅力", g.mei], ["体力", g.ti]];
    const cx = size / 2, cy = size / 2, R = size * 0.36, n = dims.length, max = 120;
    const pt = (i, r) => {
      const ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    };
    let grid = "";
    for (let g2 = 1; g2 <= 4; g2++) {
      const pts = dims.map((_, i) => pt(i, R * g2 / 4).join(",")).join(" ");
      grid += `<polygon points="${pts}" fill="none" stroke="rgba(90,74,48,.25)" stroke-width="1"/>`;
    }
    let axes = "", labels = "";
    dims.forEach((d, i) => {
      const [x, y] = pt(i, R);
      axes += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(90,74,48,.25)"/>`;
      const [lx, ly] = pt(i, R + 16);
      labels += `<text x="${lx}" y="${ly}" font-size="11" fill="#5a4a30" text-anchor="middle" dominant-baseline="middle">${d[0]}</text>`;
    });
    const dataPts = dims.map((d, i) => pt(i, R * Math.min(1, d[1] / max)).join(",")).join(" ");
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      ${grid}${axes}
      <polygon points="${dataPts}" fill="rgba(193,39,45,.35)" stroke="var(--cn-red)" stroke-width="2"/>
      ${labels}</svg>`;
  }

  function showDetail(g, opts = {}) {
    const html = `<div class="result-card detail-card">
      <div class="winner-av" style="background:${g.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)'}">${avatarChar(g.name)}</div>
      <div class="wname">${g.name}</div>
      <div style="font-size:13px;color:#8a6d3b;margin-top:2px">${g.title || ''}</div>
      <div class="wdesc">${g.intro || ''}</div>
      <div class="radar-wrap">${radarSVG(g)}</div>
      <div class="overall-line">武将评分 <b class="ov-sum">${ratingScore(g)}</b> <span class="ov-num">(六维 ${sumStats(g)} + 突出加成 ${Math.round(ratingScore(g) - sumStats(g))})</span> · 武将评级 ${ratingChip(g)}</div>
      <div class="stat-rows">${statRow('体力', g.ti)}${statRow('武力', g.wu)}${statRow('统帅', g.tong)}${statRow('智力', g.zhi)}${statRow('政治', g.zheng)}${statRow('魅力', g.mei)}</div>
      <div class="btns">
        ${opts.pickable ? `<button class="btn-primary" id="detail-pick">选他出战</button>` : ''}
        <button class="btn-ghost" id="detail-close">关闭</button>
      </div>
    </div>`;
    openOverlay(html);
    $("#detail-close").onclick = closeOverlay;
    if (opts.pickable) $("#detail-pick").onclick = () => { closeOverlay(); opts.onPick(g); };
  }
  function statRow(lbl, val) {
    return `<div class="stat-row"><span class="lbl">${lbl}</span>
      <span class="track"><span class="bar" style="width:${Math.min(100, val / 1.2)}%;background:${gradeColor(val)}"></span></span>
      <span class="val">${val}</span>${gradeChip(val)}</div>`;
  }

  /* ============================================================
   *  选将界面
   * ============================================================ */
  const SelectUI = {
    mode: "classic",
    side: "cn",
    picks: [],     // 选中的武将（classic 需2个，gauntlet 需1个）
    need: 2,

    open(mode) {
      this.mode = mode; this.picks = []; this.side = "cn";
      this.need = mode === "classic" ? 2 : (mode === "cup" ? Tournament.size : 1);
      const titles = { classic: "经典单挑 · 选择双将", gauntlet: "车轮大战 · 选你的主将", cup: `世界杯 · 选 ${Tournament.size} 将` };
      $("#select-title").textContent = titles[mode] || "选择武将";
      const hints = {
        classic: "依次点选两名武将（可同阵营）· 或点「随机双将」· 点 ⓘ 查看六维属性",
        gauntlet: "选一名主将连斩群雄 · 点 ⓘ 查看六维属性",
        cup: `点选参赛武将（最多 ${Tournament.size} 名）· 不足将随机补满`,
      };
      $("#select-hint").textContent = hints[mode] || "";
      // 「随机双将」仅经典单挑可用
      $("#select-random").style.display = mode === "classic" ? "" : "none";
      $("#cn-count").textContent = DB.bySide("cn").length;
      $("#jp-count").textContent = DB.bySide("jp").length;
      $("#select-search").value = "";

      this.render();
      this.updateBar();
      showScreen("select");
    },
    // 经典单挑：随机抽取两名武将直接开战
    randomPick() {
      const all = DB.list;
      if (all.length < 2) return;
      const a = all[Math.floor(Math.random() * all.length)];
      let b; do { b = all[Math.floor(Math.random() * all.length)]; } while (b.id === a.id);
      this.picks = [a, b];
      AudioSystem.sfx.select();
      startClassicBattle(a, b, false);
    },
    setSide(side) {
      this.side = side;
      $$(".side-tab", $("#screen-select")).forEach(t => t.classList.toggle("active", t.dataset.side === side));
      this.render();
    },
    render() {
      const kw = $("#select-search").value.trim();
      let arr = DB.bySide(this.side);
      if (kw) arr = arr.filter(g => g.name.includes(kw) || (g.title || "").includes(kw));
      arr.sort((a, b) => b.wu - a.wu);
      const grid = $("#select-grid");
      grid.innerHTML = arr.map(g => {
        const idx = this.picks.findIndex(p => p.id === g.id);
        return `<div class="card ${g.side} ${idx >= 0 ? 'selected' : ''}" data-id="${g.id}">
          <span class="cinfo" data-info>ⓘ</span>
          ${idx >= 0 ? `<span class="selnum">${idx + 1}</span>` : ''}
          <div class="avatar">${avatarChar(g.name)}</div>
          <div class="cname">${g.name}</div>
          <div class="cwu">武 ${g.wu} · 统 ${g.tong}</div>
        </div>`;
      }).join("") || `<div class="empty">无匹配武将</div>`;

      $$(".card", grid).forEach(c => {
        const id = +c.dataset.id;
        c.addEventListener("click", e => {
          if (e.target.closest("[data-info]")) { e.stopPropagation(); showDetail(DB.get(id), { pickable: true, onPick: g => this.toggle(g.id) }); return; }
          this.toggle(id);
        });
        c.addEventListener("contextmenu", e => { e.preventDefault(); showDetail(DB.get(id)); });
      });
    },
    toggle(id) {
      AudioSystem.sfx.select();
      const g = DB.get(id);
      const idx = this.picks.findIndex(p => p.id === id);
      if (idx >= 0) { this.picks.splice(idx, 1); }
      else {
        if (this.picks.length >= this.need) {
          if (this.need === 1) this.picks = [];
          else this.picks.shift();
        }
        this.picks.push(g);
      }
      this.render();
      this.updateBar();
    },
    updateBar() {
      const info = $("#select-info"), btn = $("#select-confirm");
      if (this.mode === "classic") {
        if (this.picks.length === 0) info.textContent = "请选择第 1 名武将";
        else if (this.picks.length === 1) info.textContent = `已选 ${this.picks[0].name}，再选 1 名对手`;
        else info.textContent = `${this.picks[0].name}  VS  ${this.picks[1].name}`;
        btn.disabled = this.picks.length !== 2;
        btn.textContent = "开始单挑";
      } else if (this.mode === "gauntlet") {
        info.textContent = this.picks.length ? `主将：${this.picks[0].name}` : "请选择你的主将";
        btn.disabled = this.picks.length !== 1;
        btn.textContent = "踏上擂台";
      } else if (this.mode === "cup") {
        info.textContent = `已选 ${this.picks.length}/${this.need}（不足将随机补满）`;
        btn.disabled = false;
        btn.textContent = this.picks.length >= this.need ? "满员开赛" : "开赛";
      }
    },
    confirm() {
      if (this.mode === "classic" && this.picks.length === 2) {
        startClassicBattle(this.picks[0], this.picks[1], false);
      } else if (this.mode === "gauntlet" && this.picks.length === 1) {
        Gauntlet.start(this.picks[0]);
      } else if (this.mode === "cup") {
        Tournament.begin(this.picks);
      }
    },
  };

  /* ============================================================
   *  战斗界面（经典单挑 / 车轮战通用）
   * ============================================================ */
  let BATTLE = null;
  let battleToken = 0;   // 每场战斗唯一票据，防止旧场的自动定时器误驱动新场
  const PREF = { auto: false, speed: 1 };

  function renderFighter(sel, fighter, sideClass) {
    const el = $(sel);
    const isLeft = sel.includes('left');
    el.className = `fighter ${isLeft ? 'left' : 'right'} ${sideClass}`;
    const g = fighter.g;
    $(".favatar", el).textContent = avatarChar(g.name);
    $(".fname", el).textContent = g.name;
    $(".ftotal", el).innerHTML = `武将评分 <b>${ratingScore(g)}</b> ${ratingChip(g)}`;
    // 头像/姓名右侧的五维（评级 + 数值彩条 + 数值；体力另以下方血条呈现）
    $(".fstats", el).innerHTML = DIMS.filter(([k]) => k !== "ti").map(([k, label]) =>
      `<div class="fs-row"><span class="fs-lbl">${label[0]}</span>` +
      `<span class="fs-track"><span class="fs-bar" style="width:${Math.min(100, g[k] / 1.2)}%;background:${gradeColor(g[k])}"></span></span>` +
      `<span class="fs-val">${g[k]}</span>${gradeChip(g[k])}</div>`
    ).join("");
    updateBars(el, fighter);
  }

  /* ============================================================
   *  Duel —— 8-bit 像素骑战画面（仿三国志II 霸王的大陆单挑）
   *  低分辨率 256×160 画布，最近邻放大，骑将策马对冲。
   * ============================================================ */
  const Duel = {
    cv: null, ctx: null, raf: 0, riders: [], spark: 0, sparkX: 128, shake: 0, _bg: null,
    init() { this.cv = $("#duel-canvas"); this.ctx = this.cv.getContext("2d"); this.ctx.imageSmoothingEnabled = false; },
    setup(g1, g2) {
      if (!this.cv) this.init();
      const W = this.cv.width;
      this.riders = [this.mk(g1, 44, false), this.mk(g2, W - 44, true)];
      this.spark = 0; this.shake = 0;
      this.start();
    },
    mk(g, baseX, flip) {
      return {
        g, side: g.side, baseX, x: baseX, y: 134, flip, dir: flip ? -1 : 1,
        anim: null, hitT: 0, ko: false, koT: 0, charge: false, impact: null,
      };
    },
    start() { if (this.raf) return; const loop = t => { this.frame(t); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); },
    stop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } },

    // 攻击：策马冲向中央，返回 Promise 在「命中瞬间」resolve；之后自动收马
    attack(who, tactic, speed) {
      return new Promise(res => {
        const r = this.riders[who];
        const dur = 620 / (speed || 1);
        r.anim = { type: "charge", t0: performance.now(), dur, tactic, hit: false };
        r.charge = false;
        r.impact = res;
      });
    },
    hit(who) { const r = this.riders[who]; r.hitT = performance.now(); this.shake = 6; },
    ko(who) { const r = this.riders[who]; r.ko = true; r.koT = performance.now(); },
    setCharge(who, on) { this.riders[who].charge = on; },

    frame(now) {
      const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
      // 镜头抖动
      let sx = 0, sy = 0;
      if (this.shake > 0) { sx = (Math.random() - 0.5) * this.shake; sy = (Math.random() - 0.5) * this.shake; this.shake *= 0.8; if (this.shake < 0.4) this.shake = 0; }
      ctx.save(); ctx.translate(Math.round(sx), Math.round(sy));
      this.drawBg(ctx, W, H, now);
      // 更新骑将位置
      const center = W / 2;
      for (let i = 0; i < this.riders.length; i++) {
        const r = this.riders[i];
        let drawX = r.baseX;
        if (r.anim && r.anim.type === "charge") {
          const p = Math.min(1, (now - r.anim.t0) / r.anim.dur);
          const reach = (center - r.dir * 18) - r.baseX; // 冲到中央交锋点
          // 0→0.5 冲锋, 0.5→1 收马
          const tri = p < 0.5 ? p / 0.5 : (1 - p) / 0.5;
          drawX = r.baseX + reach * tri;
          if (!r.anim.hit && p >= 0.5) { r.anim.hit = true; this.spark = 1; this.sparkX = center; if (r.impact) { r.impact(); r.impact = null; } }
          if (p >= 1) r.anim = null;
        }
        // 受击击退
        if (r.hitT) { const hp = (now - r.hitT) / 300; if (hp >= 1) r.hitT = 0; else drawX += -r.dir * 7 * (1 - hp); }
        r.x = drawX;
      }
      // 远→近顺序：先画较靠后者无所谓，直接画
      for (const r of this.riders) this.drawGeneral(ctx, r, now);
      // 火花
      if (this.spark > 0) { this.drawSpark(ctx, this.sparkX, 96, this.spark); this.spark -= 0.08; if (this.spark < 0) this.spark = 0; }
      ctx.restore();
    },

    drawBg(ctx, W, H, now) {
      const P = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); };
      // 黄昏战场天空：多段渐变
      const sky = ["#243b6e", "#3a5a9c", "#5c7fc8", "#8aa6df", "#c9b6c0", "#f0c79a"];
      for (let i = 0; i < sky.length; i++) P(0, i * 16, W, 17, sky[i]);
      // 落日 + 光晕
      const sunX = W - 50, sunY = 26;
      P(sunX - 12, sunY - 12, 24, 24, "rgba(255,220,140,.25)");
      P(sunX - 9, sunY - 9, 18, 18, "#ffe9a8");
      P(sunX - 7, sunY - 7, 14, 14, "#ffd45a");
      // 霞光横纹
      ctx.fillStyle = "rgba(255,210,140,.18)";
      for (let y = 8; y < 90; y += 12) ctx.fillRect(0, y, W, 2);
      // 飘云（缓慢平移）
      const cloud = (cx, cy, s, col) => { P(cx, cy, 14 * s, 4, col); P(cx + 5, cy - 3, 10 * s, 4, col); P(cx + 12 * s, cy, 10 * s, 4, col); };
      const t = now * 0.004;
      ctx.globalAlpha = .85;
      cloud(((40 + t) % (W + 60)) - 40, 18, 1.4, "#eef0f6");
      cloud(((150 + t * 0.7) % (W + 60)) - 40, 34, 1.0, "#dfe4ef");
      cloud(((250 + t * 1.3) % (W + 60)) - 40, 12, 1.1, "#f6f1ee");
      ctx.globalAlpha = 1;
      // 远山三层（越远越淡）
      for (let mx = -30; mx < W + 30; mx += 90) this.tri(ctx, mx, 98, 70, 34, "#6a6f9a");
      for (let mx = 20; mx < W + 30; mx += 80) this.tri(ctx, mx, 100, 60, 44, "#4a5a7e");
      // 远处城郭剪影
      const cxs = W * 0.5 | 0;
      P(cxs - 26, 78, 52, 22, "#2e3a55");
      P(cxs - 30, 86, 60, 14, "#283250");
      for (let i = -2; i <= 2; i++) P(cxs + i * 11 - 2, 72, 5, 8, "#2e3a55"); // 城垛
      P(cxs - 4, 64, 8, 16, "#37456a"); P(cxs - 6, 60, 12, 5, "#a01818"); // 天守 + 红旗
      // 近山（深绿）
      for (let mx = -10; mx < W + 30; mx += 64) this.tri(ctx, mx, 104, 56, 30, "#235c30");
      // 草原
      P(0, 104, W, H - 104, "#3fae37");
      P(0, 104, W, 5, "#48c23e");
      ctx.fillStyle = "#2f8a28";
      for (let y = 118; y < H; y += 9) ctx.fillRect(0, y, W, 1);
      // 草丛与野花点缀（固定布局）
      for (let i = 0; i < 46; i++) {
        const gx = (i * 71 + 13) % W, gy = 112 + (i * 29) % (H - 116);
        P(gx, gy, 2, 3, "#2c8a24"); P(gx + 2, gy - 1, 2, 3, "#56cc46");
        if (i % 7 === 0) P(gx + 1, gy - 2, 2, 2, i % 14 === 0 ? "#ffe24d" : "#ff7aa0");
      }
      // 两侧军旗
      this.banner(ctx, 10, 104, "#c1272d", now);
      this.banner(ctx, W - 14, 104, "#2b3a67", now);
    },
    // 战旗（旗杆 + 飘动旗面）
    banner(ctx, x, groundY, col, now) {
      const P = (px, py, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(px | 0, py | 0, w | 0, h | 0); };
      P(x, groundY - 46, 2, 46, "#5a4a2a");
      P(x - 1, groundY - 48, 4, 3, "#e8c25a");
      const wv = Math.sin(now * 0.006) * 2;
      for (let i = 0; i < 7; i++) { const fy = groundY - 44 + i * 3; P(x + 2, fy, 16 + (i % 2 ? wv : -wv), 3, col); }
      P(x + 4, groundY - 40, 8, 8, "#e8c25a"); // 旗徽
    },
    tri(ctx, cx, baseY, w, h, col) {
      ctx.fillStyle = col;
      for (let i = 0; i < h; i++) { const ww = Math.round(w * (h - i) / h); ctx.fillRect(Math.round(cx - ww / 2), baseY - i, ww, 1); }
    },
    drawSpark(ctx, x, y, t) {
      const r = Math.round(16 * (1 - t) + 4);
      const cols = ["#ffffff", "#ffe060", "#ff8020"];
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = cols[k];
        const rr = r - k * 3; if (rr <= 0) continue;
        ctx.fillRect(x - rr, y - 1, rr * 2, 2);
        ctx.fillRect(x - 1, y - rr, 2, rr * 2);
        ctx.fillRect(x - rr * 0.7, y - rr * 0.7, rr * 0.5, rr * 0.5);
        ctx.fillRect(x + rr * 0.4, y + rr * 0.3, rr * 0.5, rr * 0.5);
      }
    },

    // 绘制一名骑将（默认朝右，flip 镜像）
    drawGeneral(ctx, r, now) {
      const armor = r.side === "cn" ? "#e03028" : "#3858d8";
      const armor2 = r.side === "cn" ? "#a01818" : "#203098";
      const gold = "#f8d038", skin = "#f8c088", steel = "#d0d8e0";
      const horse = "#b07838", horseD = "#7a5020", mane = "#5a3a18";
      ctx.save();
      ctx.translate(Math.round(r.x), 0);
      if (r.flip) ctx.scale(-1, 1);
      let alpha = 1, rot = 0;
      if (r.ko) { const kp = Math.min(1, (now - r.koT) / 700); rot = -1.0 * kp; alpha = 1 - 0.55 * kp; ctx.translate(0, kp * 6); }
      ctx.globalAlpha = alpha;
      const yb = r.y;
      if (rot) { ctx.translate(0, yb - 18); ctx.rotate(rot); ctx.translate(0, -(yb - 18)); }
      const P = (x, w, y, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
      // 蹄影
      ctx.globalAlpha = alpha * 0.3; P(-16, 34, yb - 1, 3, "#1c5418"); ctx.globalAlpha = alpha;
      // 马腿（奔腾两帧）
      const gf = Math.floor(now / 110) % 2;
      const bL = -10 + (gf ? -2 : 2), fL = 8 + (gf ? 2 : -2);
      P(bL, 3, yb - 9, 9, horseD); P(bL + 5, 3, yb - 8, 8, horse);
      P(fL, 3, yb - 9, 9, horseD); P(fL - 5, 3, yb - 8, 8, horse);
      // 马身
      P(-14, 28, yb - 19, 11, horse);
      P(8, 9, yb - 23, 8, horse);              // 前胸
      P(-16, 4, yb - 18, 12, mane);            // 尾
      // 颈/头
      P(14, 5, yb - 27, 11, horse);
      P(17, 9, yb - 31, 7, horse);
      P(24, 4, yb - 29, 4, horse);             // 口鼻
      P(18, 2, yb - 33, 2, horse);             // 耳
      P(13, 3, yb - 29, 9, mane);              // 鬃
      P(22, 1, yb - 29, 1, "#000");            // 眼
      // 背旗（指物，随风飘动）
      const bw = 9 + Math.round(Math.sin(now * 0.008) * 1.5);
      P(-10, 2, yb - 50, 22, "#5a4a2a");       // 旗杆
      P(-10 - (bw - 9), bw, yb - 49, 14, armor); // 旗面
      P(-10 - (bw - 9), bw, yb - 49, 3, gold);   // 旗顶
      P(-10 - (bw - 9) + 2, bw - 4, yb - 44, 5, gold); // 旗徽
      // 鞍 + 骑将
      P(-6, 13, yb - 21, 3, armor2);
      P(-4, 3, yb - 21, 7, armor2); P(4, 3, yb - 21, 7, armor2);  // 腿
      P(-8, 4, yb - 31, 13, armor2);           // 披风
      P(-4, 10, yb - 32, 11, armor);           // 躯干
      P(-4, 10, yb - 32, 3, gold);             // 胸甲金边
      P(-6, 3, yb - 31, 4, armor2); P(6, 3, yb - 31, 4, armor2);  // 护肩
      P(5, 7, yb - 30, 3, skin);               // 持枪手臂
      P(-2, 7, yb - 39, 7, skin);              // 头
      P(-3, 9, yb - 41, 3, armor2);            // 头盔
      P(0, 2, yb - 47, 6, gold);               // 盔缨（加高）
      P(-2, 2, yb - 44, 4, "#fff");            // 缨穗高光
      P(3, 1, yb - 37, 1, "#000");             // 眼
      // 马蹄扬尘（移动时）
      if (Math.abs(r.x - r.baseX) > 3) {
        ctx.globalAlpha = alpha * 0.5;
        const d = (now / 80 | 0) % 3;
        P(-18 - d * 2, 4, yb - 2, 3, "#d9c9a0"); P(-22 - d, 3, yb - 5, 2, "#e8dcc0");
        ctx.globalAlpha = alpha;
      }
      // 长枪（上扬）
      P(11, 2, yb - 54, 2, mane);
      for (let i = 0; i < 22; i++) P(11 + i * 0.18, 2, yb - 54 + i, 2, "#7a5020"); // 斜枪杆
      P(13, 5, yb - 60, 5, steel);             // 枪尖
      P(12, 2, yb - 58, 2, "#fff");            // 高光
      // 蓄力金光
      if (r.charge) {
        const fl = (Math.floor(now / 80) % 2) ? "#fff0a0" : "#ffd040";
        ctx.globalAlpha = alpha * 0.9;
        P(-9, 1, yb - 42, 24, fl); P(-9, 1, yb - 19, 24, fl);
        P(-9, 24, yb - 42, 1, fl); P(15, 1, yb - 42, 24, fl);
        ctx.globalAlpha = alpha;
      }
      // 受击闪白
      if (r.hitT) { const hp = (now - r.hitT) / 300; if (hp < 1 && (Math.floor(now / 60) % 2)) { ctx.globalAlpha = alpha * 0.7; P(-8, 26, yb - 45, 45, "#ffffff"); } }
      ctx.restore();
    },
  };

  function updateBars(el, fighter) {
    const ratio = fighter.hp / fighter.maxHp;
    const fill = $(".hpbar .fill", el);
    fill.style.width = (ratio * 100) + "%";
    fill.style.background = hpColor(ratio);
    $(".hpbar .txt", el).textContent = `${Math.ceil(fighter.hp)} / ${fighter.maxHp}`;
    $(".stambar .fill", el).style.width = fighter.stam + "%";
  }

  function logLine(text, cls) {
    const log = $("#battle-log");
    const div = document.createElement("div");
    div.className = "ln " + (cls || "");
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function renderTactics(enabled) {
    const wrap = $("#tactics");
    const g = BATTLE.p1.g;
    const used = BATTLE.freeUsed || {};
    wrap.innerHTML = Object.values(TACTICS).map(t => {
      const cost = staminaCost(t.key, g);
      const chosen = used[t.key] ? " chosen" : "";
      const costLbl = t.key === "charge" ? `<span class="stcost gain">回战意</span>`
        : (cost <= 0 ? `<span class="stcost">免耗</span>` : `<span class="stcost">耗${cost}</span>`);
      return `<button class="tactic-btn ${t.type === "scheme" ? "scheme" : ""}${t.free ? " free" : ""}${chosen}" data-t="${t.key}" title="${t.desc}">
        <span class="ti">${t.icon}</span><span class="tn">${t.name}</span>
        ${costLbl}
      </button>`;
    }).join("");
    $$(".tactic-btn", wrap).forEach(b => {
      const key = b.dataset.t;
      const t = TACTICS[key];
      const cost = staminaCost(key, g);
      // 蓄力/格挡不因战意不足而禁用；其余按战意消耗判定
      let dis = !enabled || BATTLE.spectate || (cost > 0 && key !== "charge" && BATTLE.p1.stam < cost);
      if (t.free && used[key]) dis = true;   // 该免费计策本回合已发动
      b.disabled = dis;
      b.onclick = () => (t.free ? chooseFree(key) : playerTactic(key));
    });
  }

  function startClassicBattle(g1, g2, isRandom, rpg) {
    BATTLE = {
      p1: makeFighter(g1), p2: makeFighter(g2),
      round: 0, mode: "classic", busy: false,
      onWin: null, rpg: !!rpg, opp: g2,
    };
    $("#battle-title").textContent = rpg ? "历练单挑" : (isRandom ? "随机演武" : "经典单挑");
    enterBattle();
  }

  // 阵营大战「详情」模式：在经典单挑画面上自动演完整场对决，Promise 返回胜负
  // 中途中止时以 null 解开等待方（见 War.abort）
  function autoPlayBattle(g1, g2, opts = {}) {
    return new Promise(resolve => {
      const b = {
        p1: makeFighter(g1), p2: makeFighter(g2),
        round: 0, mode: "war", busy: false, spectate: true,
        onWin: (winner, loser) => resolve({ winner, loser, rounds: b.round }),
        abortResolve: () => resolve(null),
      };
      BATTLE = b;
      $("#battle-title").textContent = opts.title || "阵营大战 · 单挑";
      enterBattle();
      if (opts.intro) logLine(opts.intro, "sys");
    });
  }

  function battleSleep(ms) { return sleep(ms / (BATTLE.speed || 1)); }
  const whoIdx = who => (who === "p1" ? 0 : 1);

  function enterBattle() {
    renderFighter("#f-left", BATTLE.p1, BATTLE.p1.g.side);
    renderFighter("#f-right", BATTLE.p2, BATTLE.p2.g.side);
    Duel.setup(BATTLE.p1.g, BATTLE.p2.g);
    $("#battle-log").innerHTML = "";
    $("#round-badge").textContent = "第 1 回合";
    logLine(`【${BATTLE.p1.g.name}】 对阵 【${BATTLE.p2.g.name}】，单挑开始！`, "sys");
    logLine(`体力=血量 武力=攻 智力=谋攻 统帅=先手/减伤/格挡 政治=战意 魅力=暴击率`, "sys");
    BATTLE.busy = false;
    BATTLE.token = ++battleToken;
    BATTLE.speed = PREF.speed;
    BATTLE.auto = BATTLE.spectate ? true : PREF.auto;   // 阵营观战恒为自动
    // 头像点击查看详情
    $$("[data-info]", $("#screen-battle")).forEach(av => {
      av.onclick = function () {
        const f = this.closest("#f-left") ? BATTLE.p1 : BATTLE.p2;
        showDetail(f.g);
      };
    });
    syncBattleControls();
    BATTLE.turnNo = 0;
    BATTLE.turn = firstMover(BATTLE.p1, BATTLE.p2);   // 统帅决定先手
    nextTurn();
    showScreen("battle");
  }

  // 轮换出招：决定/提示当前回合该谁出手
  function nextTurn() {
    BATTLE.freeUsed = {};
    const active = BATTLE.turn;
    const me = active === "p1" ? BATTLE.p1 : BATTLE.p2;
    const foe = active === "p1" ? BATTLE.p2 : BATTLE.p1;
    const human = active === "p1" && !BATTLE.auto && !BATTLE.spectate;
    if (human && me.bound <= 0) {
      renderTactics(true);
      $("#battle-foot").textContent = "请出招 —— " + me.g.name;
      return;
    }
    // 自动出手：对手回合、自动作战、观战、或被束缚（自动跳过）
    renderTactics(false);
    $("#battle-foot").textContent = me.bound > 0
      ? `${me.g.name} 被束缚，暂停出招…`
      : (BATTLE.spectate ? "阵营观战中 ⚔ " : (human ? "" : (active === "p1" ? "自动作战 —— " : "对手出招 —— "))) + me.g.name;
    const tok = BATTLE.token;
    BATTLE._autoTimer = setTimeout(() => {
      if (!BATTLE || BATTLE.token !== tok) return;
      const a = BATTLE.turn === "p1" ? BATTLE.p1 : BATTLE.p2;
      const f = BATTLE.turn === "p1" ? BATTLE.p2 : BATTLE.p1;
      takeTurn(aiChoosePlan(a, f));
    }, 560 / BATTLE.speed);
  }

  // 自动作战开关触发：若轮到我方且可行动则立即自动出手
  function maybeAutoPlay() {
    if (!BATTLE || BATTLE.busy || !BATTLE.auto) return;
    if (overlay.classList.contains("show")) return;
    const a = BATTLE.turn === "p1" ? BATTLE.p1 : BATTLE.p2;
    const f = BATTLE.turn === "p1" ? BATTLE.p2 : BATTLE.p1;
    takeTurn(aiChoosePlan(a, f));
  }

  // 手动：点免费计策(束缚/弱化)——立即发动并演出；同回合两者皆可发动，各限一次，且仍可再出招
  async function chooseFree(key) {
    if (!BATTLE || BATTLE.busy || BATTLE.spectate) return;
    if (BATTLE.turn !== "p1" || BATTLE.p1.bound > 0) return;
    if (!BATTLE.freeUsed) BATTLE.freeUsed = {};
    if (BATTLE.freeUsed[key]) return;              // 该计策本回合已发动
    const cost = staminaCost(key, BATTLE.p1.g);
    if (BATTLE.p1.stam < cost) { toast("战意不足"); return; }
    BATTLE.busy = true;
    const myTok = BATTLE.token; const stale = () => !BATTLE || BATTLE.token !== myTok;
    clearTimeout(BATTLE._autoTimer);
    BATTLE.freeUsed[key] = true;
    renderTactics(false);
    AudioSystem.sfx.select();
    // 立即结算并演出这条免费计策
    BATTLE.p1.stam = Math.max(0, BATTLE.p1.stam - cost);
    const ok = Math.random() < schemeSuccess(BATTLE.p1, BATTLE.p2, TACTICS[key].scheme);
    const ev = applyScheme({ atk: BATTLE.p1, def: BATTLE.p2, label: "p1" }, TACTICS[key].scheme, ok);
    await applyEvent(ev);
    if (stale()) return;
    updateBars($("#f-left"), BATTLE.p1);
    updateBars($("#f-right"), BATTLE.p2);
    BATTLE.busy = false;
    renderTactics(true);   // 主行动可继续；已发动的计策按钮已禁用
    $("#battle-foot").textContent = `已发动【${TACTICS[key].name}】，可再施计或出招`;
  }

  // 玩家选定「主行动」后结算本回合（免费计策已即时发动，不再重复）
  function playerTactic(mainKey) {
    takeTurn({ frees: [], main: mainKey });
  }

  // 结算「当前出手方」的一个回合
  async function takeTurn(plan) {
    if (!BATTLE || BATTLE.busy) return;
    const myTok = BATTLE.token;           // 该回合所属战斗；战斗被替换则中途作废
    const stale = () => !BATTLE || BATTLE.token !== myTok;
    BATTLE.busy = true;
    BATTLE.freeUsed = {};
    clearTimeout(BATTLE._autoTimer);
    renderTactics(false);

    BATTLE.turnNo = (BATTLE.turnNo || 0) + 1;
    $("#round-badge").textContent = `第 ${Math.ceil(BATTLE.turnNo / 2)} 回合`;

    const active = BATTLE.turn;
    const me = active === "p1" ? BATTLE.p1 : BATTLE.p2;
    const foe = active === "p1" ? BATTLE.p2 : BATTLE.p1;
    const events = resolveTurn(me, foe, plan, active);

    for (const ev of events) {
      await applyEvent(ev);
      if (stale()) return;
    }
    updateBars($("#f-left"), BATTLE.p1);
    updateBars($("#f-right"), BATTLE.p2);

    if (BATTLE.p1.hp <= 0 || BATTLE.p2.hp <= 0) {
      await battleSleep(500);
      if (stale()) return;
      endBattle();
      return;
    }
    BATTLE.busy = false;
    BATTLE.turn = active === "p1" ? "p2" : "p1";   // 轮换出手
    await battleSleep(220);
    if (stale()) return;
    nextTurn();
  }

  async function applyEvent(ev) {
    const cls = ev.who === "p1" ? "p1" : "p2";
    const atk = whoIdx(ev.who), def = whoIdx(ev.who === "p1" ? "p2" : "p1");

    if (ev.type === "charge") {
      AudioSystem.sfx.charge();
      Duel.setCharge(atk, true);
      logLine(ev.text, cls);
      // 蓄力恢复战意：刷新双方血条/战意条
      updateBars($("#f-left"), BATTLE.p1);
      updateBars($("#f-right"), BATTLE.p2);
      await battleSleep(380);
      return;
    }
    if (ev.type === "miss") {
      AudioSystem.sfx.gallop();
      await Duel.attack(atk, ev.tactic, BATTLE.speed);
      Duel.setCharge(atk, false);
      AudioSystem.sfx.guard();
      logLine(ev.text, "sys");
      await battleSleep(320);
      return;
    }
    if (ev.type === "hit") {
      AudioSystem.sfx.gallop();
      AudioSystem.sfx.swing();
      // 策马冲锋，命中瞬间结算
      await Duel.attack(atk, ev.tactic, BATTLE.speed);
      Duel.setCharge(atk, false);

      const softened = ev.guarded || ev.counter <= 0.7;
      if (ev.crit) AudioSystem.sfx.crit();
      else if (softened) AudioSystem.sfx.guard();
      else AudioSystem.sfx.hit();

      Duel.hit(def);
      if (!softened) { $("#duel-canvas").classList.remove("flash"); void $("#duel-canvas").offsetWidth; $("#duel-canvas").classList.add("flash"); }
      floatDamage(ev.who === "p1" ? "right" : "left", ev.dmg, ev.crit);

      logLine(ev.text, cls);
      updateBars($("#f-left"), BATTLE.p1);
      updateBars($("#f-right"), BATTLE.p2);
      await battleSleep(ev.crit ? 460 : 320);
      return;
    }
    if (ev.type === "defend") {
      AudioSystem.sfx.guard();
      Duel.setCharge(atk, true);
      logLine(ev.text, cls);
      await battleSleep(380);
      Duel.setCharge(atk, false);
      return;
    }
    if (ev.type === "bound") {
      AudioSystem.sfx.guard();
      logLine(ev.text, cls);
      await battleSleep(420);
      return;
    }
    if (ev.type === "scheme") {
      AudioSystem.sfx.charge();
      Duel.setCharge(atk, true);
      logLine(ev.text, ev.ok ? cls : "sys");
      await battleSleep(300);
      Duel.setCharge(atk, false);
      if (ev.ok) {
        if (ev.scheme === "heal") {
          AudioSystem.sfx.victory();
          updateBars($("#f-left"), BATTLE.p1);
          updateBars($("#f-right"), BATTLE.p2);
          floatDamage(ev.who === "p1" ? "left" : "right", ev.heal, false, true);
        } else {
          // 束缚/弱化命中：在敌方一侧闪现效果
          AudioSystem.sfx.crit();
          Duel.hit(def);
          $("#duel-canvas").classList.remove("flash"); void $("#duel-canvas").offsetWidth; $("#duel-canvas").classList.add("flash");
        }
      }
      await battleSleep(ev.ok ? 460 : 320);
      return;
    }
    if (ev.type === "ko") {
      AudioSystem.sfx.ko();
      Duel.ko(def);
      logLine(ev.text, "sys");
      await battleSleep(600);
    }
  }

  function syncBattleControls() {
    const a = $("#btn-auto");
    a.classList.toggle("on", !!BATTLE.auto);
    a.textContent = BATTLE.auto ? "⏸ 自动" : "▶ 自动";
    $("#btn-speed").textContent = "×" + (BATTLE.speed || 1);
  }

  function floatDamage(side, dmg, crit, heal) {
    const stage = $("#stage");
    const d = document.createElement("div");
    d.className = "dmg-float" + (crit ? " crit" : "") + (heal ? " heal" : "");
    d.textContent = (heal ? "+" : "-") + dmg;
    d.style.left = (side === "left" ? 28 : 64) + "%";
    d.style.top = "30%";
    stage.appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }

  function endBattle() {
    BATTLE.busy = false; // 战斗结束解除锁定，避免阻塞返回等操作
    const winner = BATTLE.p1.hp > 0 ? BATTLE.p1.g : BATTLE.p2.g;
    const loser = winner === BATTLE.p1.g ? BATTLE.p2.g : BATTLE.p1.g;
    if (!BATTLE.spectate) AudioSystem.sfx.victory();   // 阵营观战由 War 统一收尾，避免逐场喧闹
    if (BATTLE.cupResolve) { const r = BATTLE.cupResolve; BATTLE.cupResolve = null; showScreen("cup"); r(); return; }
    if (BATTLE.rpg) { RPG.onBattleEnd(BATTLE.p1.hp > 0, BATTLE.opp); return; }
    if (BATTLE.onWin) { BATTLE.onWin(winner, loser); return; }

    showResult(winner, loser, {
      onRematch: () => { startClassicBattle(BATTLE.p1.g, BATTLE.p2.g, false); },
      onBack: () => { closeOverlay(); SelectUI.open("classic"); },
    });
  }

  function showResult(winner, loser, opts) {
    const bg = winner.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
    openOverlay(`<div class="result-card">
      <h1>胜 · ${winner.side === 'cn' ? '三国' : '战国'}</h1>
      <div class="winner-av" style="background:${bg}">${avatarChar(winner.name)}</div>
      <div class="wname">${winner.name}</div>
      <div style="font-size:13px;color:#8a6d3b">${winner.title || ''}</div>
      <div class="wdesc">力克 ${loser.name}，威震四方！<br>${winner.intro || ''}</div>
      <div class="btns">
        <button class="btn-primary" id="res-again">${opts.rematchLabel || '再战一场'}</button>
        <button class="btn-ghost" id="res-back">${opts.backLabel || '返回'}</button>
      </div>
    </div>`);
    $("#res-again").onclick = () => { closeOverlay(); opts.onRematch(); };
    $("#res-back").onclick = () => { closeOverlay(); opts.onBack(); };
  }

  /* ============================================================
   *  车轮战
   * ============================================================ */
  const Gauntlet = {
    hero: null, streak: 0, pool: [],
    start(hero, rpg) {
      this.hero = clone(hero);
      this.streak = 0;
      this.rpg = !!rpg;
      // 对手池：大致由弱到强，但加入随机扰动，使每次顺序都不同
      this.pool = DB.list.filter(g => g.id !== hero.id)
        .map(g => ({ g, key: g.wu + (Math.random() - 0.5) * 60 }))
        .sort((a, b) => a.key - b.key)
        .map(x => x.g);
      this.next();
    },
    next() {
      if (!this.pool.length) { this.finish(true); return; }
      const foe = this.pool.shift();
      BATTLE = {
        p1: makeFighter(this.hero), p2: makeFighter(foe),
        round: 0, mode: "gauntlet", busy: false,
        onWin: (winner) => this.onResult(winner),
      };
      // 保留主将已损耗的体力（车轮战考验持久力），恢复一部分
      BATTLE.p1.hp = Math.min(this.hero.ti, BATTLE.p1.hp);
      $("#battle-title").textContent = `车轮战 · 第 ${this.streak + 1} 阵`;
      enterBattle();
      logLine(`连胜 ${this.streak} 场！新对手：${foe.name} 登场！`, "sys");
    },
    onResult(winner) {
      if (winner.id === this.hero.id) {
        this.streak++;
        // 胜利后回复 30% 体力
        AudioSystem.sfx.victory();
        const heal = Math.round(this.hero.ti * 0.3);
        this.hero._carryHp = Math.min(this.hero.ti, BATTLE.p1.hp + heal);
        openOverlay(`<div class="result-card">
          <h1>连胜 ${this.streak}</h1>
          <div class="winner-av" style="background:linear-gradient(135deg,var(--cn-gold),#b8860b)">${avatarChar(this.hero.name)}</div>
          <div class="wname">${this.hero.name} 斩将！</div>
          <div class="wdesc">击败 ${BATTLE.p2.g.name}！<br>战后恢复体力 ${heal} 点，下一阵对手更强。</div>
          <div class="btns">
            <button class="btn-primary" id="g-next">迎战下一员</button>
            <button class="btn-ghost" id="g-quit">鸣金收兵</button>
          </div></div>`);
        $("#g-next").onclick = () => {
          closeOverlay();
          const carry = this.hero._carryHp;
          this.next();
          BATTLE.p1.hp = carry; updateBars($("#f-left"), BATTLE.p1);
        };
        $("#g-quit").onclick = () => { closeOverlay(); this.finish(false); };
      } else {
        AudioSystem.sfx.ko();
        this.finish(false, BATTLE.p2.g);
      }
    },
    finish(allCleared, killer) {
      if (this.rpg) { RPG.onGauntletResult(this.streak, allCleared, killer); return; }
      openOverlay(`<div class="result-card">
        <h1>${allCleared ? '天下无敌!' : '车轮战 · 终'}</h1>
        <div class="winner-av" style="background:linear-gradient(135deg,var(--cn-red),#7a1420)">${avatarChar(this.hero.name)}</div>
        <div class="wname">${this.hero.name}</div>
        <div class="wdesc">最终连胜 <b style="font-size:24px;color:var(--cn-red)">${this.streak}</b> 场！${allCleared ? '横扫两国群雄，无人可挡！' : (killer ? '终被 ' + killer.name + ' 所阻。' : '主动收兵。')}</div>
        <div class="btns">
          <button class="btn-primary" id="g-restart">重新挑战</button>
          <button class="btn-ghost" id="g-home">返回菜单</button>
        </div></div>`);
      $("#g-restart").onclick = () => { closeOverlay(); SelectUI.open("gauntlet"); };
      $("#g-home").onclick = () => { closeOverlay(); showScreen("home"); };
    },
  };

  /* ============================================================
   *  阵营大战（自动模拟 100 vs 100）
   * ============================================================ */
  const War = {
    running: false, mode: "fast", gen: 0, detached: false,
    // 中止进行中的大战：作废循环、解开等待的观战对决、复位界面
    abort() {
      this.gen++;
      this.aborted = true;
      this.running = false;
      $("#war-start").disabled = false;
      if (BATTLE && BATTLE.spectate) { BATTLE.busy = false; if (BATTLE.abortResolve) BATTLE.abortResolve(); }
    },
    // 同步模式开关高亮
    syncModeBtns() {
      $("#war-mode-fast").classList.toggle("active", this.mode === "fast");
      $("#war-mode-detail").classList.toggle("active", this.mode === "detail");
    },
    // 详情观战中点返回：脱离单挑画面，回到战报界面，本场大战继续（其余各阵快捷推进）
    detach() {
      if (!BATTLE || !BATTLE.spectate || BATTLE._detached) return;
      BATTLE._detached = true;
      this.detached = true;
      // 脱离后按钮切回「快捷」，回到战报界面
      this.mode = "fast";
      this.syncModeBtns();
      $("#war-duel").innerHTML = "";
      showScreen("war");
      $("#war-status").textContent = "已返回战报，阵营大战继续进行中…（点「详情」可重新进入观战）";
      // 立即从当前状态续算完这场对决（沿用轮换出招），并交给等待中的循环，使大战无缝继续
      const p1 = BATTLE.p1, p2 = BATTLE.p2;
      let turn = BATTLE.turn || firstMover(p1, p2), guard = 0;
      while (p1.hp > 0 && p2.hp > 0 && guard++ < 400) {
        const me = turn === "p1" ? p1 : p2, foe = turn === "p1" ? p2 : p1;
        resolveTurn(me, foe, aiChoosePlan(me, foe), turn);
        turn = turn === "p1" ? "p2" : "p1";
      }
      BATTLE.token = ++battleToken;     // 作废在飞的回合动画，避免污染后续
      BATTLE.busy = false;
      clearTimeout(BATTLE._autoTimer);
      const winner = p1.hp >= p2.hp ? p1.g : p2.g;
      const loser = winner === p1.g ? p2.g : p1.g;
      if (BATTLE.onWin) BATTLE.onWin(winner, loser);
    },
    setMode(m) {
      // 大战进行中：模式开关变为「观战 / 只看战报」的实时切换
      if (this.running) {
        if (m === "detail") {
          this.mode = "detail";
          this.detached = false;            // 下一阵起重新进入单挑画面观战
          this.syncModeBtns();
          $("#war-status").textContent = "下一阵将进入经典单挑画面继续观战…";
        } else {
          // 切到快捷：若正在单挑画面观战则脱离回战报，否则仅标记
          if (BATTLE && BATTLE.spectate && !BATTLE._detached) { this.detach(); return; }
          this.mode = "fast";
          this.detached = true;
          this.syncModeBtns();
          $("#war-duel").innerHTML = "";
        }
        return;
      }
      this.mode = m;
      this.syncModeBtns();
      if (m === "fast") $("#war-duel").innerHTML = "";
      $("#war-status").textContent = m === "detail"
        ? "详情模式：每一阵都将进入经典单挑画面亲历厮杀（可调速/中途返回）"
        : "点击「开战」，让两军百将随机捉对厮杀";
    },
    async start(hero) {
      if (this.running) return;
      this.running = true;
      this.aborted = false;
      this.detached = false;
      const myGen = ++this.gen;            // 本场大战的代号，被中止/重开后作废旧循环
      $("#war-start").disabled = true;
      $("#war-log").innerHTML = "";
      $("#war-duel").innerHTML = "";
      let cn = DB.bySide("cn").map(clone);
      let jp = DB.bySide("jp").map(clone);
      shuffle(cn); shuffle(jp);
      const total = Math.min(cn.length, jp.length);
      cn = cn.slice(0, total); jp = jp.slice(0, total);
      // RPG 英雄出战：替入其所属阵营的首位
      if (hero) { (hero.side === "cn" ? cn : jp)[0] = clone(hero); }
      let heroKills = 0;
      const kills = new Map();  // 击杀榜：fighter -> {g, kills}
      const bump = g => { const k = kills.get(g) || { g, kills: 0 }; k.kills++; kills.set(g, k); };
      $("#war-cn").textContent = cn.length;
      $("#war-jp").textContent = jp.length;
      $("#war-rank").innerHTML = "";
      $("#war-status").textContent = hero ? `${hero.name} 率军出阵…` : "两军捉对厮杀中…";

      // 各自为队列，轮番派将对决，败者出局，胜者保留（带伤）继续
      let cnIdx = 0, jpIdx = 0;
      let cnFighter = cn[cnIdx], jpFighter = jp[jpIdx];
      let battleNo = 0;
      while (this.gen === myGen && !this.aborted && cnIdx < cn.length && jpIdx < jp.length) {
        battleNo++;

        // 详情模式：切到经典单挑画面，自动演完整场；快捷模式：直接结算
        let res;
        // 详情模式且未脱离观战：进入经典单挑画面演完整场；否则（快捷/已返回）直接结算
        const showDuel = this.mode === "detail" && !this.detached;
        if (showDuel) {
          res = await autoPlayBattle(cnFighter, jpFighter, {
            title: `阵营大战 · 第 ${battleNo} 阵`,
            intro: `${cnFighter.name}（${sideName(cnFighter.side)}） 对阵 ${jpFighter.name}（${sideName(jpFighter.side)}）`,
          });
          if (this.gen !== myGen || this.aborted || !res) return;  // 被中止/接管：安静退出
        } else {
          res = autoBattle(cnFighter, jpFighter);
        }
        const winSide = res.winner.side;
        bump(res.winner);  // res.winner 即 cnFighter 或 jpFighter 本身
        if (hero && res.winner.id === -1) heroKills++;

        const wlog = $("#war-log");
        const ln = document.createElement("div");
        ln.className = winSide === "cn" ? "w-cn" : "w-jp";
        const mark = g => g.id === -1 ? "★" + g.name : g.name;
        ln.innerHTML = `${pad(battleNo)} ${mark(cnFighter)} ⚔ ${mark(jpFighter)} → <b>${mark(res.winner)}</b> 胜 (${res.rounds}回合)`;
        wlog.appendChild(ln);
        wlog.scrollTop = wlog.scrollHeight;
        this.renderRank(kills);

        if (res.winner.side === "cn") { jpIdx++; jpFighter = jp[jpIdx]; }
        else { cnIdx++; cnFighter = cn[cnIdx]; }

        $("#war-cn").textContent = cn.length - cnIdx;
        $("#war-jp").textContent = jp.length - jpIdx;
        if (!showDuel) AudioSystem.sfx.hit();
        await sleep(showDuel ? 220 : (this.detached ? 80 : (hero ? 90 : 140)));
      }
      if (this.gen !== myGen) return;     // 已被新的大战接管，勿动共享状态
      if (this.aborted) { this.running = false; $("#war-start").disabled = false; return; }
      $("#war-duel").innerHTML = "";
      if (this.mode === "detail") showScreen("war");   // 详情打完回到战报界面再公布战果
      const cnWin = cnIdx < cn.length;
      $("#war-status").textContent = cnWin ? "🐲 三国 全军获胜！" : "🏯 战国 全军获胜！";
      AudioSystem.sfx.victory();
      const champ = cnWin ? cnFighter : jpFighter;
      const survivors = cnWin ? cn.length - cnIdx : jp.length - jpIdx;
      this.running = false;
      $("#war-start").disabled = false;
      if (hero) { const heroSideWon = (cnWin ? "cn" : "jp") === hero.side; RPG.onWarResult(heroKills, heroSideWon, cnWin); return; }
      const bg = cnWin ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
      openOverlay(`<div class="result-card">
        <h1>${cnWin ? '三国' : '战国'} 胜!</h1>
        <div class="winner-av" style="background:${bg}">${avatarChar(champ.name)}</div>
        <div class="wname">最后的胜者：${champ.name}</div>
        <div class="wdesc">${cnWin ? '三国' : '战国'}阵营尚余 <b>${survivors}</b> 将，力压群雄，问鼎此役！</div>
        <div class="btns">
          <button class="btn-primary" id="war-again">再战一役</button>
          <button class="btn-ghost" id="war-home">返回菜单</button>
        </div></div>`);
      $("#war-again").onclick = () => { closeOverlay(); this.start(); };
      $("#war-home").onclick = () => { closeOverlay(); showScreen("home"); };
    },
    // 击杀数排行榜（取前 8）
    renderRank(kills) {
      const top = [...kills.values()].sort((a, b) => b.kills - a.kills).slice(0, 8);
      $("#war-rank").innerHTML = `<div class="wr-title">⚔ 击杀排行榜</div>` + top.map((s, i) =>
        `<div class="wr-row ${s.g.side}"><span class="wr-no">${i + 1}</span><span class="wr-name">${s.g.id === -1 ? '★' : ''}${s.g.name}</span><span class="wr-k">${s.kills}</span></div>`).join("");
    },
    open() {
      $("#war-cn").textContent = DB.bySide("cn").length;
      $("#war-jp").textContent = DB.bySide("jp").length;
      $("#war-log").innerHTML = "";
      $("#war-duel").innerHTML = "";
      $("#war-rank").innerHTML = "";
      $("#war-start").disabled = false;   // 确保任何进入路径都可再次开战
      $("#war-status").textContent = this.mode === "detail"
        ? "详情模式：每一阵都将进入经典单挑画面亲历厮杀（可调速/中途返回）"
        : "点击「开战」，让两军百将随机捉对厮杀";
      showScreen("war");
    },
  };
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
  function pad(n) { return ("#" + n).padEnd(4, " "); }
  function sideName(side) { return side === "cn" ? "三国" : "战国"; }

  /* ============================================================
   *  数据库管理界面
   * ============================================================ */
  /* ============================================================
   *  武将世界杯：随机分组 → 小组循环赛(取前二) → 单败淘汰
   * ============================================================ */
  const Tournament = {
    size: 16, participants: [], groups: [], koRounds: [], koOffsets: [], champion: null, stage: "setup",
    busy: false, grpReveal: null, grpActive: -1, koReveal: 0, koActive: -1,
    rpgMode: false, fight: null,
    GROUP_NAMES: "ABCDEFGH".split(""),

    open() {
      this.stage = "setup"; this.rpgMode = false; this.fight = null; this.busy = false;
      $("#cup-setup").style.display = "";
      $("#cup-content").innerHTML = "";
      $$(".cup-size").forEach(b => b.classList.toggle("active", +b.dataset.size === this.size));
      showScreen("cup");
    },
    setSize(n) { this.size = n; $$(".cup-size").forEach(b => b.classList.toggle("active", +b.dataset.size === n)); },
    beginRandom() {
      const pool = DB.list.slice(); shuffle(pool);
      this.begin(pool.slice(0, this.size));
    },
    begin(parts) {
      parts = parts.slice(0, this.size);
      // 不足则随机补满
      if (parts.length < this.size) {
        const have = new Set(parts.map(p => p.id));
        const pool = DB.list.filter(g => !have.has(g.id)); shuffle(pool);
        while (parts.length < this.size && pool.length) parts.push(pool.shift());
      }
      this.participants = parts.map(clone);
      $("#cup-setup").style.display = "none";
      this.draw();
      showScreen("cup");
    },
    draw() {
      shuffle(this.participants);
      const n = this.size, gcount = n / 4;
      this.groups = [];
      for (let i = 0; i < gcount; i++) {
        this.groups.push({ name: this.GROUP_NAMES[i], teams: this.participants.slice(i * 4, i * 4 + 4), table: [], adv: [] });
      }
      this.koRounds = []; this.koOffsets = []; this.champion = null;
      this.grpReveal = null; this.grpActive = -1; this.koReveal = 0; this.koActive = -1;
      this.cupExp = 0;   // 本届世界杯累计的「单挑获胜经验」
      this.stage = "drawn";
      this.render();
    },
    async runGroups() {
      if (this.busy) return; this.busy = true;
      this.grpReveal = 0; this.grpActive = -1;
      for (let gi = 0; gi < this.groups.length; gi++) {
        const grp = this.groups[gi];
        this.grpActive = gi; this.render();
        await sleep(360);
        const stat = new Map(grp.teams.map(t => [t.id, { g: t, w: 0, l: 0, hp: 0 }]));
        const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
        for (const [i, j] of pairs) {
          const a = grp.teams[i], b = grp.teams[j];
          let winnerId, aHp, bHp;
          if (this.rpgMode && (a.id === -1 || b.id === -1)) {
            // 轮到自选武将：手动单挑
            const r = await this.playManualMatch(a, b, `世界杯·${grp.name}组`);
            winnerId = r.winner.id; aHp = r.finalHp[0]; bHp = r.finalHp[1];
            if (winnerId === -1) this.cupExp += RPG.winExp(ratingScore(RPG.heroGeneral()), ratingScore(a.id === -1 ? b : a));
          } else {
            const res = autoBattle(a, b);
            aHp = res.p1.g.id === a.id ? res.p1.hp : res.p2.hp;
            bHp = res.p1.g.id === b.id ? res.p1.hp : res.p2.hp;
            winnerId = res.winner.id;
          }
          const sa = stat.get(a.id), sb = stat.get(b.id);
          sa.hp += Math.max(0, aHp); sb.hp += Math.max(0, bHp);
          if (winnerId === a.id) { sa.w++; sb.l++; } else { sb.w++; sa.l++; }
        }
        grp.table = [...stat.values()].sort((x, y) => y.w - x.w || y.hp - x.hp);
        grp.adv = grp.table.slice(0, 2).map(s => s.g);
        this.grpReveal = gi + 1; this.grpActive = -1;
        AudioSystem.sfx.hit();
        this.render();
        await sleep(200);
      }
      this.stage = "groups"; this.busy = false; this.render();
    },
    async runKnockout() {
      if (this.busy) return; this.busy = true;
      // 世界杯式交叉布阵：每两组之间 胜者×负者 交叉
      const ko = [];
      for (let k = 0; k < this.groups.length; k += 2) {
        const g1 = this.groups[k], g2 = this.groups[k + 1];
        ko.push(g1.adv[0], g2.adv[1], g2.adv[0], g1.adv[1]);
      }
      // RPG 模式：英雄场手动单挑，逐轮即时进行
      if (this.rpgMode) { await this.runKnockoutRpg(ko); return; }
      // 预先算出全部结果（含逐回合体力序列）
      this.koRounds = []; this.koOffsets = [];
      let arr = ko, off = 0;
      while (arr.length > 1) {
        const matches = [];
        for (let i = 0; i < arr.length; i += 2) {
          const res = autoBattle(arr[i], arr[i + 1]);
          matches.push({ a: arr[i], b: arr[i + 1], winner: res.winner, rounds: res.rounds, hpSeq: res.hpSeq, startHp: res.startHp, finalHp: res.hpSeq[res.hpSeq.length - 1] });
        }
        this.koOffsets.push(off); off += matches.length;
        this.koRounds.push({ name: this.roundName(arr.length), matches });
        arr = matches.map(m => m.winner);
      }
      const total = off;
      // 逐场揭晓动画（体力数字逐回合递减）
      this.stage = "ko"; this.koReveal = 0; this.koActive = -1; this.champion = null; this.fight = null;
      this.render(); this.scrollTree();
      for (let gi = 0; gi < total; gi++) {
        const match = this.matchByGi(gi);
        this.koActive = gi;
        this.fight = { a: match.a, b: match.b, aHp: match.startHp[0], bHp: match.startHp[1] };
        this.render(); this.scrollTree();
        await sleep(350);
        // 逐回合扣血动画
        for (let s = 1; s < match.hpSeq.length; s++) {
          this.fight.aHp = match.hpSeq[s][0]; this.fight.bHp = match.hpSeq[s][1];
          this.updateFightHp(); AudioSystem.sfx.hit();
          await sleep(260);
        }
        await sleep(280);
        this.koReveal = gi + 1; this.koActive = -1; this.fight = null;
        this.render(); this.scrollTree();
        await sleep(160);
      }
      this.champion = arr[0];
      this.stage = "done";
      AudioSystem.sfx.victory();
      this.busy = false; this.render();
      if (this.rpgMode) { this.rpgMode = false; RPG.onCupResult(this.heroPlacement()); }
    },

    // RPG 淘汰赛：逐轮即时，英雄场手动单挑、其余自动并演示体力
    async runKnockoutRpg(initial) {
      this.koRounds = []; this.koOffsets = [];
      this.stage = "ko"; this.koReveal = 0; this.koActive = -1; this.champion = null; this.fight = null;
      let arr = initial, off = 0;
      while (arr.length > 1) {
        const rname = this.roundName(arr.length);
        const matches = [];
        for (let i = 0; i < arr.length; i += 2) matches.push({ a: arr[i], b: arr[i + 1], winner: null });
        this.koOffsets.push(off);
        this.koRounds.push({ name: rname, matches });
        this.render(); this.scrollTree();
        const winners = [];
        for (let mi = 0; mi < matches.length; mi++) {
          const m = matches[mi], gi = off + mi;
          if (m.a.id === -1 || m.b.id === -1) {
            const r = await this.playManualMatch(m.a, m.b, `世界杯·${rname}`);
            m.winner = r.winner; m.finalHp = r.finalHp;
            if (r.winner.id === -1) this.cupExp += RPG.winExp(ratingScore(RPG.heroGeneral()), ratingScore(m.a.id === -1 ? m.b : m.a));
            this.koReveal = gi + 1; this.render(); this.scrollTree(); await sleep(200);
          } else {
            const res = autoBattle(m.a, m.b);
            m.winner = res.winner; m.finalHp = res.hpSeq[res.hpSeq.length - 1];
            this.koActive = gi; this.fight = { a: m.a, b: m.b, aHp: res.startHp[0], bHp: res.startHp[1] };
            this.render(); this.scrollTree(); await sleep(280);
            for (let s = 1; s < res.hpSeq.length; s++) { this.fight.aHp = res.hpSeq[s][0]; this.fight.bHp = res.hpSeq[s][1]; this.updateFightHp(); AudioSystem.sfx.hit(); await sleep(150); }
            await sleep(150);
            this.koActive = -1; this.fight = null; this.koReveal = gi + 1; this.render(); this.scrollTree(); await sleep(120);
          }
          winners.push(m.winner);
        }
        off += matches.length;
        arr = winners;
      }
      this.champion = arr[0];
      this.stage = "done"; AudioSystem.sfx.victory();
      this.busy = false; this.render();
      this.rpgMode = false;
      RPG.onCupResult(this.heroPlacement(), this.cupExp);
    },

    // 手动单挑一场（用于世界杯英雄场），resolve 出胜者与终局体力
    // 始终让自选武将(英雄)落在左侧(p1)由玩家操控，再把体力按对阵(a,b)顺序还原
    playManualMatch(a, b, title) {
      const heroIsB = b.id === -1;           // 英雄在对阵右侧 → 入场时交换到左侧
      const left = heroIsB ? b : a, right = heroIsB ? a : b;
      return new Promise(res => {
        startClassicBattle(left, right, false, false);
        $("#battle-title").textContent = title || "世界杯";
        BATTLE.cupResolve = () => {
          const winner = BATTLE.p1.hp > 0 ? BATTLE.p1.g : BATTLE.p2.g;
          const hL = Math.max(0, Math.round(BATTLE.p1.hp)), hR = Math.max(0, Math.round(BATTLE.p2.hp));
          // 还原为对阵 (a,b) 顺序：若交换过，则 a=右、b=左
          res({ winner, finalHp: heroIsB ? [hR, hL] : [hL, hR] });
        };
      });
    },
    matchByGi(gi) {
      for (let r = 0; r < this.koRounds.length; r++) {
        const len = this.koRounds[r].matches.length;
        if (gi < this.koOffsets[r] + len) return this.koRounds[r].matches[gi - this.koOffsets[r]];
      }
      return null;
    },
    updateFightHp() {
      const a = $("#hp-0"), b = $("#hp-1");
      if (a) a.textContent = Math.max(0, this.fight.aHp);
      if (b) b.textContent = Math.max(0, this.fight.bHp);
    },
    // RPG 英雄(id=-1)最终名次
    heroPlacement() {
      if (!this.champion) return null;
      if (this.champion.id === -1) return { label: "夺冠", exp: 260 };
      // 是否进入淘汰赛
      const advanced = this.groups.some(g => g.adv.some(a => a.id === -1));
      if (!advanced) return { label: "小组未出线", exp: 0 }; // 未出线无晋级奖励
      let lastRound = -1;
      for (let r = 0; r < this.koRounds.length; r++) {
        for (const m of this.koRounds[r].matches) {
          if ((m.a.id === -1 || m.b.id === -1)) { lastRound = r; if (m.winner.id !== -1) { return { label: this.koRounds[r].name + "止步", exp: 50 + r * 45 }; } }
        }
      }
      return { label: "出线", exp: 70 };
    },
    scrollTree() { const t = $("#cup-content .cup-tree"); if (t) t.scrollLeft = t.scrollWidth; },
    roundName(n) {
      return ({ 16: "十六强赛", 8: "八强赛", 4: "半决赛", 2: "决赛" })[n] || (n + "强赛");
    },

    heroMark(g) { return g && g.id === -1 ? "★" : ""; },
    // 对阵树某场的某一方名字（依揭晓进度决定是否已知）
    slotInfo(r, m, slot) {
      const match = this.koRounds[r].matches[m];
      if (r === 0) { const g = slot === 0 ? match.a : match.b; return { name: g.name, side: g.side, hero: g.id === -1 }; }
      const feederGi = this.koOffsets[r - 1] + (m * 2 + slot);
      if (feederGi < this.koReveal) { const g = slot === 0 ? match.a : match.b; return { name: g.name, side: g.side, hero: g.id === -1 }; }
      return { name: "？", side: "", hero: false };
    },

    render() {
      const C = $("#cup-content");
      let h = "";
      if (this.champion) {
        const c = this.champion;
        h += `<div class="cup-champ ${c.side}">
          <div class="cc-cup">🏆</div>
          <div class="cc-name">${c.name}</div>
          <div class="cc-sub">${c.side === 'cn' ? '三国' : '战国'} · ${c.title || ''}</div>
          <div class="cc-tag">世 界 杯 冠 军</div></div>`;
      }
      // 控制按钮
      h += `<div class="cup-actions">`;
      if (this.stage === "drawn" && !this.busy) h += `<button class="cup-go primary" id="cup-run-groups">⚔ 开始小组赛</button>`;
      if (this.stage === "groups" && !this.busy) h += `<button class="cup-go primary" id="cup-run-ko">🔥 进入淘汰赛</button>`;
      if (!this.busy) h += `<button class="cup-go" id="cup-redraw">↺ 重新抽签</button>`;
      if (this.busy) h += `<div class="cup-running">⚔ 激战中…</div>`;
      h += `</div>`;

      // 淘汰赛对阵树（蜘蛛/树状图，左→右）
      if (this.koRounds && this.koRounds.length) {
        h += `<div class="cup-tree">`;
        for (let r = 0; r < this.koRounds.length; r++) {
          const rd = this.koRounds[r];
          h += `<div class="tree-col"><div class="tree-col-name">${rd.name}</div><div class="tree-col-body">`;
          for (let m = 0; m < rd.matches.length; m++) {
            const gi = this.koOffsets[r] + m;
            const decided = gi < this.koReveal, active = gi === this.koActive;
            const A = this.slotInfo(r, m, 0), B = this.slotInfo(r, m, 1);
            const match = rd.matches[m];
            const aw = decided && match.winner.id === match.a.id;
            const bw = decided && match.winner.id === match.b.id;
            // 体力数字（紧挨姓名）：当前场实时递减，已决出场显示终值
            const hpA = active ? `<span class="ts-hp" id="hp-0">${this.fight ? this.fight.aHp : ''}</span>`
              : (decided ? `<span class="ts-hp">${match.finalHp[0]}</span>` : "");
            const hpB = active ? `<span class="ts-hp" id="hp-1">${this.fight ? this.fight.bHp : ''}</span>`
              : (decided ? `<span class="ts-hp">${match.finalHp[1]}</span>` : "");
            h += `<div class="tree-match ${active ? 'active' : ''} ${decided ? 'done' : ''}">
              <div class="tree-slot ${A.side} ${A.hero ? 'hero' : ''} ${aw ? 'win' : (decided ? 'lose' : '')}"><span class="ts-name">${A.hero ? '★' : ''}${A.name}</span>${hpA}</div>
              <div class="tree-slot ${B.side} ${B.hero ? 'hero' : ''} ${bw ? 'win' : (decided ? 'lose' : '')}"><span class="ts-name">${B.hero ? '★' : ''}${B.name}</span>${hpB}</div>
              ${active ? '<div class="tree-fight">⚔</div>' : ''}</div>`;
          }
          h += `</div></div>`;
        }
        // 冠军列
        h += `<div class="tree-col champ-col"><div class="tree-col-name">冠军</div><div class="tree-col-body">
          <div class="tree-match champ ${this.champion ? this.champion.side : ''}">
            <div class="tree-slot champ-slot">${this.champion ? '👑 ' + this.heroMark(this.champion) + this.champion.name : '？'}</div></div></div></div>`;
        h += `</div>`;
      }

      // 小组
      h += `<div class="cup-groups">`;
      for (let gi = 0; gi < this.groups.length; gi++) {
        const grp = this.groups[gi];
        const revealed = this.grpReveal != null && gi < this.grpReveal && grp.table.length;
        const active = gi === this.grpActive;
        h += `<div class="cup-group ${active ? 'active' : ''}"><div class="cg-name">${grp.name} 组${active ? ' ⚔' : ''}</div>`;
        if (revealed) {
          h += `<table class="cg-table"><tr><th>武将</th><th>胜</th><th>负</th></tr>`;
          grp.table.forEach((s, idx) => {
            h += `<tr class="${idx < 2 ? 'adv' : ''} ${s.g.side}"><td>${idx < 2 ? '✓ ' : ''}${this.heroMark(s.g)}${s.g.name}</td><td>${s.w}</td><td>${s.l}</td></tr>`;
          });
          h += `</table>`;
        } else {
          h += grp.teams.map(t => `<div class="cg-member ${t.side}">${this.heroMark(t)}${t.name}</div>`).join("");
        }
        h += `</div>`;
      }
      h += `</div>`;
      C.innerHTML = h;

      const rg = $("#cup-run-groups"); if (rg) rg.onclick = () => this.runGroups();
      const rk = $("#cup-run-ko"); if (rk) rk.onclick = () => this.runKnockout();
      const rd = $("#cup-redraw"); if (rd) rd.onclick = () => { this.koRounds = []; this.grpReveal = null; this.draw(); };
    },
  };

  /* ============================================================
   *  角色扮演：自创/选用武将，随机六维(基线+加点)，历练获经验成长
   * ============================================================ */
  const RPG_KEY = "wujiang_rpg_v1";
  function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  const RPG = {
    char: null,
    load() { try { this.char = JSON.parse(localStorage.getItem(RPG_KEY)); } catch { this.char = null; } },
    save() { localStorage.setItem(RPG_KEY, JSON.stringify(this.char)); },
    expNeed(lv) { return 80 + lv * 70; },
    eff(c, k) { return c.base[k] + (c.alloc[k] || 0); },
    heroGeneral() {
      const c = this.char;
      const g = { id: -1, name: c.name, side: c.side, title: `Lv.${c.level} 历练者`, intro: c.intro || "你亲手培养的武将。" };
      DIMS.forEach(([k]) => g[k] = this.eff(c, k));
      return g;
    },
    // 随机生成基线六维(最大不超过80) + 一笔由玩家自行分配的加点(最多30)
    rollStats() {
      const base = {};
      DIMS.forEach(([k]) => base[k] = randInt(45, 80));
      return { base, points: randInt(18, 30) };
    },

    open() {
      this.load();
      if (this.char) this.renderHub();
      else this.renderCreate();
      showScreen("rpg");
    },

    /* ---- 创建 ---- */
    renderCreate(tab) {
      tab = tab || "custom";
      const C = $("#rpg-content");
      let h = `<div class="rpg-create">
        <div class="section-hint">创建你的专属武将：随机基线六维，出道后自行分配加点成长</div>
        <div class="side-tabs">
          <div class="rpg-ctab ${tab === 'custom' ? 'active' : ''}" data-tab="custom">✦ 自创武将</div>
          <div class="rpg-ctab ${tab === 'pick' ? 'active' : ''}" data-tab="pick">📜 选用名将</div>
        </div>`;
      if (tab === "custom") {
        if (!this._roll) this._roll = this.rollStats();
        const r = this._roll;
        h += `<div class="rpg-form">
          <div class="rf-row"><label>姓名</label><input id="rpg-name" maxlength="6" placeholder="输入名字" value="${this._name || ''}"></div>
          <div class="rf-row"><label>阵营</label>
            <select id="rpg-side"><option value="cn">三国 风</option><option value="jp">战国 风</option></select></div>
          <div class="rpg-roll-box">${DIMS.map(([k, l]) => {
            const v = r.base[k];
            return `<div class="rr-dim"><span>${l}</span>
              <span class="rr-track"><span class="rr-bar" style="width:${Math.min(100, v / 1.2)}%;background:${gradeColor(v)}"></span></span>
              <b>${v}</b>${gradeChip(v)}</div>`;
          }).join("")}
            <div class="rr-sum">基线评分 <b>${ratingScore(r.base)}</b> ${ratingChip(r.base)} · 可分配加点 <b style="color:var(--cn-gold)">${r.points}</b></div>
          </div>
          <div class="rpg-create-btns">
            <button class="cup-go" id="rpg-reroll">🎲 重新随机</button>
            <button class="cup-go primary" id="rpg-create-go">✓ 出道（去分配加点）</button>
          </div></div>`;
      } else {
        h += `<div class="section-hint">从武将库选一位作为你的角色（以其属性为基线，后续可成长）</div>
          <div class="search-box"><input id="rpg-search" placeholder="搜索…"></div>
          <div class="grid" id="rpg-pick-grid"></div>`;
      }
      h += `</div>`;
      C.innerHTML = h;
      $$(".rpg-ctab").forEach(t => t.onclick = () => { this._roll = null; this.renderCreate(t.dataset.tab); });
      if (tab === "custom") {
        $("#rpg-reroll").onclick = () => { this._name = $("#rpg-name").value; this._roll = this.rollStats(); this.renderCreate("custom"); };
        $("#rpg-create-go").onclick = () => {
          const name = ($("#rpg-name").value || "").trim() || "无名客";
          this.create(name, $("#rpg-side").value, this._roll.base, this._roll.points);
        };
      } else {
        this.renderPickGrid();
        $("#rpg-search").oninput = () => this.renderPickGrid();
      }
    },
    renderPickGrid() {
      const kw = ($("#rpg-search").value || "").trim();
      let arr = DB.list.slice().sort((a, b) => ratingScore(b) - ratingScore(a));
      if (kw) arr = arr.filter(g => g.name.includes(kw));
      $("#rpg-pick-grid").innerHTML = arr.slice(0, 80).map(g =>
        `<div class="card ${g.side}" data-id="${g.id}"><div class="avatar">${avatarChar(g.name)}</div>
          <div class="cname">${g.name}</div><div class="cwu">评分 ${ratingScore(g)} ${ratingChip(g)}</div></div>`).join("");
      $$("#rpg-pick-grid .card").forEach(c => c.onclick = () => {
        const g = DB.get(+c.dataset.id);
        const base = {}; DIMS.forEach(([k]) => base[k] = g[k]);
        this.create(g.name, g.side, base, 15, g.title); // 名将以其属性为基线，另赠 15 加点
      });
    },
    create(name, side, base, points, title) {
      const alloc = {}; DIMS.forEach(([k]) => alloc[k] = 0);
      this.char = { name, side, title: title || "", base: clone(base), alloc, level: 1, exp: 0, points: points || 0, wins: 0, losses: 0 };
      this._roll = null; this._name = "";
      this.save(); AudioSystem.sfx.victory(); this.renderHub();
    },

    /* ---- 主面板 ---- */
    renderHub() {
      const c = this.char, C = $("#rpg-content");
      const need = this.expNeed(c.level), expPct = Math.min(100, c.exp / need * 100);
      const sum = DIMS.reduce((s, [k]) => s + this.eff(c, k), 0);
      const dims = DIMS.map(([k, l]) => {
        const v = this.eff(c, k);
        return `<div class="rpg-dim">
          <span class="rd-lbl">${l}</span>
          <span class="rd-track"><span class="rd-bar" style="width:${Math.min(100, v / 1.2)}%;background:${gradeColor(v)}"></span></span>
          <span class="rd-val">${v}</span>${gradeChip(v)}
          <button class="rd-plus" data-k="${k}" ${c.points > 0 ? '' : 'disabled'}>＋</button>
        </div>`;
      }).join("");
      C.innerHTML = `<div class="rpg-hub">
        <div class="rpg-card ${c.side}">
          <div class="rpg-av">${avatarChar(c.name)}</div>
          <div class="rpg-meta">
            <div class="rpg-name">${c.name} <span class="rpg-lv">Lv.${c.level}</span></div>
            <div class="rpg-side-tag">${c.side === 'cn' ? '三国风' : '战国风'} · 战绩 ${c.wins}胜${c.losses}负</div>
            <div class="rpg-exp"><span class="rpg-exp-fill" style="width:${expPct}%"></span><span class="rpg-exp-txt">EXP ${c.exp}/${need}</span></div>
          </div>
        </div>
        <div class="rpg-overview">
          <div class="rpg-radar">${radarSVG(this.heroGeneral(), 190)}</div>
          <div class="rpg-total">
            <div class="rt-lbl">武将评分 ${ratingChip(this.heroGeneral())}</div>
            <div class="rt-num">${ratingScore(this.heroGeneral())}</div>
            <div class="rt-grade">六维 ${sum} + 突出 ${Math.round(ratingScore(this.heroGeneral()) - sum)}</div>
          </div>
        </div>
        <div class="rpg-points">可分配加点：<b>${c.points}</b> ${c.points > 0 ? '（点 ＋ 分配）' : ''}</div>
        <div class="rpg-dims">${dims}</div>
        <div class="rpg-actions">
          <button class="cup-go primary" id="rpg-train">⚔ 历练单挑</button>
          <button class="cup-go primary" id="rpg-gauntlet">🔥 车轮大战</button>
          <button class="cup-go primary" id="rpg-war">🚩 阵营大战</button>
          <button class="cup-go primary" id="rpg-cup16">🏆 世界杯 16 强</button>
          <button class="cup-go primary" id="rpg-cup32">🏆 世界杯 32 强</button>
          <button class="cup-go" id="rpg-rename">✎ 改名</button>
          <button class="cup-go" id="rpg-reset">↺ 重建角色</button>
        </div>
        <div class="section-hint">历练 / 车轮 / 阵营 / 世界杯 均可获得经验，升级获得加点；战绩越好经验越多。</div>
      </div>`;
      $$(".rd-plus").forEach(b => b.onclick = () => this.allocate(b.dataset.k));
      $("#rpg-train").onclick = () => this.train();
      $("#rpg-gauntlet").onclick = () => this.gauntlet();
      $("#rpg-war").onclick = () => this.war();
      $("#rpg-cup16").onclick = () => this.joinCup(16);
      $("#rpg-cup32").onclick = () => this.joinCup(32);
      $("#rpg-rename").onclick = () => {
        const n = prompt("新的名字：", c.name); if (n && n.trim()) { c.name = n.trim().slice(0, 6); this.save(); this.renderHub(); }
      };
      $("#rpg-reset").onclick = () => { if (confirm("放弃当前角色，重新创建？")) { this.char = null; localStorage.removeItem(RPG_KEY); this.renderCreate(); } };
    },
    allocate(k) {
      if (this.char.points <= 0) return;
      if (this.eff(this.char, k) >= 120) { toast("该维度已达上限 120"); return; }
      this.char.alloc[k] = (this.char.alloc[k] || 0) + 1;
      this.char.points--;
      AudioSystem.sfx.select();
      this.save(); this.renderHub();
    },

    /* ---- 历练 ---- */
    train() {
      const pool = DB.list;
      const opp = clone(pool[randInt(0, pool.length - 1)]);
      startClassicBattle(this.heroGeneral(), opp, false, true);
    },
    // 单挑获胜经验：以「武将评分」比较，胜过评分更高者按差值比例大增，胜过更低者微增
    winExp(heroScore, oppScore) {
      const diff = oppScore - heroScore;
      if (diff > 0) return 40 + Math.round(diff / heroScore * 600);
      return Math.max(8, 20 + Math.round(diff / 25));
    },
    onBattleEnd(heroWon, opp) {
      const c = this.char;
      const heroSum = ratingScore(this.heroGeneral()), oppSum = ratingScore(opp);
      const diff = oppSum - heroSum;   // >0 表示对手更强
      let gain, tag = "";
      if (heroWon) {
        gain = this.winExp(heroSum, oppSum);
        tag = diff > 0 ? "（以弱胜强，经验大增！）" : "（击败较弱者，经验微增）";
      } else {
        gain = 10 + Math.round(Math.max(0, diff) / 30);
      }
      if (heroWon) c.wins++; else c.losses++;
      c.exp += gain;
      let lvUp = 0;
      while (c.exp >= this.expNeed(c.level)) { c.exp -= this.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
      this.save();
      const bg = c.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
      openOverlay(`<div class="result-card">
        <h1>${heroWon ? '历练胜利' : '虽败犹荣'}</h1>
        <div class="winner-av" style="background:${bg}">${avatarChar(c.name)}</div>
        <div class="wname">${c.name}</div>
        <div class="wdesc">${heroWon ? '击败' : '不敌'} ${opp.name}（武将评分 ${oppSum} / 你 ${heroSum}）${tag}<br>获得经验 <b style="color:var(--cn-red)">+${gain}</b>
          ${lvUp ? `<br>🎉 升级 ${lvUp} 级！获得加点 <b style="color:var(--cn-red)">+${lvUp * 1}</b>` : ''}</div>
        <div class="btns">
          <button class="btn-primary" id="rpg-again">再历练</button>
          <button class="btn-ghost" id="rpg-hub">返回养成</button>
        </div></div>`);
      $("#rpg-again").onclick = () => { closeOverlay(); this.train(); };
      $("#rpg-hub").onclick = () => { closeOverlay(); this.renderHub(); showScreen("rpg"); };
    },

    /* ---- 报名世界杯（16 / 32 强） ---- */
    joinCup(size) {
      Tournament.size = size || 16;
      const hero = this.heroGeneral();
      const pool = DB.list.slice(); shuffle(pool);
      const parts = [hero, ...pool.slice(0, Tournament.size - 1)];
      shuffle(parts);
      Tournament.rpgMode = true;
      Tournament.begin(parts);
    },

    /* ---- 车轮大战 ---- */
    gauntlet() { Gauntlet.start(this.heroGeneral(), true); },
    onGauntletResult(streak, allCleared, killer) {
      const exp = streak * 25 + (allCleared ? 200 : 0);
      this.grantExp(exp, "车轮大战 · 连胜 " + streak,
        `连斩 <b style="color:var(--cn-red)">${streak}</b> 员${allCleared ? '，横扫群雄！' : (killer ? '，终被 ' + killer.name + ' 所阻。' : '。')}`,
        () => this.gauntlet());
    },

    /* ---- 阵营大战 ---- */
    war() { showScreen("war"); $("#war-log").innerHTML = ""; $("#war-status").textContent = "整军待发…"; setTimeout(() => War.start(this.heroGeneral()), 60); },
    onWarResult(kills, sideWon) {
      const exp = kills * 22 + (sideWon ? 120 : 0);
      this.grantExp(exp, "阵营大战 " + (sideWon ? "· 获胜" : "· 落败"),
        `你麾下斩敌 <b style="color:var(--cn-red)">${kills}</b> 员，本方阵营${sideWon ? '获胜！' : '惜败。'}`,
        () => this.war());
    },

    // 统一发放经验/升级并弹窗
    grantExp(gain, title, descHtml, againFn) {
      const c = this.char;
      c.exp += gain;
      let lvUp = 0;
      while (c.exp >= this.expNeed(c.level)) { c.exp -= this.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
      this.save();
      const bg = c.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
      setTimeout(() => {
        openOverlay(`<div class="result-card">
          <h1>${title}</h1>
          <div class="winner-av" style="background:${bg}">${avatarChar(c.name)}</div>
          <div class="wname">${c.name}</div>
          <div class="wdesc">${descHtml}<br>获得经验 <b style="color:var(--cn-red)">+${gain}</b>
            ${lvUp ? `<br>🎉 升级 ${lvUp} 级！获得加点 <b style="color:var(--cn-red)">+${lvUp * 1}</b>` : ''}</div>
          <div class="btns">
            <button class="btn-primary" id="rpg-r-again">再来一次</button>
            <button class="btn-ghost" id="rpg-r-hub">返回养成</button>
          </div></div>`);
        $("#rpg-r-again").onclick = () => { closeOverlay(); againFn(); };
        $("#rpg-r-hub").onclick = () => { closeOverlay(); showScreen("rpg"); this.renderHub(); };
      }, 600);
    },
    onCupResult(placement, cupWinExp) {
      const c = this.char;
      if (!placement) { showScreen("rpg"); this.renderHub(); return; }
      const winGain = Math.round(cupWinExp || 0);   // 各场单挑获胜累计经验
      const bonus = placement.exp;                   // 按最终轮次的晋级奖励
      const gain = winGain + bonus;
      c.exp += gain;
      let lvUp = 0;
      while (c.exp >= this.expNeed(c.level)) { c.exp -= this.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
      this.save();
      const bg = c.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
      setTimeout(() => {
        openOverlay(`<div class="result-card">
          <h1>世界杯 · ${placement.label}</h1>
          <div class="winner-av" style="background:${bg}">${avatarChar(c.name)}</div>
          <div class="wname">${c.name}</div>
          <div class="wdesc">本届世界杯成绩：<b>${placement.label}</b><br>
            单挑获胜经验 <b style="color:var(--cn-red)">+${winGain}</b> · 晋级奖励 <b style="color:var(--cn-red)">+${bonus}</b><br>
            合计获得经验 <b style="color:var(--cn-red)">+${gain}</b>
            ${lvUp ? `<br>🎉 升级 ${lvUp} 级！获得加点 <b style="color:var(--cn-red)">+${lvUp * 1}</b>` : ''}</div>
          <div class="btns">
            <button class="btn-primary" id="rpg-cup-again">再战世界杯</button>
            <button class="btn-ghost" id="rpg-cup-hub">返回养成</button>
          </div></div>`);
        $("#rpg-cup-again").onclick = () => { closeOverlay(); this.joinCup(Tournament.size); };
        $("#rpg-cup-hub").onclick = () => { closeOverlay(); showScreen("rpg"); this.renderHub(); };
      }, 1200);
    },
  };

  const DBUI = {
    side: "cn",
    sort: { key: "rating", dir: -1 },   // 默认按武将评分从高到低
    open() { this.render(); showScreen("db"); },
    setSide(side) {
      this.side = side;
      $$(".side-tab", $("#screen-db")).forEach(t => t.classList.toggle("active", t.dataset.dbside === side));
      this.render();
    },
    sortBy(key) {
      if (this.sort.key === key) this.sort.dir *= -1;
      else this.sort = { key, dir: key === "name" ? 1 : -1 };
      this.render();
    },
    render() {
      const kw = $("#db-search").value.trim();
      let arr = DB.bySide(this.side).slice();
      if (kw) arr = arr.filter(g => g.name.includes(kw) || (g.title || "").includes(kw));
      // 排序
      const { key, dir } = this.sort;
      arr.sort((a, b) => {
        let va, vb;
        if (key === "name") return a.name.localeCompare(b.name, "zh") * dir;
        if (key === "rating") { va = ratingScore(a); vb = ratingScore(b); }
        else { va = a[key]; vb = b[key]; }
        return (va - vb) * dir;
      });
      const arrow = k => this.sort.key === k ? (this.sort.dir > 0 ? " ▲" : " ▼") : "";
      const th = (k, label) => `<th data-sort="${k}" class="${this.sort.key === k ? 'sorted' : ''}">${label}${arrow(k)}</th>`;
      const head = `<tr>${th("name", "姓名")}${DIMS.map(([k, l]) => th(k, l[0])).join("")}${th("rating", "评分")}<th>评级</th><th>操作</th></tr>`;
      const body = arr.map(g => {
        const cells = DIMS.map(([k]) => `<td class="num gt-${rateLetter(g[k])}">${g[k]}</td>`).join("");
        return `<tr data-id="${g.id}">
          <td class="dt-name ${g.side}"><span class="dt-dot"></span>${g.name}</td>
          ${cells}
          <td class="dt-total">${ratingScore(g)}</td>
          <td class="dt-grade">${ratingChip(g)}</td>
          <td class="dt-act">
            <button class="db-view" data-act="view">详</button>
            <button class="db-edit" data-act="edit">改</button>
            <button class="db-del" data-act="del">删</button>
          </td></tr>`;
      }).join("");
      $("#db-list").innerHTML = arr.length
        ? `<table class="db-table"><thead>${head}</thead><tbody>${body}</tbody></table>`
        : `<div class="empty">暂无武将</div>`;

      $$("#db-list th[data-sort]").forEach(h => h.onclick = () => this.sortBy(h.dataset.sort));
      $$("#db-list tbody tr").forEach(tr => {
        const id = +tr.dataset.id;
        $$("[data-act]", tr).forEach(btn => btn.onclick = e => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === "view") showDetail(DB.get(id));
          else if (act === "edit") this.edit(DB.get(id));
          else if (act === "del") { if (confirm(`确定删除「${DB.get(id).name}」？`)) { DB.remove(id); this.render(); toast("已删除"); } }
        });
        $(".dt-name", tr).onclick = () => showDetail(DB.get(id));
      });
    },
    edit(g) {
      const isNew = !g;
      g = g || { name: "", title: "", intro: "", side: this.side, ti: 90, wu: 80, tong: 70, zhi: 60, zheng: 60, mei: 70 };
      const f = (k, label, type = "number") =>
        `<div><label>${label}</label><input id="ef-${k}" type="${type}" value="${g[k] ?? ''}"></div>`;
      openOverlay(`<div class="result-card detail-card">
        <h1 style="font-size:22px">${isNew ? '新增武将' : '编辑武将'}</h1>
        <div class="form-grid" style="margin-top:14px">
          <div><label>姓名</label><input id="ef-name" value="${g.name}"></div>
          <div><label>阵营</label><select id="ef-side">
            <option value="cn" ${g.side === 'cn' ? 'selected' : ''}>三国</option>
            <option value="jp" ${g.side === 'jp' ? 'selected' : ''}>战国</option></select></div>
          <div class="full"><label>称号</label><input id="ef-title" value="${g.title || ''}"></div>
          <div class="full"><label>简介</label><textarea id="ef-intro">${g.intro || ''}</textarea></div>
          ${f('ti', '体力')}${f('wu', '武力')}${f('tong', '统帅')}${f('zhi', '智力')}${f('zheng', '政治')}${f('mei', '魅力')}
        </div>
        <div class="btns" style="margin-top:16px">
          <button class="btn-primary" id="ef-save">保存</button>
          <button class="btn-ghost" id="ef-cancel">取消</button>
        </div></div>`);
      $("#ef-cancel").onclick = closeOverlay;
      $("#ef-save").onclick = () => {
        const name = $("#ef-name").value.trim();
        if (!name) { toast("请填写姓名"); return; }
        const data = {
          name, side: $("#ef-side").value,
          title: $("#ef-title").value.trim(), intro: $("#ef-intro").value.trim(),
          ti: clampStat($("#ef-ti").value), wu: clampStat($("#ef-wu").value),
          tong: clampStat($("#ef-tong").value), zhi: clampStat($("#ef-zhi").value),
          zheng: clampStat($("#ef-zheng").value), mei: clampStat($("#ef-mei").value),
        };
        if (isNew) { DB.add(data); this.side = data.side; }
        else DB.update(g.id, data);
        closeOverlay(); this.setSide(this.side); toast(isNew ? "已新增" : "已保存");
      };
    },
    exportJSON() {
      const blob = new Blob([JSON.stringify(DB.list, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "wujiang_database.json"; a.click();
      URL.revokeObjectURL(url); toast("已导出 JSON");
    },
    importJSON(file) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const arr = JSON.parse(e.target.result);
          if (!Array.isArray(arr)) throw 0;
          DB.list = arr.map((g, i) => Object.assign({ id: i + 1, side: g.side || 'cn' }, g));
          DB._nextId = DB.list.length + 1; DB.save();
          this.render(); toast(`已导入 ${arr.length} 名武将`);
        } catch { toast("文件格式有误"); }
      };
      reader.readAsText(file);
    },
  };
  function clampStat(v) { return Math.max(1, Math.min(120, Math.round(+v || 0))); }

  /* ============================================================
   *  音频按钮绑定
   * ============================================================ */
  function syncAudioBtns() {
    const m = AudioSystem.isMusicOn(), s = AudioSystem.isSfxOn();
    $$('[id^="btn-music"]').forEach(b => { b.classList.toggle("off", !m); b.textContent = m ? "♪" : "♪̶"; });
    $$('[id^="btn-sfx"]').forEach(b => { b.classList.toggle("off", !s); b.textContent = s ? "🔊" : "🔇"; });
  }
  function bindAudio() {
    $$('[id^="btn-music"]').forEach(b => b.onclick = () => { AudioSystem.toggleMusic(!AudioSystem.isMusicOn()); syncAudioBtns(); });
    $$('[id^="btn-sfx"]').forEach(b => b.onclick = () => { AudioSystem.toggleSfx(!AudioSystem.isSfxOn()); syncAudioBtns(); });
  }

  /* ============================================================
   *  初始化与事件绑定
   * ============================================================ */
  function init() {
    DB.load();

    // 首屏需用户交互才能启动音频
    let audioStarted = false;
    const startAudio = () => { if (!audioStarted) { audioStarted = true; AudioSystem.init(); syncAudioBtns(); } };
    document.body.addEventListener("pointerdown", startAudio, { once: false });

    // 菜单按钮
    $$(".menu-btn").forEach(b => b.onclick = () => {
      startAudio();
      const go = b.dataset.go;
      if (go === "select") SelectUI.open(b.dataset.mode);
      else if (go === "war") War.open();
      else if (go === "cup") Tournament.open();
      else if (go === "rpg") RPG.open();
      else if (go === "db") DBUI.open();
    });

    // 世界杯
    $$(".cup-size").forEach(b => b.onclick = () => Tournament.setSize(+b.dataset.size));
    $("#cup-manual").onclick = () => SelectUI.open("cup");
    $("#cup-random").onclick = () => Tournament.beginRandom();

    // 返回（仅在战斗进行中且正处于战斗画面时才阻止）
    $$("[data-back]").forEach(b => b.onclick = () => {
      const onBattle = $("#screen-battle").classList.contains("active");
      // 阵营大战详情观战：脱离单挑画面退回战报界面，但本场大战继续推进（非中止）
      if (onBattle && BATTLE && BATTLE.spectate) {
        closeOverlay();
        War.detach();   // 内部已切回战报界面、切到「快捷」并续算当前阵
        return;
      }
      if (BATTLE && BATTLE.busy && onBattle) return;
      if (BATTLE) BATTLE.busy = false;
      War.abort();   // 终止可能在进行中的阵营大战
      closeOverlay();
      showScreen("home");
    });

    // 选将
    $$(".side-tab[data-side]").forEach(t => t.onclick = () => SelectUI.setSide(t.dataset.side));
    $("#select-search").oninput = () => SelectUI.render();
    $("#select-confirm").onclick = () => SelectUI.confirm();
    $("#select-random").onclick = () => SelectUI.randomPick();

    // 阵营战
    $("#war-start").onclick = () => War.start();
    $("#war-mode-fast").onclick = () => War.setMode("fast");
    $("#war-mode-detail").onclick = () => War.setMode("detail");

    // 战斗控制：自动作战 / 速度
    $("#btn-auto").onclick = () => {
      if (!BATTLE) return;
      PREF.auto = BATTLE.auto = !BATTLE.auto;
      syncBattleControls();
      // 重新决定当前回合：自动→立即排程出手；手动→等待玩家
      if (!BATTLE.spectate && !BATTLE.busy && !overlay.classList.contains("show")) {
        clearTimeout(BATTLE._autoTimer);
        nextTurn();
      }
    };
    $("#btn-speed").onclick = () => {
      const seq = [1, 2, 4];
      PREF.speed = seq[(seq.indexOf(PREF.speed) + 1) % seq.length];
      if (BATTLE) BATTLE.speed = PREF.speed;
      syncBattleControls();
    };

    // 数据库
    $$(".side-tab[data-dbside]").forEach(t => t.onclick = () => DBUI.setSide(t.dataset.dbside));
    $("#db-search").oninput = () => DBUI.render();
    $("#db-add").onclick = () => DBUI.edit(null);
    $("#db-export").onclick = () => DBUI.exportJSON();
    $("#db-import").onchange = e => { if (e.target.files[0]) DBUI.importJSON(e.target.files[0]); e.target.value = ""; };
    $("#db-reset").onclick = () => { if (confirm("恢复为默认 200 名武将？将覆盖当前数据库。")) { DB.resetDefault(); DBUI.render(); toast("已恢复默认"); } };

    bindAudio();
    syncAudioBtns();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
