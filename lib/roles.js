const ROLES = {
  parent: { id: "parent", name: "Родитель" },
  trainer: { id: "trainer", name: "Тренер" },
  admin: { id: "admin", name: "Координатор" },
  director: { id: "director", name: "Руководитель" }
};

function canEditAttendance(role) {
  return role === "trainer" || role === "admin" || role === "director";
}

function canSeeAllGroups(role) {
  return role === "admin" || role === "director";
}

function trainerOf(db, trainerId) {
  return (db.trainers || []).find((t) => t.id === trainerId);
}

function trainerGroupIds(db, trainerId) {
  const t = trainerOf(db, trainerId);
  return t ? t.groupIds || [] : [];
}

function visibleGroups(db, role, familyId, trainerId) {
  if (role === "parent") {
    const ids = new Set(
      db.children.filter((c) => c.familyId === familyId).flatMap((c) => c.groupIds || (c.groupId ? [c.groupId] : []))
    );
    return db.groups.filter((g) => ids.has(g.id));
  }
  if (role === "trainer") {
    const ids = new Set(trainerGroupIds(db, trainerId));
    return db.groups.filter((g) => ids.has(g.id));
  }
  return db.groups;
}

function visibleChildren(db, role, familyId, trainerId) {
  if (role === "parent") return db.children.filter((c) => c.familyId === familyId);
  if (role === "trainer") {
    const ids = new Set(trainerGroupIds(db, trainerId));
    return db.children.filter((c) => (c.groupIds || []).some((g) => ids.has(g)));
  }
  return db.children;
}

module.exports = {
  ROLES,
  canEditAttendance,
  canSeeAllGroups,
  trainerOf,
  trainerGroupIds,
  visibleGroups,
  visibleChildren
};
