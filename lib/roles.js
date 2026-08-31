const ROLES = {
  parent: {
    id: "parent",
    title: "Родитель",
    hint: "Посещение своих детей и сумма к оплате за месяц"
  },
  trainer: {
    id: "trainer",
    title: "Тренер",
    hint: "Таблица посещаемости: отметка кто был на тренировке"
  },
  admin: {
    id: "admin",
    title: "Управляющая",
    hint: "Посещаемость, новенькие в группу и расчёт абонемента"
  },
  director: {
    id: "director",
    title: "Руководитель",
    hint: "Полный доступ ко всем таблицам и настройкам"
  }
};

function normalizeRole(role) {
  return ROLES[role] ? role : "parent";
}

function can(role, action) {
  const r = normalizeRole(role);
  const map = {
    viewOwnAttendance: ["parent", "trainer", "admin", "director"],
    viewAllAttendance: ["trainer", "admin", "director"],
    editAttendance: ["trainer", "admin", "director"],
    addChild: ["admin", "director"],
    removeChild: ["admin", "director"],
    viewOwnBilling: ["parent", "admin", "director"],
    viewAllBilling: ["admin", "director"],
    editDiscount: ["admin", "director"],
    editSettings: ["director"]
  };
  return (map[action] || []).includes(r);
}

function filterState(db, role, familyId) {
  const r = normalizeRole(role);
  const families = [...new Map(
    db.children.map((c) => [c.familyId, {
      id: c.familyId,
      label: (c.name.split(/\s+/)[0] || c.name),
      count: db.children.filter((x) => x.familyId === c.familyId).length
    }])
  ).values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));

  const month = db.months[0];
  const payload = {
    role: r,
    roleMeta: ROLES[r],
    familyId: familyId || "",
    families,
    settings: db.settings,
    month,
    months: db.months,
    groups: db.groups,
    sourceNote: (db.source && db.source.comment) || "",
    permissions: {
      attendance: can(r, "viewAllAttendance") || can(r, "viewOwnAttendance"),
      editAttendance: can(r, "editAttendance"),
      billing: can(r, "viewAllBilling") || can(r, "viewOwnBilling"),
      editBilling: can(r, "editDiscount"),
      addChild: can(r, "addChild"),
      removeChild: can(r, "removeChild"),
      settings: can(r, "editSettings")
    }
  };

  if (r === "parent") {
    const fid = familyId && db.children.some((c) => c.familyId === familyId)
      ? familyId
      : (families.find((f) => f.count > 1) || families[0] || {}).id;
    payload.familyId = fid || "";
    payload.children = db.children.filter((c) => c.familyId === payload.familyId);
  } else {
    payload.children = db.children;
  }

  payload.attendance = {};
  for (const child of payload.children) {
    for (const day of month.days) {
      const key = `${month.id}:${child.id}:${day.day}`;
      if (db.attendance[key]) payload.attendance[key] = db.attendance[key];
    }
  }

  return payload;
}

module.exports = { ROLES, normalizeRole, can, filterState };
