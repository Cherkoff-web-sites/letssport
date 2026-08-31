const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");
const { monthDays, parseGroupWeekdays, familyKey, scheduledDays, attKey } = require("../lib/billing");
const { write } = require("../lib/store");

const ROOT = path.join(__dirname, "..", "..");
const ATT_FILE = path.join(ROOT, "Посещаемость 2021 (5).xlsx");

function findSheet(wb, pred) {
  return wb.SheetNames.find((n) => pred(n.replace(/\s+/g, " ").trim()));
}

function rowsOf(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
}

function cell(row, i) {
  return String(row[i] ?? "").trim();
}

function isGroupHeader(val) {
  const s = String(val || "").trim();
  if (s.length < 8) return false;
  return /ХГ|САМБО|ДЗЮДО|ГИМНАСТ/i.test(s);
}

function detectLayout(rows) {
  for (let r = 0; r < Math.min(4, rows.length); r++) {
    const joined = (rows[r] || []).map((x) => String(x).toLowerCase()).join(" | ");
    if (joined.includes("заявление")) {
      return { headerRow: r, nameCol: 4, numCol: 3, dateStart: 5, doc: true };
    }
  }
  for (let r = 0; r < Math.min(4, rows.length); r++) {
    const joined = (rows[r] || []).map((x) => String(x).toLowerCase()).join(" | ");
    if (joined.includes("n п/п") || joined.includes("число")) {
      return { headerRow: r, nameCol: 1, numCol: 0, dateStart: 2, doc: false };
    }
  }
  return { headerRow: 1, nameCol: 1, numCol: 0, dateStart: 2, doc: false };
}

function parseRoster(ws) {
  const rows = rowsOf(ws);
  const layout = detectLayout(rows);
  const groups = [];
  const children = [];
  let current = null;
  let gi = 0;

  for (let r = layout.headerRow + 2; r < rows.length; r++) {
    const row = rows[r] || [];
    const a = cell(row, layout.numCol);
    const b = cell(row, layout.nameCol);
    const maybeHeader = [a, b, cell(row, 0), cell(row, 3), cell(row, 4)].find(isGroupHeader);
    if (maybeHeader) {
      gi += 1;
      current = {
        id: "g" + gi,
        name: maybeHeader.replace(/\s+/g, " ").trim(),
        weekdays: parseGroupWeekdays(maybeHeader)
      };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    const name = b || (isNaN(Number(a)) && !isGroupHeader(a) ? a : "");
    if (!name) continue;
    if (/^\d+$/.test(name)) continue;
    if (/день недели|заявление|справка|страховка|^число$/i.test(name)) continue;
    if (name.length < 3) continue;
    children.push({
      name: name.replace(/\s+/g, " ").trim(),
      groupId: current.id,
      documents: {
        application: cell(row, 0) === "+",
        certificate: cell(row, 1) === "+",
        insurance: cell(row, 2) === "+"
      }
    });
  }
  return { groups, children };
}

function seedMarks(db) {
  const month = db.months[0];
  db.children.forEach((child, idx) => {
    const group = db.groups.find((g) => g.id === child.groupId);
    if (!group) return;
    for (const day of scheduledDays(month, group)) {
      const n = (idx * 11 + day * 3) % 13;
      let status = "present";
      if (n === 0) status = "excused";
      else if (n > 9) status = "";
      if (status) db.attendance[attKey(month.id, child.id, day)] = status;
    }
  });
}

function build() {
  if (!fs.existsSync(ATT_FILE)) {
    throw new Error("Не найден файл посещаемости: " + ATT_FILE);
  }
  console.log("Читаю", ATT_FILE);
  const wb = XLSX.readFile(ATT_FILE, { raw: false });
  const sheetName = findSheet(wb, (n) => /март/.test(n) && /26/.test(n))
    || findSheet(wb, (n) => /феврал/.test(n) && /26/.test(n));
  if (!sheetName) throw new Error("Нет листа марта/февраля 26. Листы: " + wb.SheetNames.join(", "));
  const parsed = parseRoster(wb.Sheets[sheetName]);

  const year = 2026;
  const monthNum = 9;
  const days = monthDays(year, monthNum);

  const groups = parsed.groups;
  const keyToFamily = {};
  const children = parsed.children.map((c, i) => {
    const key = familyKey(c.name) || "solo-" + (i + 1);
    if (!keyToFamily[key]) {
      keyToFamily[key] = "f" + (Object.keys(keyToFamily).length + 1);
    }
    return {
      id: "c" + (i + 1),
      name: c.name,
      groupId: c.groupId,
      familyId: keyToFamily[key],
      discountPercent: null,
      documents: c.documents
    };
  });
  const used = {};
  children.forEach((c) => { used[c.familyId] = (used[c.familyId] || 0) + 1; });

  const db = {
    settings: {
      packPrice: 7500,
      packLessons: 8,
      note: "Цена 8 занятий из расчёта стоимости. 1 занятие = 7500 / 8. Скидка семьи: 2 ребёнка 10%, 3 ребёнка 20%."
    },
    months: [
      {
        id: "2026-09",
        label: "Сентябрь 2026",
        year,
        month: monthNum,
        days
      }
    ],
    groups,
    children,
    attendance: {},
    source: {
      attendanceSheet: sheetName,
      comment: "Состав групп из таблицы посещаемости (март 2026, группы конца прошлого сезона). Актуальные группы клиент пришлёт отдельно."
    }
  };

  seedMarks(db);
  write(db);
  console.log("Групп:", groups.length, "детей:", children.length, "семей 2+:", Object.values(used).filter((n) => n > 1).length);
  console.log("Лист:", sheetName);
  console.log("Записано", require("../lib/store").DB_PATH);
}

build();
