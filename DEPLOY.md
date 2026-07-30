# Запуск и развертывание Camping Drive

Стек состоит из четырех сервисов:

- `frontend` — production-сборка React/Vite под Nginx;
- `backend` — Node.js/Express API;
- `db` — PostgreSQL;
- `caddy` — внешний reverse proxy с автоматическим HTTPS (только в `compose.yaml`).

Данные PostgreSQL хранятся в томе `postgres_data`, изображения — в `uploads_data`. Обычные перезапуски и пересоздание контейнеров эти данные не удаляют. Не запускайте `docker compose down -v`, если тома нужно сохранить.

## Переменные окружения

Создайте локальную конфигурацию из примера:

```bash
cp .env.example .env.local
chmod 600 .env.local
```

Перед развертыванием обязательно задайте разные случайные значения длиной не менее 24 символов для `POSTGRES_PASSWORD` и `APP_DB_PASSWORD`; пустые, шаблонные и одинаковые значения блокируются preflight-проверкой. Production-скрипты принимают только обычный, не являющийся symlink, файл окружения текущего deployment-пользователя с mode `0600` (либо `0400`). Локальный backend использует те же `POSTGRES_DB`, `POSTGRES_USER` и `POSTGRES_PASSWORD`; при необходимости их можно переопределить стандартными переменными `PGDATABASE`, `PGUSER` и `PGPASSWORD`. Файл `.env.local` исключен из Git.

## Локальная разработка

PostgreSQL можно запустить через Docker (он будет доступен только на `127.0.0.1:${PGPORT}`), а frontend и backend — через npm:

```bash
docker compose -f compose.app-only.yaml -f compose.dev.yaml --env-file .env.local up -d db
npm install
```

Затем запустите backend и frontend в двух отдельных терминалах:

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

Vite проксирует `/api` и `/uploads` на `VITE_API_PROXY_TARGET`. Проверка backend:

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/health/ready
```

## Создание администратора

После запуска PostgreSQL создайте учетную запись один раз. Не записывайте пароль
администратора в `.env.local`: передайте его процессу через временные переменные окружения.
Для локального backend:

```bash
read -r -p "Admin login: " ADMIN_LOGIN
read -r -s -p "Admin password: " ADMIN_PASSWORD
export ADMIN_LOGIN ADMIN_PASSWORD
npm run admin:create
unset ADMIN_LOGIN ADMIN_PASSWORD
```

Для уже собранного Docker-стека:

```bash
read -r -p "Admin login: " ADMIN_LOGIN
read -r -s -p "Admin password: " ADMIN_PASSWORD
export ADMIN_LOGIN ADMIN_PASSWORD
sh scripts/compose-mutation.sh admin-create
unset ADMIN_LOGIN ADMIN_PASSWORD
```

Команда не меняет существующую учетную запись и завершится ошибкой при повторении логина.
Страница входа доступна по `/admin/login`, защищенная панель — по `/admin`. Срок сессии
задается `ADMIN_SESSION_TTL_HOURS` и по умолчанию равен 12 часам.
Лимиты изображений задаются `IMAGE_MAX_UPLOAD_MB` (по умолчанию 15)
и `IMAGE_MAX_INPUT_MEGAPIXELS` (по умолчанию 40); `IMAGE_PROCESSING_CONCURRENCY`
ограничивает одновременную тяжёлую обработку значением 1–2 (по умолчанию 1).
Админка получает файловые ограничения из API.

Backend должен получать запросы через два доверенных hop: внешний Caddy/существующий proxy
и frontend Nginx. В обеих Compose-конфигурациях это явно задано как `TRUST_PROXY_HOPS=2`,
чтобы cookie получала `Secure` при исходном HTTPS, а ограничение попыток использовало IP
клиента, а не адрес промежуточного proxy. Если топология прокси изменится, скорректируйте
значение одновременно с проверкой цепочки `X-Forwarded-For`; не доверяйте этому заголовку
при прямой публикации backend в интернет.

## Вариант 1 — полный стек с автоматическим HTTPS

Используйте `compose.yaml`, если внешние порты 80 и 443 свободны. DNS домена из `SITE_DOMAIN` должен указывать на сервер, а TCP 80/443 и UDP 443 должны быть доступны извне.

```bash
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0700 /var/lib/camping-drive/locks
export OPERATIONS_LOCK_ROOT=/var/lib/camping-drive/locks
docker compose --env-file .env.local config -q
# .env.local must contain the green full RELEASE_COMMIT.
sh scripts/compose-mutation.sh build
# Copy the printed hash to RELEASE_MANIFEST_SHA256 in .env.local only after CI approval.
sh scripts/compose-mutation.sh deploy
docker compose --env-file .env.local ps
```

Frontend и backend собираются как две runtime-цели одного `Dockerfile` и используют общий
content-hashed frontend-артефакт. Собирайте оба образа одной командой из одного immutable
checkout и с одним `VITE_SITE_URL`; CI дополнительно сравнивает встроенный `index.html`.
Runtime-роль PostgreSQL принудительно получает `NOINHERIT`, а deployment останавливается,
если эта роль состоит в другой роли PostgreSQL.

Проверка:

```bash
set -a
. ./.env.local
set +a
curl -I "https://${SITE_DOMAIN}/healthz"
curl "https://${SITE_DOMAIN}/api/health/ready"
docker compose --env-file .env.local logs --tail=100 db backend frontend caddy
```

## Вариант 2 — внешний reverse proxy уже существует

`compose.app-only.yaml` запускает PostgreSQL, backend и frontend, публикуя frontend только на `127.0.0.1:${FRONTEND_PORT}` (по умолчанию 8080):

```bash
export OPERATIONS_LOCK_ROOT=/var/lib/camping-drive/locks
docker compose -f compose.app-only.yaml --env-file .env.local config -q
# .env.local must contain the green full RELEASE_COMMIT.
COMPOSE_FILE=compose.app-only.yaml sh scripts/compose-mutation.sh build
# Copy the printed hash to RELEASE_MANIFEST_SHA256 in .env.local only after CI approval.
COMPOSE_FILE=compose.app-only.yaml sh scripts/compose-mutation.sh deploy
set -a
. ./.env.local
set +a
curl "http://127.0.0.1:${FRONTEND_PORT:-8080}/api/health/ready"
```

Направьте существующий Nginx/Caddy/Traefik на `http://127.0.0.1:<FRONTEND_PORT>` (по умолчанию порт 8080).
Внешний proxy обязан перезаписывать, а не слепо сохранять присланные клиентом
`X-Forwarded-For` и `X-Forwarded-Proto`; иначе IP-based ограничения можно обойти подделкой
заголовка. После настройки проверьте два независимых адреса скриптом из `TESTING.md`.

