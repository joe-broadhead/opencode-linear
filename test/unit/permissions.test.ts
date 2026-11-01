import { describe, expect, test } from "bun:test"
import { READ_TOOLS } from "../../src/linear-tools.js"
import { defaultRules, evaluate, hasDefaultRules, insertRules, registerDefaultRules, unguardedAgents, type Rule } from "../../src/permissions.js"
import { agentEditor, allow, builtInAgents, transforms, type AgentEditor, type FakeAgent } from "./fake.js"

const ask: Rule = { action: "linear_*", resource: "*", effect: "ask" }
const effects = (rules: readonly Rule[]) => ["linear_list_issues", "linear_get_workspace", "linear_save_issue", "linear_shiny_new_tool"].map((action) => evaluate(rules, action))

describe("defaultRules", () => {
  test("ask for every Linear tool, then allow each known read, and deny nothing", () => {
    const rules = defaultRules()
    expect(rules[0]).toEqual(ask)
    expect(rules.slice(1)).toEqual(READ_TOOLS.map((tool) => ({ action: `linear_${tool}`, resource: "*", effect: "allow" })))
    expect(rules.filter((rule) => rule.effect === "deny")).toEqual([])
  })

  test("reads allow and everything else asks", () => {
    expect(effects([allow("*"), ...defaultRules()])).toEqual(["allow", "allow", "ask", "ask"])
  })
})

describe("insertRules", () => {
  test("splices the rules right after the base allow, before the agent's own rules", () => {
    const [build, plan, explore] = builtInAgents() as [FakeAgent, FakeAgent, FakeAgent]
    const rules = defaultRules()
    for (const agent of [build, plan, explore]) {
      const before = agent.permissions.slice()
      expect(insertRules(agent.permissions, rules)).toBe(true)
      expect(agent.permissions).toEqual([before[0]!, ...rules, ...before.slice(1)])
    }
  })

  test("is idempotent and leaves the user's own linear_* rule alone", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    const once = permissions.slice()
    expect(insertRules(permissions, defaultRules())).toBe(false)
    expect(permissions).toEqual(once)
    const own = [allow("*"), { ...ask }, allow("linear_save_issue")]
    expect(insertRules(own, defaultRules())).toBe(false)
    expect(own).toHaveLength(3)
  })

  test("leaves agents without a base allow untouched and never throws on odd lists", () => {
    for (const permissions of [[], [{ action: "*", resource: "*", effect: "deny" }], [allow("read")]] as Rule[][]) {
      const before = permissions.slice()
      expect(insertRules(permissions, defaultRules())).toBe(false)
      expect(permissions).toEqual(before)
    }
  })

  test("stricter agents stay stricter: Explore's own deny still wins", () => {
    const [, plan, explore] = builtInAgents() as [FakeAgent, FakeAgent, FakeAgent]
    insertRules(explore.permissions, defaultRules())
    expect(effects(explore.permissions)).toEqual(["deny", "deny", "deny", "deny"])
    insertRules(plan.permissions, defaultRules())
    expect(effects(plan.permissions)).toEqual(["allow", "allow", "ask", "ask"])
  })

  test("the user's rules come later and win, both ways", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    permissions.push(allow("linear_save_issue"), { action: "linear_list_*", resource: "*", effect: "deny" })
    expect(effects(permissions)).toEqual(["deny", "allow", "allow", "ask"])
  })
})

describe("registerDefaultRules", () => {
  test("adds the rules to every agent once per rebuild and reports no problem", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules(), (problem) => problems.push(problem))
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      const agents = builtInAgents()
      run(agentEditor(agents))
      for (const agent of agents) expect(agent.permissions.filter((rule) => rule.action === "linear_*")).toHaveLength(1)
    }
    expect(problems).toEqual([undefined, undefined])
  })

  test("never throws; a failure is reported for status", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules(), (problem) => problems.push(problem))
    const broken = { ...agentEditor([]), list: () => { throw new Error("boom") } }
    expect(() => run(broken)).not.toThrow()
    expect(problems).toEqual([
      "RULES_NOT_ADDED: Linear's default permission rules could not be added (boom), so Linear tools may run without asking. Next step: Restart OpenCode.",
    ])
  })
})

describe("unguardedAgents", () => {
  test("names agents where a new Linear tool would run without asking", () => {
    const guarded = [allow("*"), ...defaultRules()]
    const agents = [
      { id: "build", permissions: guarded },
      { id: "reviewer", permissions: [allow("*")] },
      { id: "fixed", permissions: [allow("*"), ...defaultRules(), allow("linear_save_issue")] },
      { id: "other-plugin-first", permissions: [allow("*"), allow("github_*"), ...defaultRules()] },
      { id: "before-base", permissions: [{ ...ask }, allow("*")] },
      { id: "locked", permissions: [allow("*"), { action: "*", resource: "*", effect: "deny" as const }] },
      { id: "asks", permissions: [allow("*"), { action: "linear_*", resource: "*", effect: "deny" as const }] },
    ]
    expect(unguardedAgents(agents)).toEqual(["reviewer", "before-base"])
    expect(hasDefaultRules(guarded)).toBe(true)
  })
})
