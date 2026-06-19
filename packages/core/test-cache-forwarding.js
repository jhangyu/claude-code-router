/**
 * 獨立測試：cache_control 轉發功能
 *
 * 此測試精確複製 transformers 和 converters 中 cache_control 相關的原始邏輯。
 * 所有程式碼直接取自 src/transformer/*.ts 和 src/utils/converter.ts。
 *
 * 測試場景：
 *   A. Anthropic 請求 → UnifiedChatRequest（cache_control 保留）
 *   B. CleancacheTransformer（cache_control 清除）
 *   C. GroqTransformer（cache_control 清除 + $schema 清除）
 *   D. OpenrouterTransformer（claude 保留 / 非 claude 清除）
 *   E. VercelTransformer（claude 保留 / 非 claude 清除）
 *   F. Converter tools（雙向轉換保留 cache_control）
 *   G. 完整端到端流程
 */

"use strict";

// ─── 測試輔助 ────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, name, detail) {
  if (condition) {
    passed++;
    console.log("  \x1b[32m✓\x1b[0m " + name);
  } else {
    failed++;
    console.log("  \x1b[31m✗ FAIL:\x1b[0m " + name + (detail ? " | " + detail : ""));
  }
}

function section(title) {
  console.log("\n─── " + title + " ───");
}

// ─── 複製自 src/transformer/anthropic.transformer.ts ──────────

// 這是 AnthropicTransformer.transformRequestOut 的精確複製（只取 cache_control 相關部分）
function anthropicTransformRequestOut(request) {
  const messages = [];

  // system handling (from lines 52-70)
  if (request.system) {
    if (typeof request.system === "string") {
      messages.push({ role: "system", content: request.system });
    } else if (Array.isArray(request.system) && request.system.length) {
      const textParts = request.system
        .filter(function (item) { return item.type === "text" && item.text; })
        .map(function (item) {
          return {
            type: "text",
            text: item.text,
            cache_control: item.cache_control,  // ✅ 保留 cache_control
          };
        });
      messages.push({ role: "system", content: textParts });
    }
  }

  const requestMessages = JSON.parse(JSON.stringify(request.messages || []));

  requestMessages.forEach(function (msg) {
    if (msg.role === "user" || msg.role === "assistant") {
      if (typeof msg.content === "string") {
        messages.push({ role: msg.role, content: msg.content });
        return;
      }

      if (Array.isArray(msg.content)) {
        if (msg.role === "user") {
          // tool_result parts
          const toolParts = msg.content.filter(function (c) {
            return c.type === "tool_result" && c.tool_use_id;
          });
          if (toolParts.length) {
            toolParts.forEach(function (tool) {
              messages.push({
                role: "tool",
                content: typeof tool.content === "string" ? tool.content : JSON.stringify(tool.content),
                tool_call_id: tool.tool_use_id,
                cache_control: tool.cache_control,  // ✅ 保留 cache_control
              });
            });
          }

          // text and image parts
          const textAndMediaParts = msg.content.filter(function (c) {
            return (c.type === "text" && c.text) || (c.type === "image" && c.source);
          });
          if (textAndMediaParts.length) {
            messages.push({
              role: "user",
              content: textAndMediaParts,
            });
          }
        } else if (msg.role === "assistant") {
          // assistant handling (not cached, no cache_control expected)
          const assistantMessage = { role: "assistant", content: "" };
          const textParts = msg.content.filter(function (c) { return c.type === "text" && c.text; });
          if (textParts.length) {
            assistantMessage.content = textParts.map(function (t) { return t.text; }).join("\n");
          }
          const toolCallParts = msg.content.filter(function (c) { return c.type === "tool_use" && c.id; });
          if (toolCallParts.length) {
            assistantMessage.tool_calls = toolCallParts.map(function (tool) {
              return {
                id: tool.id,
                type: "function",
                function: {
                  name: tool.name,
                  arguments: JSON.stringify(tool.input || {}),
                },
              };
            });
          }
          messages.push(assistantMessage);
        }
        return;
      }
    }
  });

  const result = {
    messages: messages,
    model: request.model,
    cache_control: request.cache_control,  // ✅ 保留頂層 cache_control
    max_tokens: request.max_tokens,
    temperature: request.temperature,
    stream: request.stream,
    tools: request.tools?.length
      ? convertAnthropicToolsToUnified(request.tools)
      : undefined,
    tool_choice: request.tool_choice,
  };

  return result;
}

