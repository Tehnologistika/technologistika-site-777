# Выкладка: заявки и 152-ФЗ

Этот файл описывает, как включить приём заявок после изменений по персональным данным
и как запускать процесс не от root.
Сайт и базу нужно поднимать на сервере в Российской Федерации (сейчас это VPS Selectel в Москве).
**Отсюда ничего не выкладывается.** Секреты в репозиторий не класть и в логи не печатать.
Скрипты `scripts/deploy.sh` и `scripts/rollback.sh` запускает человек на сервере, не агент.

## Что меняется

1. `POST /api/leads` сначала записывает заявку в SQLite на этом же сервере.
2. Вместе с заявкой сохраняются факт согласия, время сервера, текст отметки и версии документов.
3. Запись старше `LEADS_RETENTION_DAYS` (по умолчанию 183 дня) удаляется из этой базы при старте и далее раз в сутки.
4. Telegram необязателен. Если `TELEGRAM_NOTIFY` не включён, запрос к api.telegram.org не выполняется.
5. Если сигнал включён, после успешной записи уходит только текст `Новая заявка №T-0001, откройте админку`. Имени, телефона, маршрута и комментария в нём нет. Сбой Telegram не отменяет уже сохранённую заявку.
6. Список заявок: `https://технологист.рф/admin`. Вход по личной учётной записи: пароль (scrypt) и одноразовый код из Яндекс Ключа или Google Authenticator. Сессия — cookie `HttpOnly`, `Secure`, `SameSite=Strict` на 12 часов. Общий `ADMIN_TOKEN` по умолчанию не действует.

Копии файла базы в `/var/backups/technologistika/data` хранятся не дольше 30 дней: их удаляет `scripts/deploy.sh` и ежедневный timer. Снимки кода (`dist`) лежат отдельно в `code/` и этим сроком не ограничены. Сам сервер должен находиться в Российской Федерации — это требование политики, его не проверяет код. В файле базы лежат заявки, хеши паролей и секреты TOTP. Права на файл — только у пользователя сервиса.

## Переменные окружения

Скопируйте `.env.example` в `.env` на сервере. Не коммитьте `.env`.

| Переменная | Обязательна | Назначение |
| --- | --- | --- |
| `LEADS_DB_PATH` | нет | Путь к файлу SQLite. По умолчанию `./data/leads.sqlite` от рабочей директории сервиса. Каталог должен попадать в `ReadWritePaths` unit-файла |
| `LEADS_RETENTION_DAYS` | нет | Срок хранения заявок в днях, по умолчанию 183. Допустимо 1–366 |
| `AUDIT_RETENTION_DAYS` | нет | Срок хранения журнала админки в днях, по умолчанию 365. Допустимо 1–3650. Старые строки удаляются вместе с просроченными заявками |
| `AUDIT_IP_PEPPER` | да, для админки | Секрет HMAC-SHA256 для хеша IP в журнале. Не короче 32 символов, не коммитить, не менять без нужды. Без него хеш IP не считается |
| `ADMIN_LEGACY_TOKEN` | нет | Только `true` включает старый общий токен. Любое другое значение, включая пустое и `false`, — выключено |
| `ADMIN_TOKEN` | нет | Секрет старого Bearer. Читается только при `ADMIN_LEGACY_TOKEN=true` и только для просмотра списка |
| `TELEGRAM_NOTIFY` | нет | `true`, `1` или `yes` включает сигнал. Любое другое значение, включая пустое, — выключено |
| `TELEGRAM_BOT_TOKEN` | только при сигнале | Токен бота. В текст сообщения не подставляется |
| `TELEGRAM_LEADS_CHAT_ID` | только при сигнале | Чат, куда уходит номер заявки |
| `PORT` | нет | Порт Express. Оставляйте `3000` |
| `SITE_DOMAIN` | нет | Домен в одноразовой ссылке настройки, например `технологист.рф` |

`NODE_ENV=production` остаётся как в [DEPLOY.md](./DEPLOY.md).

## Роли

