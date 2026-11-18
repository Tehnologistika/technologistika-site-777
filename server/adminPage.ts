/** Страницы админки. В HTML нет заявок и секретов: список приходит только после входа. */
export function adminPageHtml(): string {
  return page(
    "Заявки — ТехноЛогистика",
    `
    <p id="status" class="error" hidden></p>
    <section id="loginView">
      <h1>Заявки</h1>
      <p class="note">Вход по личной учётной записи и коду из Яндекс Ключа или Google Authenticator. Пароль в браузере не сохраняется. Сессия действует 12 часов.</p>
      <form id="loginForm">
        <label>Логин<input id="login" name="username" autocomplete="username" required /></label>
        <label>Пароль<input id="password" type="password" autocomplete="current-password" required /></label>
        <label>Код из приложения<input id="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,8}" required /></label>
        <button type="submit">Войти</button>
      </form>
      <p class="note">Первый вход владельца — по одноразовой ссылке настройки, которую выдаёт сервер. Здесь пароль не восстанавливается.</p>
    </section>
    <section id="appView" hidden>
      <div class="bar">
        <h1>Заявки</h1>
        <div class="bar-actions">
          <span id="who"></span>
          <button id="logout" type="button">Выйти</button>
        </div>
      </div>
      <p id="staffNote" class="note" hidden>Доступен только просмотр. Удаление, выгрузка и настройки пользователей недоступны.</p>
      <div id="ownerTools" hidden>
        <div class="bar-actions">
          <button id="exportBtn" type="button">Выгрузить CSV</button>
        </div>
        <p class="note">Файл содержит персональные данные. Не загружайте его в зарубежные сервисы (Google Drive, Gmail, Telegram) и удалите после использования.</p>
      </div>
      <p id="listMeta" class="note"></p>
      <div class="wrap"><table id="table">
        <thead>
          <tr>
            <th>№</th><th>Когда</th><th>Имя</th><th>Телефон</th><th>Маршрут</th>
            <th>Авто</th><th>На ходу</th><th>Готовность</th><th>Комментарий</th><th>Согласие</th>
            <th id="deleteHead" hidden>Удаление</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table></div>
      <section id="ownerUsers" hidden>
        <h2>Пользователи</h2>
        <p class="note">Новый человек сам задаёт пароль и код приложения по одноразовой ссылке. Ссылка показывается один раз.</p>
        <form id="userForm">
          <label>Логин<input id="newLogin" autocomplete="off" required /></label>
          <label>Роль
            <select id="newRole">
              <option value="staff">Сотрудник — только просмотр</option>
              <option value="owner">Владелец</option>
            </select>
          </label>
          <button type="submit">Создать</button>
        </form>
        <p id="invite" class="invite" hidden></p>
        <div class="wrap"><table id="users">
          <thead><tr><th>Логин</th><th>Роль</th><th>Статус</th><th></th></tr></thead>
          <tbody></tbody>
        </table></div>
        <h2>Журнал</h2>
        <p class="note">Время — московское. IP хранится только как хеш.</p>
        <div class="wrap"><table id="audit">
          <thead><tr><th>Когда</th><th>Пользователь</th><th>Событие</th><th>Детали</th><th>IP, хеш</th></tr></thead>
          <tbody></tbody>
        </table></div>
      </section>
    </section>
    `,
    `
    const loginView = document.getElementById("loginView");
    const appView = document.getElementById("appView");
    const status = document.getElementById("status");
    const who = document.getElementById("who");
    const staffNote = document.getElementById("staffNote");
    const ownerTools = document.getElementById("ownerTools");
    const ownerUsers = document.getElementById("ownerUsers");
    const deleteHead = document.getElementById("deleteHead");
    const listMeta = document.getElementById("listMeta");
    const tbody = document.querySelector("#table tbody");
    const usersBody = document.querySelector("#users tbody");
    const auditBody = document.querySelector("#audit tbody");
    const invite = document.getElementById("invite");
    const drive = { yes: "Да, на ходу", no: "Нет, не на ходу", uncertain: "Нужно уточнить" };
    const actions = {
      login: "Вход",
      login_failed: "Неудачный вход",
      logout: "Выход",
      view: "Просмотр",
      delete: "Удаление",
      export: "Выгрузка",
      user_create: "Пользователь создан",
      user_disable: "Пользователь отключён",
      user_enable: "Пользователь включён",
      user_setup: "Настройка учётной записи"
    };
    const statuses = { pending: "Ожидает настройки", active: "Активен", disabled: "Отключён" };
    const roles = { owner: "Владелец", staff: "Сотрудник" };
    let csrf = "";
    let role = "";
    let me = "";

    function cell(text) {
      const td = document.createElement("td");
      td.textContent = text == null || text === "" ? "—" : String(text);
      return td;
    }

    function showError(text) {
      status.textContent = text;
      status.hidden = !text;
    }

    function msk(iso) {
      if (!iso) return "—";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return String(iso);
      return new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).format(date) + " МСК";
    }

    async function api(path, options) {
      const headers = { "Content-Type": "application/json" };
      if (csrf && options && options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrf;
      try {
        const response = await fetch(path, {
          method: options && options.method ? options.method : "GET",
          headers: headers,
          body: options && options.body ? JSON.stringify(options.body) : undefined,
          credentials: "same-origin"
        });
        const isCsv = (response.headers.get("content-type") || "").indexOf("text/csv") !== -1;
        const payload = isCsv ? null : await response.json().catch(function () { return {}; });
        return { response: response, payload: payload };
      } catch (err) {
        return { response: { ok: false, status: 0, blob: function () { return Promise.reject(err); }, headers: { get: function () { return ""; } } }, payload: { error: "Не удалось связаться с сервером." } };
      }
    }

    async function loadLeads() {
      const result = await api("/api/admin/leads");
      if (result.response.status === 401) return showLogin();
      if (!result.response.ok) {
        showError((result.payload && result.payload.error) || "Не удалось открыть список.");
        return;
      }
      const rows = result.payload || [];
      tbody.replaceChildren();
      deleteHead.hidden = role !== "owner";
      listMeta.textContent = "Заявок: " + rows.length;
      if (!rows.length) {
        const tr = document.createElement("tr");
        const empty = cell("Заявок пока нет");
        empty.colSpan = role === "owner" ? 11 : 10;
        tr.append(empty);
        tbody.append(tr);
        return;
      }
      rows.forEach(function (row) {
        const tr = document.createElement("tr");
        tr.append(
          cell(row.publicId),
          cell(msk(row.createdAt)),
          cell(row.name),
          cell(row.phone),
          cell((row.from || "") + " → " + (row.to || "")),
          cell([row.carModel, row.carYear].filter(Boolean).join(", ")),
          cell(drive[row.driveStatus] || row.driveStatus),
          cell(row.readyDate),
          cell(row.comment),
          cell(msk(row.consentAt) + " · " + row.consentTextVersion)
        );
        if (role === "owner") {
          const td = document.createElement("td");
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Удалить";
          button.addEventListener("click", function () { removeLead(row.publicId); });
          td.append(button);
          tr.append(td);
        }
        tbody.append(tr);
      });
    }

    async function removeLead(publicId) {
      if (!window.confirm("Удалить заявку " + publicId + "?")) return;
      const result = await api("/api/admin/leads/" + encodeURIComponent(publicId), { method: "DELETE" });
      if (!result.response.ok) {
        showError((result.payload && result.payload.error) || "Не удалось удалить заявку.");
        return;
      }
      showError("");
      await loadLeads();
      await loadAudit();
    }

    async function loadUsers() {
      const result = await api("/api/admin/users");
      if (!result.response.ok) return;
      usersBody.replaceChildren();
      (result.payload || []).forEach(function (user) {
        const tr = document.createElement("tr");
        tr.append(cell(user.login), cell(roles[user.role] || user.role), cell(statuses[user.status] || user.status));
        const td = document.createElement("td");
        if (user.login !== me && user.status !== "pending") {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = user.status === "disabled" ? "Включить" : "Отключить";
          button.addEventListener("click", function () { toggleUser(user); });
          td.append(button);
        }
        tr.append(td);
        usersBody.append(tr);
      });
    }

    async function toggleUser(user) {
      const enable = user.status === "disabled";
      const result = await api("/api/admin/users/" + user.id + (enable ? "/enable" : "/disable"), { method: "POST", body: {} });
      if (!result.response.ok) {
        showError((result.payload && result.payload.error) || "Не удалось изменить пользователя.");
        return;
      }
      showError("");
      await loadUsers();
      await loadAudit();
    }

    async function loadAudit() {
      const result = await api("/api/admin/audit");
      if (!result.response.ok) return;
      auditBody.replaceChildren();
      (result.payload || []).forEach(function (row) {
        const tr = document.createElement("tr");
        tr.append(
          cell(row.atMsk),
          cell(row.actorLogin),
          cell(actions[row.action] || row.action),
          cell(row.detail),
          cell(row.ipHash)
        );
        auditBody.append(tr);
      });
    }

    function showLogin() {
      csrf = "";
      role = "";
      me = "";
      appView.hidden = true;
      loginView.hidden = false;
    }

    function showApp(session) {
      csrf = session.csrfToken;
      role = session.role;
      me = session.login;
      loginView.hidden = true;
      appView.hidden = false;
      who.textContent = "Вы вошли как " + session.login + " (" + (roles[session.role] || session.role) + ")";
      const owner = session.role === "owner";
      staffNote.hidden = owner;
      ownerTools.hidden = !owner;
      ownerUsers.hidden = !owner;
      showError("");
      loadLeads().catch(function () { showError("Не удалось открыть список."); });
      if (owner) {
        loadUsers().catch(function () {});
        loadAudit().catch(function () {});
      }
    }

    document.getElementById("loginForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      showError("");
      const result = await api("/api/admin/login", {
        method: "POST",
        body: {
          login: document.getElementById("login").value,
          password: document.getElementById("password").value,
          totp: document.getElementById("totp").value
        }
      });
      document.getElementById("password").value = "";
      document.getElementById("totp").value = "";
      if (!result.response.ok) {
        showError((result.payload && result.payload.error) || "Не удалось войти.");
        return;
      }
      showApp(result.payload);
    });

    document.getElementById("logout").addEventListener("click", async function () {
      await api("/api/admin/logout", { method: "POST", body: {} });
      showLogin();
    });

    document.getElementById("exportBtn").addEventListener("click", async function () {
      const result = await api("/api/admin/leads/export", { method: "POST", body: {} });
      if (!result.response.ok) {
        showError((result.payload && result.payload.error) || "Не удалось выгрузить заявки.");
        return;
      }
      const blob = await result.response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "leads.csv";
      link.click();
      URL.revokeObjectURL(url);
      await loadAudit();
    });

    document.getElementById("userForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      showError("");
      invite.hidden = true;
      const result = await api("/api/admin/users", {
        method: "POST",
        body: {
          login: document.getElementById("newLogin").value,
          role: document.getElementById("newRole").value
        }
      });
      if (!result.response.ok) {
        showError((result.payload && result.payload.error) || "Не удалось создать пользователя.");
        return;
      }
      document.getElementById("newLogin").value = "";
      invite.textContent = "Одноразовая ссылка для " + result.payload.login + ": " + result.payload.setupUrl;
      invite.hidden = false;
      await loadUsers();
      await loadAudit();
    });

    api("/api/admin/session").then(function (result) {
      if (result.response.ok) showApp(result.payload);
    }).catch(function () {});
    `
  );
}

