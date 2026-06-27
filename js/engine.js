/* ============================================================
 *  单挑战斗引擎
 *  回合制，体力(ti)为HP，归零即KO。
 *  打法(战术)采用相克 + 属性修正 + 随机浮动模型。
 * ============================================================ */

const TACTICS = {
  fierce:  { key: "fierce",  name: "猛攻", icon: "⚔️", desc: "全力进攻，伤害高、消耗大，被「防御」克制",   stam: 14 },
  normal:  { key: "normal",  name: "普攻", icon: "🗡️", desc: "稳健出招，攻守平衡",                       stam: 8 },
  defend:  { key: "defend",  name: "格挡", icon: "🛡️", desc: "防御反击，克制「猛攻」，对「智谋」乏力",     stam: 5 },
  strategy:{ key: "strategy",name: "智谋", icon: "🧠", desc: "以智取胜，克制「格挡」，受「猛攻」压制",     stam: 7 },
  charge:  { key: "charge",  name: "蓄力", icon: "🔥", desc: "蓄力一击，本回合防御弱，下回合暴击",         stam: 4 },
};

// 相克关系：attacker 战术 对 defender 战术的倍率
// 猛攻 > 智谋 > 格挡 > 猛攻 (石头剪刀布)，普攻/蓄力居中
const COUNTER = {
  fierce:   { defend: 0.55, strategy: 1.35, normal: 1.05, fierce: 1.0, charge: 1.45 },
  normal:   { defend: 0.85, strategy: 1.05, normal: 1.0, fierce: 0.95, charge: 1.2 },
  defend:   { fierce: 1.5,  normal: 0.7,  strategy: 0.5, defend: 0.6, charge: 0.9 },
  strategy: { defend: 1.5,  fierce: 0.6,  normal: 0.95, strategy: 1.0, charge: 1.25 },
  charge:   { defend: 0.8,  fierce: 0.9,  normal: 1.0,  strategy: 0.85, charge: 1.0 },
};

function rand(min, max) { return Math.random() * (max - min) + min; }

// 计算一次出招的伤害
function computeDamage(attacker, defender, atkTactic, defTactic, charged) {
  const a = attacker.g, d = defender.g;
  let base;
  // 主属性：智谋用智力，其余用武力；统帅辅助攻势
  if (atkTactic === "strategy") {
    base = a.wu * 0.30 + a.zhi * 0.80;
  } else {
    base = a.wu * 0.92 + a.tong * 0.18;
  }
  // 相克倍率
  const counter = (COUNTER[atkTactic] && COUNTER[atkTactic][defTactic]) || 1.0;
  // 防御减免：统帅(主) + 政治(阵列严整的小幅韧性) + 是否格挡
  let mitigation = 1 - Math.min(0.50, d.tong / 380);
  mitigation *= 1 - Math.min(0.12, d.zheng / 1000);
  if (defTactic === "defend") mitigation *= 0.6;
  if (defTactic === "charge") mitigation *= 1.15; // 蓄力时破绽大
  // 蓄力暴击
  const critMul = charged ? 2.0 : 1.0;
  // 随机浮动
  const luck = rand(0.82, 1.18);

  let dmg = (base * 0.32) * counter * mitigation * critMul * luck;

  // 会心一击：以「魅力」为主、智力为辅（气势夺人）
  const critChance = a.mei / 700 + a.zhi / 1800 + (charged ? 0.45 : 0.05);
  let crit = false;
  if (Math.random() < critChance) { dmg *= 1.6; crit = true; }

  // 临阵闪避/卸力：守方「魅力」越高，越能凭气势化险（与会心互斥）
  let evaded = false;
  if (!crit && Math.random() < d.mei / 1500) { dmg *= 0.3; evaded = true; }

  dmg = Math.max(1, Math.round(dmg));
  return { dmg, crit, counter, evaded };
}

// AI 选择战术
function aiChooseTactic(self, foe) {
  const g = self.g;
  const lowStam = self.stam < 20;
  const foeLowHp = foe.hp < foe.maxHp * 0.3;
  const r = Math.random();

  if (lowStam) {
    // 体力不足，倾向低耗招式
    return r < 0.5 ? "charge" : (r < 0.8 ? "defend" : "normal");
  }
  // 智力高者偏好智谋，武力高者偏好猛攻
  const wuBias = g.wu / (g.wu + g.zhi);
  if (foeLowHp && self.stam > 18 && r < 0.55) return "fierce"; // 收割
  if (r < wuBias * 0.5) return "fierce";
  if (r < wuBias * 0.5 + 0.25) return g.zhi > 75 ? "strategy" : "normal";
  if (r < 0.85) return "normal";
  return "defend";
}

// 创建一个战斗单位
function makeFighter(general) {
  return {
    g: general,
    maxHp: general.ti,
    hp: general.ti,
    // 起始战意：「政治」越高，开局储备越足（约 64~100）
    stam: Math.min(100, Math.round(55 + (general.zheng || 60) * 0.45)),
    charged: false,
  };
}