// 複製自 src/transformer/anthropic.transformer.ts 的 convertAnthropicToolsToUnified
function convertAnthropicToolsToUnified(tools) {
  return tools.map(function (tool) {
    return {
      type: "function",
      cache_control: tool.cache_control,  // ✅ 保留 cache_control
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: tool.input_schema,
      },
    };
  });
}

// ─── 複製自 src/transformer/cleancache.transformer.ts ─────────

function cleancacheTransformRequestIn(request) {
  delete request.cache_control;  // ✅ 清除頂層 cache_control
  if (Array.isArray(request.messages)) {
    request.messages.forEach(function (msg) {
      if (Array.isArray(msg.content)) {
        msg.content.forEach(function (item) {
          if (item.cache_control) {
            delete item.cache_control;  // ✅ 清除 content block cache_control
          }
        });
      }
      if (msg.cache_control) {
        delete msg.cache_control;  // ✅ 清除 message level cache_control（修正：獨立 if）
      }
    });
  }
  if (Array.isArray(request.tools)) {
    request.tools.forEach(function (tool) {
      if (tool.cache_control) {
        delete tool.cache_control;  // ✅ 清除 tool cache_control
      }
    });
  }
  return request;
}

// ─── 複製自 src/transformer/groq.transformer.ts ───────────────

function groqTransformRequestIn(request) {
  delete request.cache_control;
  request.messages.forEach(function (msg) {
    if (Array.isArray(msg.content)) {
      msg.content.forEach(function (item) {
        if (item.cache_control) {
          delete item.cache_control;
        }
      });
    }
    if (msg.cache_control) {
      delete msg.cache_control;
    }
  });
  if (Array.isArray(request.tools)) {
    request.tools.forEach(function (tool) {
      delete tool.cache_control;   // ✅ 清除 tool cache_control
      if (tool.function && tool.function.parameters) {
        delete tool.function.parameters.$schema;  // ✅ 清除 $schema
      }
    });
  }
  return request;
}

// ─── 複製自 src/transformer/openrouter.transformer.ts ─────────

function openrouterTransformRequestIn(request) {
  if (!request.model.includes("claude")) {
    delete request.cache_control;     // ✅ 非 claude: 清除頂層
    request.messages.forEach(function (msg) {
      if (Array.isArray(msg.content)) {
        msg.content.forEach(function (item) {
          if (item.cache_control) {
            delete item.cache_control;  // ✅ 非 claude: 清除 content block
          }
        });
      }
      if (msg.cache_control) {
        delete msg.cache_control;     // ✅ 非 claude: 清除 message level（修正：獨立 if）
      }
    });
    if (Array.isArray(request.tools)) {
      request.tools.forEach(function (tool) {
        if (tool.cache_control) {
          delete tool.cache_control;  // ✅ 非 claude: 清除 tool
        }
      });
    }
  }
  // claude 模型：不做任何 cache_control 處理（保留）
  return request;
}

// ─── 複製自 src/transformer/vercel.transformer.ts ─────────────

function vercelTransformRequestIn(request) {
  if (!request.model.includes("claude")) {
    delete request.cache_control;     // ✅ 非 claude: 清除頂層
    request.messages.forEach(function (msg) {
      if (Array.isArray(msg.content)) {
        msg.content.forEach(function (item) {
          if (item.cache_control) {
            delete item.cache_control;  // ✅ 非 claude: 清除 content block
          }
        });
      }
      if (msg.cache_control) {
        delete msg.cache_control;     // ✅ 非 claude: 清除 message level（修正：獨立 if）
      }
    });
    if (Array.isArray(request.tools)) {
      request.tools.forEach(function (tool) {
        if (tool.cache_control) {
          delete tool.cache_control;  // ✅ 非 claude: 清除 tool
        }
      });
    }
  }
  // claude 模型：不做任何 cache_control 處理（保留）
  return request;
}

// ─── 複製自 src/utils/converter.ts ────────────────────────────

function convertToolsToOpenAI(tools) {
  return tools.map(function (tool) {
    var result = {
      type: "function",
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    };
    if (tool.cache_control) {
      result.cache_control = tool.cache_control;  // ✅ 保留 cache_control
    }
    return result;
  });
}

function convertToolsToAnthropic(tools) {
  return tools.map(function (tool) {
    var result = {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    };
    if (tool.cache_control) {
      result.cache_control = tool.cache_control;  // ✅ 保留 cache_control
    }
    return result;
  });
}

