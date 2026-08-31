const role = sessionStorage.getItem("lk-role") || "parent";
const family = sessionStorage.getItem("lk-family") || "";

const headers = () => ({
  "Content-Type": "application/json",
  "X-Role": role,
  "X-Family": family
});

const rub = (n) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " ₽";
const markLabel = { present: "+", excused: "с", "": "" };
const nextMark = { "": "present", present: "excused", excused: "" };

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
  if (role === "parent" && !state.permissions.editAttendance) view = "parent";
  else if (!state.permissions.attendance) view = "billing";
  if (role === "parent") view = "parent";
  render();
}

function api(url, method, body) {
  return fetch(url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
}

function render() {
  const p = state.permissions;
  document.getElementById("top-meta").innerHTML = `
    <div><b>${state.roleMeta.title}</b> · ${state.month.label}</div>
    <div>${state.sourceNote || "Состав групп из таблицы посещаемости июня 2026. Актуальные группы клиент пришлёт отдельно."}</div>
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

function groupByGroups(children) {
  return state.groups.map((g) => ({
    group: g,
    kids: children.filter((c) => c.groupId === g.id)
  })).filter((x) => x.kids.length || role !== "parent");
}

function attendanceView() {
  const groupId = (selectedGroup && state.groups.some((g) => g.id === selectedGroup))
    ? selectedGroup
    : (state.groups[0]?.id || "");
  selectedGroup = groupId;
  const gopts = state.groups.map((g) => `<option value="${g.id}" ${g.id === groupId ? "selected" : ""}>${g.name}</option>`).join("");
  const kids = state.children.filter((c) => c.groupId === groupId);
  const group = state.groups.find((g) => g.id === groupId);
  const add = state.permissions.addChild ? `
    <form class="form-row" id="add-child">
      <label class="field">Новенький в эту группу
        <input name="name" placeholder="Фамилия Имя" required>
      </label>
      <button class="btn" type="submit">Добавить</button>
    </form>` : "";
  const rows = kids.map((c, i) => {
    const cells = state.month.days.map((d) => {
      const key = `${state.month.id}:${c.id}:${d.day}`;
      const mark = state.attendance[key] || "";
      const sched = group && group.weekdays.includes(d.weekday);
      const cls = ["mark", mark, sched ? "sched" : ""].join(" ");
      return `<td class="${cls}" data-child="${c.id}" data-day="${d.day}">${markLabel[mark] || ""}</td>`;
    }).join("");
    const del = state.permissions.removeChild
      ? `<button class="btn ghost" data-del="${c.id}" type="button">×</button>`
      : "";
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="sticky">${c.name} ${del}</td>
      ${cells}
    </tr>`;
  }).join("");
  return `
    <div class="toolbar">
      <label class="field">Группа
        <select id="group-filter">${gopts}</select>
      </label>
      ${add}
    </div>
    <p class="note">Клик по дню: пусто → <b>+</b> был → <b>с</b> справка. Подсвечены дни тренировки группы (${(group && group.weekdays.join("/")) || "—"}).</p>
    <div class="grid-wrap">
      <table class="sheet">
        <thead>
          <tr>
            <th>№</th>
            <th class="sticky">Фамилия</th>
            ${state.month.days.map((d) => `<th>${d.day}</th>`).join("")}
          </tr>
          <tr>
            <th></th>
            <th class="sticky">день недели</th>
            ${state.month.days.map((d) => `<th>${d.weekday}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          <tr class="group"><td colspan="${state.month.days.length + 2}">${group ? group.name : ""}</td></tr>
          ${rows || `<tr><td colspan="${state.month.days.length + 2}">В группе пока никого нет</td></tr>`}
        </tbody>
      </table>
    </div>
    <p class="legend"><span><b class="present">+</b> был на тренировке</span><span><b class="excused">с</b> справка, занятие не оплачивается</span><span>пусто — не был</span></p>
  `;
}

function billingView() {
  const settings = state.permissions.settings ? `
    <form class="form-row" id="pack-form">
      <label class="field">8 занятий, ₽
        <input name="packPrice" type="number" value="${state.settings.packPrice}">
      </label>
      <button class="btn" type="submit">Сохранить тариф</button>
    </form>` : `<p class="note">8 занятий = ${rub(state.settings.packPrice)}, 1 занятие = ${rub(state.settings.packPrice / state.settings.packLessons)}. Скидка семьи: 2 ребёнка 10%, 3 — 20% (если не задана вручную).</p>`;

  const groupId = selectedGroup;
  const gopts = `<option value="">Все группы</option>` + state.groups.map((g) =>
    `<option value="${g.id}" ${g.id === groupId ? "selected" : ""}>${g.name}</option>`
  ).join("");
  const list = state.billing.filter((b) => !groupId || b.groupId === groupId);
  const rows = list.map((b, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td class="sticky">${b.name}</td>
      <td>${b.groupName.replace(/\s+/g, " ")}</td>
      <td>${b.plannedCount}</td>
      <td>${b.excused}</td>
      <td>${b.toPayLessons}</td>
      <td class="money">${rub(b.toPaySum)}</td>
      <td>${state.permissions.editBilling
        ? `<input data-disc="${b.childId}" type="number" min="0" max="100" value="${b.discountPercent}" style="min-width:72px;width:72px">`
        : b.discountPercent + "%"}</td>
      <td class="money">${rub(b.discounted)}</td>
      <td class="money">${rub(b.lessonPrice)}</td>
      <td class="money">${rub(b.packPrice)}</td>
      <td class="money">${rub(b.nineLessons)}</td>
    </tr>
  `).join("");

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
            <th>Группа</th>
            <th>всего занятий</th>
            <th>справка</th>
            <th>к оплате, зан.</th>
            <th>к оплате, сумма</th>
            <th>скидка %</th>
            <th>сумма со скидкой</th>
            <th>1 занятие</th>
            <th>8 занятий</th>
            <th>9 занятий</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="note">Формулы как в Excel: к оплате занятия = всего − справка; сумма = занятия × (7500 / 8); 9 занятий = 8 занятий / 8 × 9; со скидкой = сумма × (1 − скидка).</p>
  `;
}

function parentView() {
  if (!state.children.length) return `<p class="note">Для этой семьи нет детей в текущих группах.</p>`;
  const total = state.billing.reduce((s, b) => s + b.discounted, 0);
  const cards = state.children.map((c) => {
    const b = state.billing.find((x) => x.childId === c.id);
    if (!b) return "";
    const group = state.groups.find((g) => g.id === c.groupId);
    const days = state.month.days.map((d) => {
      const mark = state.attendance[`${state.month.id}:${c.id}:${d.day}`] || "";
      const sched = group && group.weekdays.includes(d.weekday);
      return `<td class="mark ${mark} ${sched ? "sched" : ""}">${markLabel[mark] || ""}</td>`;
    }).join("");
    return `
      <article class="child-card">
        <h2>${c.name}</h2>
        <p>${group ? group.name : ""}</p>
        <div class="grid-wrap" style="max-height:none">
          <table class="sheet">
            <thead>
              <tr><th class="sticky">День</th>${state.month.days.map((d) => `<th>${d.day}</th>`).join("")}</tr>
              <tr><th class="sticky"></th>${state.month.days.map((d) => `<th>${d.weekday}</th>`).join("")}</tr>
            </thead>
            <tbody><tr><td class="sticky">Посещение</td>${days}</tr></tbody>
          </table>
        </div>
        <div class="pay">
          <div><span>Был / справка</span><strong>${b.present} / ${b.excused}</strong></div>
          <div><span>Занятий в месяце</span><strong>${b.plannedCount}</strong></div>
          <div><span>К оплате</span><strong>${rub(b.toPaySum)}</strong></div>
          <div><span>Со скидкой ${b.discountPercent}%</span><strong>${rub(b.discounted)}</strong></div>
        </div>
      </article>
    `;
  }).join("");
  return `
    <p class="note">Оплата за ${state.month.label.toLowerCase()} вперёд. Справка снимает занятие с оплаты. Вы смотрите только своих детей.</p>
    <div class="child-grid">${cards}</div>
    <article class="child-card">
      <div class="pay"><div><span>Итого по семье</span><strong>${rub(total)}</strong></div></div>
    </article>
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
    const res = await api("/api/children", "POST", { name, groupId });
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
  const del = e.target.closest("[data-del]");
  if (del) {
    if (!confirm("Убрать ученика из группы?")) return;
    await api("/api/children/" + del.dataset.del, "DELETE");
    await load();
    return;
  }
  const cell = e.target.closest("td.mark[data-child]");
  if (!cell || !state.permissions.editAttendance) return;
  const childId = cell.dataset.child;
  const day = Number(cell.dataset.day);
  const key = `${state.month.id}:${childId}:${day}`;
  const cur = state.attendance[key] || "";
  await api("/api/attendance", "POST", { childId, day, status: nextMark[cur] || "present" });
  await load();
});

load();
