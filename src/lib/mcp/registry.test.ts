import { describe, it, expect } from "vitest"
import { TOOLS, findTool, toolListPayload } from "./registry"

describe("registry", () => {
  it("não tem nome duplicado", () => {
    const names = TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it("toda tool tem descrição útil", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(30)
    }
  })

  it("acha tool por nome", () => {
    expect(findTool("pipeline_overview")?.name).toBe("pipeline_overview")
    expect(findTool("nao_existe")).toBeUndefined()
  })

  it("serializa o schema em JSON Schema para o tools/list", () => {
    const payload = toolListPayload()
    const overview = payload.find((t) => t.name === "pipeline_overview")

    expect(overview).toBeDefined()
    expect(overview!.inputSchema).toHaveProperty("type", "object")
  })
})

describe("cobertura da spec", () => {
  it("tem as 20 tools da spec", () => {
    expect(TOOLS).toHaveLength(20)
  })
})
