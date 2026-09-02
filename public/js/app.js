const role = sessionStorage.getItem("lk-role") || "parent";
const family = sessionStorage.getItem("lk-family") || "";

const headers = () => ({
  "Content-Type": "application/json",
  "X-Role": role,
  "X-Family": family
});

const WEEK_ORDER = ["пн", "вт", "ср", "чт", "пт", "сб", "воскр"];
const WEEK_TITLE = {
  пн: "Понедельник",
  вт: "Вторник",
  ср: "Среда",
  чт: "Четверг",
  пт: "Пятница",
  сб: "Суббота",
  воскр: "Воскресенье"
};

const rub = (n) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " ₽";
const markLabel = { present: "+", trial: "500", excused: "с", "": "" };
const trainerCycle = { "": "present", present: "trial", trial: "" };
const staffCycle = { "": "present", present: "trial", trial: "excused", excused: "" };

let state = null;
let view = "attendance";
let selectedGroup = "";

async function load() {
  const res = await fetch("/api/state", { headers: headers() });
  state = await res.json();
  if (!res.ok) {
    document.getElementById("app").innerHTML = `<p class="warn-text">${state.error || "Нет данных. Запустите npm run import"}</p>`;
    return;
  }
  if (role === "parent") view = "parent";
  else if (!state.permissions.attendance) view = "billing";
  else if (view === "billing" && !state.permissions.billing) view = "attendance";
  render();
}