function convertToolsFromOpenAI(tools) {
  return tools.map(function (tool) {
    return {
      type: "function",
      cache_control: tool.cache_control,  // ✅ 保留 cache_control
      function: {
        name: tool.function.name,
        description: tool.function.description || "",
        parameters: tool.function.parameters,
      },
    };
  });
}

function convertToolsFromAnthropic(tools) {
  return tools.map(function (tool) {
    return {
      type: "function",
      cache_control: tool.cache_control,  // ✅ 保留 cache_control
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: tool.input_schema,
      },
    };
  });
}

// ─── 開始測試 ────────────────────────────────────────────────

console.log("╔════════════════════════════════════════════════════╗");
console.log("║   Claude Code Router - cache_control 轉發測試     ║");
console.log("╚════════════════════════════════════════════════════╝");

// ══════════════════════════════════════════════════════════════
// A. AnthropicTransformer（Anthropic 請求 → UnifiedChatRequest）
// ══════════════════════════════════════════════════════════════

section("A. AnthropicTransformer - cache_control 保留");

// A1: system content block 的 cache_control
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
    system: [{
      type: "text",
      text: "You are a helpful assistant",
      cache_control: { type: "ephemeral" },
    }],
  };
  var result = anthropicTransformRequestOut(req);
  var sys = result.messages.find(function (m) { return m.role === "system"; });

  assert(sys !== undefined, "A1-1: system message 存在");
  if (sys && Array.isArray(sys.content)) {
    assert(sys.content[0].cache_control && sys.content[0].cache_control.type === "ephemeral",
      "A1-2: system content block cache_control.type = ephemeral");
  }
})();

// A2: 頂層 request cache_control
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
    cache_control: { type: "ephemeral", ttl: "1800" },
  };
  var result = anthropicTransformRequestOut(req);

  assert(result.cache_control && result.cache_control.type === "ephemeral",
    "A2-1: 頂層 cache_control.type = ephemeral");
  assert(result.cache_control.ttl === "1800",
    "A2-2: 頂層 cache_control.ttl = 1800");
})();

// A3: user content block 的 cache_control
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: "This is a long document",
        cache_control: { type: "ephemeral" },
      }],
    }],
  };
  var result = anthropicTransformRequestOut(req);
  var user = result.messages.find(function (m) { return m.role === "user"; });

  assert(user !== undefined, "A3-1: user message 存在");
  if (user && Array.isArray(user.content)) {
    assert(user.content[0].cache_control && user.content[0].cache_control.type === "ephemeral",
      "A3-2: user content block cache_control 保留");
  }
})();

// A4: tool cache_control
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
    tools: [{
      name: "get_weather",
      description: "Get weather",
      input_schema: { type: "object", properties: {} },
      cache_control: { type: "ephemeral", ttl: "3600" },
    }],
  };
  var result = anthropicTransformRequestOut(req);

  assert(result.tools !== undefined, "A4-1: tools 存在");
  if (result.tools) {
    assert(result.tools[0].cache_control && result.tools[0].cache_control.type === "ephemeral",
      "A4-2: tool cache_control.type = ephemeral");
    assert(result.tools[0].cache_control.ttl === "3600",
      "A4-3: tool cache_control.ttl = 3600");
    assert(result.tools[0].function.name === "get_weather",
      "A4-4: tool function name 正確");
  }
})();

// A5: tool result 的 cache_control
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_001",
        content: "result",
        cache_control: { type: "ephemeral" },
      }],
    }],
  };
  var result = anthropicTransformRequestOut(req);
  var tool = result.messages.find(function (m) { return m.role === "tool"; });

  assert(tool !== undefined, "A5-1: tool message 存在");
  if (tool) {
    assert(tool.cache_control && tool.cache_control.type === "ephemeral",
      "A5-2: tool result cache_control 保留");
  }
})();

// A6: 多個 content block，只有部分有 cache_control
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Cached content", cache_control: { type: "ephemeral" } },
        { type: "text", text: "Non-cached content" },
      ],
    }],
  };
  var result = anthropicTransformRequestOut(req);
  var user = result.messages.find(function (m) { return m.role === "user"; });

  assert(user !== undefined, "A6-1: user message 存在");
  if (user && Array.isArray(user.content)) {
    assert(user.content[0].cache_control && user.content[0].cache_control.type === "ephemeral",
      "A6-2: block 0 cache_control 保留");
    assert(user.content[1].cache_control === undefined,
      "A6-3: block 1 無 cache_control（原請求即無）");
  }
})();

