# Проверки проекта

Этап 9 запускается одной командой из корня проекта:

```bash
npm run test:stage9
```

Перед первым запуском установите Chromium для Playwright:

```bash
npx playwright install chromium
```

Команда `test:stage9` поднимает изолированный PostgreSQL на `127.0.0.1:55432`, выполняет backend unit- и integration-тесты, реальные browser E2E-сценарии для desktop и mobile, затем production-сборку. В конце временная база и тестовые загрузки удаляются. Для запуска нужны Docker и свободные порты `3010`, `5181`, `55431` (локальная блокировка), `55432`. Одновременный второй запуск блокируется, чтобы процессы не делили одну test-БД.

Без отдельной test-БД самостоятельно запускаются только unit-тесты и сборка:

```bash
npm run test:backend
npm run build
```

Команды `npm run test:backend:integration` и `npm run test:e2e` предназначены для оркестратора `test:stage9`: напрямую они требуют уже запущенный PostgreSQL, полный набор `PG*`-переменных и базу, имя которой заканчивается на `_test`. Для обычной проверки используйте `npm run test:stage9`, чтобы lifecycle и очистка выполнялись автоматически.

После сборки образов с тегом `scan` CI дополнительно выполняет disaster-recovery smoke tests:

```bash
sh scripts/dr-smoke-test.sh
DR_COMPOSE_FILE=compose.yaml sh scripts/dr-smoke-test.sh
```

Первый прогон поднимает отдельный app-only стек, второй проверяет managed-edge/Caddy. Они проверяют project-lock и обнаружение изменённой metadata,
создаёт backup, затем удаляет стек вместе с volumes и все использованные теги образов. Exact restore
выполняется только из извлечённого cold-host bundle и архива образов: проверяются dump, роли/ACL,
media-manifest, очистка восстановленных административных сессий, исчезновение контрольной
post-backup таблицы и готовность `/healthz`. Это same-daemon cold-tag simulation; обязательный ежемесячный empty-VM cold-host drill описан в `OPERATIONS.md`. На Linux-хосте требуется `flock` из util-linux. Для ручной проверки full-stack
real-IP rate limiting после запуска Compose используйте:

```bash
sh scripts/verify-real-ip-rate-limit.sh <compose-project>_web caddy https://your-public-origin
```
