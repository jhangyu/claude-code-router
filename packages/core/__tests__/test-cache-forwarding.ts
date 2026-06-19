/**
 * 測試 cache_control 轉發功能
 *
 * 測試範圍：
 * 1. AnthropicTransformer - Anthropic 請求 → UnifiedChatRequest（保留 cache_control）
 * 2. CleancacheTransformer - 清除所有 cache_control
 * 3. GroqTransformer - 對非 claude 模型清除 cache_control
 * 4. OpenrouterTransformer - claude 模型保留 / 非 claude 清除
 * 5. VercelTransformer - claude 模型保留 / 非 claude 清除
 * 6. Converter - convertToolsToOpenAI / convertToolsToAnthropic
 * 7. Converter - convertToolsFromOpenAI / convertToolsFromAnthropic
 */

import { AnthropicTransformer } from "./src/transformer/anthropic.transformer";
import { CleancacheTransformer } from "./src/transformer/cleancache.transformer";
import { GroqTransformer } from "./src/transformer/groq.transformer";
import { OpenrouterTransformer } from "./src/transformer/openrouter.transformer";
import { VercelTransformer } from "./src/transformer/vercel.transformer";
import {
  convertToolsToOpenAI,
  convertToolsToAnthropic,
  convertToolsFromOpenAI,
  convertToolsFromAnthropic,
  convertToOpenAI,
} from "./src/utils/converter";
import type { UnifiedChatRequest, UnifiedTool } from "./src/types/llm";

// ─── 測試輔助 ────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${name}${detail ? ` | ${detail}` : ""}`);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, name: string): void {
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

function section(title: string): void {
  console.log(`\n─── ${title} ───`);
}

// ─── 測試 1: AnthropicTransformer（Anthropic 請求 → Unified） ───

async function testAnthropicTransformer() {
  section("AnthropicTransformer - Anthropic → Unified");

  const transformer = new AnthropicTransformer();

  // 1a: 基本請求層 cache_control
  {
    const anthropicRequest = {
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

    const result = await transformer.transformRequestOut(anthropicRequest);

    assert(
      result.cache_control === undefined,
      "1a-1: 頂層 request 無 cache_control（Anthropic 請求不帶頂層 cache_control）"
    );

    // 檢查 system message 中的 content block 的 cache_control
    const systemMsg = result.messages.find((m) => m.role === "system");
    assert(
      systemMsg !== undefined,
      "1a-2: system message 存在"
    );
    if (systemMsg && Array.isArray(systemMsg.content)) {
      const textBlock = systemMsg.content[0] as any;
      assert(
        textBlock?.cache_control?.type === "ephemeral",
        "1a-3: system content block 的 cache_control 被保留"
      );
    }
  }

  // 1b: 帶有頂層 cache_control 的請求（模擬 Anthropic API 格式）
  {
    const anthropicRequest = {
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

    const result = await transformer.transformRequestOut(anthropicRequest);
    const userMsg = result.messages.find((m) => m.role === "user");
    assert(userMsg !== undefined, "1b-1: user message 存在");
    if (userMsg && Array.isArray(userMsg.content)) {
      const textBlock = userMsg.content[0] as any;
      assert(
        textBlock?.cache_control?.type === "ephemeral",
        "1b-2: message content block 的 cache_control 被保留"
      );
    }
  }

  // 1c: Tool 的 cache_control
  {
    const anthropicRequest = {
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

    const result = await transformer.transformRequestOut(anthropicRequest);
    assert(result.tools !== undefined, "1c-1: tools 存在");
    if (result.tools) {
      assert(
        result.tools[0]?.cache_control?.type === "ephemeral",
        "1c-2: tool cache_control.type 被保留"
      );
      assert(
        result.tools[0]?.cache_control?.ttl === "3600",
        "1c-3: tool cache_control.ttl 被保留"
      );
    }
  }

  // 1d: Tool result 的 cache_control
  {
    const anthropicRequest = {
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

    const result = await transformer.transformRequestOut(anthropicRequest);
    const toolMsg = result.messages.find((m) => m.role === "tool");
    assert(toolMsg !== undefined, "1d-1: tool message 存在");
    if (toolMsg) {
      assert(
        toolMsg.cache_control?.type === "ephemeral",
        "1d-2: tool result cache_control 被保留"
      );
    }
  }

  // 1e: system 為 string 時
  {
    const anthropicRequest = {
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
      system: "You are a helpful assistant",
    };

    const result = await transformer.transformRequestOut(anthropicRequest);
    const systemMsg = result.messages.find((m) => m.role === "system");
    assert(
      typeof systemMsg?.content === "string",
      "1e: system string 被正確轉換"
    );
  }

  // 1f: Request 自帶頂層 cache_control
  {
    const anthropicRequest = {
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
      cache_control: { type: "ephemeral" },
    };

    const result = await transformer.transformRequestOut(anthropicRequest);
    assert(
      result.cache_control?.type === "ephemeral",
      "1f: 頂層 request cache_control 被保留"
    );
  }
}

// ─── 測試 2: CleancacheTransformer ────────────────────────────

async function testCleancacheTransformer() {
  section("CleancacheTransformer - 清除 cache_control");

  const transformer = new CleancacheTransformer();

  // 2a: 頂層 cache_control
  {
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "Hello" }],
      cache_control: { type: "ephemeral" },
    };

    const result = await transformer.transformRequestIn(request);
    assert(
      result.cache_control === undefined,
      "2a: 頂層 cache_control 被清除"
    );
  }

  // 2b: message content block cache_control
  {
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4-5",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Hello",
              cache_control: { type: "ephemeral" },
            } as any,
          ],
        },
      ],
      cache_control: { type: "ephemeral" },
    };

    const result = await transformer.transformRequestIn(request);
    const userMsg = result.messages[0];
    if (Array.isArray(userMsg.content)) {
      const block = userMsg.content[0] as any;
      assert(
        block.cache_control === undefined,
        "2b: message content block cache_control 被清除"
      );
    }
  }

  // 2c: message level cache_control
  {
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4-5",
      messages: [
        {
          role: "user",
          content: "Hello",
          cache_control: { type: "ephemeral" },
        },
      ],
    };

    const result = await transformer.transformRequestIn(request);
    assert(
      result.messages[0].cache_control === undefined,
      "2c: message 層級 cache_control 被清除"
    );
  }

  // 2d: tool cache_control
  {
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "Hello" }],
      tools: [
        {
          type: "function",
          cache_control: { type: "ephemeral", ttl: "3600" },
          function: {
            name: "test",
            description: "test",
            parameters: {},
          },
        },
      ],
    };

    const result = await transformer.transformRequestIn(request);
    assert(result.tools !== undefined, "2d-1: tools 仍然存在");
    if (result.tools) {
      assert(
        result.tools[0].cache_control === undefined,
        "2d-2: tool cache_control 被清除"
      );
    }
  }
}

