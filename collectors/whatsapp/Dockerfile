FROM node:22-slim
RUN apt-get update && apt-get install -y chromium ca-certificates --no-install-recommends && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
# O coletor importa o contrato e a normalização do CRM: o contexto do build é a raiz do crmflash.
COPY src/lib/whatsapp/contract.ts src/lib/whatsapp/contract.ts
COPY src/lib/identity/normalize.ts src/lib/identity/normalize.ts
COPY collectors/whatsapp/package.json collectors/whatsapp/package-lock.json collectors/whatsapp/
RUN cd collectors/whatsapp && npm ci
COPY collectors/whatsapp/ collectors/whatsapp/
WORKDIR /app/collectors/whatsapp
# normalize.ts (em /app/src) resolve o libphonenumber-js daqui.
ENV NODE_PATH=/app/collectors/whatsapp/node_modules
ENV WA_SESSION_PATH=/data/session WA_STATE_PATH=/data/state.json
CMD ["npx", "tsx", "src/index.ts"]