## Обновление и диагностика

Для полного стека:

```bash
sh scripts/compose-mutation.sh build
sh scripts/compose-mutation.sh deploy
docker compose --env-file .env.local ps
docker compose --env-file .env.local logs -f --tail=200 db backend frontend caddy
```

Для варианта с существующим reverse proxy:

```bash
COMPOSE_FILE=compose.app-only.yaml sh scripts/compose-mutation.sh build
COMPOSE_FILE=compose.app-only.yaml sh scripts/compose-mutation.sh deploy
docker compose -f compose.app-only.yaml --env-file .env.local ps
docker compose -f compose.app-only.yaml --env-file .env.local logs -f --tail=200 db backend frontend
```

Пароли владельца БД и runtime-роли меняются раздельно и только общим locked wrapper. Сначала замените соответствующее значение в защищённом `.env.local`, затем передайте прежнее значение через временную переменную текущего процесса:

```bash
read -r -s -p "Previous owner password: " PREVIOUS_POSTGRES_PASSWORD
export PREVIOUS_POSTGRES_PASSWORD
ROTATE_CONFIRM=rotate-owner-password sh scripts/compose-mutation.sh rotate-owner-password
unset PREVIOUS_POSTGRES_PASSWORD

read -r -s -p "Previous runtime password: " PREVIOUS_APP_DB_PASSWORD
export PREVIOUS_APP_DB_PASSWORD
ROTATE_CONFIRM=rotate-runtime-password sh scripts/compose-mutation.sh rotate-runtime-password
unset PREVIOUS_APP_DB_PASSWORD
```

Wrapper удерживает общий operations lock, проверяет старый пароль, меняет роль, проверяет новый пароль и отказ старого, а затем пересоздаёт только затронутый уже работавший consumer из существующего immutable образа (`db` для owner, `backend` для runtime). Он не запускает ранее остановленный Caddy и не возобновляет трафик. После ротации немедленно создайте и проверьте новый backup. Не запускайте `ALTER ROLE`, `\password` или прямой `docker compose up` вне этого wrapper и не удаляйте том ради ротации.

Проверить существование постоянных томов:

```bash
docker volume ls --filter name=camping-drive_postgres_data
docker volume ls --filter name=camping-drive_uploads_data
```

Удаление стека командой `docker compose down` сохраняет тома. Флаг `-v` удаляет их вместе с данными.
# Важно: перед production-развёртыванием

Полный операционный регламент, включая RPO/RTO, согласованный backup БД и uploads, проверку восстановления и rollback, находится в [OPERATIONS.md](./OPERATIONS.md). Production-релиз без проверенного pre-release backup и restore drill запрещён.
