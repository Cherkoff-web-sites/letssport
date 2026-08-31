const fs = require("fs");
const path = require("path");
const { familyKey, attKey } = require("./billing");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

let cache = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    throw new Error("Нет data/db.json — сначала выполните npm run import");
  }
  cache = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  return cache;
}

function write(db) {
  ensureDir();
  cache = db;
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  return db;
}

function nextId(items, prefix) {
  const nums = items
    .map((x) => Number(String(x.id).replace(prefix, "")))
    .filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return prefix + (max + 1);
}

function setAttendance(childId, day, status) {
  const db = read();
  const month = db.months[0];
  const allowed = ["", "present", "excused"];
  const next = allowed.includes(status) ? status : "";
  const key = attKey(month.id, childId, Number(day));
  if (!next) delete db.attendance[key];
  else db.attendance[key] = next;
  write(db);
  return db;
}

function addChild({ name, groupId, discountPercent }) {
  const db = read();
  const group = db.groups.find((g) => g.id === groupId);
  if (!group) throw new Error("Группа не найдена");
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Укажите фамилию и имя");
  const key = familyKey(trimmed);
  const existing = db.children.find((c) => familyKey(c.name) === key);
  const familyId = existing
    ? existing.familyId
    : nextId(db.children.map((c) => ({ id: c.familyId })), "f");
  const child = {
    id: nextId(db.children, "c"),
    name: trimmed,
    groupId: group.id,
    familyId,
    discountPercent: discountPercent == null || discountPercent === "" ? null : Number(discountPercent),
    documents: { application: false, certificate: false, insurance: false }
  };
  db.children.push(child);
  write(db);
  return child;
}

function updateChild(id, patch) {
  const db = read();
  const child = db.children.find((c) => c.id === id);
  if (!child) throw new Error("Ребёнок не найден");
  if (patch.name) {
    child.name = String(patch.name).trim();
    const key = familyKey(child.name);
    const existing = db.children.find((c) => c.id !== child.id && familyKey(c.name) === key);
    child.familyId = existing
      ? existing.familyId
      : nextId(db.children.map((c) => ({ id: c.familyId })), "f");
  }
  if (patch.groupId) {
    const group = db.groups.find((g) => g.id === patch.groupId);
    if (!group) throw new Error("Группа не найдена");
    child.groupId = group.id;
  }
  if ("discountPercent" in patch) {
    child.discountPercent = patch.discountPercent === "" || patch.discountPercent == null
      ? null
      : Number(patch.discountPercent);
  }
  if (patch.documents) {
    child.documents = { ...child.documents, ...patch.documents };
  }
  write(db);
  return child;
}

function removeChild(id) {
  const db = read();
  db.children = db.children.filter((c) => c.id !== id);
  for (const key of Object.keys(db.attendance)) {
    if (key.includes(":" + id + ":")) delete db.attendance[key];
  }
  write(db);
}

function updateSettings(patch) {
  const db = read();
  if (patch.packPrice != null) db.settings.packPrice = Number(patch.packPrice);
  if (patch.packLessons != null) db.settings.packLessons = Number(patch.packLessons);
  write(db);
  return db.settings;
}

module.exports = {
  DB_PATH,
  read,
  write,
  setAttendance,
  addChild,
  updateChild,
  removeChild,
  updateSettings
};