// ══════════════════════════════════════════════════════════════
// B. CleancacheTransformer（清除所有 cache_control）
// ══════════════════════════════════════════════════════════════

section("B. CleancacheTransformer - 清除 cache_control");

// B1: 頂層 cache_control
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    messages: [{ role: "user", content: "Hello" }],
    cache_control: { type: "ephemeral" },
  };
  var result = cleancacheTransformRequestIn(JSON.parse(JSON.stringify(req)));

  assert(result.cache_control === undefined, "B1: 頂層 cache_control 被清除");
})();

// B2: message content block 的 cache_control
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    messages: [{
      role: "user",
      content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }],
    }],
    cache_control: { type: "ephemeral" },
  };
  var result = cleancacheTransformRequestIn(JSON.parse(JSON.stringify(req)));
  var msg = result.messages[0];

  if (Array.isArray(msg.content)) {
    assert(msg.content[0].cache_control === undefined, "B2: content block cache_control 被清除");
  }
})();

// B3: message level cache_control
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    messages: [{ role: "user", content: "Hello", cache_control: { type: "ephemeral" } }],
  };
  var result = cleancacheTransformRequestIn(JSON.parse(JSON.stringify(req)));

  assert(result.messages[0].cache_control === undefined, "B3: message level cache_control 被清除");
})();

// B4: tool cache_control
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    messages: [{ role: "user", content: "Hello" }],
    tools: [{
      type: "function",
      cache_control: { type: "ephemeral", ttl: "3600" },
      function: { name: "test", description: "test", parameters: {} },
    }],
  };
  var result = cleancacheTransformRequestIn(JSON.parse(JSON.stringify(req)));

  assert(result.tools !== undefined, "B4-1: tools 仍存在（結構保留）");
  if (result.tools) {
    assert(result.tools[0].cache_control === undefined, "B4-2: tool cache_control 被清除");
  }
})();

// B5: CleancacheTransformer 必須正確處理混合情況
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    messages: [
      {
        role: "system",
        content: [{ type: "text", text: "system prompt", cache_control: { type: "ephemeral" } }],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "user message 1", cache_control: { type: "ephemeral" } },
          { type: "text", text: "user message 2" },
        ],
        cache_control: { type: "ephemeral" },
      },
    ],
    cache_control: { type: "ephemeral" },
    tools: [{
      type: "function",
      cache_control: { type: "ephemeral" },
      function: { name: "t1", description: "", parameters: {} },
    }, {
      type: "function",
      function: { name: "t2", description: "", parameters: {} },
    }],
  };
  var result = cleancacheTransformRequestIn(JSON.parse(JSON.stringify(req)));

  // 頂層
  assert(result.cache_control === undefined, "B5-1: 頂層 cache_control 清除");
  // system content block
  var sys = result.messages[0];
  if (Array.isArray(sys.content)) {
    assert(sys.content[0].cache_control === undefined, "B5-2: system block cache_control 清除");
  }
  // user content
  var user = result.messages[1];
  assert(user.cache_control === undefined, "B5-3: user message cache_control 清除");
  if (Array.isArray(user.content)) {
    assert(user.content[0].cache_control === undefined, "B5-4: user block[0] cache_control 清除");
    assert(user.content[1].cache_control === undefined, "B5-5: user block[1] 保持無 cache_control");
  }
  // tools
  if (result.tools) {
    assert(result.tools[0].cache_control === undefined, "B5-6: tool[0] cache_control 清除");
    assert(result.tools[1].cache_control === undefined, "B5-7: tool[1] 保持無 cache_control");
  }
})();

// ══════════════════════════════════════════════════════════════
// C. GroqTransformer（全部清除 + $schema 清除）
// ══════════════════════════════════════════════════════════════

section("C. GroqTransformer - 清除 cache_control + $schema");