// ─── 測試 3: GroqTransformer ──────────────────────────────────

async function testGroqTransformer() {
  section("GroqTransformer - 非 claude 清除 cache_control");

  const transformer = new GroqTransformer();

  const request: UnifiedChatRequest = {
    model: "llama-3.3-70b",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Hello",
            cache_control: { type: "ephemeral" },
          } as any,
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
          parameters: {} as any,
        },
      },
    ],
  };

  const result = await transformer.transformRequestIn(request);

  assert(
    result.cache_control === undefined,
    "3a: 頂層 cache_control 被清除"
  );
  const userMsg = result.messages[0];
  if (Array.isArray(userMsg.content)) {
    assert(
      (userMsg.content[0] as any).cache_control === undefined,
      "3b: content block cache_control 被清除"
    );
  }
  if (result.tools) {
    assert(
      result.tools[0].cache_control === undefined,
      "3c: tool cache_control 被清除"
    );
    assert(
      (result.tools[0].function.parameters as any)?.$schema === undefined,
      "3d: $schema 被清除"
    );
  }
}

// ─── 測試 4: OpenrouterTransformer ────────────────────────────

async function testOpenrouterTransformer() {
  section("OpenrouterTransformer - claude 保留 / 非 claude 清除");

  const transformer = new OpenrouterTransformer();

  // 4a: 非 claude 模型 → 清除 cache_control
  {
    const request: UnifiedChatRequest = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Hello",
              cache_control: { type: "ephemeral" },
            } as any,
          ],
          cache_control: { type: "ephemeral" },
        },
      ],
      cache_control: { type: "ephemeral" },
      tools: [
        {
          type: "function",
          cache_control: { type: "ephemeral" },
          function: { name: "t", description: "", parameters: {} as any },
        },
      ],
    };

    const result = await transformer.transformRequestIn(
      JSON.parse(JSON.stringify(request))
    );

    assert(
      result.cache_control === undefined,
      "4a-1: 非 claude 頂層 cache_control 被清除"
    );
    const msg = result.messages[0];
    assert(
      msg.cache_control === undefined,
      "4a-2: 非 claude message cache_control 被清除"
    );
    if (Array.isArray(msg.content)) {
      assert(
        (msg.content[0] as any).cache_control === undefined,
        "4a-3: 非 claude content block cache_control 被清除"
      );
    }
    if (result.tools) {
      assert(
        result.tools[0].cache_control === undefined,
        "4a-4: 非 claude tool cache_control 被清除"
      );
    }
  }

  // 4b: claude 模型 → 保留 cache_control
  {
    const request: UnifiedChatRequest = {
      model: "anthropic/claude-sonnet-4-5",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Hello",
              cache_control: { type: "ephemeral" },
            } as any,
          ],
          cache_control: { type: "ephemeral" },
        },
      ],
      cache_control: { type: "ephemeral" },
      tools: [
        {
          type: "function",
          cache_control: { type: "ephemeral" },
          function: { name: "t", description: "", parameters: {} as any },
        },
      ],
    };

    const result = await transformer.transformRequestIn(
      JSON.parse(JSON.stringify(request))
    );

    assert(
      result.cache_control?.type === "ephemeral",
      "4b-1: claude 頂層 cache_control 被保留"
    );
    const msg = result.messages[0];
    assert(
      msg.cache_control?.type === "ephemeral",
      "4b-2: claude message cache_control 被保留"
    );
    if (Array.isArray(msg.content)) {
      assert(
        (msg.content[0] as any).cache_control?.type === "ephemeral",
        "4b-3: claude content block cache_control 被保留"
      );
    }
    if (result.tools) {
      assert(
        result.tools[0].cache_control?.type === "ephemeral",
        "4b-4: claude tool cache_control 被保留"
      );
    }
  }
}

