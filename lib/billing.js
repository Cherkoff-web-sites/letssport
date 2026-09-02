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
    : parseGroupWeekdays(group.name);
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

function attKey(monthId, childId, day) {
  return `${monthId}:${childId}:${day}`;
}

function childBilling(db, child, month) {
  const group = db.groups.find((g) => g.id === child.groupId);
  const planned = group ? scheduledDays(month, group) : [];
  const plannedCount = planned.length;
  let excused = 0;
  let present = 0;
  let trialMarks = 0;
  const allDays = month.days.map((d) => d.day);
  for (const day of allDays) {
    const mark = db.attendance[attKey(month.id, child.id, day)];
    if (mark === "excused" && planned.includes(day)) excused += 1;
    if (mark === "present") present += 1;
    if (mark === "trial") trialMarks += 1;
  }
  const packPrice = Number(db.settings.packPrice) || 7500;
  const packLessons = Number(db.settings.packLessons) || 8;
  const trialPrice = Number(db.settings.trialPrice) || 500;
  const lessonPrice = packLessons ? packPrice / packLessons : 0;
  const isTrial = child.kind === "trial";
  const toPayLessons = isTrial ? trialMarks : Math.max(0, plannedCount - excused);
  const toPaySum = isTrial ? money(trialMarks * trialPrice) : money(toPayLessons * lessonPrice);
  const size = db.children.filter((c) => c.familyId === child.familyId && c.kind !== "trial").length;
  const autoDiscount = isTrial ? 0 : familyDiscount(size);
  const discountPercent = isTrial ? 0 : (child.discountPercent == null ? autoDiscount : Number(child.discountPercent));
  const discounted = money(toPaySum * (1 - discountPercent / 100));
  const nineLessons = money((packPrice / packLessons) * 9);
  return {
    plannedCount,
    excused,
    present,
    trialMarks,
    isTrial,
    trialPrice,
    toPayLessons,
    toPaySum,
    discountPercent,
    discounted,
    lessonPrice: money(lessonPrice),
    packPrice,
    nineLessons,
    scheduled: planned
  };
}

function withBilling(db, monthId) {
  const month = db.months.find((m) => m.id === monthId) || db.months[0];
  const rows = db.children.map((child) => {
    const group = db.groups.find((g) => g.id === child.groupId);
    return {
      child,
      group,
      billing: childBilling(db, child, month)
    };
  });
  return { month, rows };
}

module.exports = {
  monthDays,
  parseGroupWeekdays,
  scheduledDays,
  familyDiscount,
  familyKey,
  money,
  attKey,
  childBilling,
  withBilling
};
