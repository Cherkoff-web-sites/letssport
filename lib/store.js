const fs = require("fs");
const path = require("path");
const { migrate, needsMigrate, groupLabel } = require("./migrate");
const { attKey, childGroupIds, parseGroupWeekdays } = require("./billing");

const DATA_FILE = path.join(__dirname, "..", "data", "db.json");
const MAX_BACKUPS = 8;

function writeAtomic(file, json) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, file);
}

function rotateBackup() {
  const dir = path.dirname(DATA_FILE);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `db.backup-${stamp}.json`);
  try {
    fs.copyFileSync(DATA_FILE, dest);
  } catch {
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("db.backup-") && f.endsWith(".json")).sort();
  while (files.length > MAX_BACKUPS) {
    const old = files.shift();
    try {
      fs.unlinkSync(path.join(dir, old));
    } catch {
      /* ignore */
    }
  }
}

function load() {
  const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const beforeMonths = (db.months || []).length;
  const wasNew = needsMigrate(db) || !db.migrated;
  migrate(db);
  if (wasNew || (db.months || []).length !== beforeMonths) save(db, { backup: wasNew });
  return db;
}

function save(db, opts) {
  if (opts && opts.backup) rotateBackup();
  writeAtomic(DATA_FILE, JSON.stringify(db, null, 2));
}

function mutate(fn) {
  const db = load();
  const result = fn(db);
  save(db);
  return result;
}

function nextId(items, prefix) {
  let max = 0;
  for (const x of items || []) {
    const n = Number(String(x.id).replace(/^[a-z]+/i, ""));
    if (n > max) max = n;
  }
  return prefix + (max + 1);
}

function monthOf(db, monthId) {
  return (db.months || []).find((m) => m.id === monthId) || db.months[0];
}

function getChild(db, id) {
  return (db.children || []).find((c) => c.id === id);
}

function getGroup(db, id) {
  return (db.groups || []).find((g) => g.id === id);
}

function login(loginName, password) {
  const db = load();
  const name = String(loginName || "").trim();
  const pass = String(password || "");
  const user = (db.users || []).find((u) => u.login === name && u.password === pass);
  if (user) return { role: user.role, name: user.name, familyId: "", trainerId: "" };
  const trainer = (db.trainers || []).find((t) => t.login === name && t.password === pass);
  if (trainer) return { role: "trainer", name: trainer.name, familyId: "", trainerId: trainer.id };
  const family = (db.families || []).find((f) => f.login === name && f.password === pass);
  if (family) return { role: "parent", name: family.parentName, familyId: family.id, trainerId: "" };
  throw new Error("Неверный логин или пароль");
}

function nextMark(child, current, role) {
  if (current === "sick") return "sick";
  const trial = child.kind === "trial";
  if (trial) {
    if (!current) return "trial0";
    if (current === "trial0") return "trial500";
    if (current === "trial500") return "present";
    if (current === "present") return "";
    return "trial0";
  }
  if (!current) return "present";
  if (current === "present") return "";
  return "present";
}

function setAttendance(groupId, childId, day, role, forced, monthId) {
  return mutate((db) => {
    const child = getChild(db, childId);
    const group = getGroup(db, groupId);
    if (!child || !group) throw new Error("Ребёнок или группа не найдены");
    if (!(childGroupIds(child).includes(groupId))) throw new Error("Ребёнок не в этой группе");
    const month = monthOf(db, monthId);
    const key = attKey(month.id, groupId, childId, Number(day));
    const sickList = (db.sick && db.sick[child.id]) || [];
    const iso = `${month.id}-${String(day).padStart(2, "0")}`;
    if (sickList.includes(iso)) {
      if (role === "trainer") throw new Error("Больничный нельзя менять");
      return { mark: "sick" };
    }
    let next;
    if (forced === undefined || forced === null) {
      next = nextMark(child, db.attendance[key] || "", role);
    } else {
      next = forced;
    }
    if (next) db.attendance[key] = next;
    else delete db.attendance[key];
    return { mark: next || "" };
  });
}

