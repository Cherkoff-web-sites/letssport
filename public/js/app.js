const role = sessionStorage.getItem("lk-role") || "";
const family = sessionStorage.getItem("lk-family") || "";
const trainer = sessionStorage.getItem("lk-trainer") || "";

if (!role) location.href = "/";

const headers = () => ({
  "Content-Type": "application/json",
  "X-Role": role,
  "X-Family": family,
  "X-Trainer": trainer
});

const WEEK_ORDER = ["пн", "вт", "ср", "чт", "пт", "сб", "воскр"];
const WEEK_SHORT = { пн: "Пн", вт: "Вт", ср: "Ср", чт: "Чт", пт: "Пт", сб: "Сб", воскр: "Вс" };
const MONTH_NAMES = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const DAYS = [["пн","Пн"],["вт","Вт"],["ср","Ср"],["чт","Чт"],["пт","Пт"],["сб","Сб"],["воскр","Вс"]];

const rub = (n) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " ₽";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtWhen = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
};

let monthId = "";
let qrMap = { qr1: "/img/qr-1.jpg", qr2: "/img/qr-2.jpg" };
let view = "";
let dirTab = "coord";
let calcTab = "prices";
let selectedGroup = "";
let selectedBranch = "";
let selectedChild = "";
let selectedSport = "";
let selectedFamily = "";
let calMode = sessionStorage.getItem("lk-cal") || "";
let selectedDay = Number(sessionStorage.getItem("lk-day") || 0);
let sheet = null;
let trainerDraft = {};
let qAthletes = "";
let qParents = "";
let qSick = "";
let showFormula = false;
let showDirFormula = "";
let periods = null;
let eye = {};

async function load() {
  const q = monthId ? ("?month=" + encodeURIComponent(monthId)) : "";
  const [res, qr] = await Promise.all([
    fetch("/api/state" + q, { headers: headers() }),
    fetch("/api/qr-map")
  ]);
  state = await res.json();
  if (qr.ok) qrMap = Object.assign(qrMap, await qr.json());
  if (!res.ok) {
    document.getElementById("app").innerHTML = `<p class="warn-text">${esc(state.error || "Нет данных")}</p>`;
    return;
  }
  if (!view) view = defaultView();
  if (!calMode) calMode = role === "trainer" ? "day" : "month";
  if (!selectedDay) selectedDay = todayDay();
  persistCal();
  render();
}

function defaultView() {
  if (role === "parent") return "parent";
  if (role === "trainer") return "attendance";
  return "branches";
}

function persistCal() {
  sessionStorage.setItem("lk-cal", calMode);
  sessionStorage.setItem("lk-day", String(selectedDay));
}

function api(url, method, body) {
  return fetch(url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
}

function todayDay() {
  const now = new Date();
  if (now.getFullYear() === state.month.year && now.getMonth() + 1 === state.month.month) return now.getDate();
  return state.month.days[0].day;
}

function isToday(day) {
  const now = new Date();
  return now.getFullYear() === state.month.year && now.getMonth() + 1 === state.month.month && now.getDate() === day;
}

function currentGroup() {
  const list = selectedBranch
    ? state.groups.filter((g) => g.branchId === selectedBranch)
    : state.groups;
  const id = (selectedGroup && list.some((g) => g.id === selectedGroup))
    ? selectedGroup
    : (list[0] && list[0].id) || (state.groups[0] && state.groups[0].id) || "";
  selectedGroup = id;
  return state.groups.find((g) => g.id === id);
}

function rosterKids(group) {
  const g = group || currentGroup();
  if (!g) return [];
  return state.children.filter((c) => (c.groupIds || []).includes(g.id));
}

function groupTitle(g) {
  if (!g) return "Группа";
  return g.title || g.name;
}

function branchName(branchId) {
  const b = (state.branches || []).find((x) => x.id === branchId);
  return b ? b.name : "";
}

function groupTitleFull(g) {
  if (!g) return "Группа";
  const branch = branchName(g.branchId);
  const title = groupTitle(g);
  return branch ? `${branch} · ${title}` : title;
}

function dayMeta(dayNum) {
  return state.month.days.find((d) => d.day === dayNum) || { day: dayNum, weekday: "пн" };
}

function isTrainingDay(group, dayNum) {
  const d = dayMeta(dayNum);
  if (!group || !group.weekdays || !group.weekdays.length) return true;
  return group.weekdays.includes(d.weekday);
}

function isoOf(day) {
  return `${state.month.id}-${String(day).padStart(2, "0")}`;
}

function isSick(childId, day) {
  return ((state.sick && state.sick[childId]) || []).includes(isoOf(day));
}

function attOf(groupId, childId, day) {
  return state.attendance[`${state.month.id}:${groupId}:${childId}:${day}`] || "";
}

function cellMark(child, groupId, day) {
  if (isSick(child.id, day)) return { cls: "sick", text: "Б", locked: true };
  const m = attOf(groupId, child.id, day);
  if (m === "trial0") return { cls: "trial0", text: "0", locked: false };
  if (m === "trial500") return { cls: "trial500", text: "500", locked: false };
  if (m === "present") return { cls: "present", text: "+", locked: false };
  return { cls: "", text: "", locked: false };
}

function weekDays() {
  const date = new Date(state.month.year, state.month.month - 1, selectedDay);
  const mondayShift = (date.getDay() + 6) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - mondayShift);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    days.push({
      day: x.getDate(),
      inMonth: x.getMonth() === state.month.month - 1 && x.getFullYear() === state.month.year,
      weekday: WEEK_ORDER[(x.getDay() + 6) % 7]
    });
  }
  return days;
}

function monthGrid() {
  const y = state.month.year;
  const m = state.month.month;
  const first = new Date(y, m - 1, 1);
  const pad = (first.getDay() + 6) % 7;
  const count = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < pad; i++) {
    const d = new Date(y, m - 1, 1 - (pad - i));
    cells.push({ day: d.getDate(), inMonth: false });
  }
  for (let day = 1; day <= count; day++) cells.push({ day, inMonth: true });
  while (cells.length % 7) cells.push({ day: cells.length - pad - count + 1, inMonth: false });
  return cells;
}

function trainerColumns() {
  if (calMode === "day") return state.month.days.filter((d) => d.day === selectedDay);
  if (calMode === "week") return weekDays().filter((d) => d.inMonth).map((d) => dayMeta(d.day));
  return state.month.days;
}

function canDelete(child) {
  if (role === "admin" || role === "director") return true;
  return role === "trainer" && child.addedBy === "trainer" && child.kind === "trial";
}

function canEnroll(child) {
  if (!child || child.kind !== "trial") return false;
  if (role === "admin" || role === "director") return true;
  return role === "trainer" && child.addedBy === "trainer";
}

function staffMode() {
  return role === "admin" || (role === "director" && dirTab === "coord");
}

function render() {
  renderTabs();
  const app = document.getElementById("app");
  if (role === "parent") app.innerHTML = parentView();
  else if (role === "trainer") app.innerHTML = attendanceScreen();
  else if (role === "director" && dirTab === "calc") app.innerHTML = calcView();
  else app.innerHTML = coordView();
  drawOverlay();
}

function renderTabs() {
  const tabs = [];
  if (role === "director") {
    tabs.push(["coord", "Координирование"], ["calc", "Расчёты"]);
  } else if (staffMode()) {
    tabs.push(["athletes", "Спортсмены"], ["sick", "Больничный"], ["branches", "Филиалы"]);
  }
  document.getElementById("tabs").innerHTML = tabs.map(([id, title]) => {
    const branchish = ["branches", "groups", "group", "trainers", "trainer-sport"].includes(view);
    const on = role === "director"
      ? dirTab === id
      : (id === "branches" ? branchish : view === id);
    return `<button class="${on ? "" : "is-off"}" data-tab="${id}">${title}</button>`;
  }).join("");
}

function calToolbar(showGroup) {
  const modes = [["day", "День"], ["week", "Неделя"], ["month", "Месяц"], ["year", "Год"]];
  const g = currentGroup();
  const groupBtn = showGroup ? `
    <button class="group-pick" type="button" data-open-groups>
      <span>${esc(groupTitle(g))}</span>
    </button>` : "";
  return `
    <div class="gcal-bar">
      <div class="gcal-modes">
        ${modes.map(([id, t]) => `<button type="button" class="${calMode === id ? "is-on" : ""}" data-cal="${id}">${t}</button>`).join("")}
      </div>
      <button type="button" class="btn ghost today-btn" data-today>Сегодня</button>
    </div>
    ${groupBtn}
    <div class="gcal-title">${MONTH_NAMES[state.month.month - 1]} ${state.month.year}</div>
  `;
}

