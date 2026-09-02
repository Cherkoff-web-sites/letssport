const role = sessionStorage.getItem("lk-role") || "parent";
const family = sessionStorage.getItem("lk-family") || "";

const headers = () => ({
  "Content-Type": "application/json",
  "X-Role": role,
  "X-Family": family
});

const WEEK_ORDER = ["пн", "вт", "ср", "чт", "пт", "сб", "воскр"];
const WEEK_SHORT = { пн: "Пн", вт: "Вт", ср: "Ср", чт: "Чт", пт: "Пт", сб: "Сб", воскр: "Вс" };
const MONTH_NAMES = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

const rub = (n) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " ₽";
const markLabel = { present: "+", trial: "500", excused: "с", "": "" };
const markTitle = { present: "Был", trial: "Пробное 500", excused: "Справка", "": "Нет отметки" };

let state = null;
let view = "attendance";
let selectedGroup = "";
let calMode = sessionStorage.getItem("lk-cal") || "";
let selectedDay = Number(sessionStorage.getItem("lk-day") || 0);
let sheet = null;

async function load() {
  const res = await fetch("/api/state", { headers: headers() });
  state = await res.json();
  if (!res.ok) {
    document.getElementById("app").innerHTML = `<p class="warn-text">${state.error || "Нет данных"}</p>`;
    return;
  }
  if (role === "parent") view = "parent";
  else if (!state.permissions.attendance && view !== "billing") view = "billing";
  else if (view === "billing" && !state.permissions.billing) view = "attendance";
  if (!calMode) calMode = role === "trainer" ? "day" : "month";
  if (!selectedDay) selectedDay = todayDay();
  persistCal();
  render();
}

function usesAttTable() {
  return role === "trainer" || role === "admin";
}
  sessionStorage.setItem("lk-cal", calMode);
  sessionStorage.setItem("lk-day", String(selectedDay));
}

function api(url, method, body) {
  return fetch(url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
}

function todayDay() {
  const now = new Date();
  if (now.getFullYear() === state.month.year && now.getMonth() + 1 === state.month.month) {
    return now.getDate();
  }
  return state.month.days[0].day;
}

function isToday(day) {
  const now = new Date();
  return now.getFullYear() === state.month.year && now.getMonth() + 1 === state.month.month && now.getDate() === day;
}

function currentGroup() {
  const id = (selectedGroup && state.groups.some((g) => g.id === selectedGroup))
    ? selectedGroup
    : (state.groups[0]?.id || "");
  selectedGroup = id;
  return state.groups.find((g) => g.id === id);
}

function rosterKids() {
  if (role === "parent") return state.children;
  const g = currentGroup();
  return state.children.filter((c) => c.groupId === (g && g.id));
}

function groupLabel(g) {
  if (!g) return "Группа";
  const name = g.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const time = (g.name.match(/\(([^)]+)\)/) || [])[1];
  return time ? `${name} · ${time}` : name;
}

function canDelete(child) {
  if (!child) return false;
  if (state.permissions.removeChild) return true;
  return state.permissions.removeOwnTrial && child.addedBy === "trainer" && child.kind === "trial";
}

function markOf(childId, day) {
  return state.attendance[`${state.month.id}:${childId}:${day}`] || "";
}

function dayMeta(dayNum) {
  return state.month.days.find((d) => d.day === dayNum) || { day: dayNum, weekday: "пн" };
}

