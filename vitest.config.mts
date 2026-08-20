import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    // Mesmo alias do tsconfig — sem isto os imports "@/..." não resolvem nos testes.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Só lógica pura por enquanto (derivações do pipeline). Componentes React
    // precisariam de jsdom + testing-library, que não estão instalados.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
