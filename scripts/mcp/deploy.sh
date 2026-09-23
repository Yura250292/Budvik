#!/bin/bash
# Деплой MCP-сервісу budvik-mcp у Railway.
#
# Чому не просто `railway up`: Railway для нових сервісів ігнорує railway.json
# (Config as Code оголошено застарілим, шлях до конфігу через API вже не
# ставиться) і збирає за замовчуванням — `npm run build`, тобто весь сайт Next,
# а стартує `npm start`. Тож вивантажуємо знімок закоміченого коду, у якому
# build/start package.json переписані на MCP. Репозиторій не змінюється,
# воркер обміну з 1С не зачіпається.
#
#   bash scripts/mcp/deploy.sh          # з кореня репозиторію, після railway login
#
# Деплоїться HEAD (закомічене), а не робоче дерево.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
PROJECT=f2f8cb78-4633-455e-9b63-da911f121394
ENV_ID=1f6b7883-b62c-4362-a1c7-1e3bdfae629f
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Знімок $(git -C "$ROOT" rev-parse --short HEAD) → $TMP"
git -C "$ROOT" archive --format=tar HEAD | tar -x -C "$TMP"
rm -f "$TMP/railway.json"
node -e '
const fs = require("fs");
const f = process.argv[1] + "/package.json";
const p = JSON.parse(fs.readFileSync(f, "utf8"));
p.scripts.build = "prisma generate && npm run mcp:build";
p.scripts.start = "node dist/mcp.cjs";
fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
' "$TMP"

cd "$TMP"
railway link --project "$PROJECT" --environment "$ENV_ID" --service budvik-mcp >/dev/null
railway up --service budvik-mcp --detach
echo "Перевірка: curl https://mcp.budvik27.com/healthz"