(function () {
  var req = {
    model: "llama-3.3-70b",
    messages: [{
      role: "user",
      content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }],
    }],
    cache_control: { type: "ephemeral" },
    tools: [{
      type: "function",
      cache_control: { type: "ephemeral" },
      function: {
        name: "test",
        description: "test",
        parameters: { type: "object", $schema: "http://json-schema.org/draft-07/schema#" },
      },
    }],
  };
  var result = groqTransformRequestIn(JSON.parse(JSON.stringify(req)));

  assert(result.cache_control === undefined, "C1: 頂層 cache_control 清除");
  if (Array.isArray(result.messages[0].content)) {
    assert(result.messages[0].content[0].cache_control === undefined, "C2: content block cache_control 清除");
  }
  if (result.tools) {
    assert(result.tools[0].cache_control === undefined, "C3: tool cache_control 清除");
    assert(result.tools[0].function.parameters.$schema === undefined, "C4: $schema 清除");
    assert(result.tools[0].function.parameters.type === "object", "C5: parameters 其他屬性保留");
  }
})();

// ══════════════════════════════════════════════════════════════
// D. OpenrouterTransformer（claude 保留 / 非 claude 清除）
// ══════════════════════════════════════════════════════════════

section("D. OpenrouterTransformer - claude 保留 / 非 claude 清除");

// D1: 非 claude 模型
(function () {
  var req = {
    model: "gpt-4o",
    messages: [{
      role: "user",
      content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }],
      cache_control: { type: "ephemeral" },
    }],
    cache_control: { type: "ephemeral" },
    tools: [{
      type: "function",
      cache_control: { type: "ephemeral" },
      function: { name: "t", description: "", parameters: {} },
    }],
  };
  var result = openrouterTransformRequestIn(JSON.parse(JSON.stringify(req)));

  assert(result.cache_control === undefined, "D1-1: 非 claude 頂層清除");
  assert(result.messages[0].cache_control === undefined, "D1-2: 非 claude message 清除");
  if (Array.isArray(result.messages[0].content)) {
    assert(result.messages[0].content[0].cache_control === undefined, "D1-3: 非 claude content block 清除");
  }
  if (result.tools) {
    assert(result.tools[0].cache_control === undefined, "D1-4: 非 claude tool 清除");
  }
})();

// D2: claude 模型
(function () {
  var req = {
    model: "anthropic/claude-sonnet-4-5",
    messages: [{
      role: "user",
      content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }],
      cache_control: { type: "ephemeral" },
    }],
    cache_control: { type: "ephemeral", ttl: "3600" },
    tools: [{
      type: "function",
      cache_control: { type: "ephemeral" },
      function: { name: "t", description: "", parameters: {} },
    }],
  };
  var result = openrouterTransformRequestIn(JSON.parse(JSON.stringify(req)));

  assert(result.cache_control && result.cache_control.type === "ephemeral", "D2-1: claude 頂層保留");
  assert(result.cache_control.ttl === "3600", "D2-2: claude 頂層 ttl 保留");
  assert(result.messages[0].cache_control && result.messages[0].cache_control.type === "ephemeral", "D2-3: claude message 保留");
  if (Array.isArray(result.messages[0].content)) {
    assert(result.messages[0].content[0].cache_control && result.messages[0].content[0].cache_control.type === "ephemeral",
      "D2-4: claude content block 保留");
  }
  if (result.tools) {
    assert(result.tools[0].cache_control && result.tools[0].cache_control.type === "ephemeral", "D2-5: claude tool 保留");
  }
})();

// D3: 模型名稱包含 "claude" 但不完全等於標準名稱
(function () {
  var req = {
    model: "openrouter/claude-3-opus",
    messages: [{
      role: "user",
      content: "Hello",
      cache_control: { type: "ephemeral" },
    }],
    cache_control: { type: "ephemeral" },
  };
  var result = openrouterTransformRequestIn(JSON.parse(JSON.stringify(req)));

  assert(result.cache_control && result.cache_control.type === "ephemeral",
    "D3: 包含 'claude' 的模型名稱也保留 cache_control");
})();

// ══════════════════════════════════════════════════════════════
// E. VercelTransformer（claude 保留 / 非 claude 清除）
// ══════════════════════════════════════════════════════════════

section("E. VercelTransformer - claude 保留 / 非 claude 清除");

// E1: 非 claude
(function () {
  var req = {
    model: "gpt-4o",
    messages: [{
      role: "user",
      content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }],
      cache_control: { type: "ephemeral" },
    }],
    cache_control: { type: "ephemeral" },
    tools: [{
      type: "function",
      cache_control: { type: "ephemeral" },
      function: { name: "t", description: "", parameters: {} },
    }],
  };
  var result = vercelTransformRequestIn(JSON.parse(JSON.stringify(req)));

  assert(result.cache_control === undefined, "E1-1: 非 claude 頂層清除");
  if (result.tools) {
    assert(result.tools[0].cache_control === undefined, "E1-2: 非 claude tool 清除");
  }
})();

