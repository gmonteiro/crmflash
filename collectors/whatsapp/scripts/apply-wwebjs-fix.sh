#!/usr/bin/env bash
# Aplica o conserto do getChats() "r: r" (wwebjs/whatsapp-web.js#201910, ainda
# não lançado) na cópia do whatsapp-web.js do coletor e fixa com patch-package.
# Quando sair a versão oficial com o conserto: apagar patches/ e o postinstall.
set -euo pipefail
cd "$(dirname "$0")/.."

gh pr diff 201910 -R wwebjs/whatsapp-web.js > /tmp/wwebjs-201910.diff
grep -q '^diff --git a/src/util/Injected/Utils.js' /tmp/wwebjs-201910.diff
if [ "$(grep -c '^diff --git' /tmp/wwebjs-201910.diff)" != "1" ]; then
  echo "o PR mexe em mais de um arquivo agora; revise antes de aplicar" >&2
  exit 1
fi

(cd node_modules/whatsapp-web.js && patch -p1 --forward < /tmp/wwebjs-201910.diff)
npm install --no-audit --no-fund -D patch-package
npx patch-package whatsapp-web.js
npm pkg set scripts.postinstall="patch-package"

# A sessão levou LOGOUT: apaga para o próximo start mostrar um QR novo.
rm -rf session .wwebjs_cache

grep -q "__getChatModelSafe" node_modules/whatsapp-web.js/src/util/Injected/Utils.js
echo "ok: patch aplicado e fixado em $(ls patches)"
