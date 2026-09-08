const form = document.getElementById("login");
const err = document.getElementById("login-err");
const demoList = document.getElementById("demo-list");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function fillForm(login, password) {
  form.login.value = login;
  form.password.value = password;
  form.login.focus();
}

function renderAccounts(accounts) {
  if (!accounts.length) {
    demoList.innerHTML = `<p class="demo-hint">Нет демо-доступов</p>`;
    return;
  }
  demoList.innerHTML = accounts.map((a, i) => `
    <article class="demo-row" data-fill="${i}">
      <div class="demo-row-main">
        <strong>${esc(a.role)}</strong>
        <code class="demo-creds">${esc(a.login)} / ${esc(a.password)}</code>
      </div>
      <div class="demo-row-actions">
        <button type="button" class="btn ghost demo-btn" data-copy="${i}">Скопировать</button>
        <button type="button" class="btn demo-btn" data-use="${i}">Войти</button>
      </div>
    </article>
  `).join("");

  demoList.querySelectorAll("[data-fill]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const a = accounts[Number(row.dataset.fill)];
      if (a) fillForm(a.login, a.password);
    });
  });
  demoList.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const a = accounts[Number(btn.dataset.copy)];
      if (!a) return;
      const ok = await copyText(`${a.login}\n${a.password}`);
      const prev = btn.textContent;
      btn.textContent = ok ? "Скопировано" : "Ошибка";
      setTimeout(() => { btn.textContent = prev; }, 1200);
    });
  });
  demoList.querySelectorAll("[data-use]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const a = accounts[Number(btn.dataset.use)];
      if (!a) return;
      fillForm(a.login, a.password);
      form.requestSubmit();
    });
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.classList.add("hidden");
  const login = form.login.value.trim();
  const password = form.password.value;
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password })
  });
  const data = await res.json();
  if (!res.ok) {
    err.textContent = data.error || "Не удалось войти";
    err.classList.remove("hidden");
    return;
  }
  sessionStorage.setItem("lk-role", data.role);
  sessionStorage.setItem("lk-family", data.familyId || "");
  sessionStorage.setItem("lk-trainer", data.trainerId || "");
  sessionStorage.setItem("lk-name", data.name || "");
  location.href = "/cabinet.html";
});

fetch("/api/demo-accounts")
  .then((r) => r.json())
  .then((data) => renderAccounts(data.accounts || []))
  .catch(() => {
    demoList.innerHTML = `<p class="demo-hint">Не удалось загрузить доступы</p>`;
  });