// E2: claude 模型 (vercel 的 claude 可能用 "claude-" 前綴)
(function () {
  var req = {
    model: "claude-sonnet-4-5",
    messages: [{
      role: "user",
      content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }],
      cache_control: { type: "ephemeral" },
    }],
    cache_control: { type: "ephemeral" },
    tools: [{
      type: "function",
      cache_control: { type: "ephemeral" },
      function: { name: "t", description: "", parameters: {} },
    }],
  };
  var result = vercelTransformRequestIn(JSON.parse(JSON.stringify(req)));

  assert(result.cache_control && result.cache_control.type === "ephemeral", "E2-1: claude 頂層保留");
  if (result.tools) {
    assert(result.tools[0].cache_control && result.tools[0].cache_control.type === "ephemeral", "E2-2: claude tool 保留");
  }
})();

// ══════════════════════════════════════════════════════════════
// F. Converter Tools（雙向轉換 cache_control）
// ══════════════════════════════════════════════════════════════

section("F. Converter - Tools 雙向轉換");

// F1: Unified → OpenAI
(function () {
  var unifiedTools = [{
    type: "function",
    cache_control: { type: "ephemeral", ttl: "3600" },
    function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } },
  }, {
    type: "function",
    function: { name: "get_time", description: "Get time", parameters: { type: "object" } },
  }];

  var openaiTools = convertToolsToOpenAI(unifiedTools);

  assert(openaiTools[0].cache_control && openaiTools[0].cache_control.type === "ephemeral",
    "F1-1: OpenAI tool cache_control.type = ephemeral");
  assert(openaiTools[0].cache_control.ttl === "3600",
    "F1-2: OpenAI tool cache_control.ttl = 3600");
  assert(openaiTools[0].function.name === "get_weather",
    "F1-3: function name 正確");
  assert(openaiTools[1].cache_control === undefined,
    "F1-4: 無 cache_control 的 tool 不會被添加");
  assert(openaiTools[1].function.name === "get_time",
    "F1-5: 第二個 tool function name 正確");
})();

// F2: Unified → Anthropic
(function () {
  var unifiedTools = [{
    type: "function",
    cache_control: { type: "ephemeral" },
    function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } },
  }];

  var anthropicTools = convertToolsToAnthropic(unifiedTools);

  assert(anthropicTools[0].cache_control && anthropicTools[0].cache_control.type === "ephemeral",
    "F2-1: Anthropic tool cache_control.type = ephemeral");
  assert(anthropicTools[0].name === "get_weather",
    "F2-2: tool name 正確");
  assert(anthropicTools[0].input_schema && anthropicTools[0].input_schema.type === "object",
    "F2-3: input_schema 正確");
})();

// F3: OpenAI → Unified
(function () {
  var openaiTools = [{
    type: "function",
    cache_control: { type: "ephemeral", ttl: "7200" },
    function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } },
  }];

  var unified = convertToolsFromOpenAI(openaiTools);

  assert(unified[0].cache_control && unified[0].cache_control.type === "ephemeral",
    "F3-1: OpenAI → Unified: cache_control.type = ephemeral");
  assert(unified[0].cache_control.ttl === "7200",
    "F3-2: OpenAI → Unified: cache_control.ttl = 7200");
  assert(unified[0].type === "function",
    "F3-3: tool type = function");
  assert(unified[0].function.name === "get_weather",
    "F3-4: function name 正確");
})();

// F4: Anthropic → Unified
(function () {
  var anthropicTools = [{
    name: "get_weather",
    description: "Get weather",
    input_schema: { type: "object" },
    cache_control: { type: "ephemeral" },
  }];

  var unified = convertToolsFromAnthropic(anthropicTools);

  assert(unified[0].cache_control && unified[0].cache_control.type === "ephemeral",
    "F4-1: Anthropic → Unified: cache_control.type = ephemeral");
  assert(unified[0].function.name === "get_weather",
    "F4-2: function name 正確");
  assert(unified[0].function.description === "Get weather",
    "F4-3: description 正確");
})();

