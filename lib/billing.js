const WEEKDAY_ORDER = ["воскр", "пн", "вт", "ср", "чт", "пт", "сб"];

function monthDays(year, month) {
  const count = new Date(year, month, 0).getDate();
  const days = [];
  for (let day = 1; day <= count; day++) {
    const date = new Date(year, month - 1, day);
    days.push({ day, weekday: WEEKDAY_ORDER[date.getDay()] });
  }
  return days;
}

function parseGroupWeekdays(title) {
  const paren = String(title).match(/\(([^)]+)\)/);
  const src = (paren ? paren[1] : title).toLowerCase();
  const found = src.match(/пн|вт|ср|чт|пт|сб|воскр|вс/g) || [];
  return [...new Set(found.map((d) => (d === "вс" ? "воскр" : d)))];
}

function scheduledDays(month, group) {
  const weekdays = group.weekdays && group.weekdays.length
    ? group.weekdays
    : parseGroupWeekdays(group.name || group.title || "");
  return month.days.filter((d) => weekdays.includes(d.weekday)).map((d) => d.day);
}

function familyDiscount(size) {
  if (size >= 3) return 20;
  if (size >= 2) return 10;
  return 0;
}

function familyKey(fullName) {
  const last = String(fullName).trim().split(/\s+/)[0] || "";
  return last
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(ский|ская|цкий|цкая|ской|цкой|ой|ая|ий|ый|ин|ина|ов|ова|ев|ева)$/i, "");
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function attKey(monthId, groupId, childId, day) {
  return `${monthId}:${groupId}:${childId}:${day}`;
}

function isoDay(month, day) {
  return `${month.id}-${String(day).padStart(2, "0")}`;
}

function isSick(db, childId, month, day) {
  const list = (db.sick && db.sick[childId]) || [];
  return list.includes(isoDay(month, day));
}

function packInfo(db, group) {
  const branch = (db.branches || []).find((b) => b.id === group.branchId);
  const packLessons = Number(group.packLessons) > 0
    ? Number(group.packLessons)
    : (Number(db.settings && db.settings.packLessons) || 8);
  let packPrice = Number(group.packPrice);
  if (!(packPrice > 0) && branch) {
    packPrice = group.durationMin === 90
      ? Number(branch.priceHourHalf) || 0
      : Number(branch.priceHour) || 0;
  }
  const unit = packLessons ? money(packPrice / packLessons) : 0;
  return { packPrice: money(packPrice), packLessons, unit, durationMin: group.durationMin || 60 };
}

function sessionPrice(db, group) {
  return packInfo(db, group).unit || 1000;
}

function childGroupIds(child) {
  if (child.groupIds && child.groupIds.length) return child.groupIds;
  return child.groupId ? [child.groupId] : [];
}

function childGroupBreakdown(db, child, month) {
  const trialPrice = Number(db.settings && db.settings.trialPrice) || 500;
  const rows = [];
  for (const gid of childGroupIds(child)) {
    const group = (db.groups || []).find((g) => g.id === gid);
    if (!group) continue;
    const branch = (db.branches || []).find((b) => b.id === group.branchId);
    const pack = packInfo(db, group);
    const planned = scheduledDays(month, group);
    let present = 0;
    let sickCount = 0;
    let trial500 = 0;
    let spent = 0;
    for (const day of planned) {
      if (isSick(db, child.id, month, day)) {
        sickCount += 1;
        continue;
      }
      const mark = (db.attendance || {})[attKey(month.id, gid, child.id, day)];
      if (mark === "present") {
        present += 1;
        spent += pack.unit;
      }
      if (mark === "trial500") {
        trial500 += 1;
        spent += trialPrice;
      }
    }
    const advance = child.kind === "trial" ? 0 : money(planned.length * pack.unit);
    rows.push({
      groupId: gid,
      title: group.title || group.name,
      branch: branch ? branch.name : "",
      durationMin: pack.durationMin,
      durationLabel: pack.durationMin === 90 ? "1,5 ч" : "1 ч",
      packPrice: pack.packPrice,
      packLessons: pack.packLessons,
      unit: pack.unit,
      sessions: planned.length,
      advance,
      present,
      sickCount,
      trial500,
      spent: money(spent)
    });
  }
  return rows;
}

function childSpent(db, child, month) {
  const trialPrice = Number(db.settings && db.settings.trialPrice) || 500;
  const lines = [];
  let spent = 0;
  let present = 0;
  let sickCount = 0;
  let trial500 = 0;
  for (const gid of childGroupIds(child)) {
    const group = (db.groups || []).find((g) => g.id === gid);
    if (!group) continue;
    const price = sessionPrice(db, group);
    const planned = scheduledDays(month, group);
    for (const day of planned) {
      if (isSick(db, child.id, month, day)) {
        sickCount += 1;
        lines.push({ group: group.title || group.name, day, mark: "Б", price: 0, note: "больничный, не списывается" });
        continue;
      }
      const mark = (db.attendance || {})[attKey(month.id, gid, child.id, day)];
      if (mark === "present") {
        spent += price;
        present += 1;
        lines.push({ group: group.title || group.name, day, mark: "+", price });
      }
      if (mark === "trial500") {
        spent += trialPrice;
        trial500 += 1;
        lines.push({ group: group.title || group.name, day, mark: "500", price: trialPrice });
      }
    }
  }
  return { spent: money(spent), present, sickCount, trial500, lines };
}

