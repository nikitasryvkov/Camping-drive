# Развертывание camping.drivebro.ru

Проект подготовлен для сервера `195.209.220.232`. DNS-запись `A` домена `camping.drivebro.ru` уже указывает на этот IP.

## Вариант 1 — полный стек с автоматическим HTTPS

Используйте `compose.yaml`, если порты `80` и `443` на сервере свободны. Стек состоит из:

- `app` — production-сборка React, которую раздает Nginx;
- `caddy` — внешний reverse proxy с автоматическим выпуском и обновлением TLS-сертификата.

### 1. Проверить сервер

```bash
docker --version
docker compose version
sudo ss -ltnp | grep -E ':(80|443)\s' || true
```

Если 80/443 заняты существующим Nginx, Caddy или панелью управления, используйте вариант 2 ниже.

Для автоматического HTTPS должны быть доступны извне TCP-порты 80/443 и UDP-порт 443. Например, при использовании UFW:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
```

### 2. Загрузить проект

Из PowerShell в корне проекта:

```powershell
tar --exclude=node_modules --exclude=dist --exclude=.git --exclude=.asset-source -czf camping-drive.tar.gz .
scp .\camping-drive.tar.gz root@195.209.220.232:/tmp/
ssh root@195.209.220.232
```

На сервере:

```bash
sudo mkdir -p /opt/camping-drive
sudo tar -xzf /tmp/camping-drive.tar.gz -C /opt/camping-drive
cd /opt/camping-drive
```

Файл `.env.local` с ключом Web3Forms должен находиться в `/opt/camping-drive`. Если проект передавался без него:

```bash
cp .env.example .env.local
nano .env.local
```

### 3. Проверить и запустить

```bash
docker compose --env-file .env.local config -q
docker compose --env-file .env.local build --pull
docker compose --env-file .env.local up -d --remove-orphans
docker compose --env-file .env.local ps
```

Проверка:

```bash
curl -I http://camping.drivebro.ru
curl -I https://camping.drivebro.ru
docker compose --env-file .env.local logs --tail=100 app caddy
```

Выпуск сертификата может занять несколько секунд после первого запуска.

## Вариант 2 — на сервере уже есть reverse proxy

Запустите только приложение на локальном порту `8080`:

```bash
docker compose -f compose.app-only.yaml --env-file .env.local config -q
docker compose -f compose.app-only.yaml --env-file .env.local up -d --build
curl -I http://127.0.0.1:8080/healthz
```

В существующем Nginx/Caddy/Traefik направьте домен `camping.drivebro.ru` на `http://127.0.0.1:8080` и настройте TLS в используемом reverse proxy.

## Обновление

Загрузите новые файлы в `/opt/camping-drive`, затем выполните:

```bash
cd /opt/camping-drive
docker compose --env-file .env.local build --pull
docker compose --env-file .env.local up -d --remove-orphans
docker image prune -f
```

## Диагностика

```bash
docker compose --env-file .env.local ps
docker compose --env-file .env.local logs -f --tail=200
docker inspect --format='{{json .State.Health}}' camping-drive-app-1
curl -I http://127.0.0.1/healthz
```

Если Caddy не получает сертификат, сначала проверьте DNS, доступность портов 80/443 и отсутствие другого процесса на этих портах.