function attTable(opts) {
  const group = opts.group || currentGroup();
  const kids = opts.kids || rosterKids(group);
  const clickable = !!opts.clickable;
  const gid = group && group.id;
  if (calMode === "year") {
    const months = MONTH_NAMES.map((name, i) => {
      const active = i + 1 === state.month.month;
      return `<th class="${active ? "is-now" : ""}">${name.slice(0, 3)}</th>`;
    }).join("");
    const rows = kids.map((c) => {
      const cells = MONTH_NAMES.map((_, i) => {
        const active = i + 1 === state.month.month;
        const n = active ? state.month.days.filter((d) => cellMark(c, gid, d.day).text === "+").length : "";
        return `<td class="${active ? "is-now" : "is-out"}">${active ? (n || "—") : ""}</td>`;
      }).join("");
      return `<tr>
        <th class="sticky ${c.kind === "trial" ? "name-trial" : ""}">${esc(c.name)}${c.kind === "trial" ? " <em>пробный</em>" : ""}</th>
        ${cells}
      </tr>`;
    }).join("");
    return `<div class="att-wrap"><table class="att-table"><thead><tr><th class="sticky">Фамилия</th>${months}</tr></thead><tbody>${rows || "<tr><td class=\"sticky\">Никого нет</td></tr>"}</tbody></table></div>`;
  }
  const cols = trainerColumns();
  const head = cols.map((d) => `
    <th class="${isToday(d.day) ? "is-today" : ""} ${isTrainingDay(group, d.day) ? "is-train" : ""} ${d.day === selectedDay ? "is-on" : ""}" data-pick-day="${d.day}">
      <small>${WEEK_SHORT[d.weekday]}</small>${d.day}
    </th>`).join("");
  const rows = kids.map((c) => {
    const del = opts.deletable && canDelete(c)
      ? `<button class="icon-del" data-ungroup="${c.id}" type="button" aria-label="Убрать">×</button>`
      : "";
    const enroll = canEnroll(c)
      ? `<button class="btn-enroll" data-enroll="${c.id}" type="button">В группу</button>`
      : "";
    const cells = cols.map((d) => {
      const mark = cellMark(c, gid, d.day);
      const open = clickable && !mark.locked ? `data-toggle-mark="${c.id}" data-day="${d.day}" data-group="${gid}"` : "";
      return `<td class="mark big-mark ${mark.cls} ${isTrainingDay(group, d.day) ? "is-train" : ""}" ${open}>${mark.text}</td>`;
    }).join("");
    const trialTag = c.kind === "trial" ? `<span class="trial-tag">пробный</span>` : "";
    return `<tr>
      <th class="sticky ${c.kind === "trial" ? "name-trial" : ""}">
        <span class="name-row">${esc(c.name)} ${trialTag}</span>
        <span class="name-actions">${enroll}${del}</span>
      </th>
      ${cells}
    </tr>`;
  }).join("");
  const strip = calMode === "week" ? weekStrip() : "";
  return `${strip}<div class="att-wrap"><table class="att-table"><thead><tr><th class="sticky">Фамилия</th>${head}</tr></thead>
    <tbody>${rows || `<tr><td class="sticky">Никого нет</td>${cols.map(() => "<td></td>").join("")}</tr>`}</tbody></table></div>`;
}

function weekStrip() {
  const days = weekDays();
  return `<div class="week-strip">${days.map((d) => `
    <button type="button" class="week-day ${d.inMonth && d.day === selectedDay ? "is-on" : ""} ${d.inMonth ? "" : "is-out"} ${d.inMonth && isToday(d.day) ? "is-today" : ""}" data-pick-day="${d.inMonth ? d.day : ""}" ${d.inMonth ? "" : "disabled"}>
      <small>${WEEK_SHORT[d.weekday]}</small><strong>${d.day}</strong>
    </button>`).join("")}</div>`;
}

function addTrialForm() {
  const label = role === "trainer" ? "Пробник без записи" : "Фамилия Имя";
  const extra = (role === "admin" || role === "director")
    ? `<label class="trial-check"><input type="checkbox" name="trial"> пробный</label>`
    : `<input type="hidden" name="trialForced" value="1">`;
  return `<form class="add-bar" id="add-child">
    <input name="name" placeholder="${label}" required>
    ${extra}
    <button class="btn" type="submit">Добавить</button>
  </form>`;
}

function attendanceScreen() {
  const g = currentGroup();
  const staff = staffMode();
  return `
    <div class="gcal gcal-table">
      ${calToolbar(true)}
      ${attTable({ clickable: true, deletable: true, group: g })}
      ${addTrialForm()}
      ${staff ? addExistingForm() : ""}
    </div>`;
}