function isTrainingDay(group, dayNum) {
  const d = dayMeta(dayNum);
  if (role === "parent") {
    return state.children.some((c) => {
      const g = state.groups.find((x) => x.id === c.groupId);
      return g && g.weekdays && g.weekdays.includes(d.weekday);
    });
  }
  if (!group || !group.weekdays || !group.weekdays.length) return true;
  return group.weekdays.includes(d.weekday);
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
  while (cells.length % 7) {
    const extra = cells.length - pad - count + 1;
    cells.push({ day: extra, inMonth: false });
  }
  return cells;
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

function dotsForDay(day) {
  const kids = rosterKids();
  let present = 0, trial = 0, excused = 0;
  for (const c of kids) {
    const m = markOf(c.id, day);
    if (m === "present") present += 1;
    if (m === "trial") trial += 1;
    if (m === "excused") excused += 1;
  }
  return { present, trial, excused, any: present + trial + excused };
}

function render() {
  const p = state.permissions;
  document.getElementById("top-meta").innerHTML = `<b>${state.roleMeta.title}</b>`;
  const tabs = [];
  if (role === "parent") tabs.push(["parent", "Календарь"]);
  else {
    if (p.attendance) tabs.push(["attendance", "Календарь"]);
    if (p.billing) tabs.push(["billing", "Расчёт"]);
  }
  document.getElementById("tabs").innerHTML = tabs.map(([id, title]) => (
    `<button class="${view === id ? "" : "is-off"}" data-view="${id}">${title}</button>`
  )).join("");

  const app = document.getElementById("app");
  if (view === "parent" || view === "attendance") app.innerHTML = calendarView();
  else app.innerHTML = billingView();
  drawOverlay();
}

function calToolbar() {
  const modes = [["day", "День"], ["week", "Неделя"], ["month", "Месяц"], ["year", "Год"]];
  const g = currentGroup();
  const groupBtn = role === "parent" ? "" : `
    <button class="group-pick" type="button" data-open-groups>
      <span>${groupLabel(g)}</span>
    </button>`;
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

function addForm() {
  if (role === "parent" || !state.permissions.editAttendance) return "";
  if (state.permissions.addChild) {
    return `
      <form class="add-bar" id="add-child">
        <input name="name" placeholder="Фамилия Имя" required>
        <label class="check"><input type="checkbox" name="trial"> пробный</label>
        <button class="btn" type="submit">Добавить</button>
      </form>`;
  }
  if (state.permissions.addTrial) {
    return `
      <form class="add-bar" id="add-child">
        <input name="name" placeholder="Пробник без записи" required>
        <input type="hidden" name="trialForced" value="1">
        <button class="btn" type="submit">Дописать</button>
      </form>`;
  }
  return "";
}

function dayList(dayNum) {
  const kids = rosterKids();
  const group = currentGroup();
  const meta = dayMeta(dayNum);
  const train = role === "parent" || isTrainingDay(group, dayNum);
  const clickable = state.permissions.editAttendance;
  const rows = kids.map((c) => {
    const mark = markOf(c.id, dayNum);
    const del = canDelete(c)
      ? `<button class="icon-del" data-del="${c.id}" type="button" aria-label="Убрать">×</button>`
      : "";
    const open = clickable
      ? `data-open-mark="${c.id}" data-day="${dayNum}"`
      : "";
    return `
      <div class="person ${c.kind === "trial" ? "name-trial" : ""}">
        <button class="person-main" type="button" ${open}>
          <span class="person-name">${c.name}${c.kind === "trial" ? " · пробный" : ""}</span>
          <span class="person-mark ${mark}">${mark ? markLabel[mark] : "—"}</span>
        </button>
        ${del}
      </div>`;
  }).join("");
  return `
    <section class="day-agenda">
      <h2>${meta.day} ${MONTH_NAMES[state.month.month - 1].toLowerCase()}, ${WEEK_SHORT[meta.weekday]}${isToday(dayNum) ? " · сегодня" : ""}</h2>
      ${train ? "" : `<p class="hint">Не день тренировки этой группы — отметить всё равно можно.</p>`}
      <div class="person-list">${rows || "<p class=\"hint\">В группе никого нет</p>"}</div>
    </section>`;
}

function viewDay() {
  return dayList(selectedDay);
}

function viewWeek() {
  const days = weekDays();
  return `
    <div class="week-strip">
      ${days.map((d) => {
        const on = d.inMonth && d.day === selectedDay;
        const today = d.inMonth && isToday(d.day);
        const dots = d.inMonth ? dotsForDay(d.day) : { any: 0 };
        return `
          <button type="button" class="week-day ${on ? "is-on" : ""} ${d.inMonth ? "" : "is-out"} ${today ? "is-today" : ""}" data-pick-day="${d.inMonth ? d.day : ""}" ${d.inMonth ? "" : "disabled"}>
            <small>${WEEK_SHORT[d.weekday]}</small>
            <strong>${d.day}</strong>
            <span class="mini-dots">${dotHtml(dots)}</span>
          </button>`;
      }).join("")}
    </div>
    ${dayList(selectedDay)}
  `;
}

function viewMonth() {
  const cells = monthGrid();
  const group = currentGroup();
  return `
    <div class="month-grid">
      ${WEEK_ORDER.map((w) => `<span class="dow">${WEEK_SHORT[w]}</span>`).join("")}
      ${cells.map((c) => {
        if (!c.inMonth) return `<span class="m-cell is-out"></span>`;
        const on = c.day === selectedDay;
        const today = isToday(c.day);
        const train = isTrainingDay(group, c.day);
        const dots = dotsForDay(c.day);
        return `
          <button type="button" class="m-cell ${on ? "is-on" : ""} ${today ? "is-today" : ""} ${train ? "is-train" : ""}" data-pick-day="${c.day}">
            <span>${c.day}</span>
            <span class="mini-dots">${dotHtml(dots)}</span>
          </button>`;
      }).join("")}
    </div>
    ${dayList(selectedDay)}
  `;
}

function viewYear() {
  const y = state.month.year;
  const months = MONTH_NAMES.map((name, i) => {
    const active = i + 1 === state.month.month;
    return `
      <button type="button" class="y-month ${active ? "is-on" : ""}" data-cal="month" ${active ? "" : "disabled"}>
        <strong>${name}</strong>
        ${active ? "<span>есть занятия</span>" : "<span>нет данных</span>"}
      </button>`;
  }).join("");
  return `<div class="year-grid">${months}</div><p class="hint">Сейчас в учёте ${MONTH_NAMES[state.month.month - 1]} ${y}. Остальные месяцы появятся, когда заведёте период.</p>`;
}

function dotHtml(dots) {
  if (!dots.any) return "";
  return `${dots.present ? "<i class=\"d-present\"></i>" : ""}${dots.trial ? "<i class=\"d-trial\"></i>" : ""}${dots.excused ? "<i class=\"d-excused\"></i>" : ""}`;
}

function parentPaySection() {
  if (!state.children.length) return "";
  const total = state.billing.reduce((s, b) => s + b.discounted, 0);
  const familyPaid = state.billing.length > 0 && state.billing.every((b) => b.paid);
  const cards = state.children.map((c) => {
    const b = state.billing.find((x) => x.childId === c.id);
    if (!b) return "";
    const group = state.groups.find((g) => g.id === c.groupId);
    return `
      <article class="child-card">
        <h2 class="${c.kind === "trial" ? "name-trial" : ""}">${c.name}${c.kind === "trial" ? " · пробный" : ""}</h2>
        <p>${group ? group.name : ""}</p>
        <div class="pay">
          <div><span>Был / справка</span><strong>${b.present} / ${b.excused}</strong></div>
          <div><span>К оплате</span><strong>${rub(b.toPaySum)}</strong></div>
          <div><span>Со скидкой ${b.discountPercent}%</span><strong>${rub(b.discounted)}</strong></div>
        </div>
      </article>
    `;
  }).join("");
  return `
    <div class="parent-pay">
      <p class="note">Оплата за ${state.month.label.toLowerCase()} вперёд. Справка снимает занятие с оплаты. Вы смотрите только своих детей.</p>
      <div class="child-grid">${cards}</div>
      <article class="child-card">
        <div class="pay"><div><span>Итого по семье</span><strong>${rub(total)}</strong></div></div>
      </article>
      ${payBlock(total, familyPaid, true)}
    </div>
  `;
}

function trainerColumns() {
  if (calMode === "day") return state.month.days.filter((d) => d.day === selectedDay);
  if (calMode === "week") {
    return weekDays().filter((d) => d.inMonth).map((d) => dayMeta(d.day));
  }
  return state.month.days;
}

function trainerWeekStrip() {
  const days = weekDays();
  return `
    <div class="week-strip">
      ${days.map((d) => {
        const on = d.inMonth && d.day === selectedDay;
        const today = d.inMonth && isToday(d.day);
        const dots = d.inMonth ? dotsForDay(d.day) : { any: 0 };
        return `
          <button type="button" class="week-day ${on ? "is-on" : ""} ${d.inMonth ? "" : "is-out"} ${today ? "is-today" : ""}" data-pick-day="${d.inMonth ? d.day : ""}" ${d.inMonth ? "" : "disabled"}>
            <small>${WEEK_SHORT[d.weekday]}</small>
            <strong>${d.day}</strong>
            <span class="mini-dots">${dotHtml(dots)}</span>
          </button>`;
      }).join("")}
    </div>`;
}

function trainerTable() {
  const kids = rosterKids();
  const group = currentGroup();
  const clickable = state.permissions.editAttendance;
  if (calMode === "year") {
    const months = MONTH_NAMES.map((name, i) => {
      const active = i + 1 === state.month.month;
      return `<th class="${active ? "is-now" : ""}">${name.slice(0, 3)}</th>`;
    }).join("");
    const rows = kids.map((c) => {
      const cells = MONTH_NAMES.map((_, i) => {
        const active = i + 1 === state.month.month;
        const n = active ? state.month.days.filter((d) => markOf(c.id, d.day) === "present").length : "";
        return `<td class="${active ? "is-now" : "is-out"}">${active ? (n || "—") : ""}</td>`;
      }).join("");
      return `<tr>
        <th class="sticky ${c.kind === "trial" ? "name-trial" : ""}">${c.name}${c.kind === "trial" ? " · пробный" : ""}</th>
        ${cells}
      </tr>`;
    }).join("");
    return `
      <div class="att-wrap">
        <table class="att-table">
          <thead><tr><th class="sticky">Фамилия</th>${months}</tr></thead>
          <tbody>${rows || "<tr><td class=\"sticky\">Никого нет</td></tr>"}</tbody>
        </table>
      </div>
      <p class="hint">В учёте пока ${MONTH_NAMES[state.month.month - 1]}. Нажмите «Месяц», чтобы править дни.</p>`;
  }
  const cols = trainerColumns();
  const head = cols.map((d) => `
    <th class="${isToday(d.day) ? "is-today" : ""} ${isTrainingDay(group, d.day) ? "is-train" : ""} ${d.day === selectedDay ? "is-on" : ""}" data-pick-day="${d.day}">
      <small>${WEEK_SHORT[d.weekday]}</small>
      ${d.day}
    </th>`).join("");
  const rows = kids.map((c) => {
    const del = canDelete(c)
      ? `<button class="icon-del" data-del="${c.id}" type="button" aria-label="Убрать">×</button>`
      : "";
    const cells = cols.map((d) => {
      const mark = markOf(c.id, d.day);
      const open = clickable ? `data-open-mark="${c.id}" data-day="${d.day}"` : "";
      return `<td class="mark ${mark} ${isTrainingDay(group, d.day) ? "is-train" : ""}" ${open}>${markLabel[mark] || ""}</td>`;
    }).join("");
    return `<tr>
      <th class="sticky ${c.kind === "trial" ? "name-trial" : ""}">
        <span>${c.name}${c.kind === "trial" ? " · пробный" : ""}</span>
        ${del}
      </th>
      ${cells}
    </tr>`;
  }).join("");
  return `
    ${calMode === "month" ? "" : trainerWeekStrip()}
    <div class="att-wrap">
      <table class="att-table">
        <thead>
          <tr>
            <th class="sticky">Фамилия</th>
            ${head}
          </tr>
        </thead>
        <tbody>${rows || `<tr><td class="sticky">Никого нет</td>${cols.map(() => "<td></td>").join("")}</tr>`}</tbody>
      </table>
    </div>`;
}

function calendarView() {
  const body = usesAttTable()
    ? trainerTable()
    : calMode === "week" ? viewWeek()
    : calMode === "month" ? viewMonth()
    : calMode === "year" ? viewYear()
    : viewDay();
  return `
    <div class="gcal ${usesAttTable() ? "gcal-table" : ""}">
      ${calToolbar()}
      ${body}
      ${calMode === "year" && !usesAttTable() ? "" : addForm()}
    </div>
    ${role === "parent" ? parentPaySection() : ""}
  `;
}

function payBlock(total, familyPaid, withButton) {
  return `
    <article class="child-card pay-how">
      <h2>Как оплатить?</h2>
      <div class="qr-row">
        <figure>
          <img src="/img/qr-1.svg" alt="QR для оплаты 1">
          <figcaption>QR 1</figcaption>
        </figure>
        <figure>
          <img src="/img/qr-2.svg" alt="QR для оплаты 2">
          <figcaption>QR 2</figcaption>
        </figure>
      </div>
      <p>Сканируйте один из кодов. Переходов по ссылке нет — только QR.</p>
      <label class="field">Сумма
        <input value="${Math.round(total)}" readonly>
      </label>
      ${withButton && state.permissions.markPaid ? `
        <button class="btn pay-btn ${familyPaid ? "is-paid" : ""}" type="button" data-pay="${familyPaid ? "0" : "1"}">
          ${familyPaid ? "Оплачено" : "Оплатил"}
        </button>
      ` : ""}
    </article>
  `;
}

function billingView() {
  const settings = state.permissions.settings ? `
    <form class="add-bar" id="pack-form">
      <label class="field">8 занятий, ₽
        <input name="packPrice" type="number" value="${state.settings.packPrice}">
      </label>
      <button class="btn" type="submit">Сохранить</button>
    </form>` : "";
  const g = currentGroup();
  const groupId = selectedGroup;
  const list = state.billing.filter((b) => !groupId || b.groupId === groupId);
  const cards = list.map((b) => `
    <article class="bill-card ${b.paid ? "is-paid-row" : ""}">
      <h3 class="${b.isTrial ? "name-trial" : ""}">${b.name}${b.isTrial ? " · пробный" : ""}</h3>
      <p>${b.isTrial ? "Пробное занятие" : `Занятий ${b.plannedCount}, справка ${b.excused}`}</p>
      <p class="money">${rub(b.discounted)}</p>
      ${state.permissions.editBilling && !b.isTrial
        ? `<label class="field">скидка %<input data-disc="${b.childId}" type="number" min="0" max="100" value="${b.discountPercent}"></label>`
        : ""}
      ${state.permissions.markPaid
        ? `<button class="btn pay-btn ${b.paid ? "is-paid" : ""}" type="button" data-pay-child="${b.childId}" data-pay="${b.paid ? "0" : "1"}">${b.paid ? "Оплачено" : "Оплатил"}</button>`
        : ""}
    </article>
  `).join("");
  const total = list.reduce((s, b) => s + b.discounted, 0);
  return `
    <div class="gcal">
      <button class="group-pick" type="button" data-open-groups><span>${groupId ? groupLabel(g) : "Все группы"}</span></button>
      ${settings}
      <div class="bill-cards">${cards || "<p class=\"hint\">Нет строк</p>"}</div>
      ${payBlock(total, list.length > 0 && list.every((b) => b.paid), false)}
    </div>
  `;
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
    const items = state.groups.filter((g) => g.name.toLowerCase().includes(q));
    const all = view === "billing" ? `<button type="button" data-group="" class="sheet-item">Все группы</button>` : "";
    el.innerHTML = `
      <div class="sheet" role="dialog">
        <p class="sheet-kicker">Группа</p>
        <input class="sheet-search" placeholder="Найти филиал или группу" value="${sheet.q || ""}" data-group-q>
        <div class="sheet-list">
          ${all}
          ${items.map((g) => `<button type="button" class="sheet-item ${g.id === selectedGroup ? "is-on" : ""}" data-group="${g.id}">${groupLabel(g)}</button>`).join("")}
        </div>
        <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Закрыть</button>
      </div>`;
    const input = el.querySelector("[data-group-q]");
    if (input) {
      input.focus();
      input.setSelectionRange((sheet.q || "").length, (sheet.q || "").length);
    }
    return;
  }
  if (sheet.type === "mark") {
    const child = state.children.find((c) => c.id === sheet.childId);
    const mark = markOf(sheet.childId, sheet.day);
    const opts = [
      ["present", "+ Был"],
      ["trial", "500 Пробное"]
    ];
    if (role !== "trainer") opts.push(["excused", "с Справка"]);
    opts.push(["", "Снять отметку"]);
    el.innerHTML = `
      <div class="sheet" role="dialog">
        <p class="sheet-kicker">${child ? child.name : ""} · ${sheet.day} ${MONTH_NAMES[state.month.month - 1].toLowerCase()}</p>
        <p class="hint">Сейчас: ${markTitle[mark] || "нет"}</p>
        ${opts.map(([v, t]) => `<button type="button" class="sheet-item ${mark === v ? "is-on" : ""}" data-set-mark="${v}">${t}</button>`).join("")}
        <button type="button" class="btn ghost sheet-cancel" data-close-sheet>Отмена</button>
      </div>`;
  }
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-view]");
  if (!btn) return;
  view = btn.dataset.view;
  render();
});

