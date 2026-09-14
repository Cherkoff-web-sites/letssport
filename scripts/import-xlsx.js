const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");
const { monthDays, parseGroupWeekdays, familyKey, attKey } = require("../lib/billing");
const { save, load, DATA_FILE } = require("../lib/store");

const ROOT = path.join(__dirname, "..", "..");

function findAttFile() {
  const files = fs.readdirSync(ROOT).filter((f) => /\.xlsx$/i.test(f) && !/^~\$?/.test(f));
  const prefer = files.find((f) => /посещаемость\s*сентябрь/i.test(f))
    || files.find((f) => /\(6\)/.test(f) && /посещаемость/i.test(f))
    || files.find((f) => /\(6\)/.test(f))
    || files.find((f) => /посещаемость/i.test(f));
  if (!prefer) throw new Error("Не найден xlsx посещаемости в " + ROOT);
  return path.join(ROOT, prefer);
}

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
  if (/^\d+$/.test(s)) return false;
  return /ХГ|САМБО|ДЗЮДО|ГИМНАСТ|ФУТБОЛ|ХОККЕЙ|ТЕННИС|ШАХМАТ|ЕДИНОБОР|ЙОГА|ПЛАВАНИЕ|ГТО/i.test(s);
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

function dayColumns(headerRow, dateStart) {
  const cols = [];
  for (let c = dateStart; c < (headerRow || []).length; c++) {
    const raw = String(headerRow[c] || "").trim();
    if (!raw) continue;
    const m = raw.match(/^(\d{1,2})/);
    if (!m) continue;
    const day = Number(m[1]);
    if (day >= 1 && day <= 31) cols.push({ col: c, day });
  }
  return cols;
}

/** Жёлтая заливка в таблице = «был» (часто без текста в ячейке). */
function isYellowFill(style) {
  if (!style || style.patternType !== "solid") return false;
  const colors = [style.fgColor, style.bgColor].filter(Boolean);
  for (const c of colors) {
    if (c.indexed === 5 || c.indexed === 43 || c.indexed === 13) return true;
    const rgb = String(c.rgb || "").toUpperCase().replace(/^FF/, "");
    if (/^(FFFF00|FFEB9C|FFFF99|FFC000|FFD966|FFF2CC|FFE699)$/.test(rgb)) return true;
  }
  return false;
}

/** Map Excel cell → { status?, sick? }; text overrides fill. */
function mapMark(raw, style) {
  const s = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (s && !/^(пн|вт|ср|чт|пт|сб|воскр|вс)$/i.test(s) && !/^\d{1,2}[-./]/.test(s)) {
    // Excel serial dates / мусор
    if (/^\d{4,}$/.test(s)) return null;
    if (/^б$|^бол/.test(s) || s === "б") return { sick: true };
    if (/^ф$|факульт|уваж|пропуск/.test(s)) return { sick: true };
    if (/^т(\s|$)|пробн|500/.test(s)) return { status: "trial500" };
    if (/^0$|бесплат/.test(s)) return { status: "trial0" };
    if (/не\s*занимал|не\s*состоял|не\s*было|х2|1\.5|\?/.test(s)) return null;
    if (/^[вп+]|^был|^дб|в\s*дб/.test(s)) return { status: "present" };
    if (s === "п") return { status: "present" };
  }
  if (isYellowFill(style)) return { status: "present" };
  return null;
}

function parseRoster(ws) {
  const rows = rowsOf(ws);
  const layout = detectLayout(rows);
  const header = rows[layout.headerRow] || [];
  const dayCols = dayColumns(header, layout.dateStart);
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

    const marks = {};
    const sickDays = [];
    for (const { col, day } of dayCols) {
      const addr = XLSX.utils.encode_cell({ r, c: col });
      const xcell = ws[addr];
      const mapped = mapMark(row[col], xcell && xcell.s);
      if (!mapped) continue;
      if (mapped.sick) sickDays.push(day);
      else if (mapped.status) marks[day] = mapped.status;
    }

    children.push({
      name: name.replace(/\s+/g, " ").trim(),
      groupId: current.id,
      documents: layout.doc
        ? {
            application: cell(row, 0) === "+",
            certificate: cell(row, 1) === "+",
            insurance: cell(row, 2) === "+"
          }
        : { application: false, certificate: false, insurance: false },
      marks,
      sickDays
    });
  }
  return { groups, children, dayCols };
}

