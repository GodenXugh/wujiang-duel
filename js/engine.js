/* ============================================================
 *  单挑战斗引擎
 *  回合制，体力(ti)为HP，归零即KO。
 *  打法(战术)采用相克 + 属性修正 + 随机浮动模型。
 * ============================================================ */

const TACTICS = {
  fierce:  { key: "fierce",  name: "猛攻", icon: "⚔️", desc: "全力进攻，伤害高、消耗大，被「格挡」克制",   stam: 14, type: "atk" },
  normal:  { key: "normal",  name: "普攻", icon: "🗡️", desc: "稳健出招，攻守平衡，伤害低于猛攻",           stam: 8,  type: "atk" },
  defend:  { key: "defend",  name: "格挡", icon: "🛡️", desc: "防御反击，克制「猛攻」，对「智谋」乏力",     stam: 5,  type: "atk" },
  strategy:{ key: "strategy",name: "智谋", icon: "🧠", desc: "以智取胜（智力伤害），克制「格挡」，受「猛攻」压制", stam: 7, type: "atk" },
  charge:  { key: "charge",  name: "蓄力", icon: "🔥", desc: "凝气蓄力：恢复战意，且本回合防御弱、下回合暴发", stam: 4,  type: "atk" },
  // —— 计策（智力系）：成功率与效果均取决于双方「智力」 ——
  // 束缚 / 弱化为「计策(免费)」：发动后不占用本回合行动，仍可再出招，但每回合只能发动一个
  bind:    { key: "bind",    name: "束缚", icon: "🪢", desc: "计策(免费)：使敌方下一回合无法行动；发动后仍可出招，每回合限一计", stam: 12, type: "scheme", scheme: "bind", free: true },
  weaken:  { key: "weaken",  name: "弱化", icon: "🌀", desc: "计策(免费)：削弱敌方攻击力(2回合)；发动后仍可出招，每回合限一计", stam: 10, type: "scheme", scheme: "weaken", free: true },
  heal:    { key: "heal",    name: "疗伤", icon: "💊", desc: "计策：运功恢复自身体力（占用本回合行动）；智力越高回复越多",          stam: 11, type: "scheme", scheme: "heal" },
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
  // 被「弱化」计策削弱的攻击力
  const atkMul = attacker.atkMul || 1;
  // 招式威力：普攻明显弱于猛攻，拉开两者差距
  const power = ({ fierce: 1.0, normal: 0.7, defend: 1.0, strategy: 1.0, charge: 1.0 })[atkTactic] || 1;

  let dmg = (base * 0.32) * counter * mitigation * critMul * luck * atkMul * power;

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

// 计策成功率：以双方「智力」差为主，各计策有不同基准；夹在 12%~92%
function schemeSuccess(self, foe, scheme) {
  const dz = self.g.zhi - foe.g.zhi;
  const base = { bind: 0.30, weaken: 0.45, heal: 0.62 }[scheme] || 0.4;
  return Math.max(0.12, Math.min(0.92, base + dz / 220));
}

// 执行一条计策，返回事件对象（命中与否、效果文本等）
function applyScheme(o, scheme, ok) {
  const a = o.atk, d = o.def, an = a.g.name, dn = d.g.name;
  const sname = TACTICS[scheme].name;
  if (!ok) {
    return { who: o.label, type: "scheme", scheme, ok: false, attacker: an,
      text: `${an} 施展【${sname}】，却被 ${dn} 识破，未能奏效。` };
  }
  if (scheme === "bind") {
    const dur = (a.g.zhi - d.g.zhi > 45) ? 2 : 1;
    // 记入 boundAdd，回合结束时才计入，确保是「下一回合」而非当前回合生效
    d.boundAdd = Math.max(d.boundAdd || 0, dur);
    return { who: o.label, type: "scheme", scheme, ok: true, attacker: an, defender: dn,
      text: `${an} 施展【束缚】，${dn} ${dur > 1 ? dur + "回合" : "下一回合"}无法行动！` };
  }
  if (scheme === "weaken") {
    const reduce = Math.min(0.55, 0.22 + a.g.zhi / 600);
    d.atkMul = 1 - reduce; d.atkMulT = 2;
    return { who: o.label, type: "scheme", scheme, ok: true, attacker: an, defender: dn,
      text: `${an} 施展【弱化】，${dn} 攻击力下降 ${Math.round(reduce * 100)}%（2回合）！` };
  }
  // heal（回复量较此前下调）
  const before = a.hp;
  const amount = Math.round(a.g.zhi * (0.26 + Math.random() * 0.2));
  a.hp = Math.min(a.maxHp, a.hp + amount);
  const healed = Math.round(a.hp - before);
  return { who: o.label, type: "scheme", scheme, ok: true, attacker: an, heal: healed,
    text: healed > 0 ? `${an} 施展【疗伤】，恢复体力 ${healed} 点！` : `${an} 施展【疗伤】，但体力已满。` };
}

// AI 选择「主行动」（攻击/防御/蓄力/智谋/疗伤；不含免费计策）
function aiChooseTactic(self, foe) {
  const g = self.g;
  const lowStam = self.stam < 20;
  const foeLowHp = foe.hp < foe.maxHp * 0.3;
  const selfLowHp = self.hp < self.maxHp * 0.35;
  const has = k => self.stam >= staminaCost(k, g);

  // 自身濒危且通晓医理 → 优先疗伤
  if (selfLowHp && g.zhi >= 68 && has("heal") && Math.random() < 0.55) return "heal";
  if (lowStam) {
    // 战意不足，倾向低耗招式
    const r = Math.random();
    return r < 0.5 ? "charge" : (r < 0.8 ? "defend" : "normal");
  }
  const r = Math.random();
  // 智力高者偏好智谋，武力高者偏好猛攻
  const wuBias = g.wu / (g.wu + g.zhi);
  if (foeLowHp && self.stam > 18 && r < 0.55) return "fierce"; // 收割
  if (r < wuBias * 0.5) return "fierce";
  if (r < wuBias * 0.5 + 0.25) return g.zhi > 75 ? "strategy" : "normal";
  if (r < 0.85) return "normal";
  return "defend";
}

// AI 的整套行动：一个可选的免费计策(束缚/弱化) + 一个主行动
// 计算机控制的武将同样会用计；用计后仍正常出招
function aiChoosePlan(self, foe) {
  const g = self.g;
  let free = null;
  // 留足战意给主攻后，智将才考虑用计
  const room = cost => self.stam >= cost + 8;
  if (g.zhi >= 78 && (foe.bound || 0) <= 0 && (foe.boundAdd || 0) <= 0 &&
      room(staminaCost("bind", g)) && Math.random() < 0.22) {
    free = "bind";
  } else if (g.zhi >= 70 && (foe.atkMul || 1) >= 1 &&
      room(staminaCost("weaken", g)) && Math.random() < 0.26) {
    free = "weaken";
  }
  return { free, main: aiChooseTactic(self, foe) };
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
    bound: 0,        // 被束缚的剩余回合（>0 时无法行动）
    boundAdd: 0,     // 本回合被施加、回合末才计入的束缚（确保「下一回合」生效）
    atkMul: 1,       // 攻击力倍率（被「弱化」时 <1）
    atkMulT: 0,      // 弱化的剩余回合
  };
}