document.getElementById("app").addEventListener("click", async (e) => {
  const cal = e.target.closest("[data-cal]");
  if (cal) {
    calMode = cal.dataset.cal;
    persistCal();
    render();
    return;
  }
  if (e.target.closest("[data-today]")) {
    selectedDay = todayDay();
    if (role === "trainer") calMode = "day";
    persistCal();
    render();
    return;
  }
  const pick = e.target.closest("[data-pick-day]");
  if (pick && pick.dataset.pickDay) {
    selectedDay = Number(pick.dataset.pickDay);
    persistCal();
    render();
    return;
  }
  if (e.target.closest("[data-open-groups]")) {
    sheet = { type: "groups", q: "" };
    drawOverlay();
    return;
  }
  const openMark = e.target.closest("[data-open-mark]");
  if (openMark && !e.target.closest("[data-del]")) {
    sheet = { type: "mark", childId: openMark.dataset.openMark, day: Number(openMark.dataset.day) };
    drawOverlay();
    return;
  }
  const payChild = e.target.closest("[data-pay-child]");
  if (payChild) {
    await api("/api/paid", "POST", { childId: payChild.dataset.payChild, paid: payChild.dataset.pay === "1" });
    await load();
    return;
  }
  const pay = e.target.closest("[data-pay]");
  if (pay && !pay.dataset.payChild) {
    await api("/api/paid", "POST", { paid: pay.dataset.pay === "1" });
    await load();
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Убрать из группы?")) return;
    const res = await api("/api/children/" + del.dataset.del, "DELETE");
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
  }
});

