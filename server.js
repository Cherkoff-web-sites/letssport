const express = require("express");
const path = require("path");
const store = require("./lib/store");
const { can, filterState, normalizeRole, ROLES } = require("./lib/roles");
const { withBilling } = require("./lib/billing");

const app = express();
const PORT = process.env.PORT || 3780;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function ctx(req) {
  return {
    role: normalizeRole(req.get("X-Role") || req.query.role || "parent"),
    familyId: req.get("X-Family") || req.query.family || ""
  };
}

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

app.get("/api/meta", (_req, res) => {
  res.json({ roles: ROLES });
});

app.get("/api/state", (req, res) => {
  try {
    const { role, familyId } = ctx(req);
    const db = store.read();
    const state = filterState(db, role, familyId);
    const { rows, month } = withBilling(db, state.month.id);
    const visibleIds = new Set(state.children.map((c) => c.id));
    const canBill = can(role, "viewAllBilling") || can(role, "viewOwnBilling");
    state.billing = canBill
      ? rows
          .filter((row) => visibleIds.has(row.child.id))
          .map((row) => ({
            childId: row.child.id,
            name: row.child.name,
            groupId: row.child.groupId,
            groupName: row.group ? row.group.name : "",
            discountPercent: row.billing.discountPercent,
            plannedCount: row.billing.plannedCount,
            present: row.billing.present,
            excused: row.billing.excused,
            toPayLessons: row.billing.toPayLessons,
            toPaySum: row.billing.toPaySum,
            discounted: row.billing.discounted,
            lessonPrice: row.billing.lessonPrice,
            packPrice: row.billing.packPrice,
            nineLessons: row.billing.nineLessons,
            scheduled: row.billing.scheduled
          }))
      : [];
    state.month = month;
    res.json(state);
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

app.post("/api/attendance", (req, res) => {
  const { role } = ctx(req);
  if (!can(role, "editAttendance")) return sendError(res, 403, "Нет прав отмечать посещаемость");
  const { childId, day, status } = req.body || {};
  if (!childId || day == null) return sendError(res, 400, "Нужны childId и day");
  try {
    store.setAttendance(childId, day, status);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, 400, err.message);
  }
});

app.post("/api/children", (req, res) => {
  const { role } = ctx(req);
  if (!can(role, "addChild")) return sendError(res, 403, "Нет прав добавлять учеников");
  try {
    const child = store.addChild(req.body || {});
    res.json(child);
  } catch (err) {
    sendError(res, 400, err.message);
  }
});

app.patch("/api/children/:id", (req, res) => {
  const { role } = ctx(req);
  if (!can(role, "editDiscount") && !can(role, "addChild")) {
    return sendError(res, 403, "Нет прав редактировать ученика");
  }
  try {
    const child = store.updateChild(req.params.id, req.body || {});
    res.json(child);
  } catch (err) {
    sendError(res, 400, err.message);
  }
});

app.delete("/api/children/:id", (req, res) => {
  const { role } = ctx(req);
  if (!can(role, "removeChild")) return sendError(res, 403, "Нет прав удалять учеников");
  try {
    store.removeChild(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, 400, err.message);
  }
});

app.patch("/api/settings", (req, res) => {
  const { role } = ctx(req);
  if (!can(role, "editSettings")) return sendError(res, 403, "Только руководитель меняет тариф");
  try {
    res.json(store.updateSettings(req.body || {}));
  } catch (err) {
    sendError(res, 400, err.message);
  }
});

app.listen(PORT, () => {
  console.log("ЛК «Займемся Спортом»: http://localhost:" + PORT);
});
