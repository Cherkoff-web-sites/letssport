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
    const cells = cols.map((d) => {
      const mark = cellMark(c, gid, d.day);
      const open = clickable && !mark.locked ? `data-toggle-mark="${c.id}" data-day="${d.day}" data-group="${gid}"` : "";
      return `<td class="mark big-mark ${mark.cls} ${isTrainingDay(group, d.day) ? "is-train" : ""}" ${open}>${mark.text}</td>`;
    }).join("");
    const trialTag = c.kind === "trial" ? `<span class="trial-tag">пробный</span>` : "";
    return `<tr>
      <th class="sticky ${c.kind === "trial" ? "name-trial" : ""}">
        <span>${esc(c.name)} ${trialTag}</span>${del}
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

function monthSwitch() {
  if (!state.months || state.months.length < 2) return "";
  return `<div class="subtabs">${state.months.map((m) => `
    <button type="button" class="${state.month.id === m.id ? "" : "is-off"}" data-month="${m.id}">${esc(m.label)}</button>
  `).join("")}</div>`;
}

function parentView() {
  if (selectedChild) return parentChildView();
  const p = state.period || {};
  const kids = (p.perChild || []).map((row) => `
    <button class="child-card tap-card" type="button" data-open-child="${row.childId}">
      <h2 class="${row.kind === "trial" ? "name-trial" : ""}">${esc(row.name)}${row.kind === "trial" ? " · пробный" : ""}</h2>
      <div class="pay">
        <div><span>Списано</span><strong>${rub(row.spent)}</strong></div>
        <div><span>Был / Б</span><strong>${row.present} / ${row.sickCount}</strong></div>
      </div>
    </button>`).join("");
  const qrs = (state.qrs || ["qr1"]).map((id) => `
    <figure>
      <img src="${qrMap[id] || "/img/qr-1.jpg"}" alt="QR">
      <figcaption>${id === "qr2" ? "QR 2" : "QR 1"}</figcaption>
    </figure>`).join("");
  const paid = p.status === "yellow" || p.status === "green";
  return `
    <div class="parent-home">
      ${monthSwitch()}
      <p class="note">Кабинет семьи · ${esc(state.month.label)}. Нажмите на ребёнка — календарь посещений и формула.</p>
      <div class="child-grid">${kids || "<p class=\"hint\">Нет детей в семье</p>"}</div>
      <article class="child-card">
        <div class="pay">
          <div><span>Остаток баланса</span><strong>${rub(p.opening)}</strong></div>
          <div><span>Аванс</span><strong>${rub(p.advance)}</strong></div>
          <div><span>Списано за месяц</span><strong>${rub(p.spent)}</strong></div>
        </div>
      </article>
      <article class="child-card">
        <div class="pay"><div><span>Итого к оплате</span><strong>${rub(Math.max(0, p.amountDue))}</strong></div>
        <div><span>Текущий баланс</span><strong>${rub(p.balance)}</strong></div></div>
        ${p.discountPercent ? `<p class="hint">Скидка многодетных ${p.discountPercent}%</p>` : ""}
        <button class="btn ghost" type="button" data-toggle-formula>${showFormula ? "Скрыть формулу" : "Показать формулу"}</button>
        ${showFormula ? formulaHtml(p) : ""}
      </article>
      <article class="child-card pay-how">
        <h2>Как оплатить</h2>
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
    return `<details class="formula-child" open>
      <summary><b>${esc(c.name)}</b>${c.kind === "trial" ? " · пробный" : ""} —
        аванс ${rub(c.advance)}, списано ${rub(c.spent)}, был ${c.present}, Б ${c.sickCount}${c.trial500 ? ", 500×" + c.trial500 : ""}</summary>
      <ul>
        ${adv.map((l) => `<li class="f-adv">Аванс: ${esc(l.group)} · ${l.sessions} зан. × ${rub(l.price)} = <b>${rub(l.part)}</b></li>`).join("")}
        ${visits.map((l) => `<li class="f-visit">${esc(l.group)} · ${l.day} число · <b>${esc(l.mark)}</b> → ${l.price ? "−" + rub(l.price) : "0 ₽"}${l.note ? " (" + esc(l.note) + ")" : ""}</li>`).join("") || "<li>Нет отметок посещений</li>"}
      </ul>
    </details>`;
  }).join("");
  const credit = p.credit != null ? p.credit : Math.max(0, p.opening || 0);
  const debt = p.debt != null ? p.debt : Math.max(0, -(p.opening || 0));
  return `<div class="formula">
    <h3>Ход расчёта</h3>
    <ol class="formula-steps">
      <li>Аванс сырой (занятия × тариф филиала): <b>${rub(p.advanceRaw)}</b></li>
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

function parentChildView() {
  const child = state.children.find((c) => c.id === selectedChild);
  if (!child) return `<p class="hint">Ребёнок не найден</p>`;
  const groups = state.groups.filter((g) => (child.groupIds || []).includes(g.id));
  const row = (state.period && state.period.perChild || []).find((x) => x.childId === child.id);
  const tables = groups.map((g) => `
    <h3>${esc(groupTitle(g))}</h3>
    ${attTable({ group: g, kids: [child], clickable: false, deletable: false })}
  `).join("");
  return `
    <div class="gcal gcal-table">
      <button class="btn ghost" type="button" data-back-parent>← К семье</button>
      <h2>${esc(child.name)}</h2>
      ${calToolbar(false)}
      ${tables}
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
    const selected = new Set(t.groupIds || []);
    const opts = groups.map((g) => `<label class="check"><input type="checkbox" data-tg="${t.id}" value="${g.id}" ${selected.has(g.id) ? "checked" : ""}> ${esc(groupTitle(g))}</label>`).join("");
    return `<article class="ath-card">
      <strong>${esc(t.name)}</strong>
      <p class="hint">логин ${esc(t.login)} · пароль ${esc(t.password)}</p>
      <div class="multi">${opts}</div>
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
  const cards = (state.branches || []).map((b) => `
    <article class="ath-card">
      <strong>${esc(b.name)}</strong>
      <form class="add-bar" data-branch-price="${b.id}">
        <label class="field">час, ₽<input name="priceHour" type="number" value="${b.priceHour}"></label>
        <label class="field">1,5 часа, ₽<input name="priceHourHalf" type="number" value="${b.priceHourHalf}"></label>
        <label class="field">QR
          <select name="qr">
            <option value="qr1" ${b.qr === "qr1" ? "selected" : ""}>QR 1</option>
            <option value="qr2" ${b.qr === "qr2" ? "selected" : ""}>QR 2</option>
          </select>
        </label>
        <button class="btn" type="submit">Сохранить</button>
      </form>
    </article>`).join("");
  return `
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
    const have = new Set((child && child.groupIds) || []);
    el.innerHTML = `
      <div class="sheet" role="dialog">
        <p class="sheet-kicker">${esc(child ? child.name : "")} · группы</p>
        <div class="sheet-list">
          ${state.groups.map((g) => `
            <label class="sheet-item check">
              <input type="checkbox" data-cg="${g.id}" ${have.has(g.id) ? "checked" : ""}>
              ${esc(groupTitle(g))}
            </label>`).join("")}
        </div>
        <button class="btn" type="button" data-save-cgroups>Сохранить</button>
        <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Закрыть</button>
      </div>`;
    return;
  }
  if (sheet.type === "family") {
    const child = state.children.find((c) => c.id === sheet.childId);
    const fam = state.families.find((f) => f.id === (child && child.familyId));
    const kids = state.children.filter((c) => c.familyId === (fam && fam.id));
    const showKids = sheet.kids;
    el.innerHTML = `
      <div class="sheet" role="dialog">
        <p class="sheet-kicker">Семья · ${esc(child ? child.name : "")}</p>
        ${fam ? `<p>логин <b>${esc(fam.login)}</b><br>пароль <b>${esc(fam.password)}</b></p>
          <form id="fam-edit">
            <label class="field">ФИО родителя<input name="parentName" value="${esc(fam.parentName)}"></label>
            <label class="field">телефон<input name="phone" value="${esc(fam.phone)}"></label>
            <label class="field">почта<input name="email" value="${esc(fam.email)}"></label>
            <button class="btn" type="submit">Сохранить контакты</button>
          </form>
          <button class="btn ghost" type="button" data-toggle-fkids>Дети в семье</button>
          ${showKids ? `<div class="sheet-list">${kids.map((k) => `<div class="sheet-item">${esc(k.name)}</div>`).join("")}</div>` : ""}
          <p class="hint">Назначить другую семью</p>
          <select data-assign-fam>
            <option value="">— новая семья —</option>
            ${state.families.map((f) => `<option value="${f.id}" ${fam.id === f.id ? "selected" : ""}>${esc(f.parentName)} (${esc(f.login)})</option>`).join("")}
          </select>
          <button class="btn ghost" type="button" data-do-assign>Назначить / создать</button>`
          : `<p>Семья не назначена</p><button class="btn" type="button" data-do-assign>Создать семью</button>`}
        <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Закрыть</button>
      </div>`;
  }
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
  if (cg) { sheet = { type: "child-groups", childId: cg.dataset.childGroups }; drawOverlay(); return; }
  const cf = e.target.closest("[data-child-family]");
  if (cf) { sheet = { type: "family", childId: cf.dataset.childFamily, kids: false }; drawOverlay(); return; }

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
    const ids = [...document.querySelectorAll(`[data-tg="${saveT.dataset.saveTrainer}"]:checked`)].map((i) => i.value);
    await api("/api/trainers/" + saveT.dataset.saveTrainer, "PATCH", { groupIds: ids });
    await load();
    view = "trainer-sport";
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
});