// F5: Round-trip OpenAI → Unified → OpenAI
(function () {
  var originalOpenAI = [{
    type: "function",
    cache_control: { type: "ephemeral", ttl: "1800" },
    function: { name: "test", description: "Test", parameters: { type: "object" } },
  }];

  var unified = convertToolsFromOpenAI(originalOpenAI);
  var roundTrip = convertToolsToOpenAI(unified);

  assert(roundTrip[0].cache_control && roundTrip[0].cache_control.type === "ephemeral",
    "F5-1: Round-trip OpenAI: cache_control.type 保留");
  assert(roundTrip[0].cache_control.ttl === "1800",
    "F5-2: Round-trip OpenAI: cache_control.ttl 保留");
  assert(roundTrip[0].function.name === "test",
    "F5-3: Round-trip OpenAI: function name 保留");
})();

// F6: Round-trip Anthropic → Unified → Anthropic
(function () {
  var originalAnthropic = [{
    name: "test_tool",
    description: "Test tool",
    input_schema: { type: "object", properties: { x: { type: "number" } } },
    cache_control: { type: "ephemeral", ttl: "900" },
  }];

  var unified = convertToolsFromAnthropic(originalAnthropic);
  var roundTrip = convertToolsToAnthropic(unified);

  assert(roundTrip[0].cache_control && roundTrip[0].cache_control.type === "ephemeral",
    "F6-1: Round-trip Anthropic: cache_control.type 保留");
  assert(roundTrip[0].cache_control.ttl === "900",
    "F6-2: Round-trip Anthropic: cache_control.ttl 保留");
  assert(roundTrip[0].name === "test_tool",
    "F6-3: Round-trip Anthropic: name 保留");
  assert(roundTrip[0].input_schema.properties.x.type === "number",
    "F6-4: Round-trip Anthropic: input_schema 保留");
})();

// ══════════════════════════════════════════════════════════════
// G. 完整端到端流程
// ══════════════════════════════════════════════════════════════

section("G. 端到端流程模擬");