function setSickDates(childId, dates) {
  return mutate((db) => {
    const child = getChild(db, childId);
    if (!child) throw new Error("Ребёнок не найден");
    db.sick = db.sick || {};
    const uniq = [...new Set((dates || []).filter(Boolean))].sort();
    db.sick[childId] = uniq;
    return { dates: uniq };
  });
}

function toggleSickDate(childId, iso) {
  return mutate((db) => {
    const child = getChild(db, childId);
    if (!child) throw new Error("Ребёнок не найден");
    db.sick = db.sick || {};
    const list = db.sick[childId] || [];
    const i = list.indexOf(iso);
    if (i >= 0) list.splice(i, 1);
    else list.push(iso);
    db.sick[childId] = list.sort();
    return { dates: db.sick[childId] };
  });
}

function stampTrialDay(db, child, groupId, dayHint) {
  if (!child || child.kind !== "trial" || !groupId) return;
  const month = db.months[0];
  if (!month) return;
  let day = Number(dayHint) || 0;
  const now = new Date();
  if (!day) {
    if (now.getFullYear() === month.year && now.getMonth() + 1 === month.month) day = now.getDate();
    else day = month.days[0].day;
  }
  if (!month.days.some((d) => d.day === day)) day = month.days[0].day;
  db.attendance = db.attendance || {};
  db.attendance[attKey(month.id, groupId, child.id, day)] = "trial0";
}

function addChild(fields, role) {
  return mutate((db) => {
    const name = String(fields.name || "").trim();
    if (!name) throw new Error("Нужно имя");
    const groupId = fields.groupId;
    const existing = db.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing && groupId) {
      if (childGroupIds(existing).includes(groupId)) throw new Error("Этот ребёнок уже есть в таблице");
      existing.groupIds = [...childGroupIds(existing), groupId];
      existing.groupId = existing.groupIds[0];
      if (fields.kind === "trial") existing.kind = "trial";
      if (existing.kind === "trial") stampTrialDay(db, existing, groupId, fields.day);
      return existing;
    }
    let familyId = fields.familyId || "";
    if (!familyId) {
      const fam = createFamilyRecord(db, { parentName: "Родитель " + name.split(/\s+/)[0] });
      familyId = fam.id;
    }
    const child = {
      id: nextId(db.children, "c"),
      name,
      groupId: groupId || "",
      groupIds: groupId ? [groupId] : [],
      familyId,
      discountPercent: null,
      documents: {
        doctor: false,
        insurance: "",
        certificate: false,
        application: false
      },
      kind: fields.kind === "trial" ? "trial" : "regular",
      addedBy: role || "admin"
    };
    db.children.push(child);
    if (child.kind === "trial" && groupId) stampTrialDay(db, child, groupId, fields.day);
    return child;
  });
}

function updateChild(id, patch) {
  return mutate((db) => {
    const child = getChild(db, id);
    if (!child) throw new Error("Ребёнок не найден");
    if (patch.name != null) child.name = String(patch.name).trim() || child.name;
    if (patch.kind) child.kind = patch.kind;
    if (patch.documents) {
      child.documents = { ...(child.documents || {}), ...patch.documents };
    }
    if (Array.isArray(patch.groupIds)) {
      child.groupIds = [...new Set(patch.groupIds)];
      child.groupId = child.groupIds[0] || "";
    }
    if (patch.familyId !== undefined) child.familyId = patch.familyId;
    return child;
  });
}

function addChildToGroup(groupId, childId) {
  return mutate((db) => {
    const child = getChild(db, childId);
    const group = getGroup(db, groupId);
    if (!child || !group) throw new Error("Ребёнок или группа не найдены");
    const ids = childGroupIds(child);
    if (ids.includes(groupId)) throw new Error("Этот ребёнок уже есть в таблице");
    child.groupIds = [...ids, groupId];
    child.groupId = child.groupIds[0];
    return child;
  });
}

