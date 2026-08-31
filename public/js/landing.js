const ROLES = [
  ["parent", "Родитель", "Посещение своих детей и сумма оплаты за месяц вперёд"],
  ["trainer", "Тренер", "Таблица посещаемости: отметка кто был на тренировке"],
  ["admin", "Управляющая", "Та же таблица, новенькие в группу и расчёт абонемента"],
  ["director", "Руководитель", "Доступ ко всему: посещаемость, расчёт и тариф"]
];

const box = document.getElementById("roles");
const famBox = document.getElementById("families-box");
const famList = document.getElementById("families");

box.innerHTML = ROLES.map(([id, title, hint]) => `
  <button class="role-card" data-role="${id}">
    <strong>${title}</strong>
    <small>${hint}</small>
  </button>
`).join("");

box.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-role]");
  if (!btn) return;
  const role = btn.dataset.role;
  sessionStorage.setItem("lk-role", role);
  if (role !== "parent") {
    sessionStorage.removeItem("lk-family");
    location.href = "/cabinet.html";
    return;
  }
  famBox.classList.remove("hidden");
  const res = await fetch("/api/state", { headers: { "X-Role": "director" } });
  const data = await res.json();
  const families = (data.families || []).slice(0, 18);
  famList.innerHTML = families.map((f) => `
    <button class="family-card" data-family="${f.id}">
      ${f.label} · ${f.count} ${f.count === 1 ? "ребёнок" : "детей"}
    </button>
  `).join("");
});

famList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-family]");
  if (!btn) return;
  sessionStorage.setItem("lk-role", "parent");
  sessionStorage.setItem("lk-family", btn.dataset.family);
  location.href = "/cabinet.html";
});