(function () {
  // 模擬 Claude Code 發送的典型請求
  var claudeCodeRequest = {
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    stream: true,
    system: [{
      type: "text",
      text: "You are an expert programmer.",
      cache_control: { type: "ephemeral" },
    }],
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Here is the codebase:", cache_control: { type: "ephemeral" } },
        { type: "text", text: "Please fix the bug in file.ts" },
      ],
    }],
    tools: [{
      name: "read_file",
      description: "Read a file",
      input_schema: { type: "object", properties: { path: { type: "string" } } },
      cache_control: { type: "ephemeral" },
    }, {
      name: "write_file",
      description: "Write a file",
      input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
    }],
  };

  // Step G1: Anthropic → Unified（入站轉換）
  var unified = anthropicTransformRequestOut(claudeCodeRequest);

  // 檢查 system cache_control
  var sys = unified.messages.find(function (m) { return m.role === "system"; });
  assert(sys !== undefined, "G1: system message 存在");
  if (sys && Array.isArray(sys.content)) {
    assert(sys.content[0].cache_control && sys.content[0].cache_control.type === "ephemeral",
      "G2: system cache_control 保留");
  }

  // 檢查 user content
  var user = unified.messages.find(function (m) { return m.role === "user"; });
  assert(user !== undefined, "G3: user message 存在");
  if (user && Array.isArray(user.content)) {
    assert(user.content[0].cache_control && user.content[0].cache_control.type === "ephemeral",
      "G4: user block[0] cache_control 保留");
    assert(user.content[1].cache_control === undefined,
      "G5: user block[1] 無 cache_control");
  }

  // 檢查工具
  assert(unified.tools !== undefined, "G6: tools 存在");
  if (unified.tools) {
    assert(unified.tools[0].cache_control && unified.tools[0].cache_control.type === "ephemeral",
      "G7: tool[0] cache_control 保留");
    assert(unified.tools[0].function.name === "read_file", "G8: tool[0] name 正確");
    assert(unified.tools[1].cache_control === undefined, "G9: tool[1] 無 cache_control");
    assert(unified.tools[1].function.name === "write_file", "G10: tool[1] name 正確");
  }

  // Step G2: 轉換到 OpenAI 格式（模擬發送到 OpenAI-compatible provider）
  var openaiTools = unified.tools ? convertToolsToOpenAI(unified.tools) : undefined;
  if (openaiTools) {
    assert(openaiTools[0].cache_control && openaiTools[0].cache_control.type === "ephemeral",
      "G11: OpenAI 格式 tool[0] cache_control 保留");
    assert(openaiTools[1].cache_control === undefined,
      "G12: OpenAI 格式 tool[1] 無 cache_control");
  }

  // Step G3: CleancacheTransformer 清除（模擬禁用 cache 的場景）
  var cleaned = cleancacheTransformRequestIn(JSON.parse(JSON.stringify(unified)));
  assert(cleaned.cache_control === undefined, "G13: Cleancache 清除頂層");
  if (cleaned.tools) {
    assert(cleaned.tools[0].cache_control === undefined, "G14: Cleancache 清除 tool[0]");
    assert(cleaned.tools[1].cache_control === undefined, "G15: Cleancache 清除 tool[1]");
  }
  var cleanedUser = cleaned.messages.find(function (m) { return m.role === "user"; });
  if (cleanedUser && Array.isArray(cleanedUser.content)) {
    assert(cleanedUser.content[0].cache_control === undefined, "G16: Cleancache 清除 user block[0]");
  }

  // Step G4: 驗證 deep clone 後的原始 unified 未被 Cleancache 影響
  var origUser = unified.messages.find(function (m) { return m.role === "user"; });
  if (origUser && Array.isArray(origUser.content)) {
    assert(origUser.content[0].cache_control && origUser.content[0].cache_control.type === "ephemeral",
      "G17: 原始 unified 未受 Cleancache 影響（deep clone 正確）");
  }

  // Step G5: 轉換到 Anthropic 格式 tools（模擬發送到 Anthropic provider）
  var anthropicTools = unified.tools ? convertToolsToAnthropic(unified.tools) : undefined;
  if (anthropicTools) {
    assert(anthropicTools[0].cache_control && anthropicTools[0].cache_control.type === "ephemeral",
      "G18: Anthropic 格式 tool[0] cache_control 保留");
    assert(anthropicTools[0].name === "read_file",
      "G19: Anthropic 格式 tool[0] name 保留");
    assert(anthropicTools[1].cache_control === undefined,
      "G20: Anthropic 格式 tool[1] 無 cache_control");
  }

  // Step G6: 完整 round-trip (Anthropic tools → Unified → OpenAI → Unified → Anthropic)
  if (unified.tools) {
    var nativeAnthropicTools = convertToolsToAnthropic(unified.tools);
    var roundUnified = convertToolsFromAnthropic(nativeAnthropicTools);
    var roundOpenAI = convertToolsToOpenAI(roundUnified);

    assert(roundOpenAI[0].cache_control && roundOpenAI[0].cache_control.type === "ephemeral",
      "G21: Full Round-trip: cache_control.type 保留");
    assert(roundOpenAI[0].function.name === "read_file",
      "G22: Full Round-trip: function name 保留");
    assert(roundOpenAI[1].cache_control === undefined,
      "G23: Full Round-trip: tool[1] 仍無 cache_control");
  }

  // Step G7: 驗證 Cleancache 之後再經過其他 transformer 的正確性
  // GroqTransformer 收到已清理的請求應該不會出錯
  var afterGroq = groqTransformRequestIn(JSON.parse(JSON.stringify(cleaned)));
  assert(afterGroq.cache_control === undefined, "G24: Groq 處理已清理請求：頂層仍無 cache_control");
  if (afterGroq.tools) {
    assert(afterGroq.tools[0].cache_control === undefined, "G25: Groq 處理已清理請求：tool 仍無 cache_control");
  }
})();

// ══════════════════════════════════════════════════════════════
// 結果
// ══════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════");
console.log("  結果: \x1b[32m" + passed + " 通過\x1b[0m, \x1b[31m" + failed + " 失敗\x1b[0m, 共 " + (passed + failed) + " 項");
console.log("═══════════════════════════════════════════════════");

if (failed > 0) {
  console.log("\n\x1b[31m❌ 測試失敗！有 " + failed + " 項未通過。\x1b[0m");
  process.exit(1);
} else {
  console.log("\n\x1b[32m✅ 全部測試通過！cache_control 轉發功能正常。\x1b[0m");
  console.log("\n涵蓋場景：");
  console.log("  - Anthropic → Unified 轉換（5 種 cache_control 位置）");
  console.log("  - CleancacheTransformer 清除（5 層 cache_control）");
  console.log("  - GroqTransformer 清除（含 $schema）");
  console.log("  - OpenrouterTransformer claude/非claude 判斷");
  console.log("  - VercelTransformer claude/非claude 判斷");
  console.log("  - Converter 雙向轉換 + Round-trip");
  console.log("  - 端到端：入站 → OpenAI 格式 → Cleancache → Anthropic 格式");
}