// ─── 測試 5: VercelTransformer ────────────────────────────────

async function testVercelTransformer() {
  section("VercelTransformer - claude 保留 / 非 claude 清除");

  const transformer = new VercelTransformer();

  // 5a: 非 claude → 清除
  {
    const request: UnifiedChatRequest = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Hello",
              cache_control: { type: "ephemeral" },
            } as any,
          ],
          cache_control: { type: "ephemeral" },
        },
      ],
      cache_control: { type: "ephemeral" },
      tools: [
        {
          type: "function",
          cache_control: { type: "ephemeral" },
          function: { name: "t", description: "", parameters: {} as any },
        },
      ],
    };

    const result = await transformer.transformRequestIn(
      JSON.parse(JSON.stringify(request))
    );

    assert(
      result.cache_control === undefined,
      "5a-1: 非 claude 頂層 cache_control 被清除"
    );
    if (result.tools) {
      assert(
        result.tools[0].cache_control === undefined,
        "5a-2: 非 claude tool cache_control 被清除"
      );
    }
  }

  // 5b: claude → 保留
  {
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4-5",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Hello",
              cache_control: { type: "ephemeral" },
            } as any,
          ],
          cache_control: { type: "ephemeral" },
        },
      ],
      cache_control: { type: "ephemeral" },
      tools: [
        {
          type: "function",
          cache_control: { type: "ephemeral" },
          function: { name: "t", description: "", parameters: {} as any },
        },
      ],
    };

    const result = await transformer.transformRequestIn(
      JSON.parse(JSON.stringify(request))
    );

    assert(
      result.cache_control?.type === "ephemeral",
      "5b-1: claude 頂層 cache_control 被保留"
    );
    if (result.tools) {
      assert(
        result.tools[0].cache_control?.type === "ephemeral",
        "5b-2: claude tool cache_control 被保留"
      );
    }
  }
}

// ─── 測試 6: Converter - Tools ────────────────────────────────

