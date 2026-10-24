module.exports = {
  apps: [
    {
      name: "whatsapp-crm",
      interpreter: "node",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/index.ts",
      cwd: __dirname,
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
    },
  ],
}
