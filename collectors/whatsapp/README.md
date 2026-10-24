# Coletor de WhatsApp do CRM Flash

Lê o seu WhatsApp, **só leitura**, e manda para o CRM apenas as conversas que você confirmou como comerciais. Roda no seu PC, como dispositivo vinculado, ao lado do `whatsapp-obsidian`.

## O que sai do PC, e o que não sai

| | Vai para o CRM? |
|---|---|
| Conversa que não casa com ninguém do CRM (família, amigos) | **Não.** Nem é lida |
| Contato com nome salvo igual ao de alguém do CRM | Só **nome e número**, como caso na fila |
| Grupo com nome de empresa do funil, ou com contato confirmado | Só **nome do grupo**, como caso na fila |
| Conversa ou grupo que você confirmou na fila | As mensagens do dia (texto, ≤ 4.000 caracteres) |

O coletor nunca envia mensagem, não marca como lida e não manda confirmação de leitura. O teste `src/readonly-guard.test.ts` falha se algum método que escreve no WhatsApp aparecer no código.

## Instalar (uma vez)

```powershell
cd $HOME\Documents\crmflash          # a raiz do repo: normalize.ts usa o libphonenumber-js daqui
npm install
node scripts/whatsapp-collector-token.mjs   # grava o token no .env do coletor e mostra só o hash
cd collectors\whatsapp
npm install
copy .env.example .env               # se ainda não existir; o token já está lá
```

No `.env`, preencha `WHATSAPP_INTERNAL_PHONES` com os telefones da Lumeis (com DDI, separados por vírgula). O seu entra sozinho.

Na Vercel, `WHATSAPP_COLLECTOR_TOKEN_SHA256` recebe o hash que o script mostrou.

## Parear

```powershell
npm start
```

Abra http://localhost:3011 e, no celular: WhatsApp → Dispositivos conectados → Conectar dispositivo. A sessão fica em `./session` e não pede QR de novo.

## Deixar ligado

- **pm2:** `pm2 start ecosystem.config.cjs; pm2 save`
- **Sem pm2:** copie um atalho de `start-hidden.vbs` para a pasta Inicializar (`Win+R` → `shell:startup`). O log vai para `collector.log`.

O ciclo roda a cada 5 minutos. Com o PC desligado não se perde nada: ao subir, ele busca o que falta.

## A fila

Os casos aparecem no claude.ai (conector CRMFlash): `list_identity_reviews`, depois `resolve_identity`.

- Contato: `link_person`, ou `ignore` se não for comercial.
- Grupo: `link_company` / `create_company`, ou `ignore`.

O caso não volta. No ciclo seguinte, a conversa confirmada sobe com os últimos 30 dias.

## Opção B: na nuvem

O `Dockerfile` é construído a partir da **raiz do crmflash**, porque o coletor importa o contrato e a normalização do CRM:

```bash
docker build -f collectors/whatsapp/Dockerfile -t whatsapp-crm .
```

Monte um volume em `/data` (sessão e estado) e passe as mesmas variáveis do `.env`. O `NODE_PATH` do Dockerfile faz `normalize.ts` achar o `libphonenumber-js`.