function testConverterTools() {
  section("Converter - Tools cache_control");

  // 6a: convertToolsToOpenAI
  {
    const unifiedTools: UnifiedTool[] = [
      {
        type: "function",
        cache_control: { type: "ephemeral", ttl: "3600" },
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object" } as any,
        },
      },
      {
        type: "function",
        function: {
          name: "get_time",
          description: "Get time",
          parameters: { type: "object" } as any,
        },
      },
    ];

    const openaiTools = convertToolsToOpenAI(unifiedTools);

    assert(
      (openaiTools[0] as any).cache_control?.type === "ephemeral",
      "6a-1: OpenAI tool 保留 cache_control.type"
    );
    assert(
      (openaiTools[0] as any).cache_control?.ttl === "3600",
      "6a-2: OpenAI tool 保留 cache_control.ttl"
    );
    assert(
      (openaiTools[1] as any).cache_control === undefined,
      "6a-3: 無 cache_control 的 tool 不會被添加 cache_control"
    );
  }

  // 6b: convertToolsToAnthropic
  {
    const unifiedTools: UnifiedTool[] = [
      {
        type: "function",
        cache_control: { type: "ephemeral" },
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object" } as any,
        },
      },
    ];

    const anthropicTools = convertToolsToAnthropic(unifiedTools);

    assert(
      (anthropicTools[0] as any).cache_control?.type === "ephemeral",
      "6b-1: Anthropic tool 保留 cache_control"
    );
    assert(
      anthropicTools[0].name === "get_weather",
      "6b-2: tool name 正確"
    );
    assert(
      (anthropicTools[0] as any).input_schema?.type === "object",
      "6b-3: input_schema 正確"
    );
  }

  // 6c: convertToolsFromOpenAI
  {
    const openaiTools = [
      {
        type: "function" as const,
        cache_control: { type: "ephemeral", ttl: "7200" },
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object" },
        },
      },
    ];

    const unifiedTools = convertToolsFromOpenAI(openaiTools as any);

    assert(
      unifiedTools[0].cache_control?.type === "ephemeral",
      "6c-1: 從 OpenAI 轉換保留 cache_control.type"
    );
    assert(
      unifiedTools[0].cache_control?.ttl === "7200",
      "6c-2: 從 OpenAI 轉換保留 cache_control.ttl"
    );
    assert(
      unifiedTools[0].type === "function",
      "6c-3: tool type 正確"
    );
  }

  // 6d: convertToolsFromAnthropic
  {
    const anthropicTools = [
      {
        name: "get_weather",
        description: "Get weather",
        input_schema: { type: "object" },
        cache_control: { type: "ephemeral" },
      },
    ];

    const unifiedTools = convertToolsFromAnthropic(anthropicTools as any);

    assert(
      unifiedTools[0].cache_control?.type === "ephemeral",
      "6d-1: 從 Anthropic 轉換保留 cache_control"
    );
    assert(
      unifiedTools[0].function.name === "get_weather",
      "6d-2: function name 正確"
    );
  }
}

// ─── 測試 7: 完整端到端流程模擬 ──────────────────────────────

