/** Страница админки без персональных данных в HTML. Список подгружается только после ввода токена. */
export function adminPageHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Заявки — ТехноЛогистика</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #0F1115; color: #F5F7FA; font: 16px/1.5 Inter, system-ui, sans-serif; }
    main { max-width: 1100px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1 { font-size: 1.5rem; letter-spacing: -0.02em; }
    p.note { color: #AAB3C2; max-width: 42rem; }
    form { display: flex; gap: 0.75rem; flex-wrap: wrap; margin: 1.25rem 0; }
    input, button { font: inherit; border-radius: 4px; }
    input { background: #161A20; color: #F5F7FA; border: 1px solid rgba(255,255,255,.15); padding: 0.65rem 0.8rem; min-width: 16rem; }
    button { background: transparent; color: #F5F7FA; border: 1px solid rgba(255,255,255,.25); padding: 0.65rem 1rem; cursor: pointer; }
    .error { color: #f0a8a8; }
    .wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { border-bottom: 1px solid rgba(255,255,255,.08); text-align: left; vertical-align: top; padding: 0.55rem 0.45rem; }
    th { color: #AAB3C2; font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <h1>Заявки</h1>
    <p class="note">Список хранится в базе на этом сервере. Токен не сохраняется в браузере. В Telegram уходит только номер заявки.</p>
    <form id="gate">
      <input id="token" type="password" autocomplete="current-password" placeholder="Токен админки" />
      <button type="submit">Показать заявки</button>
    </form>
    <p id="status" class="error" hidden></p>
    <div class="wrap"><table id="table" hidden>
      <thead>
        <tr>
          <th>№</th><th>Когда</th><th>Имя</th><th>Телефон</th><th>Маршрут</th>
          <th>Авто</th><th>На ходу</th><th>Готовность</th><th>Комментарий</th><th>Согласие</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table></div>
  </main>
  <script>
    const form = document.getElementById("gate");
    const tokenInput = document.getElementById("token");
    const status = document.getElementById("status");
    const table = document.getElementById("table");
    const tbody = table.querySelector("tbody");
    const drive = { yes: "Да, на ходу", no: "Нет, не на ходу", uncertain: "Нужно уточнить" };

    function td(text) {
      const cell = document.createElement("td");
      cell.textContent = text == null || text === "" ? "—" : String(text);
      return cell;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.hidden = true;
      table.hidden = true;
      tbody.replaceChildren();
      const token = tokenInput.value;
      if (!token) return;
      let response;
      try {
        response = await fetch("/api/admin/leads", {
          headers: { Authorization: "Bearer " + token },
        });
      } catch {
        status.textContent = "Не удалось открыть список.";
        status.hidden = false;
        return;
      }
      if (response.status === 401) {
        status.textContent = "Неверный токен.";
        status.hidden = false;
        return;
      }
      if (!response.ok) {
        status.textContent = "Админка не настроена или список недоступен.";
        status.hidden = false;
        return;
      }
      const rows = await response.json();
      for (const row of rows) {
        const tr = document.createElement("tr");
        tr.append(
          td(row.publicId),
          td(row.createdAt),
          td(row.name),
          td(row.phone),
          td((row.from || "") + " → " + (row.to || "")),
          td([row.carModel, row.carYear].filter(Boolean).join(", ")),
          td(drive[row.driveStatus] || row.driveStatus),
          td(row.readyDate),
          td(row.comment),
          td(row.consentAt + " · " + row.consentTextVersion),
        );
        tbody.append(tr);
      }
      if (!rows.length) {
        const tr = document.createElement("tr");
        const cell = td("Заявок пока нет");
        cell.colSpan = 10;
        tr.append(cell);
        tbody.append(tr);
      }
      table.hidden = false;
    });
  </script>
</body>
</html>`;
}