function removeChildFromGroup(groupId, childId, role) {
  return mutate((db) => {
    const child = getChild(db, childId);
    if (!child) throw new Error("Ребёнок не найден");
    if (role === "trainer" && !(child.addedBy === "trainer" && child.kind === "trial")) {
      throw new Error("Тренер не может удалять тех, кого внёс координатор");
    }
    child.groupIds = childGroupIds(child).filter((g) => g !== groupId);
    child.groupId = child.groupIds[0] || "";
    return { ok: true };
  });
}

function removeChild(id, role) {
  return mutate((db) => {
    const child = getChild(db, id);
    if (!child) throw new Error("Ребёнок не найден");
    if (role === "trainer" && !(child.addedBy === "trainer" && child.kind === "trial")) {
      throw new Error("Тренер не может удалять тех, кого внёс координатор");
    }
    db.children = db.children.filter((c) => c.id !== id);
    return { ok: true };
  });
}

function createFamilyRecord(db, fields) {
  const fam = {
    id: nextId(db.families, "f"),
    login: "",
    password: String(100000 + Math.floor(Math.random() * 900000)),
    parentName: String(fields.parentName || "Родитель").trim(),
    phone: String(fields.phone || ""),
    email: String(fields.email || "")
  };
  db.families.push(fam);
  fam.login = "sem" + fam.id.replace(/\D/g, "");
  return fam;
}

function createFamily(fields, childId) {
  return mutate((db) => {
    const fam = createFamilyRecord(db, fields || {});
    if (childId) {
      const child = getChild(db, childId);
      if (child) child.familyId = fam.id;
    }
    return fam;
  });
}

function updateFamily(id, patch) {
  return mutate((db) => {
    const fam = (db.families || []).find((f) => f.id === id);
    if (!fam) throw new Error("Семья не найдена");
    if (patch.parentName != null) fam.parentName = String(patch.parentName);
    if (patch.phone != null) fam.phone = String(patch.phone);
    if (patch.email != null) fam.email = String(patch.email);
    if (patch.login != null) fam.login = String(patch.login);
    if (patch.password != null) fam.password = String(patch.password);
    return fam;
  });
}

function assignFamily(childId, familyId) {
  return mutate((db) => {
    const child = getChild(db, childId);
    if (!child) throw new Error("Ребёнок не найден");
    if (!familyId) {
      const fam = createFamilyRecord(db, { parentName: "Родитель " + child.name.split(/\s+/)[0] });
      child.familyId = fam.id;
      return { child, family: fam };
    }
    const fam = (db.families || []).find((f) => f.id === familyId);
    if (!fam) throw new Error("Семья не найдена");
    child.familyId = familyId;
    return { child, family: fam };
  });
}

function createGroup(fields) {
  return mutate((db) => {
    const branch = (db.branches || []).find((b) => b.id === fields.branchId);
    if (!branch) throw new Error("Филиал не найден");
    const sport = fields.sport === "hg" ? "hg" : "sambo";
    const weekdays = Array.isArray(fields.weekdays) && fields.weekdays.length
      ? fields.weekdays
      : parseGroupWeekdays(fields.time || "");
    const g = {
      id: nextId(db.groups, "g"),
      name: "",
      branchId: branch.id,
      sport,
      durationMin: Number(fields.durationMin) === 90 ? 90 : 60,
      time: String(fields.time || "").trim(),
      weekdays
    };
    const sportName = sport === "hg" ? "ХГ" : "САМБО";
    g.name = `${sportName} ${branch.name} (${(g.weekdays || []).join("/")} ${g.time})`.trim();
    g.title = groupLabel(g);
    db.groups.push(g);
    return g;
  });
}