// 结算一个完整回合（双方同时出招），返回日志事件
function resolveRound(p1, p2, t1, t2) {
  const events = [];
  const order = [
    { atk: p1, def: p2, t: t1, dt: t2, label: "p1" },
    { atk: p2, def: p1, t: t2, dt: t1, label: "p2" },
  ];
  // 速度：统帅+随机决定先后
  const spd1 = p1.g.tong + rand(0, 30);
  const spd2 = p2.g.tong + rand(0, 30);
  if (spd2 > spd1) order.reverse();

  for (const o of order) {
    if (o.atk.hp <= 0 || o.def.hp <= 0) continue;
    // 消耗战意：「政治」越高，调度有方、出招更省力（最多省 ~30%）
    const cost = staminaCost(o.t, o.atk.g);
    o.atk.stam = Math.max(0, o.atk.stam - cost);

    if (o.t === "charge") {
      o.atk.charged = true;
      events.push({ who: o.label, type: "charge", text: `${o.atk.g.name} 凝气蓄力，杀招将至！` });
      continue;
    }
    const wasCharged = o.atk.charged;
    o.atk.charged = false;
    const res = computeDamage(o.atk, o.def, o.t, o.dt, wasCharged);
    o.def.hp = Math.max(0, o.def.hp - res.dmg);
    events.push({
      who: o.label, type: "hit", dmg: res.dmg, crit: res.crit, evaded: res.evaded,
      counter: res.counter, charged: wasCharged, tactic: o.t,
      attacker: o.atk.g.name, defender: o.def.g.name, defHp: o.def.hp, defMax: o.def.maxHp,
      text: buildHitText(o.atk.g.name, o.def.g.name, o.t, res, wasCharged),
    });
    if (o.def.hp <= 0) {
      events.push({ who: o.label, type: "ko", winner: o.atk.g.name, loser: o.def.g.name,
        text: `💥 ${o.def.g.name} 体力归零，被 ${o.atk.g.name} 一击 KO！` });
      break;
    }
  }
  // 每回合恢复战意：「政治」越高，整军经武、回气越快
  p1.stam = Math.min(100, p1.stam + staminaRegen(p1.g));
  p2.stam = Math.min(100, p2.stam + staminaRegen(p2.g));
  return events;
}

// 「政治」→ 出招战意消耗（高政治更省力）
function staminaCost(tactic, g) {
  return Math.max(2, Math.round(TACTICS[tactic].stam * (1 - (g.zheng || 0) / 380)));
}
// 「政治」→ 每回合战意恢复
function staminaRegen(g) { return 2 + (g.zheng || 0) / 22; }

function buildHitText(atk, def, tactic, res, charged) {
  const t = TACTICS[tactic].name;
  let s = `${atk} 使出【${t}】`;
  if (charged) s += "（蓄力暴发）";
  if (res.evaded) s += `，被 ${def} 凭气势卸力`;
  else if (res.counter >= 1.3) s += `，正中破绽`;
  else if (res.counter <= 0.7) s += `，却被巧妙化解`;
  s += `，造成 ${res.dmg} 点伤害`;
  if (res.crit) s += " ✨会心一击！";
  return s;
}

// 自动模拟整场对决（用于车轮/阵营战），返回 {winner, loser, rounds, log}
function autoBattle(g1, g2, maxRounds = 40) {
  const p1 = makeFighter(g1), p2 = makeFighter(g2);
  const log = [];
  // hpSeq：逐回合记录双方体力 [g1体力, g2体力]，供「体力数字逐次递减」动画使用
  const hpSeq = [[p1.hp, p2.hp]];
  let r = 0;
  while (p1.hp > 0 && p2.hp > 0 && r < maxRounds) {
    r++;
    const t1 = aiChooseTactic(p1, p2);
    const t2 = aiChooseTactic(p2, p1);
    const ev = resolveRound(p1, p2, t1, t2);
    log.push({ round: r, events: ev });
    hpSeq.push([Math.max(0, Math.round(p1.hp)), Math.max(0, Math.round(p2.hp))]);
    if (p1.hp <= 0 || p2.hp <= 0) break;
  }
  let winner, loser;
  if (p1.hp <= 0 && p2.hp <= 0) { winner = p1.hp >= p2.hp ? g1 : g2; loser = winner === g1 ? g2 : g1; }
  else if (p1.hp <= 0) { winner = g2; loser = g1; }
  else if (p2.hp <= 0) { winner = g1; loser = g2; }
  else { winner = p1.hp >= p2.hp ? g1 : g2; loser = winner === g1 ? g2 : g1; } // 回合耗尽看血量
  return { winner, loser, rounds: r, log, p1, p2, hpSeq, startHp: [g1.ti, g2.ti] };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TACTICS, makeFighter, resolveRound, aiChooseTactic, autoBattle, computeDamage, staminaCost, staminaRegen };
}