// 将参数规整为行动计划：{ free: 束缚/弱化或null, main: 主行动 }
function normPlan(p) {
  if (p == null) return { free: null, main: "normal" };
  if (typeof p === "string") {
    // 兼容旧用法：若传入的是免费计策，归入 free；否则为主行动
    const t = TACTICS[p];
    return t && t.free ? { free: p, main: "normal" } : { free: null, main: p };
  }
  return { free: p.free || null, main: p.main || "normal" };
}

// 结算一个完整回合，返回日志事件。
// 流程：①免费计策(束缚/弱化)阶段 → ②主行动阶段。计策不占用主行动。
function resolveRound(p1, p2, plan1, plan2) {
  plan1 = normPlan(plan1); plan2 = normPlan(plan2);
  const events = [];
  const order = [
    { atk: p1, def: p2, plan: plan1, dt: plan2.main, label: "p1" },
    { atk: p2, def: p1, plan: plan2, dt: plan1.main, label: "p2" },
  ];
  // 速度：统帅+随机决定先后
  const spd1 = p1.g.tong + rand(0, 30);
  const spd2 = p2.g.tong + rand(0, 30);
  if (spd2 > spd1) order.reverse();

  // —— 阶段①：免费计策（束缚/弱化）。被束缚者本回合无法发动 ——
  for (const o of order) {
    if (o.atk.hp <= 0 || o.def.hp <= 0) continue;
    if (o.atk.bound > 0) continue;            // 被束缚：本回合彻底无法行动
    const fk = o.plan.free;
    if (!fk) continue;
    const tac = TACTICS[fk];
    if (!tac || !tac.free) continue;
    const cost = staminaCost(fk, o.atk.g);
    if (o.atk.stam < cost) continue;          // 战意不足，计策落空（不报错）
    o.atk.stam -= cost;
    const ok = Math.random() < schemeSuccess(o.atk, o.def, tac.scheme);
    events.push(applyScheme(o, tac.scheme, ok));
  }

  // —— 阶段②：主行动（攻击/格挡/智谋/蓄力/疗伤）——
  for (const o of order) {
    if (o.atk.hp <= 0 || o.def.hp <= 0) continue;
    // 被束缚：跳过主行动并消耗一层束缚
    if (o.atk.bound > 0) {
      o.atk.bound--;
      events.push({ who: o.label, type: "bound", attacker: o.atk.g.name,
        text: `${o.atk.g.name} 被束缚，本回合无法行动！` });
      continue;
    }
    const mk = o.plan.main || "normal";
    const tac = TACTICS[mk] || TACTICS.normal;

    if (mk === "charge") {
      // 蓄力：恢复战意（并蓄势，下次出招暴发）
      const gain = Math.round(28 + (o.atk.g.zheng || 0) * 0.12);
      o.atk.stam = Math.min(100, o.atk.stam + gain);
      o.atk.charged = true;
      events.push({ who: o.label, type: "charge", gain,
        text: `${o.atk.g.name} 凝气蓄力，战意 +${gain}，蓄势待发！` });
      continue;
    }
    const cost = staminaCost(mk, o.atk.g);
    o.atk.stam = Math.max(0, o.atk.stam - cost);
    // 疗伤等占用行动的计策
    if (tac.type === "scheme") {
      const ok = Math.random() < schemeSuccess(o.atk, o.def, tac.scheme);
      events.push(applyScheme(o, tac.scheme, ok));
      continue;
    }
    const wasCharged = o.atk.charged;
    o.atk.charged = false;
    const res = computeDamage(o.atk, o.def, mk, o.dt, wasCharged);
    o.def.hp = Math.max(0, o.def.hp - res.dmg);
    events.push({
      who: o.label, type: "hit", dmg: res.dmg, crit: res.crit, evaded: res.evaded,
      counter: res.counter, charged: wasCharged, tactic: mk,
      attacker: o.atk.g.name, defender: o.def.g.name, defHp: o.def.hp, defMax: o.def.maxHp,
      text: buildHitText(o.atk.g.name, o.def.g.name, mk, res, wasCharged),
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
  // 回合末结算：束缚延迟生效（下一回合）、弱化随回合消退
  for (const f of [p1, p2]) {
    if (f.boundAdd > 0) { f.bound += f.boundAdd; f.boundAdd = 0; }
    if (f.atkMulT > 0) { f.atkMulT--; if (f.atkMulT === 0) f.atkMul = 1; }
  }
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
    const ev = resolveRound(p1, p2, aiChoosePlan(p1, p2), aiChoosePlan(p2, p1));
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
  module.exports = { TACTICS, makeFighter, resolveRound, aiChooseTactic, aiChoosePlan, autoBattle, computeDamage, staminaCost, staminaRegen, schemeSuccess, applyScheme };
}