async function testEndToEnd() {
  section("端到端流程模擬");

  const anthropicTransformer = new AnthropicTransformer();

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
          {
            type: "text",
            text: "Please fix the bug in file.ts",
          },
        ],
      },
    ],
    tools: [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } } },
        cache_control: { type: "ephemeral" },
      },
      {
        name: "write_file",
        description: "Write a file",
        input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
      },
    ],
  };

  // Step 1: Anthropic → Unified
  const unified = await anthropicTransformer.transformRequestOut(claudeCodeRequest);

  // 檢查 system cache_control
  const systemMsg = unified.messages.find((m) => m.role === "system");
  assert(systemMsg !== undefined, "E2E-1: system message 存在");
  if (systemMsg && Array.isArray(systemMsg.content)) {
    const block = systemMsg.content[0] as any;
    assert(
      block?.cache_control?.type === "ephemeral",
      "E2E-2: system cache_control 保留"
    );
  }

  // 檢查 user content cache_control
  const userMsg = unified.messages.find((m) => m.role === "user");
  assert(userMsg !== undefined, "E2E-3: user message 存在");
  if (userMsg && Array.isArray(userMsg.content)) {
    const firstBlock = userMsg.content[0] as any;
    assert(
      firstBlock?.cache_control?.type === "ephemeral",
      "E2E-4: user content block 0 cache_control 保留"
    );
    const secondBlock = userMsg.content[1] as any;
    assert(
      secondBlock?.cache_control === undefined,
      "E2E-5: user content block 1 無 cache_control（原請求就沒有）"
    );
  }

  // 檢查 tools cache_control
  assert(unified.tools !== undefined, "E2E-6: tools 存在");
  if (unified.tools) {
    assert(
      unified.tools[0]?.cache_control?.type === "ephemeral",
      "E2E-7: tool 0 cache_control 保留"
    );
    assert(
      unified.tools[0]?.function.name === "read_file",
      "E2E-8: tool 0 name 正確"
    );
    assert(
      unified.tools[1]?.cache_control === undefined,
      "E2E-9: tool 1 無 cache_control（原請求就沒有）"
    );
    assert(
      unified.tools[1]?.function.name === "write_file",
      "E2E-10: tool 1 name 正確"
    );
  }

  // Step 2: Unified → OpenAI（模擬發送到 OpenAI 兼容 provider）
  const openaiRequest = convertToOpenAI(unified);

  assert(
    openaiRequest.model === "claude-sonnet-4-5",
    "E2E-11: model 正確傳遞"
  );

  if (openaiRequest.tools) {
    assert(
      (openaiRequest.tools[0] as any).cache_control?.type === "ephemeral",
      "E2E-12: OpenAI 格式 tool 0 cache_control 保留"
    );
    assert(
      (openaiRequest.tools[1] as any).cache_control === undefined,
      "E2E-13: OpenAI 格式 tool 1 無 cache_control"
    );
  }

  // Step 3: 模擬 CleancacheTransformer 清除（禁用 cache 時的場景）
  const cleanTransformer = new CleancacheTransformer();
  const cleaned = await cleanTransformer.transformRequestIn(
    JSON.parse(JSON.stringify(unified))
  );

  assert(
    cleaned.cache_control === undefined,
    "E2E-14: Cleancache 清除了頂層 cache_control"
  );
  if (cleaned.tools) {
    assert(
      cleaned.tools[0]?.cache_control === undefined,
      "E2E-15: Cleancache 清除了 tool 0 cache_control"
    );
  }
  const cleanedUserMsg = cleaned.messages.find((m) => m.role === "user");
  if (cleanedUserMsg && Array.isArray(cleanedUserMsg.content)) {
    assert(
      (cleanedUserMsg.content[0] as any).cache_control === undefined,
      "E2E-16: Cleancache 清除了 content block cache_control"
    );
  }

  // Step 4: Convert tools to Anthropic format（模擬發送到 Anthropic provider）
  if (unified.tools) {
    const anthropicTools = convertToolsToAnthropic(unified.tools);
    assert(
      (anthropicTools[0] as any).cache_control?.type === "ephemeral",
      "E2E-17: Anthropic 格式 tool 0 cache_control 保留"
    );
    assert(
      (anthropicTools[1] as any).cache_control === undefined,
      "E2E-18: Anthropic 格式 tool 1 無 cache_control"
    );
  }

  // Step 5: Round-trip OpenAI tools → unified → OpenAI
  if (openaiRequest.tools) {
    const roundTripUnified = convertToolsFromOpenAI(openaiRequest.tools as any);
    const roundTripOpenAI = convertToolsToOpenAI(roundTripUnified);

    assert(
      (roundTripOpenAI[0] as any).cache_control?.type === "ephemeral",
      "E2E-19: Round-trip OpenAI → Unified → OpenAI: cache_control 保留"
    );
    assert(
      (roundTripOpenAI[1] as any).cache_control === undefined,
      "E2E-20: Round-trip: 無 cache_control 的 tool 不受影響"
    );
  }

  // Step 6: Round-trip Anthropic tools → unified → Anthropic
  if (unified.tools) {
    const anthropicTools = convertToolsToAnthropic(unified.tools);
    const roundTripUnified = convertToolsFromAnthropic(anthropicTools as any);
    const roundTripAnthropic = convertToolsToAnthropic(roundTripUnified);

    assert(
      (roundTripAnthropic[0] as any).cache_control?.type === "ephemeral",
      "E2E-21: Round-trip Anthropic → Unified → Anthropic: cache_control 保留"
    );
    assert(
      (roundTripAnthropic[1] as any).cache_control === undefined,
      "E2E-22: Round-trip: 無 cache_control 的 tool 不受影響"
    );
  }
}

// ─── 執行所有測試 ────────────────────────────────────────────

async function main() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║   Claude Code Router - cache_control 轉發測試     ║");
  console.log("╚════════════════════════════════════════════════════╝");

  await testAnthropicTransformer();
  testConverterTools();
  await testCleancacheTransformer();
  await testGroqTransformer();
  await testOpenrouterTransformer();
  await testVercelTransformer();
  await testEndToEnd();

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  結果: ${passed} 通過, ${failed} 失敗, 共 ${passed + failed} 項`);
  console.log(`═══════════════════════════════════════════════════`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("測試執行錯誤:", err);
  process.exit(1);
});