document.getElementById("overlay").addEventListener("click", async (e) => {
  if (e.target.id === "overlay" || e.target.closest("[data-close-sheet]")) {
    sheet = null; drawOverlay(); return;
  }
  const g = e.target.closest("[data-pick-group]");
  if (g) { selectedGroup = g.dataset.pickGroup; sheet = null; render(); return; }
  if (e.target.closest("[data-save-cgroups]") && sheet) {
    const ids = [...document.querySelectorAll("[data-cg]:checked")].map((i) => i.dataset.cg);
    await api("/api/children/" + sheet.childId, "PATCH", { groupIds: ids });
    sheet = null;
    await load();
    return;
  }
  if (e.target.closest("[data-toggle-fkids]") && sheet) {
    sheet.kids = !sheet.kids; drawOverlay(); return;
  }
  if (e.target.closest("[data-do-assign]") && sheet) {
    const sel = document.querySelector("[data-assign-fam]");
    const familyId = sel ? sel.value : "";
    await api("/api/children/" + sheet.childId + "/family", "POST", { familyId });
    sheet = null;
    await load();
  }
});

document.getElementById("overlay").addEventListener("submit", async (e) => {
  if (e.target.id !== "fam-edit" || !sheet) return;
  e.preventDefault();
  const child = state.children.find((c) => c.id === sheet.childId);
  await api("/api/families/" + child.familyId, "PATCH", {
    parentName: e.target.parentName.value,
    phone: e.target.phone.value,
    email: e.target.email.value
  });
  await load();
  sheet = { type: "family", childId: child.id, kids: false };
  drawOverlay();
});

document.getElementById("overlay").addEventListener("input", (e) => {
  if (e.target.dataset.groupQ !== undefined && sheet) {
    sheet.q = e.target.value;
    drawOverlay();
  }
});

load();