function api(url, method, body) {
  return fetch(url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
}

function childById(id) {
  return state.children.find((c) => c.id === id);
}

function canDelete(child) {
  if (!child) return false;
  if (state.permissions.removeChild) return true;
  return state.permissions.removeOwnTrial && child.addedBy === "trainer" && child.kind === "trial";
}

function weekdayBlocks(group) {
  const wanted = (group && group.weekdays && group.weekdays.length)
    ? group.weekdays
    : WEEK_ORDER;
  return WEEK_ORDER.filter((w) => wanted.includes(w)).map((w) => ({
    weekday: w,
    title: WEEK_TITLE[w],
    days: state.month.days.filter((d) => d.weekday === w)
  })).filter((b) => b.days.length);
}

function render() {
  const p = state.permissions;
  document.getElementById("top-meta").innerHTML = `
    <div><b>${state.roleMeta.title}</b> · ${state.month.label}</div>
    <div>${state.sourceNote || ""}</div>
  `;
  const tabs = [];
  if (role === "parent") tabs.push(["parent", "Мои дети"]);
  else {
    if (p.attendance) tabs.push(["attendance", "Посещаемость"]);
    if (p.billing) tabs.push(["billing", "Расчёт стоимости"]);
  }
  document.getElementById("tabs").innerHTML = tabs.map(([id, title]) => (
    `<button class="${view === id ? "" : "is-off"}" data-view="${id}">${title}</button>`
  )).join("");

  const app = document.getElementById("app");
  if (view === "parent") app.innerHTML = parentView();
  else if (view === "billing") app.innerHTML = billingView();
  else app.innerHTML = attendanceView();
}

function markCell(child, day, clickable) {
  const key = `${state.month.id}:${child.id}:${day.day}`;
  const mark = state.attendance[key] || "";
  const extra = clickable ? `data-child="${child.id}" data-day="${day.day}"` : "";
  return `<td class="mark ${mark}" ${extra}>${markLabel[mark] || ""}</td>`;
}

function nameCell(child) {
  const trial = child.kind === "trial";
  const del = canDelete(child)
    ? `<button class="btn ghost" data-del="${child.id}" type="button">×</button>`
    : "";
  return `<td class="sticky ${trial ? "name-trial" : ""}">${child.name}${trial ? " · пробный" : ""} ${del}</td>`;
}

function attendanceView() {
  const groupId = (selectedGroup && state.groups.some((g) => g.id === selectedGroup))
    ? selectedGroup
    : (state.groups[0]?.id || "");
  selectedGroup = groupId;
  const gopts = state.groups.map((g) => `<option value="${g.id}" ${g.id === groupId ? "selected" : ""}>${g.name}</option>`).join("");
  const kids = state.children.filter((c) => c.groupId === groupId);
  const group = state.groups.find((g) => g.id === groupId);
  const clickable = state.permissions.editAttendance;

  let add = "";
  if (state.permissions.addChild) {
    add = `
      <form class="form-row" id="add-child">
        <label class="field">В эту группу
          <input name="name" placeholder="Фамилия Имя" required>
        </label>
        <label class="check"><input type="checkbox" name="trial"> пробный</label>
        <button class="btn" type="submit">Добавить</button>
      </form>`;
  } else if (state.permissions.addTrial) {
    add = `
      <form class="form-row" id="add-child">
        <label class="field">Пробник (пришёл без записи)
          <input name="name" placeholder="Фамилия Имя" required>
        </label>
        <input type="hidden" name="trialForced" value="1">
        <button class="btn" type="submit">Дописать пробника</button>
      </form>`;
  }

  const blocks = weekdayBlocks(group).map((block) => {
    const head = block.days.map((d) => `<th>${d.day}</th>`).join("");
    const rows = kids.map((c) => `
      <tr>
        ${nameCell(c)}
        ${block.days.map((d) => markCell(c, d, clickable)).join("")}
      </tr>
    `).join("");
    return `
      <section class="cal-week">
        <h3>${block.title}</h3>
        <div class="cal-chips">${block.days.map((d) => `<span>${d.day}</span>`).join("")}</div>
        <div class="grid-wrap cal-wrap">
          <table class="sheet">
            <thead>
              <tr>
                <th class="sticky">Фамилия</th>
                ${head}
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td class="sticky">Пока никого нет</td>${block.days.map(() => "<td></td>").join("")}</tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }).join("");

  return `
    <div class="toolbar">
      <label class="field">Группа
        <select id="group-filter">${gopts}</select>
      </label>
      ${add}
    </div>
    <p class="note">${group ? group.name : ""} · дни тренировки друг под другом, как в мобильном календаре. Клик: пусто → <b>+</b> → <b>500</b>${role === "trainer" ? "" : " → <b>с</b> справка"}.</p>
    ${blocks}
    <p class="legend">
      <span><b class="present">+</b> был</span>
      <span><b class="trial">500</b> пробное, сдали</span>
      ${role === "trainer" ? "" : "<span><b class=\"excused\">с</b> справка</span>"}
      <span>пусто — не был</span>
      <span><b>жирный</b> — пробник</span>
    </p>
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
    <form class="form-row" id="pack-form">
      <label class="field">8 занятий, ₽
        <input name="packPrice" type="number" value="${state.settings.packPrice}">
      </label>
      <button class="btn" type="submit">Сохранить тариф</button>
    </form>` : "";

  const groupId = selectedGroup;
  const gopts = `<option value="">Все группы</option>` + state.groups.map((g) =>
    `<option value="${g.id}" ${g.id === groupId ? "selected" : ""}>${g.name}</option>`
  ).join("");
  const list = state.billing.filter((b) => !groupId || b.groupId === groupId);
  const rows = list.map((b, i) => `
    <tr class="${b.isTrial ? "row-trial" : ""} ${b.paid ? "row-paid" : ""}">
      <td class="num">${i + 1}</td>
      <td class="sticky ${b.isTrial ? "name-trial" : ""}">${b.name}${b.isTrial ? " · пробный" : ""}</td>
      <td>${b.isTrial ? "пробное" : b.plannedCount}</td>
      <td>${b.excused}</td>
      <td>${b.toPayLessons}</td>
      <td class="money">${rub(b.toPaySum)}</td>
      <td>${state.permissions.editBilling && !b.isTrial
        ? `<input data-disc="${b.childId}" type="number" min="0" max="100" value="${b.discountPercent}" style="min-width:72px;width:72px">`
        : (b.isTrial ? "—" : b.discountPercent + "%")}</td>
      <td class="money">${rub(b.discounted)}</td>
      <td class="money">${b.isTrial ? "—" : rub(b.lessonPrice)}</td>
      <td class="money">${b.isTrial ? "—" : rub(b.packPrice)}</td>
      <td class="money">${b.isTrial ? "—" : rub(b.nineLessons)}</td>
      <td>${state.permissions.markPaid
        ? `<button class="btn pay-btn ${b.paid ? "is-paid" : ""}" type="button" data-pay-child="${b.childId}" data-pay="${b.paid ? "0" : "1"}">${b.paid ? "Оплачено" : "Оплатил"}</button>`
        : (b.paid ? "да" : "")}</td>
    </tr>
  `).join("");
  const total = list.reduce((s, b) => s + b.discounted, 0);

  return `
    <div class="toolbar">
      <label class="field">Группа
        <select id="group-filter">${gopts}</select>
      </label>
      ${settings}
    </div>
    <div class="grid-wrap">
      <table class="sheet">
        <thead>
          <tr>
            <th>№</th>
            <th class="sticky">Фамилия</th>
            <th>всего занятий</th>
            <th>справка</th>
            <th>к оплате, зан.</th>
            <th>к оплате, сумма</th>
            <th>скидка %</th>
            <th>сумма со скидкой</th>
            <th>1 занятие</th>
            <th>8 занятий</th>
            <th>9 занятий</th>
            <th>оплата</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="note">Группа выбирается сверху, в таблице её нет. Пробное = 500 ₽ за отметку. Зелёная кнопка — родитель нажал «оплатил», так проще сверить с банком.</p>
    ${payBlock(total, list.length > 0 && list.every((b) => b.paid), false)}
  `;
}

function parentView() {
  if (!state.children.length) return `<p class="note">Для этой семьи нет детей в текущих группах.</p>`;
  const total = state.billing.reduce((s, b) => s + b.discounted, 0);
  const familyPaid = state.billing.length > 0 && state.billing.every((b) => b.paid);
  const cards = state.children.map((c) => {
    const b = state.billing.find((x) => x.childId === c.id);
    if (!b) return "";
    const group = state.groups.find((g) => g.id === c.groupId);
    const blocks = weekdayBlocks(group).map((block) => `
      <section class="cal-week">
        <h3>${block.title}</h3>
        <div class="grid-wrap cal-wrap">
          <table class="sheet">
            <thead><tr><th class="sticky">День</th>${block.days.map((d) => `<th>${d.day}</th>`).join("")}</tr></thead>
            <tbody><tr><td class="sticky">Посещение</td>${block.days.map((d) => markCell(c, d, false)).join("")}</tr></tbody>
          </table>
        </div>
      </section>
    `).join("");
    return `
      <article class="child-card">
        <h2 class="${c.kind === "trial" ? "name-trial" : ""}">${c.name}${c.kind === "trial" ? " · пробный" : ""}</h2>
        <p>${group ? group.name : ""}</p>
        ${blocks}
        <div class="pay">
          <div><span>Был / справка</span><strong>${b.present} / ${b.excused}</strong></div>
          <div><span>К оплате</span><strong>${rub(b.discounted)}</strong></div>
        </div>
      </article>
    `;
  }).join("");
  return `
    <p class="note">Оплата за ${state.month.label.toLowerCase()} вперёд. Ниже — как оплатить и кнопка «оплатил».</p>
    <div class="child-grid">${cards}</div>
    <article class="child-card">
      <div class="pay"><div><span>Итого по семье</span><strong>${rub(total)}</strong></div></div>
    </article>
    ${payBlock(total, familyPaid, true)}
  `;
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-view]");
  if (!btn) return;
  view = btn.dataset.view;
  render();
});

document.getElementById("app").addEventListener("change", async (e) => {
  if (e.target.id === "group-filter") {
    selectedGroup = e.target.value;
    render();
    return;
  }
  if (e.target.dataset.disc) {
    await api("/api/children/" + e.target.dataset.disc, "PATCH", { discountPercent: e.target.value });
    await load();
  }
});

document.getElementById("app").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.target.id === "add-child") {
    const groupId = document.getElementById("group-filter").value;
    const name = e.target.name.value;
    const trial = !!(e.target.trial && e.target.trial.checked) || !!(e.target.trialForced);
    const res = await api("/api/children", "POST", { name, groupId, kind: trial ? "trial" : "regular" });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
  }
  if (e.target.id === "pack-form") {
    await api("/api/settings", "PATCH", { packPrice: Number(e.target.packPrice.value) });
    await load();
  }
});

document.getElementById("app").addEventListener("click", async (e) => {
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
    if (!confirm("Убрать из группы?")) return;
    const res = await api("/api/children/" + del.dataset.del, "DELETE");
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
    return;
  }
  const cell = e.target.closest("td.mark[data-child]");
  if (!cell || !state.permissions.editAttendance) return;
  const childId = cell.dataset.child;
  const day = Number(cell.dataset.day);
  const key = `${state.month.id}:${childId}:${day}`;
  const cur = state.attendance[key] || "";
  const cycle = role === "trainer" ? trainerCycle : staffCycle;
  await api("/api/attendance", "POST", { childId, day, status: cycle[cur] || "present" });
  await load();
});

load();