document.getElementById("app").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.target.id === "add-child") {
    const name = e.target.name.value;
    const trial = !!(e.target.trial && e.target.trial.checked) || !!(e.target.trialForced);
    const res = await api("/api/children", "POST", {
      name,
      groupId: currentGroup().id,
      kind: trial ? "trial" : "regular"
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
  }
  if (e.target.id === "pack-form") {
    await api("/api/settings", "PATCH", { packPrice: Number(e.target.packPrice.value) });
    await load();
  }
});

document.getElementById("app").addEventListener("change", async (e) => {
  if (e.target.dataset.disc) {
    await api("/api/children/" + e.target.dataset.disc, "PATCH", { discountPercent: e.target.value });
    await load();
  }
});

document.getElementById("overlay").addEventListener("click", async (e) => {
  if (e.target.id === "overlay" || e.target.closest("[data-close-sheet]")) {
    sheet = null;
    drawOverlay();
    return;
  }
  const g = e.target.closest("[data-group]");
  if (g) {
    selectedGroup = g.dataset.group;
    sheet = null;
    render();
    return;
  }
  const set = e.target.closest("[data-set-mark]");
  if (set && sheet) {
    await api("/api/attendance", "POST", {
      childId: sheet.childId,
      day: sheet.day,
      status: set.dataset.setMark
    });
    sheet = null;
    await load();
  }
});

document.getElementById("overlay").addEventListener("input", (e) => {
  if (e.target.dataset.groupQ !== undefined && sheet) {
    sheet.q = e.target.value;
    drawOverlay();
  }
});

load();
