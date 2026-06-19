/**
 * 測試 cache_control 轉發功能（獨立測試，不依賴 TypeScript 路徑別名）
 *
 * 測試所有 transformer 和 converter 中 cache_control 的保留與清除邏輯。
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const distModule = require("./dist/cjs/server.cjs");

// 從 dist 取得可用匯出
const { default: Server, ConfigService, TransformerService, ProviderService } = distModule;

// ─── 測試輔助 ────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, name, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${name}${detail ? " | " + detail : ""}`);
  }
}

function assertDeepEqual(actual, expected, name) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${name}`);
    console.log(`    預期: ${expectedStr}`);
    console.log(`    實際: ${actualStr}`);
  }
}

function section(title) {
  console.log(`\n─── ${title} ───`);
}

// ─── 模擬 ConfigService 來初始化 TransformerService ───────────

// 建立一個 mock config service
const mockConfig = {
  providers: [],
  Router: { default: "claude-sonnet-4-5" },
  PORT: "3000",
  HOST: "127.0.0.1",
  Transformers: {
    anthropic: {},
    cleancache: {},
    groq: {},
    openrouter: {},
    vercel: {},
  },
};

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

// 使用 ConfigService 來讀取設定
// ConfigService 需要 options 參數
const configService = new ConfigService({ initialConfig: mockConfig });
const transformerService = new TransformerService(configService, mockLogger);

// ─── 開始測試前先初始化 transformer ──────────────────────────

await transformerService.initialize();

// 取得所有已註冊的 transformer
const transformers = transformerService.getTransformers();
console.log("已註冊的 transformers:", Object.keys(transformers));

// ─── 單元測試：手動測試核心邏輯 ──────────────────────────────

// 由於 transformer 是透過 TransformerService 動態載入，
// 我們直接測試其核心邏輯（已在上面的手動 review 中證實正確）

// 以下測試重點：
// 1. 驗證 transformer 實例存在
// 2. 驗證 cache_control 在各 transformer 中的保留/清除行為
// 3. 端到端測試

// ─── 測試 1: Transformer 實例 ─────────────────────────────────

section("Transformer 實例存在性");

const anthropicTransformer = transformers["anthropic"];
const cleancacheTransformer = transformers["cleancache"];
const groqTransformer = transformers["groq"];
const openrouterTransformer = transformers["openrouter"];
const vercelTransformer = transformers["vercel"];

assert(anthropicTransformer !== undefined, "1a: AnthropicTransformer 已註冊");
assert(cleancacheTransformer !== undefined, "1b: CleancacheTransformer 已註冊");
assert(groqTransformer !== undefined, "1c: GroqTransformer 已註冊");
assert(openrouterTransformer !== undefined, "1d: OpenrouterTransformer 已註冊");
assert(vercelTransformer !== undefined, "1e: VercelTransformer 已註冊");

assert(typeof anthropicTransformer.transformRequestOut === "function", "1f: AnthropicTransformer 有 transformRequestOut");
assert(typeof anthropicTransformer.transformResponseIn === "function", "1g: AnthropicTransformer 有 transformResponseIn");
assert(typeof cleancacheTransformer.transformRequestIn === "function", "1h: CleancacheTransformer 有 transformRequestIn");
assert(typeof groqTransformer.transformRequestIn === "function", "1i: GroqTransformer 有 transformRequestIn");
assert(typeof openrouterTransformer.transformRequestIn === "function", "1j: OpenrouterTransformer 有 transformRequestIn");
assert(typeof vercelTransformer.transformRequestIn === "function", "1k: VercelTransformer 有 transformRequestIn");

// ─── 測試 2: Anthropic → Unified 轉換 ────────────────────────

section("Anthropic → Unified 轉換 (cache_control 保留)");

{
  const request = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
    system: [
      {
        type: "text",
        text: "You are a helpful assistant",
        cache_control: { type: "ephemeral" },
      },
    ],
  };

  const result = await anthropicTransformer.transformRequestOut(request);

  // system message cache_control
  const sysMsg = result.messages.find((m) => m.role === "system");
  assert(sysMsg !== undefined, "2a: system message 存在");
  if (sysMsg && Array.isArray(sysMsg.content)) {
    const block = sysMsg.content[0];
    assert(
      block?.cache_control?.type === "ephemeral",
      "2b: system content block 的 cache_control 被保留"
    );
  }
}

// ─── 測試 3: Message content block cache_control ─────────────

{
  const request = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "This is a long document",
            cache_control: { type: "ephemeral" },
          },
        ],
      },
    ],
  };

  const result = await anthropicTransformer.transformRequestOut(request);
  const userMsg = result.messages.find((m) => m.role === "user");
  assert(userMsg !== undefined, "3a: user message 存在");
  if (userMsg && Array.isArray(userMsg.content)) {
    assert(
      userMsg.content[0]?.cache_control?.type === "ephemeral",
      "3b: message content block 的 cache_control 被保留"
    );
  }
}

// ─── 測試 4: Tool cache_control ──────────────────────────────

{
  const request = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
    tools: [
      {
        name: "get_weather",
        description: "Get weather",
        input_schema: { type: "object", properties: {} },
        cache_control: { type: "ephemeral", ttl: "3600" },
      },
    ],
  };

  const result = await anthropicTransformer.transformRequestOut(request);
  assert(result.tools !== undefined, "4a: tools 存在");
  if (result.tools) {
    assert(
      result.tools[0]?.cache_control?.type === "ephemeral",
      "4b: tool cache_control.type 被保留"
    );
    assert(
      result.tools[0]?.cache_control?.ttl === "3600",
      "4c: tool cache_control.ttl 被保留"
    );
    assert(
      result.tools[0]?.function.name === "get_weather",
      "4d: tool function name 正確"
    );
  }
}

// ─── 測試 5: Tool result 的 cache_control ────────────────────

{
  const request = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_001",
            content: "result",
            cache_control: { type: "ephemeral" },
          },
        ],
      },
    ],
  };

  const result = await anthropicTransformer.transformRequestOut(request);
  const toolMsg = result.messages.find((m) => m.role === "tool");
  assert(toolMsg !== undefined, "5a: tool message 存在");
  if (toolMsg) {
    assert(
      toolMsg.cache_control?.type === "ephemeral",
      "5b: tool result cache_control 被保留"
    );
  }
}

// ─── 測試 6: 頂層 request cache_control ──────────────────────

{
  const request = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
    cache_control: { type: "ephemeral" },
  };

  const result = await anthropicTransformer.transformRequestOut(request);
  assert(
    result.cache_control?.type === "ephemeral",
    "6a: 頂層 request cache_control 被保留"
  );
}

// ─── 測試 7: CleancacheTransformer ──────────────────────────

section("CleancacheTransformer - 清除 cache_control");

{
  const request = {
    model: "claude-sonnet-4-5",
    messages: [{ role: "user", content: "Hello" }],
    cache_control: { type: "ephemeral" },
    tools: [
      {
        type: "function",
        cache_control: { type: "ephemeral", ttl: "3600" },
        function: { name: "test", description: "test", parameters: {} },
      },
    ],
  };

  const result = await cleancacheTransformer.transformRequestIn(
    JSON.parse(JSON.stringify(request))
  );

  assert(
    result.cache_control === undefined,
    "7a: 頂層 cache_control 被清除"
  );

  if (result.tools) {
    assert(
      result.tools[0]?.cache_control === undefined,
      "7b: tool cache_control 被清除"
    );
  }
}

// ─── 測試 8: Cleancache - content block cache_control ───────

{
  const request = {
    model: "claude-sonnet-4-5",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Hello",
            cache_control: { type: "ephemeral" },
          },
        ],
      },
    ],
    cache_control: { type: "ephemeral" },
  };

  const result = await cleancacheTransformer.transformRequestIn(
    JSON.parse(JSON.stringify(request))
  );

  const msg = result.messages[0];
  if (Array.isArray(msg.content)) {
    assert(
      msg.content[0]?.cache_control === undefined,
      "8a: content block cache_control 被清除"
    );
  }

  assert(result.cache_control === undefined, "8b: 頂層 cache_control 被清除");
}

// ─── 測試 9: Cleancache - message level cache_control ───────

{
  const request = {
    model: "claude-sonnet-4-5",
    messages: [
      { role: "user", content: "Hello", cache_control: { type: "ephemeral" } },
    ],
  };

  const result = await cleancacheTransformer.transformRequestIn(
    JSON.parse(JSON.stringify(request))
  );

  assert(
    result.messages[0].cache_control === undefined,
    "9a: message level cache_control 被清除"
  );
}

// ─── 測試 10: GroqTransformer ────────────────────────────────

section("GroqTransformer - 非 claude 清除 cache_control");

{
  const request = {
    model: "llama-3.3-70b",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Hello",
            cache_control: { type: "ephemeral" },
          },
        ],
      },
    ],
    cache_control: { type: "ephemeral" },
    tools: [
      {
        type: "function",
        cache_control: { type: "ephemeral" },
        function: {
          name: "test",
          description: "test",
          parameters: { $schema: "http://json-schema.org/draft-07/schema#" },
        },
      },
    ],
  };

  const result = await groqTransformer.transformRequestIn(
    JSON.parse(JSON.stringify(request))
  );

  assert(result.cache_control === undefined, "10a: 頂層 cache_control 被清除");

  const msg = result.messages[0];
  if (Array.isArray(msg.content)) {
    assert(
      msg.content[0]?.cache_control === undefined,
      "10b: content block cache_control 被清除"
    );
  }

  if (result.tools) {
    assert(
      result.tools[0]?.cache_control === undefined,
      "10c: tool cache_control 被清除"
    );
    assert(
      result.tools[0]?.function?.parameters?.$schema === undefined,
      "10d: $schema 被清除"
    );
  }
}

// ─── 測試 11: OpenrouterTransformer ──────────────────────────

section("OpenrouterTransformer - claude 保留 / 非 claude 清除");

{
  // 非 claude 模型
  const nonClaudeReq = {
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Hello", cache_control: { type: "ephemeral" } },
        ],
        cache_control: { type: "ephemeral" },
      },
    ],
    cache_control: { type: "ephemeral" },
    tools: [
      {
        type: "function",
        cache_control: { type: "ephemeral" },
        function: { name: "t", description: "", parameters: {} },
      },
    ],
  };

  const nonClaudeResult = await openrouterTransformer.transformRequestIn(
    JSON.parse(JSON.stringify(nonClaudeReq))
  );

  assert(
    nonClaudeResult.cache_control === undefined,
    "11a: 非 claude 頂層 cache_control 被清除"
  );
  assert(
    nonClaudeResult.messages[0].cache_control === undefined,
    "11b: 非 claude message cache_control 被清除"
  );
  if (Array.isArray(nonClaudeResult.messages[0].content)) {
    assert(
      nonClaudeResult.messages[0].content[0]?.cache_control === undefined,
      "11c: 非 claude content block cache_control 被清除"
    );
  }
  if (nonClaudeResult.tools) {
    assert(
      nonClaudeResult.tools[0]?.cache_control === undefined,
      "11d: 非 claude tool cache_control 被清除"
    );
  }
}

{
  // claude 模型
  const claudeReq = {
    model: "anthropic/claude-sonnet-4-5",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Hello", cache_control: { type: "ephemeral" } },
        ],
        cache_control: { type: "ephemeral" },
      },
    ],
    cache_control: { type: "ephemeral" },
    tools: [
      {
        type: "function",
        cache_control: { type: "ephemeral" },
        function: { name: "t", description: "", parameters: {} },
      },
    ],
  };

  const claudeResult = await openrouterTransformer.transformRequestIn(
    JSON.parse(JSON.stringify(claudeReq))
  );

  assert(
    claudeResult.cache_control?.type === "ephemeral",
    "11e: claude 頂層 cache_control 被保留"
  );
  assert(
    claudeResult.messages[0].cache_control?.type === "ephemeral",
    "11f: claude message cache_control 被保留"
  );
  if (Array.isArray(claudeResult.messages[0].content)) {
    assert(
      claudeResult.messages[0].content[0]?.cache_control?.type === "ephemeral",
      "11g: claude content block cache_control 被保留"
    );
  }
  if (claudeResult.tools) {
    assert(
      claudeResult.tools[0]?.cache_control?.type === "ephemeral",
      "11h: claude tool cache_control 被保留"
    );
  }
}

// ─── 測試 12: VercelTransformer ──────────────────────────────

section("VercelTransformer - claude 保留 / 非 claude 清除");

{
  // 非 claude 模型
  const nonClaudeReq = {
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Hello", cache_control: { type: "ephemeral" } },
        ],
        cache_control: { type: "ephemeral" },
      },
    ],
    cache_control: { type: "ephemeral" },
    tools: [
      {
        type: "function",
        cache_control: { type: "ephemeral" },
        function: { name: "t", description: "", parameters: {} },
      },
    ],
  };

  const result = await vercelTransformer.transformRequestIn(
    JSON.parse(JSON.stringify(nonClaudeReq))
  );

  assert(
    result.cache_control === undefined,
    "12a: 非 claude 頂層 cache_control 被清除"
  );
  if (result.tools) {
    assert(
      result.tools[0]?.cache_control === undefined,
      "12b: 非 claude tool cache_control 被清除"
    );
  }
}

{
  // claude 模型
  const claudeReq = {
    model: "claude-sonnet-4-5",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Hello", cache_control: { type: "ephemeral" } },
        ],
        cache_control: { type: "ephemeral" },
      },
    ],
    cache_control: { type: "ephemeral" },
    tools: [
      {
        type: "function",
        cache_control: { type: "ephemeral" },
        function: { name: "t", description: "", parameters: {} },
      },
    ],
  };

  const result = await vercelTransformer.transformRequestIn(
    JSON.parse(JSON.stringify(claudeReq))
  );

  assert(
    result.cache_control?.type === "ephemeral",
    "12c: claude 頂層 cache_control 被保留"
  );
  if (result.tools) {
    assert(
      result.tools[0]?.cache_control?.type === "ephemeral",
      "12d: claude tool cache_control 被保留"
    );
  }
}

// ─── 測試 13: 完整端到端流程 ─────────────────────────────────

section("端到端流程模擬");

{
  // 模擬 Claude Code 發送的典型請求（帶 cache_control）
  const claudeCodeRequest = {
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    stream: true,
    system: [
      {
        type: "text",
        text: "You are an expert programmer.",
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Here is the codebase:",
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: "Please fix the bug in file.ts" },
        ],
      },
    ],
    tools: [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
        },
        cache_control: { type: "ephemeral" },
      },
      {
        name: "write_file",
        description: "Write a file",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
        },
      },
    ],
  };

  // Step 1: Anthropic → Unified
  const unified = await anthropicTransformer.transformRequestOut(
    claudeCodeRequest
  );

  // 檢查 system cache_control
  const systemMsg = unified.messages.find((m) => m.role === "system");
  assert(systemMsg !== undefined, "13a: system message 存在");
  if (systemMsg && Array.isArray(systemMsg.content)) {
    assert(
      systemMsg.content[0]?.cache_control?.type === "ephemeral",
      "13b: system cache_control 保留"
    );
  }

  // 檢查 user content
  const userMsg = unified.messages.find((m) => m.role === "user");
  assert(userMsg !== undefined, "13c: user message 存在");
  if (userMsg && Array.isArray(userMsg.content)) {
    assert(
      userMsg.content[0]?.cache_control?.type === "ephemeral",
      "13d: 第一個 content block 的 cache_control 保留"
    );
    assert(
      userMsg.content[1]?.cache_control === undefined,
      "13e: 第二個 content block 無 cache_control（原請求沒有）"
    );
  }

  // 檢查 tools
  assert(unified.tools !== undefined, "13f: tools 存在");
  if (unified.tools) {
    assert(
      unified.tools[0]?.cache_control?.type === "ephemeral",
      "13g: tool 0 cache_control 保留"
    );
    assert(
      unified.tools[0]?.function.name === "read_file",
      "13h: tool 0 name 正確"
    );
    assert(
      unified.tools[1]?.cache_control === undefined,
      "13i: tool 1 無 cache_control（原請求沒有）"
    );
    assert(
      unified.tools[1]?.function.name === "write_file",
      "13j: tool 1 name 正確"
    );
  }

  // Step 2: 模擬 CleancacheTransformer 清除
  const cleaned = await cleancacheTransformer.transformRequestIn(
    JSON.parse(JSON.stringify(unified))
  );

  assert(
    cleaned.cache_control === undefined,
    "13k: Cleancache 清除了頂層 cache_control"
  );
  if (cleaned.tools) {
    assert(
      cleaned.tools[0]?.cache_control === undefined,
      "13l: Cleancache 清除了 tool 0 cache_control"
    );
  }
  const cleanedSystem = cleaned.messages.find((m) => m.role === "system");
  if (cleanedSystem && Array.isArray(cleanedSystem.content)) {
    assert(
      cleanedSystem.content[0]?.cache_control === undefined,
      "13m: Cleancache 清除了 system content block cache_control"
    );
  }
  const cleanedUser = cleaned.messages.find((m) => m.role === "user");
  if (cleanedUser && Array.isArray(cleanedUser.content)) {
    assert(
      cleanedUser.content[0]?.cache_control === undefined,
      "13n: Cleancache 清除了 user content block cache_control"
    );
  }

  // Step 3: 驗證原始 unified 沒被修改（因為 Cleancache 收到的是 deep clone）
  const originalSystem = unified.messages.find((m) => m.role === "system");
  if (originalSystem && Array.isArray(originalSystem.content)) {
    assert(
      originalSystem.content[0]?.cache_control?.type === "ephemeral",
      "13o: 原始 unified system cache_control 未被 Cleancache 影響"
    );
  }
}

// ─── 測試 14: 多種 cache_control type ────────────────────────

section("多種 cache_control type");

{
  const request = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
    cache_control: { type: "ephemeral", ttl: "1800" },
    tools: [
      {
        name: "test",
        description: "test",
        input_schema: { type: "object" },
        cache_control: { type: "ephemeral", ttl: "7200" },
      },
    ],
  };

  const result = await anthropicTransformer.transformRequestOut(request);

  assert(
    result.cache_control?.type === "ephemeral",
    "14a: 頂層 cache_control.type = ephemeral"
  );
  assert(
    result.cache_control?.ttl === "1800",
    "14b: 頂層 cache_control.ttl = 1800"
  );

  if (result.tools) {
    assert(
      result.tools[0]?.cache_control?.type === "ephemeral",
      "14c: tool cache_control.type = ephemeral"
    );
    assert(
      result.tools[0]?.cache_control?.ttl === "7200",
      "14d: tool cache_control.ttl = 7200"
    );
  }
}

// ─── 結果 ────────────────────────────────────────────────────

console.log(`\n═══════════════════════════════════════════════════`);
console.log(
  `  結果: ${passed} 通過, ${failed} 失敗, 共 ${passed + failed} 項`
);
console.log(`═══════════════════════════════════════════════════`);

if (failed > 0) {
  process.exit(1);
}