function addExistingForm() {
  const g = currentGroup();
  const inGroup = new Set(rosterKids(g).map((c) => c.id));
  const others = state.children.filter((c) => !inGroup.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return `<form class="add-bar" id="add-existing">
    <select name="childId" required>
      <option value="">Добавить из списка…</option>
      ${others.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
    </select>
    <button class="btn ghost" type="submit">В группу</button>
  </form>`;
}

function periodPhase(month) {
  if (!month) return "current";
  const now = new Date();
  const start = new Date(month.year, month.month - 1, 1);
  const end = new Date(month.year, month.month, 0, 23, 59, 59, 999);
  if (now < start) return "upcoming";
  if (now > end) return "closed";
  return "current";
}

function periodPhaseLabel(phase) {
  if (phase === "closed") return "завершён";
  if (phase === "upcoming") return "ещё не начался";
  return "сейчас идёт";
}

function monthSwitch() {
  if (!state.months || !state.months.length) return "";
  return `<div class="subtabs period-tabs">${state.months.map((m) => {
    const phase = periodPhase(m);
    const tag = phase === "closed" ? " · завершён" : phase === "current" ? " · сейчас" : "";
    return `<button type="button" class="${state.month.id === m.id ? "" : "is-off"}" data-month="${m.id}">${esc(m.label)}${tag}</button>`;
  }).join("")}</div>`;
}

function parentPeriodBanner() {
  const m = state.month;
  const phase = periodPhase(m);
  const phaseText = periodPhaseLabel(phase);
  return `
    <div class="period-banner period-${phase}">
      <p class="period-banner-title">Платёжный период · ${esc(m.label)}</p>
      <p class="period-banner-meta">Период <b>${phaseText}</b>. Расчёт, баланс и счёт ниже закреплены за этим месяцем.</p>
    </div>`;
}

function parentView() {
  if (selectedChild) return parentChildView();
  const p = state.period || {};
  const phase = periodPhase(state.month);
  const kids = (p.perChild || []).map((row) => {
    const groups = row.groups || [];
    const groupLines = groups.map((g) => `
      <div class="group-line">
        <span class="group-line-main">${esc(g.branch ? g.branch + " · " : "")}${esc(g.title)}</span>
        <span class="group-line-meta">${esc(g.durationLabel)} · ${g.sessions} зан. × ${rub(g.unit)} = <b>${rub(g.advance)}</b></span>
        <span class="group-line-meta">был ${g.present} · Б ${g.sickCount}</span>
      </div>`).join("");
    return `
    <article class="child-card parent-child-card">
      <h2 class="${row.kind === "trial" ? "name-trial" : ""}">${esc(row.name)}${row.kind === "trial" ? " · пробный" : ""}</h2>
      ${groups.length > 1 ? `<p class="hint">Ходит в ${groups.length} группы — данные сведены ниже</p>` : ""}
      <div class="group-lines">${groupLines || "<p class=\"hint\">Нет группы</p>"}</div>
      <div class="pay">
        <div><span>Был / Б</span><strong>${row.present} / ${row.sickCount}</strong></div>
      </div>
      <button class="btn child-open-btn" type="button" data-open-child="${row.childId}">Календарь посещений</button>
    </article>`;
  }).join("");
  const qrs = (state.qrs || ["qr1"]).map((id) => `
    <figure>
      <img src="${qrMap[id] || "/img/qr-1.jpg"}" alt="QR">
      <figcaption>${id === "qr2" ? "QR 2" : "QR 1"}</figcaption>
    </figure>`).join("");
  const paid = p.status === "yellow" || p.status === "green";
  return `
    <div class="parent-home">
      ${monthSwitch()}
      ${parentPeriodBanner()}
      <div class="child-grid">${kids || "<p class=\"hint\">Нет детей в семье</p>"}</div>
      <article class="child-card">
        <p class="card-period-tag">Баланс за ${esc(state.month.label)}${phase === "closed" ? " · период завершён" : ""}</p>
        <div class="pay">
          <div><span>Остаток на начало месяца</span><strong>${rub(p.opening)}</strong></div>
          <div><span>Аванс</span><strong>${rub(p.advance)}</strong></div>
          <div><span>Остаток на конец месяца</span><strong>${rub(p.balance)}</strong></div>
        </div>
      </article>
      <article class="child-card">
        <p class="card-period-tag">Счёт платёжного периода · ${esc(state.month.label)}</p>
        <div class="pay"><div><span>Итого к оплате</span><strong>${rub(Math.max(0, p.amountDue))}</strong></div></div>
        ${p.discountPercent ? `<p class="hint">Скидка многодетных ${p.discountPercent}%</p>` : ""}
        <button class="btn ghost" type="button" data-toggle-formula>${showFormula ? "Скрыть формулу" : "Показать формулу"}</button>
        ${showFormula ? formulaHtml(p) : ""}
      </article>
      <article class="child-card pay-how">
        <h2>Как оплатить</h2>
        <p class="hint">Оплата относится к периоду ${esc(state.month.label)}</p>
        <div class="qr-row">${qrs}</div>
        <label class="field">Сумма<input value="${Math.round(Math.max(0, p.amountDue || 0))}" readonly></label>
        <button class="btn pay-btn ${paid ? "is-paid" : ""}" type="button" data-parent-pay ${paid ? "disabled" : ""}>
          ${p.status === "green" ? "Оплачено" : p.status === "yellow" ? "Ожидает подтверждения" : "Оплатил"}
        </button>
      </article>
    </div>`;
}

function formulaHtml(p) {
  const kids = (p.perChild || []).map((c) => {
    const visits = (c.formula || []).filter((l) => l.day != null || l.mark);
    const adv = (c.formula || []).filter((l) => l.sessions != null);
    const groupBits = (c.groups || []).map((g) =>
      `<li class="f-adv">${esc(g.branch ? g.branch + " · " : "")}${esc(g.title)} · ${esc(g.durationLabel)} · ${g.sessions}×${rub(g.unit)} = <b>${rub(g.advance)}</b></li>`
    ).join("");
    return `<details class="formula-child" open>
      <summary><b>${esc(c.name)}</b>${c.kind === "trial" ? " · пробный" : ""} —
        аванс ${rub(c.advance)}, списано ${rub(c.spent)}, был ${c.present}, Б ${c.sickCount}${c.trial500 ? ", 500×" + c.trial500 : ""}</summary>
      <ul>
        ${groupBits || adv.map((l) => `<li class="f-adv">Аванс: ${esc(l.group)} · ${l.sessions} зан. × ${rub(l.price)} = <b>${rub(l.part)}</b>${l.note ? `<br><small>${esc(l.note)}</small>` : ""}</li>`).join("")}
        ${visits.map((l) => `<li class="f-visit">${esc(l.group)} · ${l.day} число · <b>${esc(l.mark)}</b> → ${l.price ? "−" + rub(l.price) : "0 ₽"}${l.note ? " (" + esc(l.note) + ")" : ""}</li>`).join("") || "<li>Нет отметок посещений</li>"}
      </ul>
    </details>`;
  }).join("");
  const credit = p.credit != null ? p.credit : Math.max(0, p.opening || 0);
  const debt = p.debt != null ? p.debt : Math.max(0, -(p.opening || 0));
  return `<div class="formula">
    <h3>Ход расчёта</h3>
    <ol class="formula-steps">
      <li>Аванс сырой (по группам: занятия × цена пакета ÷ занятий в пакете): <b>${rub(p.advanceRaw)}</b></li>
      <li>Скидка многодетных ${p.discountPercent || 0}%: аванс = ${rub(p.advanceRaw)} × (1 − ${p.discountPercent || 0}/100) = <b>${rub(p.advance)}</b></li>
      <li>Остаток с прошлого периода: <b>${rub(credit)}</b>${debt ? ` · долг прошлого: <b class="warn-text">${rub(debt)}</b>` : ""}</li>
      <li>Счёт к оплате: аванс ${rub(p.advance)} − остаток ${rub(credit)} + долг ${rub(debt)} = <b>${rub(p.requested)}</b></li>
      <li>Приход (подтверждённый): <b>${rub(p.incoming)}</b></li>
      <li>Списано за «+» / 500 в этом месяце: <b>−${rub(p.spent)}</b>${p.sickCredit ? ` · больничные Б не списаны (условно ${rub(p.sickCredit)})` : ""}</li>
      <li>К оплате сейчас: счёт ${rub(p.requested)} − приход ${rub(p.incoming)} = <b>${rub(p.amountDue)}</b></li>
      <li>Текущий баланс: остаток/долг ${rub(p.opening)} + приход ${rub(p.incoming)} − списано ${rub(p.spent)} = <b>${rub(p.balance)}</b></li>
    </ol>
    <h3>По детям</h3>
    ${kids || "<p class=\"hint\">Нет детей</p>"}
  </div>`;
}

function parentCombinedAtt(child) {
  const groups = state.groups.filter((g) => (child.groupIds || []).includes(g.id));
  if (!groups.length) return `<p class="hint">Нет группы</p>`;
  const cols = trainerColumns();
  const head = cols.map((d) => `
    <th class="${isToday(d.day) ? "is-today" : ""} ${d.day === selectedDay ? "is-on" : ""}" data-pick-day="${d.day}">
      <small>${WEEK_SHORT[d.weekday]}</small>${d.day}
    </th>`).join("");
  const rows = groups.map((g) => {
    const packLessons = Number(g.packLessons) || 8;
    const packPrice = Number(g.packPrice) || 0;
    const unit = packLessons ? Math.round(packPrice / packLessons) : 0;
    const dur = g.durationMin === 90 ? "1,5 ч" : "1 ч";
    const branch = branchName(g.branchId);
    const cells = cols.map((d) => {
      const mark = cellMark(child, g.id, d.day);
      return `<td class="mark big-mark ${mark.cls} ${isTrainingDay(g, d.day) ? "is-train" : ""}">${mark.text}</td>`;
    }).join("");
    return `<tr>
      <th class="sticky">
        <span class="sheet-item-branch">${esc(branch || "Филиал")} · ${dur} · ${rub(unit)}</span>
        <span>${esc(groupTitle(g))}</span>
      </th>
      ${cells}
    </tr>`;
  }).join("");
  const strip = calMode === "week" ? weekStrip() : "";
  return `
    ${strip}
    <div class="att-wrap">
      <table class="att-table">
        <thead><tr><th class="sticky">Группа / тариф</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function parentChildView() {
  const child = state.children.find((c) => c.id === selectedChild);
  if (!child) return `<p class="hint">Ребёнок не найден</p>`;
  const row = (state.period && state.period.perChild || []).find((x) => x.childId === child.id);
  const groups = row && row.groups ? row.groups : [];
  const summary = groups.map((g) => `
    <div class="group-sum-card">
      <strong>${esc(g.branch ? g.branch + " · " : "")}${esc(g.title)}</strong>
      <p>${esc(g.durationLabel)} · пакет ${rub(g.packPrice)} / ${g.packLessons} = <b>${rub(g.unit)}</b> за занятие</p>
      <div class="pay">
        <div><span>В месяце</span><strong>${g.sessions}</strong></div>
        <div><span>Аванс</span><strong>${rub(g.advance)}</strong></div>
        <div><span>Был / Б</span><strong>${g.present} / ${g.sickCount}</strong></div>
      </div>
    </div>`).join("");
  return `
    <div class="gcal gcal-table parent-child">
      <button class="btn ghost" type="button" data-back-parent>← К семье</button>
      <h2>${esc(child.name)}</h2>
      ${parentPeriodBanner()}
      <p class="note">Сводная таблица из всех групп ребёнка. Разный тариф часа и 1,5 ч считается отдельно и складывается в итог.</p>
      <div class="group-sum-grid">${summary || "<p class=\"hint\">Нет групп</p>"}</div>
      <article class="child-card">
        <div class="pay">
          <div><span>Итого аванс</span><strong>${rub(row ? row.advance : 0)}</strong></div>
          <div><span>Был / Б</span><strong>${row ? row.present : 0} / ${row ? row.sickCount : 0}</strong></div>
        </div>
      </article>
      ${calToolbar(false)}
      <h3 class="sheet-section">Общая таблица посещений</h3>
      ${parentCombinedAtt(child)}
      <button class="btn ghost" type="button" data-toggle-formula>${showFormula ? "Скрыть формулу" : "Формула расчёта"}</button>
      ${showFormula && state.period ? formulaHtml({
        ...state.period,
        perChild: (state.period.perChild || []).filter((x) => x.childId === child.id),
        formula: row ? row.formula : []
      }) : ""}
    </div>`;
}

function staffSub() {
  if (role !== "director") return "";
  const items = [
    ["athletes", "Спортсмены"],
    ["sick", "Больничный"],
    ["branches", "Филиалы"]
  ];
  const onBranches = ["branches", "groups", "group", "trainers", "trainer-sport"].includes(view);
  return `<div class="subtabs">${items.map(([id, t]) => {
    const on = id === "branches" ? onBranches : view === id;
    return `<button type="button" class="${on ? "" : "is-off"}" data-go="${id}">${t}</button>`;
  }).join("")}</div>`;
}

function coordView() {
  const inner = view === "athletes" ? athletesView()
    : view === "sick" ? sickView()
    : (view === "trainers" || view === "trainer-sport") ? trainersView()
    : view === "group" ? attendanceScreen()
    : view === "groups" ? groupsOfBranch()
    : branchesView();
  return staffSub() + inner;
}

function branchesView() {
  const cards = (state.branches || []).map((b) => {
    const n = state.groups.filter((g) => g.branchId === b.id).length;
    const note = b.name === "ВАЛДАЙСКИЙ" ? "занятия 1,5 часа" : "";
    return `<button class="branch-card" type="button" data-open-branch="${b.id}">
      <strong>${esc(b.name)}</strong>
      <small>${n} групп${note ? " · " + note : ""}</small>
    </button>`;
  }).join("");
  return `
    <div class="branch-grid">${cards}</div>
    <div class="center-row">
      <button class="btn" type="button" data-go="trainers">Редактирование тренеров</button>
    </div>`;
}

function groupsOfBranch() {
  const b = state.branches.find((x) => x.id === selectedBranch);
  const list = state.groups.filter((g) => g.branchId === selectedBranch);
  return `
    <button class="btn ghost" type="button" data-go="branches">← Филиалы</button>
    <h2>${esc(b ? b.name : "")}</h2>
    <div class="list-cards">
      ${list.map((g) => `<button class="sheet-item" type="button" data-open-group="${g.id}">${esc(groupTitle(g))}</button>`).join("") || "<p class=\"hint\">Нет групп</p>"}
    </div>
    <form class="add-bar stack-form" id="new-group">
      <p class="hint">Новая группа</p>
      <select name="sport"><option value="hg">ХГ</option><option value="sambo">Самбо / борьба</option></select>
      <input name="time" placeholder="время, напр. 17:30–18:30" required>
      <div class="day-picks">
        ${DAYS.map(([id, t]) => `<label class="check"><input type="checkbox" name="wd" value="${id}"> ${t}</label>`).join("")}
      </div>
      <select name="durationMin">
        <option value="60" ${b && b.name !== "ВАЛДАЙСКИЙ" ? "selected" : ""}>1 час</option>
        <option value="90" ${b && b.name === "ВАЛДАЙСКИЙ" ? "selected" : ""}>1,5 часа</option>
      </select>
      <button class="btn" type="submit">Создать группу</button>
    </form>`;
}

function athletesView() {
  const q = qAthletes.trim().toLowerCase();
  const list = state.children
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .filter((c) => !q || c.name.toLowerCase().includes(q));
  const rows = list.map((c) => {
    const n = (c.groupIds || []).length;
    const ins = (c.documents && c.documents.insurance) || "";
    const insLabel = ins === "yes" ? "оформлена" : ins === "no" ? "отказ" : "не решено";
    return `<article class="ath-card ${c.kind === "trial" ? "is-trial-card" : ""}">
      <div class="ath-head">
        <strong>${esc(c.name)}</strong>
        <button class="icon-btn" type="button" data-edit-name="${c.id}" title="Редактировать">✎</button>
      </div>
      ${c.kind === "trial" ? `<span class="trial-tag">пробный</span>` : ""}
      <div class="ath-meta">
        <label class="check">справка врача <input type="checkbox" data-doc="${c.id}" data-field="doctor" ${c.documents && c.documents.doctor ? "checked" : ""}></label>
        <label>страховка
          <select data-ins="${c.id}">
            <option value="" ${!ins ? "selected" : ""}>не решено</option>
            <option value="yes" ${ins === "yes" ? "selected" : ""}>оформление</option>
            <option value="no" ${ins === "no" ? "selected" : ""}>отказ</option>
          </select>
        </label>
        <span class="muted-inline">${insLabel}</span>
      </div>
      <div class="ath-actions">
        ${canEnroll(c) ? `<button class="btn" type="button" data-enroll="${c.id}">Зачислить в группу</button>` : ""}
        <button class="btn ghost" type="button" data-child-groups="${c.id}">
          ${n ? "Группы: " + n : "<span class=\"warn-text\">Нет группы</span>"}
        </button>
        <button class="btn ghost" type="button" data-child-family="${c.id}">Семья</button>
      </div>
    </article>`;
  }).join("");
  return `
    <input class="search-input" data-ath-q placeholder="Поиск по ФИО" value="${esc(qAthletes)}">
    <div class="ath-list">${rows || "<p class=\"hint\">Никого нет</p>"}</div>`;
}

function sickView() {
  const q = qSick.trim().toLowerCase();
  const hits = q
    ? state.children.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 20)
    : [];
  if (selectedChild) {
    const child = state.children.find((c) => c.id === selectedChild);
    const cells = monthGrid().map((c) => {
      if (!c.inMonth) return `<span class="m-cell is-out"></span>`;
      const on = isSick(child.id, c.day);
      return `<button type="button" class="m-cell ${on ? "is-sick" : ""} ${isToday(c.day) ? "is-today" : ""}" data-toggle-sick="${isoOf(c.day)}">
        <span>${c.day}</span>${on ? "<b class=\"big-mark sick\">Б</b>" : ""}
      </button>`;
    }).join("");
    return `
      <button class="btn ghost" type="button" data-clear-sick>← Поиск</button>
      <h2>${esc(child ? child.name : "")}</h2>
      <p class="hint">Отметьте дни болезни — буква Б появится во всех группах ребёнка на эти даты.</p>
      <div class="month-grid">${WEEK_ORDER.map((w) => `<span class="dow">${WEEK_SHORT[w]}</span>`).join("")}${cells}</div>`;
  }
  return `
    <input class="search-input" data-sick-q placeholder="Введите ФИО" value="${esc(qSick)}" autofocus>
    <div class="list-cards">${hits.map((c) => `<button class="sheet-item" type="button" data-sick-child="${c.id}">${esc(c.name)}</button>`).join("")}</div>`;
}

function trainersView() {
  if (view !== "trainer-sport") {
    return `
      <button class="btn ghost" type="button" data-go="branches">← Филиалы</button>
      <h2>Тренеры</h2>
      <div class="branch-grid">
        <button class="branch-card" type="button" data-sport="hg"><strong>ХГ</strong><small>художественная гимнастика</small></button>
        <button class="branch-card" type="button" data-sport="sambo"><strong>Борьба</strong><small>самбо</small></button>
      </div>`;
  }
  const list = state.trainers.filter((t) => t.sport === selectedSport);
  const groups = state.groups.filter((g) => g.sport === selectedSport);
  const cards = list.map((t) => {
    if (!trainerDraft[t.id]) trainerDraft[t.id] = [...(t.groupIds || [])];
    const selected = new Set(trainerDraft[t.id]);
    const sorted = groups.slice().sort((a, b) => {
      const as = selected.has(a.id) ? 0 : 1;
      const bs = selected.has(b.id) ? 0 : 1;
      if (as !== bs) return as - bs;
      const ba = branchName(a.branchId).localeCompare(branchName(b.branchId), "ru");
      if (ba) return ba;
      return groupTitle(a).localeCompare(groupTitle(b), "ru");
    });
    const opts = sorted.map((g) => `
      <button type="button" class="sheet-item ${selected.has(g.id) ? "is-on" : ""}" data-toggle-tg="${t.id}" data-group="${g.id}">
        <span class="sheet-item-branch">${esc(branchName(g.branchId) || "Филиал")}</span>
        <span class="sheet-item-title">${esc(groupTitle(g))}</span>
      </button>`).join("");
    return `<article class="ath-card">
      <strong>${esc(t.name)}</strong>
      <p class="hint">логин ${esc(t.login)} · пароль ${esc(t.password)}</p>
      <p class="hint">Сначала выбранные. В названии — филиал. Нажмите на группу, чтобы добавить или убрать.</p>
      <div class="multi multi-pick">${opts || "<p class=\"hint\">Нет групп</p>"}</div>
      <button class="btn ghost" type="button" data-save-trainer="${t.id}">Сохранить группы</button>
    </article>`;
  }).join("");
  return `
    <button class="btn ghost" type="button" data-go="trainers">← Виды</button>
    <h2>${selectedSport === "hg" ? "ХГ" : "Борьба"}</h2>
    ${cards || "<p class=\"hint\">Нет тренеров</p>"}
    <form class="add-bar" id="new-trainer">
      <input name="name" placeholder="Имя тренера" required>
      <input name="login" placeholder="логин" required>
      <input name="password" placeholder="пароль" required>
      <button class="btn" type="submit">Добавить</button>
    </form>`;
}

function calcView() {
  const sub = `${monthSwitch()}
    <div class="subtabs">
      <button class="${calcTab === "prices" ? "" : "is-off"}" data-calc="prices">Стоимость занятий</button>
      <button class="${calcTab === "parents" ? "" : "is-off"}" data-calc="parents">Родители</button>
    </div>`;
  if (calcTab === "prices") return sub + pricesView();
  return sub + parentsCalcView();
}

function pricesView() {
  const pack = Number(state.settings && state.settings.packLessons) || 8;
  const cards = (state.branches || []).map((b) => {
    const groups = state.groups.filter((g) => g.branchId === b.id);
    const tariffs = b.tariffs || [];
    return `
    <article class="ath-card price-branch">
      <strong>${esc(b.name)}</strong>
      <p class="hint">Базовые пакеты филиала (если у группы свой пакет не задан): ${pack}×1ч = ${rub(b.priceHour)}, ${pack}×1,5ч = ${rub(b.priceHourHalf)}</p>
      <form class="add-bar" data-branch-price="${b.id}">
        <label class="field">${pack} занятий · 1 час, ₽
          <input name="priceHour" type="number" value="${b.priceHour}">
        </label>
        <label class="field">${pack} занятий · 1,5 часа, ₽
          <input name="priceHourHalf" type="number" value="${b.priceHourHalf}">
        </label>
        <label class="field">QR
          <select name="qr">
            <option value="qr1" ${b.qr === "qr1" ? "selected" : ""}>QR 1</option>
            <option value="qr2" ${b.qr === "qr2" ? "selected" : ""}>QR 2</option>
          </select>
        </label>
        <button class="btn" type="submit">Сохранить базу</button>
      </form>
      ${tariffs.length ? `
        <p class="hint">Тарифы с бумажки (быстрый выбор для группы):
          ${tariffs.map((t) => `${esc(t.label)} — ${rub(t.packPrice)}`).join(" · ")}
        </p>` : ""}
      <h3 class="sheet-section">Группы филиала</h3>
      <div class="price-groups">
        ${groups.map((g) => {
          const lessons = Number(g.packLessons) || pack;
          const price = Number(g.packPrice) || (g.durationMin === 90 ? b.priceHourHalf : b.priceHour);
          const unit = lessons ? Math.round(price / lessons) : 0;
          return `
          <form class="add-bar stack-form price-group" data-group-pack="${g.id}">
            <p class="hint"><b>${esc(groupTitle(g))}</b></p>
            <label class="field">цена пакета, ₽
              <input name="packPrice" type="number" value="${price}">
            </label>
            <label class="field">занятий в пакете
              <input name="packLessons" type="number" min="1" value="${lessons}">
            </label>
            <label class="field">длительность
              <select name="durationMin">
                <option value="60" ${g.durationMin !== 90 ? "selected" : ""}>1 час</option>
                <option value="90" ${g.durationMin === 90 ? "selected" : ""}>1,5 часа</option>
              </select>
            </label>
            ${tariffs.length ? `
            <label class="field">тариф с бумажки
              <select name="tariffId">
                <option value="">— не менять —</option>
                ${tariffs.map((t) => `<option value="${t.id}">${esc(t.label)} (${rub(t.packPrice)})</option>`).join("")}
              </select>
            </label>` : ""}
            <p class="hint price-hint">1 занятие = ${rub(unit)} · аванс за месяц ≈ число тренировок × ${rub(unit)}</p>
            <button class="btn" type="submit">Сохранить группу</button>
          </form>`;
        }).join("") || "<p class=\"hint\">Нет групп</p>"}
      </div>
    </article>`;
  }).join("");
  return `
    <p class="note">Ребёнок может ходить в несколько групп — стоимость месяца складывается: занятия₁×(пакет₁/N₁) + занятия₂×(пакет₂/N₂). Пример Валдайский: 4 из «8×1,5ч за 9500» + 4 из «12×1ч за 9500» = 4×1187,5 + 4×791,67.</p>
    <div class="ath-list">${cards}</div>
    <article class="child-card">
      <h2>QR для оплаты</h2>
      <p class="hint">Три филиала — один QR, остальные — другой. Родителю показывается подходящий.</p>
      <div class="qr-row">
        ${["qr1","qr2"].map((id) => `
          <figure>
            <img src="${qrMap[id]}" alt="${id}">
            <figcaption>${id === "qr1" ? "QR 1" : "QR 2"}</figcaption>
            <label class="btn ghost file-btn">Загрузить
              <input type="file" accept="image/*" data-qr-file="${id}" hidden>
            </label>
          </figure>`).join("")}
      </div>
    </article>`;
}

function parentsCalcView() {
  if (!periods) return `<p class="hint">Загрузка…</p>`;
  const q = qParents.trim().toLowerCase();
  const rows = (periods.rows || []).filter((r) => {
    if (!q) return true;
    const kids = state.children.filter((c) => c.familyId === r.family.id).map((c) => c.name).join(" ");
    return (r.family.parentName + " " + r.family.login + " " + kids).toLowerCase().includes(q);
  });
  const html = rows.map((r) => {
    const p = r.period;
    const st = p.status || "red";
    const exact = st === "green" && p.incoming >= p.requested && p.amountDue <= 0 && p.incoming === p.requested;
    const showPass = !!eye[r.family.id];
    return `<article class="pay-row status-${st} ${exact ? "is-white" : ""}">
      <div class="pay-row-main">
        <strong>${esc(r.family.parentName)}</strong>
        <span class="ball ball-${st}"></span>
      </div>
      <div class="cred">
        <span>${esc(r.family.login)} / ${showPass ? esc(r.family.password) : "••••••"}</span>
        <button class="icon-btn" type="button" data-eye="${r.family.id}" title="Показать пароль">👁</button>
      </div>
      <div class="pay-nums">
        <div><span>К оплате</span><b>${rub(Math.max(0, p.amountDue))}</b></div>
        <div><span>Счёт</span><b>${rub(p.requested)}</b></div>
        <div><span>Баланс</span><b>${rub(p.balance)}</b></div>
        ${p.parentClickedAt ? `<div><span>Родитель нажал</span><b>${fmtWhen(p.parentClickedAt)}</b></div>` : ""}
      </div>
      <div class="pay-row-actions">
        <button class="btn ghost" type="button" data-dir-pay="${r.family.id}" data-need="${Math.max(0, p.amountDue)}">Сменить статус</button>
        <button class="btn" type="button" data-dir-formula="${r.family.id}">${showDirFormula === r.family.id ? "Скрыть формулу" : "Показать формулу"}</button>
      </div>
      ${showDirFormula === r.family.id ? formulaHtml(p) : ""}
    </article>`;
  }).join("");
  return `
    <input class="search-input" data-par-q placeholder="Поиск семьи или ребёнка" value="${esc(qParents)}">
    <div class="ath-list">${html || "<p class=\"hint\">Нет семей</p>"}</div>`;
}

async function loadPeriods() {
  const q = monthId ? ("?month=" + encodeURIComponent(monthId)) : "";
  const res = await fetch("/api/periods" + q, { headers: headers() });
  periods = await res.json();
  render();
}

function drawOverlay() {
  const el = document.getElementById("overlay");
  if (!sheet) {
    el.innerHTML = "";
    el.className = "";
    return;
  }
  el.className = "overlay-on";
  if (sheet.type === "groups") {
    const q = (sheet.q || "").toLowerCase();
    const items = state.groups.filter((g) => (g.title || g.name).toLowerCase().includes(q));
    el.innerHTML = `
      <div class="sheet" role="dialog">
        <p class="sheet-kicker">Группа</p>
        <input class="sheet-search" placeholder="Найти" value="${esc(sheet.q || "")}" data-group-q>
        <div class="sheet-list">
          ${items.map((g) => `<button type="button" class="sheet-item ${g.id === selectedGroup ? "is-on" : ""}" data-pick-group="${g.id}">${esc(groupTitle(g))}</button>`).join("")}
        </div>
        <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Закрыть</button>
      </div>`;
    const input = el.querySelector("[data-group-q]");
    if (input) { input.focus(); const v = sheet.q || ""; input.setSelectionRange(v.length, v.length); }
    return;
  }
  if (sheet.type === "child-groups") {
    const child = state.children.find((c) => c.id === sheet.childId);
    if (!sheet.selected) sheet.selected = [...((child && child.groupIds) || [])];
    const selected = new Set(sheet.selected);
    const sorted = state.groups.slice().sort((a, b) => {
      const as = selected.has(a.id) ? 0 : 1;
      const bs = selected.has(b.id) ? 0 : 1;
      if (as !== bs) return as - bs;
      const ba = branchName(a.branchId).localeCompare(branchName(b.branchId), "ru");
      if (ba) return ba;
      return groupTitle(a).localeCompare(groupTitle(b), "ru");
    });
    el.innerHTML = `
      <div class="sheet" role="dialog">
        ${sheet.backFamily ? `<button class="sheet-back" type="button" data-back-family aria-label="Назад">← Назад</button>` : ""}
        <p class="sheet-kicker">${esc(child ? child.name : "")} · группы</p>
        <p class="hint">Сначала выбранные. В названии указан филиал. Нажмите на группу, чтобы добавить или убрать.</p>
        <div class="sheet-list">
          ${sorted.map((g) => `
            <button type="button" class="sheet-item ${selected.has(g.id) ? "is-on" : ""}" data-toggle-cg="${g.id}">
              <span class="sheet-item-branch">${esc(branchName(g.branchId) || "Филиал")}</span>
              <span class="sheet-item-title">${esc(groupTitle(g))}</span>
            </button>`).join("")}
        </div>
        <button class="btn" type="button" data-save-cgroups>Сохранить</button>
        <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Закрыть</button>
      </div>`;
    return;
  }
  if (sheet.type === "family") {
    el.innerHTML = familySheetHtml();
  }
}

function familySheetHtml() {
  const child = state.children.find((c) => c.id === sheet.childId);
  const fam = state.families.find((f) => f.id === (sheet.familyId || (child && child.familyId)));
  const view = sheet.view || "home";
  const back = view !== "home"
    ? `<button class="sheet-back" type="button" data-fam-view="home" aria-label="Назад">← Назад</button>`
    : "";

  if (!fam && view !== "assign") {
    return `
      <div class="sheet" role="dialog">
        <p class="sheet-kicker">Семья · ${esc(child ? child.name : "")}</p>
        <p class="hint">Семья не назначена</p>
        <button class="btn" type="button" data-do-assign>Создать новую семью</button>
        <button class="btn ghost" type="button" data-fam-view="assign">Назначить из списка</button>
        <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Закрыть</button>
      </div>`;
  }

  if (view === "assign") {
    return `
      <div class="sheet" role="dialog">
        ${child && child.familyId ? back : `<button class="sheet-back" type="button" data-fam-view="home" aria-label="Назад">← Назад</button>`}
        <p class="sheet-kicker">Назначить семью</p>
        <p class="hint">Выберите существующую семью или создайте новую для ${esc(child ? child.name : "ребёнка")}.</p>
        <select data-assign-fam>
          <option value="">— создать новую семью —</option>
          ${state.families.map((f) => `<option value="${f.id}" ${fam && fam.id === f.id ? "selected" : ""}>${esc(f.parentName)} (${esc(f.login)})</option>`).join("")}
        </select>
        <button class="btn" type="button" data-do-assign>Назначить</button>
        <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Закрыть</button>
      </div>`;
  }

  if (!fam) {
    sheet.view = "home";
    return familySheetHtml();
  }

  if (view === "parent-new") {
    return `
      <div class="sheet" role="dialog">
        ${back}
        <p class="sheet-kicker">Новый родитель</p>
        <form id="fam-parent-new">
          <label class="field">ФИО<input name="name" required placeholder="Фамилия Имя"></label>
          <label class="field">телефон<input name="phone" placeholder="+7..."></label>
          <label class="field">почта<input name="email" type="email" placeholder="email@"></label>
          <button class="btn" type="submit">Добавить</button>
        </form>
        <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Закрыть</button>
      </div>`;
  }

  if (view === "parent-edit") {
    const parent = (fam.parents || []).find((p) => p.id === sheet.parentId) || (fam.parents || [])[0];
    if (!parent) {
      sheet.view = "home";
      return familySheetHtml();
    }
    return `
      <div class="sheet" role="dialog">
        ${back}
        <p class="sheet-kicker">Родитель</p>
        <form id="fam-parent-edit">
          <input type="hidden" name="id" value="${esc(parent.id)}">
          <label class="field">ФИО<input name="name" required value="${esc(parent.name)}"></label>
          <label class="field">телефон<input name="phone" value="${esc(parent.phone || "")}"></label>
          <label class="field">почта<input name="email" type="email" value="${esc(parent.email || "")}"></label>
          <button class="btn" type="submit">Сохранить</button>
        </form>
        ${(fam.parents || []).length > 1
          ? `<button class="btn ghost warn-btn" type="button" data-remove-parent="${esc(parent.id)}">Убрать из семьи</button>`
          : ""}
        <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Закрыть</button>
      </div>`;
  }

  if (view === "child") {
    const kid = state.children.find((c) => c.id === sheet.viewChildId);
    if (!kid) {
      sheet.view = "home";
      return familySheetHtml();
    }
    const groups = state.groups.filter((g) => (kid.groupIds || []).includes(g.id));
    return `
      <div class="sheet" role="dialog">
        ${back}
        <p class="sheet-kicker">${esc(kid.name)}</p>
        ${kid.kind === "trial" ? `<span class="trial-tag">пробный</span>` : ""}
        <p class="hint">Группы ребёнка</p>
        <div class="sheet-list">
          ${groups.map((g) => `
            <div class="sheet-item is-static">
              <span class="sheet-item-branch">${esc(branchName(g.branchId) || "Филиал")}</span>
              <span class="sheet-item-title">${esc(groupTitle(g))}</span>
            </div>`).join("") || `<p class="hint">Нет группы</p>`}
        </div>
        <button class="btn" type="button" data-open-kid-groups="${kid.id}">Изменить группы</button>
        <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Закрыть</button>
      </div>`;
  }

  const parents = fam.parents || [];
  const kids = state.children.filter((c) => c.familyId === fam.id);
  return `
    <div class="sheet" role="dialog">
      <p class="sheet-kicker">Семья · ${esc(child ? child.name : fam.parentName)}</p>
      <div class="cred-block">
        <div><span>логин</span><b>${esc(fam.login)}</b></div>
        <div><span>пароль</span><b>${esc(fam.password)}</b></div>
      </div>

      <h3 class="sheet-section">Родители</h3>
      <div class="sheet-list">
        ${parents.map((p) => `
          <button type="button" class="sheet-item contact-card" data-edit-parent="${esc(p.id)}">
            <strong>${esc(p.name)}</strong>
            <span>${esc(p.phone || "телефон не указан")}</span>
            <span>${esc(p.email || "почта не указана")}</span>
          </button>`).join("")}
      </div>
      <button class="btn ghost" type="button" data-fam-view="parent-new">+ Добавить родителя</button>

      <h3 class="sheet-section">Дети в семье</h3>
      <div class="sheet-list">
        ${kids.map((k) => `
          <button type="button" class="sheet-item" data-fam-child="${k.id}">
            ${esc(k.name)}${k.kind === "trial" ? " · пробный" : ""}
          </button>`).join("") || `<p class="hint">Нет детей</p>`}
      </div>

      <button class="btn ghost" type="button" data-fam-view="assign">Сменить семью ребёнка</button>
      <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Закрыть</button>
    </div>`;
}

document.getElementById("logout").addEventListener("click", () => {
  sessionStorage.clear();
  location.href = "/";
});

document.getElementById("tabs").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  const id = btn.dataset.tab;
  if (role === "director") {
    dirTab = id;
    if (id === "coord" && (view === "parent" || !view)) view = "branches";
    if (id === "calc") {
      calcTab = calcTab || "prices";
      if (calcTab === "parents") await loadPeriods();
    }
  } else {
    view = id;
    selectedChild = "";
  }
  render();
});

document.getElementById("app").addEventListener("click", async (e) => {
  const cal = e.target.closest("[data-cal]");
  if (cal) { calMode = cal.dataset.cal; persistCal(); render(); return; }
  const monthBtn = e.target.closest("[data-month]");
  if (monthBtn) {
    monthId = monthBtn.dataset.month;
    if (role === "director" && dirTab === "calc" && calcTab === "parents") await loadPeriods();
    else await load();
    return;
  }
  if (e.target.closest("[data-today]")) {
    selectedDay = todayDay();
    if (role === "trainer") calMode = "day";
    persistCal(); render(); return;
  }
  const pick = e.target.closest("[data-pick-day]");
  if (pick && pick.dataset.pickDay) { selectedDay = Number(pick.dataset.pickDay); persistCal(); render(); return; }
  if (e.target.closest("[data-open-groups]")) { sheet = { type: "groups", q: "" }; drawOverlay(); return; }

  const go = e.target.closest("[data-go]");
  if (go) { view = go.dataset.go; selectedChild = ""; render(); return; }

  const br = e.target.closest("[data-open-branch]");
  if (br) { selectedBranch = br.dataset.openBranch; view = "groups"; render(); return; }

  const og = e.target.closest("[data-open-group]");
  if (og) { selectedGroup = og.dataset.openGroup; view = "group"; render(); return; }

  const sport = e.target.closest("[data-sport]");
  if (sport) { selectedSport = sport.dataset.sport; view = "trainer-sport"; render(); return; }

  const openChild = e.target.closest("[data-open-child]");
  if (openChild) { selectedChild = openChild.dataset.openChild; showFormula = false; render(); return; }
  if (e.target.closest("[data-back-parent]")) { selectedChild = ""; render(); return; }

  if (e.target.closest("[data-toggle-formula]")) { showFormula = !showFormula; render(); return; }

  const toggle = e.target.closest("[data-toggle-mark]");
  if (toggle) {
    const res = await api("/api/attendance", "POST", {
      groupId: toggle.dataset.group,
      childId: toggle.dataset.toggleMark,
      day: Number(toggle.dataset.day),
      monthId: state.month.id
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
    return;
  }

  const un = e.target.closest("[data-ungroup]");
  if (un) {
    e.preventDefault();
    if (!confirm("Убрать из группы?")) return;
    const g = currentGroup();
    const res = await api(`/api/groups/${g.id}/children/${un.dataset.ungroup}`, "DELETE");
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
    return;
  }

  const enrollBtn = e.target.closest("[data-enroll]");
  if (enrollBtn) {
    e.preventDefault();
    if (!confirm("Зачислить в группу? Отметки 0 и 500 сохранятся, дальше можно ставить «+» как обычным.")) return;
    const res = await api(`/api/children/${enrollBtn.dataset.enroll}/enroll`, "POST");
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
    return;
  }

  if (e.target.closest("[data-parent-pay]")) {
    await api("/api/pay/parent", "POST", { monthId: state.month.id });
    await load();
    return;
  }

  const editName = e.target.closest("[data-edit-name]");
  if (editName) {
    const child = state.children.find((c) => c.id === editName.dataset.editName);
    const name = prompt("Фамилия Имя", child ? child.name : "");
    if (!name) return;
    await api("/api/children/" + child.id, "PATCH", { name });
    await load();
    return;
  }

  const cg = e.target.closest("[data-child-groups]");
  if (cg) {
    const child = state.children.find((c) => c.id === cg.dataset.childGroups);
    sheet = {
      type: "child-groups",
      childId: cg.dataset.childGroups,
      selected: [...((child && child.groupIds) || [])]
    };
    drawOverlay();
    return;
  }
  const cf = e.target.closest("[data-child-family]");
  if (cf) {
    const child = state.children.find((c) => c.id === cf.dataset.childFamily);
    sheet = {
      type: "family",
      childId: cf.dataset.childFamily,
      familyId: child ? child.familyId : "",
      view: "home"
    };
    drawOverlay();
    return;
  }

  const sc = e.target.closest("[data-sick-child]");
  if (sc) { selectedChild = sc.dataset.sickChild; render(); return; }
  if (e.target.closest("[data-clear-sick]")) { selectedChild = ""; render(); return; }
  const ts = e.target.closest("[data-toggle-sick]");
  if (ts) {
    await api("/api/sick", "POST", { childId: selectedChild, iso: ts.dataset.toggleSick });
    await load();
    return;
  }

  const calc = e.target.closest("[data-calc]");
  if (calc) {
    calcTab = calc.dataset.calc;
    if (calcTab === "parents") await loadPeriods();
    else render();
    return;
  }

  const eyeBtn = e.target.closest("[data-eye]");
  if (eyeBtn) { eye[eyeBtn.dataset.eye] = !eye[eyeBtn.dataset.eye]; render(); return; }

  const df = e.target.closest("[data-dir-formula]");
  if (df) { showDirFormula = showDirFormula === df.dataset.dirFormula ? "" : df.dataset.dirFormula; render(); return; }

  const dp = e.target.closest("[data-dir-pay]");
  if (dp) {
    const incoming = prompt("Сумма прихода, ₽", dp.dataset.need || "0");
    if (incoming == null) return;
    await api("/api/pay/director", "POST", {
      familyId: dp.dataset.dirPay,
      incoming: Number(incoming),
      requested: Number(dp.dataset.need),
      monthId: state.month.id
    });
    await loadPeriods();
    return;
  }

  const saveT = e.target.closest("[data-save-trainer]");
  if (saveT) {
    const tid = saveT.dataset.saveTrainer;
    const ids = trainerDraft[tid] || [];
    await api("/api/trainers/" + tid, "PATCH", { groupIds: ids });
    delete trainerDraft[tid];
    await load();
    view = "trainer-sport";
    return;
  }

  const toggleTg = e.target.closest("[data-toggle-tg]");
  if (toggleTg) {
    const tid = toggleTg.dataset.toggleTg;
    const gid = toggleTg.dataset.group;
    const t = (state.trainers || []).find((x) => x.id === tid);
    if (!trainerDraft[tid]) trainerDraft[tid] = [...((t && t.groupIds) || [])];
    const set = new Set(trainerDraft[tid]);
    if (set.has(gid)) set.delete(gid);
    else set.add(gid);
    trainerDraft[tid] = [...set];
    render();
    return;
  }

  const qrFile = e.target.closest("[data-qr-file]");
  if (qrFile) return;
});

document.getElementById("app").addEventListener("change", async (e) => {
  if (e.target.dataset.doc) {
    await api("/api/children/" + e.target.dataset.doc, "PATCH", {
      documents: { doctor: e.target.checked }
    });
    await load();
    return;
  }
  if (e.target.dataset.ins) {
    await api("/api/children/" + e.target.dataset.ins, "PATCH", {
      documents: { insurance: e.target.value }
    });
    await load();
    return;
  }
  const file = e.target.closest("[data-qr-file]");
  if (file && file.files && file.files[0]) {
    const reader = new FileReader();
    reader.onload = async () => {
      await api("/api/qr/" + file.dataset.qrFile, "POST", { dataUrl: reader.result });
      await load();
    };
    reader.readAsDataURL(file.files[0]);
  }
});

document.getElementById("app").addEventListener("input", (e) => {
  if (e.target.dataset.athQ !== undefined) {
    qAthletes = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const input = document.querySelector("[data-ath-q]");
    if (input) { input.focus(); input.setSelectionRange(pos, pos); }
  }
  if (e.target.dataset.sickQ !== undefined) {
    qSick = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const input = document.querySelector("[data-sick-q]");
    if (input) { input.focus(); input.setSelectionRange(pos, pos); }
  }
  if (e.target.dataset.parQ !== undefined) {
    qParents = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const input = document.querySelector("[data-par-q]");
    if (input) { input.focus(); input.setSelectionRange(pos, pos); }
  }
});

document.getElementById("app").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.target.id === "add-child") {
    const name = e.target.name.value;
    const trial = !!(e.target.trial && e.target.trial.checked) || !!(e.target.trialForced);
    const g = currentGroup();
    const res = await api("/api/groups/" + g.id + "/children", "POST", {
      name,
      kind: trial ? "trial" : "regular",
      day: selectedDay || todayDay()
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
  }
  if (e.target.id === "add-existing") {
    const g = currentGroup();
    const res = await api("/api/groups/" + g.id + "/children", "POST", { childId: e.target.childId.value });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
  }
  if (e.target.id === "new-group") {
    const wds = [...e.target.querySelectorAll("[name=wd]:checked")].map((i) => i.value);
    const res = await api("/api/groups", "POST", {
      branchId: selectedBranch,
      sport: e.target.sport.value,
      time: e.target.time.value,
      weekdays: wds,
      durationMin: Number(e.target.durationMin.value)
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
    view = "groups";
  }
  if (e.target.id === "new-trainer") {
    const res = await api("/api/trainers", "POST", {
      name: e.target.name.value,
      login: e.target.login.value,
      password: e.target.password.value,
      sport: selectedSport
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
    view = "trainer-sport";
  }
  const bp = e.target.closest("[data-branch-price]");
  if (bp) {
    await api("/api/branches/" + bp.dataset.branchPrice, "PATCH", {
      priceHour: Number(e.target.priceHour.value),
      priceHourHalf: Number(e.target.priceHourHalf.value),
      qr: e.target.qr.value
    });
    await load();
    dirTab = "calc";
    calcTab = "prices";
  }
  const gp = e.target.closest("[data-group-pack]");
  if (gp) {
    const body = {
      packPrice: Number(e.target.packPrice.value),
      packLessons: Number(e.target.packLessons.value),
      durationMin: Number(e.target.durationMin.value)
    };
    if (e.target.tariffId && e.target.tariffId.value) body.tariffId = e.target.tariffId.value;
    const res = await api("/api/groups/" + gp.dataset.groupPack, "PATCH", body);
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
    dirTab = "calc";
    calcTab = "prices";
  }
});

document.getElementById("overlay").addEventListener("click", async (e) => {
  if (e.target.id === "overlay" || e.target.closest("[data-close-sheet]")) {
    sheet = null; drawOverlay(); return;
  }
  const g = e.target.closest("[data-pick-group]");
  if (g) { selectedGroup = g.dataset.pickGroup; sheet = null; render(); return; }
  const toggleCg = e.target.closest("[data-toggle-cg]");
  if (toggleCg && sheet && sheet.type === "child-groups") {
    const id = toggleCg.dataset.toggleCg;
    const set = new Set(sheet.selected || []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    sheet.selected = [...set];
    drawOverlay();
    return;
  }
  if (e.target.closest("[data-back-family]") && sheet && sheet.backFamily) {
    sheet = { ...sheet.backFamily, type: "family" };
    drawOverlay();
    return;
  }
  if (e.target.closest("[data-save-cgroups]") && sheet) {
    const ids = sheet.selected || [];
    const childId = sheet.childId;
    const backFamily = sheet.backFamily || null;
    await api("/api/children/" + childId, "PATCH", { groupIds: ids });
    await load();
    if (backFamily) {
      sheet = { ...backFamily, type: "family" };
      drawOverlay();
    } else {
      sheet = null;
      drawOverlay();
      render();
    }
    return;
  }

  const famView = e.target.closest("[data-fam-view]");
  if (famView && sheet && sheet.type === "family") {
    sheet.view = famView.dataset.famView;
    sheet.parentId = "";
    sheet.viewChildId = "";
    drawOverlay();
    return;
  }
  const editParent = e.target.closest("[data-edit-parent]");
  if (editParent && sheet && sheet.type === "family") {
    sheet.view = "parent-edit";
    sheet.parentId = editParent.dataset.editParent;
    drawOverlay();
    return;
  }
  const famChild = e.target.closest("[data-fam-child]");
  if (famChild && sheet && sheet.type === "family") {
    sheet.view = "child";
    sheet.viewChildId = famChild.dataset.famChild;
    drawOverlay();
    return;
  }
  const openKidGroups = e.target.closest("[data-open-kid-groups]");
  if (openKidGroups) {
    const kid = state.children.find((c) => c.id === openKidGroups.dataset.openKidGroups);
    sheet = {
      type: "child-groups",
      childId: openKidGroups.dataset.openKidGroups,
      selected: [...((kid && kid.groupIds) || [])],
      backFamily: sheet && sheet.type === "family" ? { ...sheet, view: "child", viewChildId: openKidGroups.dataset.openKidGroups } : null
    };
    drawOverlay();
    return;
  }
  const removeParent = e.target.closest("[data-remove-parent]");
  if (removeParent && sheet && sheet.type === "family") {
    const child = state.children.find((c) => c.id === sheet.childId);
    const famId = sheet.familyId || (child && child.familyId);
    if (!confirm("Убрать этого родителя из семьи?")) return;
    const res = await api("/api/families/" + famId, "PATCH", { removeParentId: removeParent.dataset.removeParent });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
    sheet = { type: "family", childId: sheet.childId, familyId: famId, view: "home" };
    drawOverlay();
    return;
  }

  if (e.target.closest("[data-do-assign]") && sheet) {
    const sel = document.querySelector("[data-assign-fam]");
    const familyId = sel ? sel.value : "";
    const res = await api("/api/children/" + sheet.childId + "/family", "POST", { familyId });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
    const child = state.children.find((c) => c.id === sheet.childId) || data.child;
    sheet = {
      type: "family",
      childId: sheet.childId,
      familyId: (child && child.familyId) || (data.family && data.family.id) || "",
      view: "home"
    };
    drawOverlay();
    return;
  }
});

document.getElementById("overlay").addEventListener("submit", async (e) => {
  if (!sheet || sheet.type !== "family") return;
  const child = state.children.find((c) => c.id === sheet.childId);
  const famId = sheet.familyId || (child && child.familyId);
  if (!famId) return;

  if (e.target.id === "fam-parent-edit") {
    e.preventDefault();
    await api("/api/families/" + famId, "PATCH", {
      parent: {
        id: e.target.elements.id.value,
        name: e.target.elements.name.value,
        phone: e.target.elements.phone.value,
        email: e.target.elements.email.value
      }
    });
    await load();
    sheet = { type: "family", childId: sheet.childId, familyId: famId, view: "home" };
    drawOverlay();
    return;
  }
  if (e.target.id === "fam-parent-new") {
    e.preventDefault();
    await api("/api/families/" + famId, "PATCH", {
      addParent: {
        name: e.target.elements.name.value,
        phone: e.target.elements.phone.value,
        email: e.target.elements.email.value
      }
    });
    await load();
    sheet = { type: "family", childId: sheet.childId, familyId: famId, view: "home" };
    drawOverlay();
  }
});

document.getElementById("overlay").addEventListener("input", (e) => {
  if (e.target.dataset.groupQ !== undefined && sheet) {
    sheet.q = e.target.value;
    drawOverlay();
  }
});

load();
