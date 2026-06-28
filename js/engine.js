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
  // —— 计策（智力系）：成功率与效果均取决于双方「智力」 ——
  // 束缚 / 弱化为「计策(免费)」：发动后不占用本回合行动，仍可再出招，但每回合只能发动一个
  bind:    { key: "bind",    name: "束缚", icon: "🪢", desc: "计策(免费)：使敌方下一回合暂停出招；发动后仍可出招，每回合限一计", stam: 12, type: "scheme", scheme: "bind", free: true },
  weaken:  { key: "weaken",  name: "弱化", icon: "🌀", desc: "计策(免费)：削弱敌方攻击力，时长随智力而定；发动后仍可出招，每回合限一计", stam: 10, type: "scheme", scheme: "weaken", free: true },
  heal:    { key: "heal",    name: "疗伤", icon: "💊", desc: "计策：运功恢复自身体力（占用行动）；成败与回复随智力而定",          stam: 11, type: "scheme", scheme: "heal" },
  charge:  { key: "charge",  name: "蓄力", icon: "🔥", desc: "计策：凝气蓄力恢复战意、下次出招暴发（占用行动）；成败与成效随智力而定", stam: 4, type: "scheme", scheme: "charge" },
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
  const base = { bind: 0.30, weaken: 0.45, heal: 0.62, charge: 0.66 }[scheme] || 0.4;
  return Math.max(0.12, Math.min(0.94, base + dz / 220));
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
    // 轮换出招下：直接置入束缚层数，敌方下一回合即暂停（智力差大可达 2 回合）
    const dur = (a.g.zhi - d.g.zhi > 45) ? 2 : 1;
    d.bound = Math.max(d.bound || 0, dur);
    return { who: o.label, type: "scheme", scheme, ok: true, attacker: an, defender: dn,
      text: `${an} 施展【束缚】，${dn} ${dur > 1 ? "接下来 " + dur + " 回合" : "下一回合"}暂停出招！` };
  }
  if (scheme === "weaken") {
    const reduce = Math.min(0.55, 0.22 + a.g.zhi / 600);
    // 时长取决于双方智力高低（1~4 回合）
    const dur = Math.max(1, Math.min(4, 2 + Math.round((a.g.zhi - d.g.zhi) / 30)));
    d.atkMul = 1 - reduce; d.atkMulT = dur;
    return { who: o.label, type: "scheme", scheme, ok: true, attacker: an, defender: dn,
      text: `${an} 施展【弱化】，${dn} 攻击力下降 ${Math.round(reduce * 100)}%（${dur}回合）！` };
  }
  if (scheme === "charge") {
    // 蓄力计策：成功则恢复战意并蓄势（成效随智力）
    if (!ok) return { who: o.label, type: "scheme", scheme, ok: false, attacker: an,
      text: `${an} 试图凝气蓄力，却心绪难平，未能成势。` };
    const gain = Math.round(16 + a.g.zhi * 0.3);
    a.stam = Math.min(100, a.stam + gain);
    a.charged = true;
    return { who: o.label, type: "charge", scheme, ok: true, attacker: an, gain,
      text: `${an} 凝气蓄力，战意 +${gain}，蓄势待发！` };
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
    bound: 0,        // 被束缚的剩余回合（>0 时本回合暂停出招）
    atkMul: 1,       // 攻击力倍率（被「弱化」时 <1）
    atkMulT: 0,      // 弱化的剩余回合
    stance: "normal",// 最近一次的攻击姿态，作为对手下次攻击的相克对象
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

// 统帅决定先手：返回先出招的一方 "p1" / "p2"
function firstMover(p1, p2) {
  const s1 = p1.g.tong + rand(0, 20), s2 = p2.g.tong + rand(0, 20);
  return s2 > s1 ? "p2" : "p1";
}

// 回合末：行动者恢复战意、其减益按回合消退
function endTurn(f) {
  f.stam = Math.min(100, f.stam + staminaRegen(f.g));
  if (f.atkMulT > 0) { f.atkMulT--; if (f.atkMulT === 0) f.atkMul = 1; }
}

// 结算「一名武将的一个回合」（轮换出招）：可选免费计策(束缚/弱化) + 一个主行动。
// who 为行动方标识("p1"/"p2")。被束缚则跳过整个回合。
function resolveTurn(attacker, defender, plan, who) {
  plan = normPlan(plan);
  const events = [];
  const o = { atk: attacker, def: defender, label: who };

  // 被束缚：本回合暂停出招，消耗一层
  if (attacker.bound > 0) {
    attacker.bound--;
    events.push({ who, type: "bound", attacker: attacker.g.name,
      text: `${attacker.g.name} 被束缚，本回合暂停出招！` });
    endTurn(attacker);
    return events;
  }

  // 免费计策（束缚/弱化）：发动后仍可出招
  const fk = plan.free;
  if (fk && TACTICS[fk] && TACTICS[fk].free) {
    const cost = staminaCost(fk, attacker.g);
    if (attacker.stam >= cost) {
      attacker.stam -= cost;
      const ok = Math.random() < schemeSuccess(attacker, defender, TACTICS[fk].scheme);
      events.push(applyScheme(o, TACTICS[fk].scheme, ok));
    }
  }

  // 主行动
  const mk = plan.main || "normal";
  const tac = TACTICS[mk] || TACTICS.normal;
  if (tac.type === "scheme") {
    // 占用行动的计策：蓄力(charge) / 疗伤(heal)；蓄力恢复战意故不扣战意
    if (mk !== "charge") { attacker.stam = Math.max(0, attacker.stam - staminaCost(mk, attacker.g)); }
    attacker.stance = "normal";   // 用计姿态门户大开
    const ok = Math.random() < schemeSuccess(attacker, defender, tac.scheme);
    events.push(applyScheme(o, tac.scheme, ok));
  } else {
    attacker.stam = Math.max(0, attacker.stam - staminaCost(mk, attacker.g));
    const wasCharged = attacker.charged; attacker.charged = false;
    // 相克对象取守方最近一次姿态
    const res = computeDamage(attacker, defender, mk, defender.stance || "normal", wasCharged);
    defender.hp = Math.max(0, defender.hp - res.dmg);
    attacker.stance = mk;
    events.push({
      who, type: "hit", dmg: res.dmg, crit: res.crit, evaded: res.evaded,
      counter: res.counter, charged: wasCharged, tactic: mk,
      attacker: attacker.g.name, defender: defender.g.name, defHp: defender.hp, defMax: defender.maxHp,
      text: buildHitText(attacker.g.name, defender.g.name, mk, res, wasCharged),
    });
    if (defender.hp <= 0) {
      events.push({ who, type: "ko", winner: attacker.g.name, loser: defender.g.name,
        text: `💥 ${defender.g.name} 体力归零，被 ${attacker.g.name} 一击 KO！` });
    }
  }
  endTurn(attacker);
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

// 自动模拟整场对决（轮换出招；用于车轮/阵营/世界杯），返回 {winner, loser, rounds, log}
function autoBattle(g1, g2, maxTurns = 160) {
  const p1 = makeFighter(g1), p2 = makeFighter(g2);
  const log = [];
  // hpSeq：逐回合记录双方体力 [g1体力, g2体力]，供「体力数字逐次递减」动画使用
  const hpSeq = [[p1.hp, p2.hp]];
  let turn = firstMover(p1, p2), t = 0;
  while (p1.hp > 0 && p2.hp > 0 && t < maxTurns) {
    t++;
    const me = turn === "p1" ? p1 : p2, foe = turn === "p1" ? p2 : p1;
    const ev = resolveTurn(me, foe, aiChoosePlan(me, foe), turn);
    log.push({ round: Math.ceil(t / 2), events: ev });
    hpSeq.push([Math.max(0, Math.round(p1.hp)), Math.max(0, Math.round(p2.hp))]);
    if (p1.hp <= 0 || p2.hp <= 0) break;
    turn = turn === "p1" ? "p2" : "p1";
  }
  let winner, loser;
  if (p1.hp <= 0 && p2.hp <= 0) { winner = p1.hp >= p2.hp ? g1 : g2; loser = winner === g1 ? g2 : g1; }
  else if (p1.hp <= 0) { winner = g2; loser = g1; }
  else if (p2.hp <= 0) { winner = g1; loser = g2; }
  else { winner = p1.hp >= p2.hp ? g1 : g2; loser = winner === g1 ? g2 : g1; } // 回合耗尽看血量
  return { winner, loser, rounds: Math.ceil(t / 2), log, p1, p2, hpSeq, startHp: [g1.ti, g2.ti] };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TACTICS, makeFighter, resolveTurn, firstMover, aiChooseTactic, aiChoosePlan, autoBattle, computeDamage, staminaCost, staminaRegen, schemeSuccess, applyScheme };
}
