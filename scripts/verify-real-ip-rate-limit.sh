#!/bin/sh
set -eu

network=${1:?Usage: scripts/verify-real-ip-rate-limit.sh DOCKER_WEB_NETWORK [CADDY_HOST] [ORIGIN]}
caddy_host=${2:-caddy}
origin=${3:?Pass the real HTTPS public origin, for example https://camping.example}
case "$origin" in
  https://*) ;;
  *) echo "ORIGIN must be an HTTPS origin" >&2; exit 2 ;;
esac
site_authority=${origin#https://}
case "$site_authority" in
  ""|*/*|*@*|*\?*|*\#*) echo "ORIGIN must not contain credentials, a path, query or fragment" >&2; exit 2 ;;
esac
case "$site_authority" in
  *:*)
    site_host=${site_authority%%:*}
    site_port=${site_authority##*:}
    ;;
  *)
    site_host=$site_authority
    site_port=443
    ;;
esac
case "$site_host:$site_port" in
  :*|*:*[!0-9]*) echo "ORIGIN contains an invalid host or port" >&2; exit 2 ;;
esac
client_name="camping-drive-rate-client-$$"
curl_image=curlimages/curl:8.16.0

cleanup() {
  docker rm -f "$client_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

client_script='
  i=1
  while [ "$i" -le 10 ]; do
    curl -sk -o /dev/null -w "%{http_code}\n" \
      --connect-to "'"$site_host"':'"$site_port"':'"$caddy_host"':443" \
      -H "Host: '"$site_authority"'" \
      -H "Origin: '"$origin"'" \
      -H "Content-Type: application/json" \
      --data "{\"login\":\"client-a-$i\",\"password\":\"invalid-password-$i\"}" \
      "'"$origin"'/api/auth/login"
    i=$((i + 1))
  done
  sleep 30
'

docker run -d --name "$client_name" --network "$network" --entrypoint sh \
  "$curl_image" -c "$client_script" >/dev/null

attempt=1
while [ "$attempt" -le 20 ]; do
  client_a_codes=$(docker logs "$client_name" 2>/dev/null || true)
  if [ "$(printf '%s\n' "$client_a_codes" | grep -Ec '^[0-9]{3}$')" -ge 10 ]; then
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done

printf '%s\n' "$client_a_codes" | grep -qx 429 || {
  echo "Client A did not reach its own rate limit: $client_a_codes" >&2
  exit 1
}
client_a_error=$(docker exec "$client_name" curl -sk \
  --connect-to "$site_host:$site_port:$caddy_host:443" \
  -H "Host: $site_authority" \
  -H "Origin: $origin" \
  -H "Content-Type: application/json" \
  --data '{"login":"client-a-final","password":"invalid-password-final"}' \
  "$origin/api/auth/login")
printf '%s' "$client_a_error" | grep -q '"code":"RATE_LIMITED"' || {
  echo "Rate-limit response is not the documented JSON error: $client_a_error" >&2
  exit 1
}

client_b_code=$(docker run --rm --network "$network" "$curl_image" \
  -sk -o /dev/null -w "%{http_code}" \
  --connect-to "$site_host:$site_port:$caddy_host:443" \
  -H "Host: $site_authority" \
  -H "Origin: $origin" \
  -H "Content-Type: application/json" \
  --data '{"login":"client-b","password":"invalid-password-b"}' \
  "$origin/api/auth/login")
test "$client_b_code" = 401 || {
  echo "Independent client inherited another IP bucket (HTTP $client_b_code)" >&2
  exit 1
}

echo "Real client IP rate-limit isolation verified"