export function setupPageHtml(): string {
  return page(
    "Настройка входа — ТехноЛогистика",
    `
    <p id="status" class="error" hidden></p>
    <h1>Настройка входа</h1>
    <p class="note">Задайте свой пароль и подтвердите код из Яндекс Ключа или Google Authenticator. Пароль никому не сообщайте: сервер его не показывает и не хранит в открытом виде.</p>
    <form id="passwordForm">
      <label>Одноразовый код<input id="code" autocomplete="off" required /></label>
      <label>Новый пароль<input id="password" type="password" autocomplete="new-password" required /></label>
      <label>Пароль ещё раз<input id="passwordConfirm" type="password" autocomplete="new-password" required /></label>
      <button type="submit">Показать код приложения</button>
    </form>
    <section id="totpStep" hidden>
      <p class="note">Отсканируйте код или введите ключ вручную. Затем впишите шестизначный код из приложения.</p>
      <img id="qr" alt="QR-код для приложения-аутентификатора" width="220" height="220" />
      <p id="secret" class="secret"></p>
      <form id="totpForm">
        <label>Код из приложения<input id="totp" inputmode="numeric" autocomplete="one-time-code" required /></label>
        <button type="submit">Завершить и войти</button>
      </form>
    </section>
    `,
    `
    const status = document.getElementById("status");
    const passwordForm = document.getElementById("passwordForm");
    const totpStep = document.getElementById("totpStep");
    const codeInput = document.getElementById("code");
    const params = new URLSearchParams(location.hash.indexOf("#") === 0 ? location.hash.slice(1) : "");
    if (params.get("code")) {
      codeInput.value = params.get("code");
      history.replaceState(null, "", location.pathname);
    }

    function showError(text) {
      status.textContent = text;
      status.hidden = !text;
    }

    passwordForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      showError("");
      const password = document.getElementById("password").value;
      const passwordConfirm = document.getElementById("passwordConfirm").value;
      if (password !== passwordConfirm) {
        showError("Пароли не совпадают.");
        return;
      }
      let response;
      try {
        response = await fetch("/api/admin/setup/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ code: codeInput.value, password: password, passwordConfirm: passwordConfirm })
        });
      } catch (err) {
        showError("Не удалось связаться с сервером.");
        return;
      }
      const payload = await response.json().catch(function () { return {}; });
      document.getElementById("password").value = "";
      document.getElementById("passwordConfirm").value = "";
      if (!response.ok) {
        showError(payload.error || "Не удалось подготовить код.");
        return;
      }
      const img = document.getElementById("qr");
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(payload.qrSvg || "");
      document.getElementById("secret").textContent = payload.secret || "";
      passwordForm.hidden = true;
      totpStep.hidden = false;
    });

    document.getElementById("totpForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      showError("");
      let response;
      try {
        response = await fetch("/api/admin/setup/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ code: codeInput.value, totp: document.getElementById("totp").value })
        });
      } catch (err) {
        showError("Не удалось связаться с сервером.");
        return;
      }
      const payload = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        showError(payload.error || "Не удалось завершить настройку.");
        return;
      }
      location.assign("/admin");
    });
    `
  );
}