- **Владелец** смотрит заявки, удаляет, выгружает CSV и создаёт или отключает учётные записи владельцев и сотрудников.
- **Сотрудник** только смотрит заявки. Удаление, выгрузка и раздел пользователей ему недоступны.
- Пароль задаёт сам человек на странице `/admin/setup`. Команда на сервере пароль не принимает и не печатает.
- Неудачные входы ограничиваются: 5 ошибок подряд блокируют учётную запись на 15 минут, с одного адреса — не больше 30 попыток за 15 минут. В журнал пишется время по Москве, логин и HMAC-SHA256 IP с секретом `AUDIT_IP_PEPPER`, не сам адрес. Журнал хранится `AUDIT_RETENTION_DAYS` дней (по умолчанию 365).

## Node.js

Нужен Node.js 22 (в этом репозитории проверено на 22.23) с встроенным модулем `node:sqlite`.
Модуль всё ещё запускается с флагом:

```bash
node --experimental-sqlite dist/index.js
```

Скрипт `pnpm start` уже добавляет флаг. В unit-файле systemd команда должна быть такой:

```ini
ExecStart=/usr/bin/node --experimental-sqlite dist/index.js
```

Без флага процесс не поднимет базу и не примет заявку. Порт в `.env` — `3000`.

## Пользователь сервиса и unit

Процесс не запускается от root. Ниже команды для человека на сервере.

```bash
sudo useradd --system --user-group --home-dir /var/www/technologistika-site \
  --shell /usr/sbin/nologin --comment "Technologistika site" technologistika

sudo mkdir -p /var/www/technologistika-site/data
sudo chown -R root:technologistika /var/www/technologistika-site
sudo find /var/www/technologistika-site -type d -exec chmod 0750 {} +
sudo find /var/www/technologistika-site -type f -exec chmod 0640 {} +
sudo chown technologistika:technologistika /var/www/technologistika-site/data
sudo chmod 0750 /var/www/technologistika-site/data

# .env уже лежит на сервере и не приезжает из git.
sudo chown root:technologistika /var/www/technologistika-site/.env
sudo chmod 0640 /var/www/technologistika-site/.env

sudo cp /var/www/technologistika-site/deploy/technologistika.service /etc/systemd/system/technologistika.service
sudo systemctl daemon-reload
sudo systemctl enable --now technologistika
sudo systemctl status technologistika --no-pager
```

Если пользователь уже есть, `useradd` повторно не запускайте. Каталог `data` должен существовать до старта: `ProtectSystem=strict` не создаст его сам, а писать процесс может только туда.

Пример unit (он же `deploy/technologistika.service`):

```ini
[Unit]
Description=Technologistika site (Express)
After=network.target

[Service]
Type=simple
User=technologistika
Group=technologistika
WorkingDirectory=/var/www/technologistika-site
EnvironmentFile=/var/www/technologistika-site/.env
Environment=HOME=/tmp
ExecStart=/usr/bin/node --experimental-sqlite dist/index.js
Restart=always
RestartSec=5
UMask=0027
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/www/technologistika-site/data

[Install]
WantedBy=multi-user.target
```

`PORT=3000` берётся из `.env`. Nginx из [DEPLOY.md](./DEPLOY.md) по-прежнему проксирует сайт на `127.0.0.1:3000`. Отдельные `location` для `/api/leads` и `/admin` не нужны.

## Первый владелец

После того как сервис поднялся и база создалась в `data/`:

```bash
cd /var/www/technologistika-site
sudo -u technologistika node --experimental-sqlite dist/admin-cli.js create-owner ivan
```

Команда печатает одноразовую ссылку вида `https://технологист.рф/admin/setup#code=…` и сам код. Их передают владельцу по доверенному каналу, не в общий чат. Ссылка живёт 24 часа. Владелец сам задаёт пароль (от 12 до 128 символов) и подтверждает код из приложения. Пока настройка не закончена, этим логином войти нельзя.

Если человек ещё не завершил настройку, ту же команду можно запустить снова: старая ссылка погаснет, пароль по-прежнему не задаётся скриптом. Если учётная запись уже активна, команда ничего не меняет.

Дальше владельцы создают сотрудников и других владельцев в разделе «Пользователи». Отключить самого себя или последнего активного владельца нельзя.

`ADMIN_LEGACY_TOKEN` оставляйте `false`. Включайте `true` только на короткий переход, если список ещё нужно открыть старым Bearer. В этом режиме токен не удаляет заявки, не выгружает их и не управляет людьми.

## Скрипт выкладки и отката

Оба скрипта рассчитаны на каталог `/var/www/technologistika-site` и unit `technologistika`. Они не печатают `.env` и не придумывают пароль.