function childAdvance(db, child, month) {
  if (child.kind === "trial") return { advance: 0, lines: [] };
  const lines = [];
  let advance = 0;
  for (const gid of childGroupIds(child)) {
    const group = (db.groups || []).find((g) => g.id === gid);
    if (!group) continue;
    const days = scheduledDays(month, group);
    const pack = packInfo(db, group);
    const price = pack.unit;
    const part = days.length * price;
    advance += part;
    lines.push({
      child: child.name,
      group: group.title || group.name,
      sessions: days.length,
      price,
      part: money(part),
      packPrice: pack.packPrice,
      packLessons: pack.packLessons,
      durationMin: pack.durationMin,
      note: `пакет ${pack.packPrice} ₽ / ${pack.packLessons} зан. = ${price} ₽ за занятие`
    });
  }
  return { advance: money(advance), lines };
}

function periodCore(db, familyId, month) {
  const kids = (db.children || []).filter((c) => c.familyId === familyId);
  const regular = kids.filter((c) => c.kind !== "trial");
  const fam = (db.families || []).find((f) => f.id === familyId);
  const autoDisc = familyDiscount(regular.length);
  const disc = fam && fam.discountPercent != null && fam.discountPercent !== ""
    ? Number(fam.discountPercent) || 0
    : autoDisc;
  let advanceRaw = 0;
  let spent = 0;
  let sickCredit = 0;
  const formula = [];
  const perChild = [];

  for (const child of kids) {
    const adv = childAdvance(db, child, month);
    const sp = childSpent(db, child, month);
    const groups = childGroupBreakdown(db, child, month);
    const sessions = adv.lines.reduce((s, l) => s + l.sessions, 0);
    const priceAvg = sessions
      ? adv.lines.reduce((s, l) => s + l.price * l.sessions, 0) / sessions
      : 1000;
    const sickMoney = money(sp.sickCount * priceAvg);
    advanceRaw += adv.advance;
    spent += sp.spent;
    sickCredit += sickMoney;
    formula.push(...adv.lines.map((l) => ({ ...l, type: "advance" })));
    formula.push(...sp.lines.map((l) => ({ ...l, type: "visit", child: child.name })));
    perChild.push({
      childId: child.id,
      name: child.name,
      kind: child.kind,
      advance: adv.advance,
      spent: sp.spent,
      present: sp.present,
      sickCount: sp.sickCount,
      trial500: sp.trial500,
      groups,
      formula: [...adv.lines, ...sp.lines]
    });
  }

  return {
    advanceRaw: money(advanceRaw),
    discountPercent: disc,
    discountAuto: autoDisc,
    discountManual: !!(fam && fam.discountPercent != null && fam.discountPercent !== ""),
    advance: money(advanceRaw * (1 - disc / 100)),
    spent: money(spent),
    sickCredit: money(sickCredit),
    perChild,
    formula
  };
}

function payRecord(db, familyId, monthId) {
  return ((db.familyPayments || {})[`${familyId}:${monthId}`]) || {};
}

/** Остаток (+) / долг (−) на начало месяца по цепочке прошлых периодов. */
function openingBefore(db, familyId, month) {
  const months = db.months || [];
  const idx = months.findIndex((m) => m.id === month.id);
  let carry = 0;
  for (let i = 0; i < idx; i++) {
    const core = periodCore(db, familyId, months[i]);
    const incoming = Number(payRecord(db, familyId, months[i].id).incoming) || 0;
    const credit = Math.max(0, carry);
    const invoice = money(Math.max(0, core.advance - credit));
    const unpaid = money(Math.max(0, invoice - incoming));
    const leftover = money(Math.max(0, credit + incoming - core.spent));
    carry = money(leftover - unpaid);
  }
  return carry;
}

function familyPeriod(db, familyId, month) {
  const core = periodCore(db, familyId, month);
  const opening = openingBefore(db, familyId, month);
  const pay = payRecord(db, familyId, month.id);
  const incoming = Number(pay.incoming) || 0;
  const credit = Math.max(0, opening);
  const debt = Math.max(0, -opening);
  // Счёт: аванс − остаток прошлого + прошлый долг
  const requested = money(Math.max(0, core.advance - credit) + debt);
  const amountDue = money(requested - incoming);
  const balance = money(opening + incoming - core.spent);
  let status = pay.status || "red";
  if (!pay.status) {
    if (pay.parentClickedAt) status = "yellow";
    else if (incoming > 0 && amountDue <= 0) status = "green";
    else if (incoming > 0 && amountDue > 0) status = "red";
    else status = "red";
  }
  return {
    familyId,
    monthId: month.id,
    ...core,
    opening,
    credit,
    debt,
    incoming,
    balance,
    requested,
    amountDue,
    status,
    parentClickedAt: pay.parentClickedAt || null,
    directorAt: pay.directorAt || null
  };
}

function allFamilyPeriods(db, month) {
  return (db.families || []).map((f) => ({
    family: f,
    period: familyPeriod(db, f.id, month)
  }));
}

function familyQr(db, familyId) {
  const ids = new Set();
  for (const c of db.children || []) {
    if (c.familyId !== familyId) continue;
    for (const gid of childGroupIds(c)) {
      const g = (db.groups || []).find((x) => x.id === gid);
      if (g) ids.add(g.branchId);
    }
  }
  const qrs = [];
  for (const b of db.branches || []) {
    if (!ids.has(b.id)) continue;
    if (!qrs.includes(b.qr)) qrs.push(b.qr);
  }
  if (!qrs.length) qrs.push("qr1");
  return qrs;
}

module.exports = {
  monthDays,
  parseGroupWeekdays,
  scheduledDays,
  familyDiscount,
  familyKey,
  money,
  attKey,
  isoDay,
  isSick,
  sessionPrice,
  packInfo,
  childGroupIds,
  childSpent,
  childAdvance,
  childGroupBreakdown,
  periodCore,
  familyPeriod,
  allFamilyPeriods,
  familyQr
};
