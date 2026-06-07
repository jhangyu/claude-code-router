/**
 * Custom router for Claude Code Router
 *
 * Routes different business logic scenarios to different LLM providers.
 * Place this path in config.json: "CUSTOM_ROUTER_PATH": "/path/to/custom-router.js"
 *
 * Signature: module.exports = async (req, config, context) => "provider,model"
 */

// ============================================================
// Scenario detectors — ordered by priority (high → low)
// ============================================================

const SCENARIOS = [
  {
    key: "longContext",
    priority: 100,
    detect: (req, config) => {
      const Router = getRouter(config);
      const threshold = Router?.longContextThreshold || 60000;
      const tokenCount = req.tokenCount || 0;
      return tokenCount > threshold && !!Router?.longContext;
    },
  },
  {
    key: "subagentDirect",
    priority: 95,
    detect: (req) => {
      return (
        req.body?.system?.length > 1 &&
        req.body?.system[1]?.text?.startsWith("<CCR-SUBAGENT-MODEL>")
      );
    },
  },
  {
    key: "background",
    priority: 90,
    detect: (req, config) => {
      const Router = getRouter(config);
      return (
        req.body.model?.includes("claude") &&
        req.body.model?.includes("haiku") &&
        !!Router?.background
      );
    },
  },
  {
    key: "architect",
    priority: 80,
    detect: (req, config) => {
      return !!getRouter(config)?.architect && systemMatches(req, [
        /AgentType:\s*architect/i,
        /subagent_type:\s*architect/i,
        /architect.*agent/i,
        /system design.*agent/i,
        /elite AI software architect/i,
        /architecture and system design/i,
        /clean architecture/i,
        /microservices.*pattern/i,
      ]);
    },
  },
  {
    key: "planner",
    priority: 75,
    detect: (req, config) => {
      return !!getRouter(config)?.planner && systemMatches(req, [
        /AgentType:\s*planner/i,
        /subagent_type:\s*planner/i,
        /planning.*specialist/i,
        /software architect.*planning/i,
        /turn.*vague.*implementation.*plan/i,
        /plan mode/i,
      ]);
    },
  },
  {
    key: "debugger",
    priority: 70,
    detect: (req, config) => {
      return !!getRouter(config)?.debugger && systemMatches(req, [
        /AgentType:\s*debugger/i,
        /subagent_type:\s*debugger/i,
        /root.?cause.*investigation/i,
        /debugging.*specialist/i,
        /hypoth.*debug/i,
        /debugger.*agent/i,
        /error.*test.*fail/i,
        /runtime error/i,
      ]);
    },
  },
  {
    key: "reviewer",
    priority: 65,
    detect: (req, config) => {
      return !!getRouter(config)?.reviewer && systemMatches(req, [
        /AgentType:\s*code-reviewer/i,
        /AgentType:\s*security-reviewer/i,
        /subagent_type:\s*reviewer/i,
        /code review.*expert/i,
        /review.*security/i,
        /security audit/i,
        /static analysis/i,
        /comprehensive review/i,
      ]);
    },
  },
  {
    key: "explorer",
    priority: 60,
    detect: (req, config) => {
      return !!getRouter(config)?.explorer && systemMatches(req, [
        /AgentType:\s*explorer/i,
        /AgentType:\s*code-explorer/i,
        /subagent_type:\s*explorer/i,
        /codebase exploration/i,
        /code explorer/i,
        /understand.*feature/i,
        /how.*this.*feature.*work/i,
        /where.*defined/i,
        /which files.*reference/i,
        /locat.*code/i,
        /fast read.?only search/i,
      ]);
    },
  },
  {
    key: "implementer",
    priority: 55,
    detect: (req, config) => {
      return !!getRouter(config)?.implementer && systemMatches(req, [
        /AgentType:\s*implementer/i,
        /AgentType:\s*full-stack-orchestrator/i,
        /subagent_type:\s*implementer/i,
        /feature.*implement/i,
        /write.*code.*implement/i,
        /code.*builder/i,
        /parallel feature build/i,
      ]);
    },
  },
  {
    key: "tester",
    priority: 50,
    detect: (req, config) => {
      return !!getRouter(config)?.tester && systemMatches(req, [
        /AgentType:\s*test-runner/i,
        /AgentType:\s*test-automator/i,
        /AgentType:\s*tdd/i,
        /subagent_type:\s*test/i,
        /test.*automat/i,
        /unit.*integration.*test/i,
        /TDD.*orchestrat/i,
        /test.*fail.*flaky/i,
        /create.*test.*suite/i,
      ]);
    },
  },
  {
    key: "webSearch",
    priority: 40,
    detect: (req, config) => {
      const Router = getRouter(config);
      return (
        Array.isArray(req.body.tools) &&
        req.body.tools.some((t) => t.type?.startsWith("web_search")) &&
        !!Router?.webSearch
      );
    },
  },
  {
    key: "think",
    priority: 30,
    detect: (req, config) => {
      return !!getRouter(config)?.think && req.body.thinking;
    },
  },
];

// ============================================================
// Helpers
// ============================================================

/**
 * Resolves an explicitly specified model from req.body.model.
 *
 * Returns "providerName,modelName" if ALL four conditions are met:
 *   1. req.body.model is a string containing a comma
 *   2. Split on the FIRST comma yields non-empty providerName and modelName
 *   3. providerName exists in config.Providers (or config.providers)
 *   4. modelName exists in that provider's models array
 *
 * Returns null otherwise, letting the existing scenario logic continue.
 *
 * Safety note: Claude Code sends model values like "claude-sonnet-4" or
 * "claude-3-haiku-*" which contain no comma, so they never match condition 1.
 * This means all built-in scenario routing (background, think, longContext, etc.)
 * remains completely unaffected for normal Claude Code requests.
 *
 * Trade-off: when an explicit model IS specified, longContext protection is
 * intentionally bypassed — the user's explicit choice takes precedence.
 */