Выкладка указанной ревизии (ветка или SHA, которые уже есть на `origin`):

```bash
cd /var/www/technologistika-site
sudo bash scripts/deploy.sh origin/cursor/admin-accounts-totp-e384
```

Скрипт создаёт системного пользователя, если его ещё нет, и кладёт снимок раздельно:

- код для отката — `/var/backups/technologistika/code/<дата>/` (`dist`, ревизия, unit). Этот каталог скрипт очистки не удаляет;
- копия базы — `/var/backups/technologistika/data/<дата>/leads.sqlite`. Не дольше 30 дней.

В конце выкладка сама удаляет копии базы старше 30 дней и включает ежедневный timer:

```bash
sudo cp deploy/technologistika-backup-prune.service deploy/technologistika-backup-prune.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now technologistika-backup-prune.timer
```

`scripts/deploy.sh` делает эти шаги сам. Timer вызывает `scripts/prune-data-backups.sh` каждый день в 03:30. Проверка: `systemctl list-timers technologistika-backup-prune.timer`.

Откат кода к предыдущей выкладке (базу заявок не трогает):

```bash
sudo bash scripts/rollback.sh
```

Снимок можно передать явно: метку `20261118T120000Z` или каталог `code/<дата>`.

**Не используйте `--with-db` без необходимости.** Откат с `--with-db` возвращает файл базы к снимку и тем самым возвращает заявки, которые успели удалить после этого снимка. После такого отката их нужно удалить повторно по журналу (`action=delete`). Скрипт перед подменой базы сохраняет номера из журнала и сразу вызывает:

```bash
node --experimental-sqlite dist/admin-cli.js export-deletes --since <время снимка>
node --experimental-sqlite dist/admin-cli.js replay-deletes <файл-номеров>
```

Если автоматический повтор не прошёл, ту же команду `replay-deletes` запускают вручную. Без файла она берёт все `action=delete` из текущего журнала. Команда не печатает имена и телефоны. Для записи в журнал нужен `AUDIT_IP_PEPPER`.

После отката на ревизию со старым общим токеном снова нужен `ADMIN_TOKEN` в `.env`, как в той ревизии. Новые таблицы в SQLite старый код не мешают.

## Проверка после выкладки

Не используйте настоящие персональные данные в проверке. Достаточно вымышленной заявки.

1. Откройте главную, прокрутите до формы. Кнопка отправки неактивна, пока не отмечено согласие.
2. Отправьте заявку. В ответе `{"ok":true}`. В Telegram при `TELEGRAM_NOTIFY=false` ничего не приходит.
3. Откройте ссылку настройки владельца, задайте пароль и код приложения. В `/admin` должна быть строка заявки и время согласия по Москве.
4. Учётная запись сотрудника открывает тот же список и не показывает удаление и выгрузку. Запрос удаления от её cookie отвечает отказом.
5. Если включаете сигнал, поставьте `TELEGRAM_NOTIFY=true`, перезапустите сервис и отправьте ещё одну заявку. В чате должна быть только фраза с номером `T-….`.
6. В браузере на чистом профиле во вкладке «Сеть» не должно быть запросов к `fonts.googleapis.com`, `fonts.gstatic.com`, `cloudfront.net` и `api.telegram.org` при открытии страницы. `api.telegram.org` допустим только на сервере и только после записи в базу, если сигнал включён.
7. `systemctl show technologistika -p User -p Group` показывает `technologistika`, не `root`.

Файл базы содержит персональные данные. Не копируйте его в тикет, чат и git.

## Что остаётся на собственнике

Регистрационный номер в реестре операторов на страницах Политики и Согласия: 77-26-578756 (приказ Роскомнадзора от 05.11.2026 № 641). Политика, согласие и политика cookie утверждены генеральным директором 18.11.2026; номер внутреннего приказа не указан. Персональные данные клиентов перевозчикам не передаются.

Контактный email для обращений по персональным данным на страницах — Technologistika07@yandex.ru.

Политика по-прежнему описывает цель 2 так, как она указана в уведомлении (ФИО, телефон, email). Форма и текст согласия шире: маршрут и сведения об автомобиле. До 15.12.2026 нужно либо сузить форму, либо подать в Роскомнадзор информационное письмо. Это решение собственника, код его не принимает.