function monthLabelRu(year, monthNum) {
  const names = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  return names[monthNum - 1] + " " + year;
}

function build() {
  const ATT_FILE = findAttFile();
  console.log("Читаю", ATT_FILE);
  const wb = XLSX.readFile(ATT_FILE, { raw: false, cellStyles: true });

  const sheetName = findSheet(wb, (n) => /сентябрь/.test(n) && /26/.test(n))
    || findSheet(wb, (n) => /^лист1$/i.test(n))
    || findSheet(wb, (n) => /сентябрь/i.test(n))
    || findSheet(wb, (n) => /май/.test(n) && /26/.test(n))
    || findSheet(wb, (n) => /март/.test(n) && /26/.test(n))
    || wb.SheetNames[0];
  if (!sheetName) throw new Error("Нет листов в файле");

  const year = 2026;
  const monthNum = /май/i.test(sheetName) && !/сентябрь/i.test(path.basename(ATT_FILE))
    ? 5
    : /март/i.test(sheetName) && !/сентябрь/i.test(path.basename(ATT_FILE))
      ? 3
      : 9;
  const monthId = `${year}-${String(monthNum).padStart(2, "0")}`;
  const days = monthDays(year, monthNum);

  const parsed = parseRoster(wb.Sheets[sheetName]);
  const groups = parsed.groups;
  const keyToFamily = {};
  const attendance = {};
  const sick = {};

  const children = parsed.children.map((c, i) => {
    const key = familyKey(c.name) || "solo-" + (i + 1);
    if (!keyToFamily[key]) {
      keyToFamily[key] = "f" + (Object.keys(keyToFamily).length + 1);
    }
    const id = "c" + (i + 1);
    for (const [day, status] of Object.entries(c.marks || {})) {
      attendance[attKey(monthId, c.groupId, id, Number(day))] = status;
    }
    if (c.sickDays && c.sickDays.length) {
      sick[id] = c.sickDays.map((d) => `${monthId}-${String(d).padStart(2, "0")}`);
    }
    return {
      id,
      name: c.name,
      groupId: c.groupId,
      groupIds: [c.groupId],
      familyId: keyToFamily[key],
      kind: "regular",
      discountPercent: null,
      documents: c.documents
    };
  });

  const used = {};
  children.forEach((c) => { used[c.familyId] = (used[c.familyId] || 0) + 1; });

  const markCount = Object.keys(attendance).length;
  const sickKids = Object.keys(sick).length;

  const db = {
    settings: {
      packPrice: 7500,
      packLessons: 8,
      trialPrice: 500,
      note: "Импорт из таблицы посещаемости. Цена пакета / число занятий = цена за занятие. Скидка семьи: 2 ребёнка 10%, 3+ — 20%."
    },
    months: [
      {
        id: monthId,
        label: monthLabelRu(year, monthNum),
        year,
        month: monthNum,
        days
      }
    ],
    groups,
    children,
    attendance,
    sick,
    familyPayments: {},
    source: {
      file: path.basename(ATT_FILE),
      attendanceSheet: sheetName,
      comment: `Состав и отметки из «${sheetName}»: жёлтая заливка = был (${markCount} посещений, больничных у ${sickKids} детей).`
    }
  };

  save(db, { backup: true });
  // migrate / trainers / packs / demo multi-group
  const live = load();
  console.log("Групп:", live.groups.length, "детей:", live.children.length);
  console.log("Семей 2+:", Object.values(used).filter((n) => n > 1).length);
  console.log("Отметок:", markCount, "· больничные:", sickKids);
  console.log("Лист:", sheetName);
  console.log("Записано", DATA_FILE);
}

build();