function page(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; }
    [hidden] { display: none !important; }
    body { margin: 0; background: #0F1115; color: #F5F7FA; font: 16px/1.5 Inter, system-ui, sans-serif; }
    main { max-width: 1100px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1 { font-size: 1.5rem; letter-spacing: -0.02em; margin: 0; }
    h2 { font-size: 1.15rem; margin: 2rem 0 0.5rem; }
    p.note { color: #AAB3C2; max-width: 46rem; }
    form { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: end; margin: 1.25rem 0; }
    label { display: grid; gap: 0.35rem; color: #AAB3C2; font-size: 0.875rem; }
    input, button, select { font: inherit; border-radius: 4px; }
    input, select { background: #161A20; color: #F5F7FA; border: 1px solid rgba(255,255,255,.15); padding: 0.65rem 0.8rem; min-width: 14rem; }
    button { background: transparent; color: #F5F7FA; border: 1px solid rgba(255,255,255,.25); padding: 0.65rem 1rem; cursor: pointer; }
    .error { color: #f0a8a8; }
    .bar, .bar-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; justify-content: space-between; }
    .bar { margin-bottom: 1rem; }
    .wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { border-bottom: 1px solid rgba(255,255,255,.08); text-align: left; vertical-align: top; padding: 0.55rem 0.45rem; }
    th { color: #AAB3C2; font-weight: 600; }
    img { background: #fff; padding: 8px; border-radius: 4px; }
    .secret { font-family: ui-monospace, monospace; letter-spacing: 0.04em; }
    .invite { white-space: pre-wrap; word-break: break-all; background: #161A20; padding: 0.8rem 1rem; border-radius: 4px; }
    #audit td:last-child { font-family: ui-monospace, monospace; font-size: 0.75rem; max-width: 16rem; word-break: break-all; }
  </style>
</head>
<body>
  <main>
    ${body}
  </main>
  <script>${script}</script>
</body>
</html>`;
}
