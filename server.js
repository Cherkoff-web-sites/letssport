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
          .map((row) => {
            const pay = (db.payments || {})[`${month.id}:${row.child.id}`];
            return {
              childId: row.child.id,
              name: row.child.name,
              kind: row.child.kind || "regular",
              addedBy: row.child.addedBy || "admin",
              groupId: row.child.groupId,
              groupName: row.group ? row.group.name : "",
              discountPercent: row.billing.discountPercent,
              plannedCount: row.billing.plannedCount,
              present: row.billing.present,
              excused: row.billing.excused,
              trialMarks: row.billing.trialMarks,
              isTrial: row.billing.isTrial,
              toPayLessons: row.billing.toPayLessons,
              toPaySum: row.billing.toPaySum,
              discounted: row.billing.discounted,
              lessonPrice: row.billing.lessonPrice,
              packPrice: row.billing.packPrice,
              nineLessons: row.billing.nineLessons,
              scheduled: row.billing.scheduled,
              paid: !!(pay && pay.paid)
            };
          })
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
    store.setAttendance(childId, day, status, role);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, 400, err.message);
  }
});

app.post("/api/children", (req, res) => {
  const { role } = ctx(req);
  const kind = req.body && req.body.kind === "trial" ? "trial" : "regular";
  if (kind === "trial" && !can(role, "addTrial")) {
    return sendError(res, 403, "Нет прав добавлять пробников");
  }
  if (kind !== "trial" && !can(role, "addChild")) {
    return sendError(res, 403, "Нет прав добавлять учеников");
  }
  try {
    const child = store.addChild({ ...(req.body || {}), kind, addedBy: role });
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
  const child = store.getChild(req.params.id);
  if (!child) return sendError(res, 404, "Ребёнок не найден");
  const ownTrial = role === "trainer" && child.addedBy === "trainer" && child.kind === "trial";
  if (ownTrial && can(role, "removeOwnTrial")) {
    store.removeChild(req.params.id);
    return res.json({ ok: true });
  }
  if (!can(role, "removeChild")) {
    return sendError(res, 403, "Тренер не может удалять тех, кого внёс координатор");
  }
  try {
    store.removeChild(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, 400, err.message);
  }
});

app.post("/api/paid", (req, res) => {
  const { role, familyId } = ctx(req);
  if (!can(role, "markPaid")) return sendError(res, 403, "Нет прав отмечать оплату");
  const db = store.read();
  const { childId, paid } = req.body || {};
  let ids = [];
  if (role === "parent") {
    const fid = familyId || "";
    ids = db.children.filter((c) => c.familyId === fid).map((c) => c.id);
  } else if (childId) {
    ids = [childId];
  }
  if (!ids.length) return sendError(res, 400, "Некого отмечать");
  try {
    store.setPaid(ids, !!paid);
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

app.listen(PORT, "0.0.0.0", () => {
  console.log("ЛК «Займемся Спортом»: http://localhost:" + PORT);
});