function updateGroup(id, patch) {
  return mutate((db) => {
    const g = getGroup(db, id);
    if (!g) throw new Error("Группа не найдена");
    if (patch.durationMin) g.durationMin = Number(patch.durationMin) === 90 ? 90 : 60;
    if (patch.time != null) g.time = String(patch.time);
    if (Array.isArray(patch.weekdays)) g.weekdays = patch.weekdays;
    if (patch.sport) g.sport = patch.sport;
    const branch = (db.branches || []).find((b) => b.id === g.branchId);
    const sportName = g.sport === "hg" ? "ХГ" : "САМБО";
    g.name = `${sportName} ${branch ? branch.name : ""} (${(g.weekdays || []).join("/")} ${g.time})`.trim();
    g.title = groupLabel(g);
    return g;
  });
}

function updateTrainer(id, patch) {
  return mutate((db) => {
    const t = (db.trainers || []).find((x) => x.id === id);
    if (!t) throw new Error("Тренер не найден");
    if (patch.name != null) t.name = String(patch.name);
    if (patch.login != null) t.login = String(patch.login);
    if (patch.password != null) t.password = String(patch.password);
    if (Array.isArray(patch.groupIds)) t.groupIds = [...new Set(patch.groupIds)];
    if (patch.sport) t.sport = patch.sport;
    return t;
  });
}

function createTrainer(fields) {
  return mutate((db) => {
    const t = {
      id: nextId(db.trainers, "t"),
      name: String(fields.name || "Тренер").trim(),
      sport: fields.sport === "hg" ? "hg" : "sambo",
      login: String(fields.login || "").trim() || ("tr" + Date.now().toString().slice(-4)),
      password: String(fields.password || 100000 + Math.floor(Math.random() * 900000)),
      groupIds: Array.isArray(fields.groupIds) ? fields.groupIds : []
    };
    db.trainers.push(t);
    return t;
  });
}

function updateBranch(id, patch) {
  return mutate((db) => {
    const b = (db.branches || []).find((x) => x.id === id);
    if (!b) throw new Error("Филиал не найден");
    if (patch.priceHour != null) b.priceHour = Number(patch.priceHour) || 0;
    if (patch.priceHourHalf != null) b.priceHourHalf = Number(patch.priceHourHalf) || 0;
    if (patch.qr) b.qr = patch.qr === "qr2" ? "qr2" : "qr1";
    return b;
  });
}

function setParentPaid(familyId, monthId) {
  return mutate((db) => {
    const month = monthOf(db, monthId);
    const key = `${familyId}:${month.id}`;
    db.familyPayments = db.familyPayments || {};
    const cur = db.familyPayments[key] || {};
    db.familyPayments[key] = {
      ...cur,
      status: "yellow",
      parentClickedAt: new Date().toISOString()
    };
    return db.familyPayments[key];
  });
}

function setDirectorPay(familyId, incoming, requested, monthId) {
  return mutate((db) => {
    const month = monthOf(db, monthId);
    const key = `${familyId}:${month.id}`;
    db.familyPayments = db.familyPayments || {};
    const sum = Number(incoming) || 0;
    const need = Number(requested);
    let status = "green";
    if (!Number.isNaN(need) && sum < need) status = "red";
    if (!Number.isNaN(need) && sum === need) status = "green";
    if (!Number.isNaN(need) && sum > need) status = "green";
    const cur = db.familyPayments[key] || {};
    db.familyPayments[key] = {
      ...cur,
      incoming: sum,
      status,
      directorAt: new Date().toISOString()
    };
    return db.familyPayments[key];
  });
}

module.exports = {
  load,
  save,
  DATA_FILE,
  login,
  monthOf,
  getChild,
  getGroup,
  setAttendance,
  setSickDates,
  toggleSickDate,
  addChild,
  updateChild,
  addChildToGroup,
  removeChildFromGroup,
  removeChild,
  createFamily,
  updateFamily,
  assignFamily,
  createGroup,
  updateGroup,
  updateTrainer,
  createTrainer,
  updateBranch,
  setParentPaid,
  setDirectorPay
};