function resolveExplicitModel(req, config) {
  const raw = req.body?.model;
  if (typeof raw !== "string") return null;

  const commaIdx = raw.indexOf(",");
  if (commaIdx === -1) return null;

  const providerName = raw.slice(0, commaIdx).trim();
  const modelName = raw.slice(commaIdx + 1).trim();
  if (!providerName || !modelName) return null;

  const providers = config?.Providers || config?.providers;
  if (!Array.isArray(providers)) return null;

  const provider = providers.find((p) => p.name === providerName);
  if (!provider) return null;

  if (!Array.isArray(provider.models) || !provider.models.includes(modelName)) return null;

  return `${providerName},${modelName}`;
}

function getRouter(config) {
  // config is the full config from configService.getAll()
  // Router may be at top level or nested
  return config?.Router || config?.router || undefined;
}

function extractTextFromBlock(block) {
  if (!block) return "";
  if (typeof block === "string") return block;
  if (block.type === "text" && typeof block.text === "string") return block.text;
  if (Array.isArray(block.text)) return block.text.map((t) => (typeof t === "string" ? t : "")).join(" ");
  if (typeof block.text === "string") return block.text;
  return "";
}

function getAllSystemText(req) {
  const sys = req.body?.system || [];
  if (typeof sys === "string") return sys;
  if (Array.isArray(sys)) {
    return sys.map((item) => extractTextFromBlock(item)).join("\n");
  }
  return "";
}

function systemMatches(req, patterns) {
  const text = getAllSystemText(req);
  if (!text) return false;
  return patterns.some((p) => p.test(text));
}

function getLog(req) {
  return req.log || console;
}

// ============================================================
// Subagent direct model extraction (strip tag from prompt)
// ============================================================

function extractSubagentModel(req) {
  const system = req.body?.system;
  if (!Array.isArray(system)) return null;

  for (let i = 0; i < system.length; i++) {
    const block = system[i];
    const text = extractTextFromBlock(block);
    if (!text) continue;

    const match = text.match(/<CCR-SUBAGENT-MODEL>(.*?)<\/CCR-SUBAGENT-MODEL>/s);
    if (match) {
      const cleaned = text.replace(`<CCR-SUBAGENT-MODEL>${match[1]}</CCR-SUBAGENT-MODEL>`, "").trim();
      // Write back preserving the original block structure
      if (typeof block === "string") {
        system[i] = cleaned;
      } else if (block.type === "text") {
        if (Array.isArray(block.text)) {
          block.text = cleaned ? [cleaned] : [];
        } else {
          block.text = cleaned;
        }
      }
      return match[1];
    }
  }
  return null;
}

// ============================================================
// Main router function
// ============================================================

module.exports = async function customRouter(req, config, context) {
  try {
    // Priority 0: Explicit model — highest priority, overrides all scenarios.
    // Only fires when req.body.model is a valid "providerName,modelName" pair
    // that exists in the config. Claude Code's own model values (e.g. "claude-sonnet-4")
    // never contain a comma, so this block is never reached for normal CC requests.
    const explicitModel = resolveExplicitModel(req, config);
    if (explicitModel) {
      getLog(req).info(`[custom-router] Explicit model specified → ${explicitModel}`);
      req.scenarioType = "default";
      return explicitModel;
    }

    // Priority 1: Long context
    const longCtx = SCENARIOS.find((s) => s.key === "longContext");
    if (longCtx.detect(req, config)) {
      const model = getRouter(config)?.longContext;
      getLog(req).info(`[custom-router] Long context scenario → ${model} (tokenCount: ${req.tokenCount})`);
      req.scenarioType = "longContext";
      return model;
    }

    // Priority 2: Subagent direct model
    const subagentModel = extractSubagentModel(req);
    if (subagentModel) {
      getLog(req).info(`[custom-router] Subagent direct model → ${subagentModel}`);
      req.scenarioType = "default";
      return subagentModel;
    }

    // Priority 3: Background (haiku)
    const bg = SCENARIOS.find((s) => s.key === "background");
    if (bg.detect(req, config)) {
      const model = getRouter(config)?.background;
      getLog(req).info(`[custom-router] Background scenario → ${model}`);
      req.scenarioType = "background";
      return model;
    }

    // Priority 4+: Detect agent type from system prompt
    // (skip the first 3 built-in scenarios already handled above)
    const agentScenarios = SCENARIOS.filter(
      (s) => !["longContext", "subagentDirect", "background"].includes(s.key)
    );

    for (const scenario of agentScenarios) {
      if (scenario.detect(req, config)) {
        const Router = getRouter(config);
        const model = Router?.[scenario.key];
        if (model) {
          getLog(req).info(`[custom-router] ${scenario.key} scenario → ${model}`);
          req.scenarioType = scenario.key;
          return model;
        }
      }
    }

    // Fallback: use default model
    const defaultModel = getRouter(config)?.default;
    if (defaultModel) {
      getLog(req).info(`[custom-router] Default → ${defaultModel}`);
      req.scenarioType = "default";
      return defaultModel;
    }

    return null;
  } catch (err) {
    getLog(req).error(`[custom-router] Error: ${err.message}`);
    return null;
  }
};
