---
sidebar_position: 2
---

# Prompt Caching 實作計畫

讓 Claude Code Router 支援 Anthropic prompt caching，解決 `cache_read_input_tokens` 命中率為 0 的問題。

## 問題診斷

### 症狀

Claude Code 客戶端設定 `CLAUDE_CODE_ATTRIBUTION_HEADER=0`（阻止隨機 hex 破壞快取）後，`minimax` provider 的 prompt cache 命中率仍然為 0%。

### 根因分析

#### 請求端（Claude Code → CCR）

Claude Code 發送的 Anthropic Messages API 請求中**已正確包含 `cache_control` breakpoint**。經 `CLAUDE_CODE_ATTRIBUTION_HEADER=0` 設定後，system prompt 內容在跨請求時保持穩定。

#### Router 端（CCR Internal）

`AnthropicTransformer.transformRequestOut()` 在 Anthropic → UnifiedChatRequest 轉換時**保留了 `cache_control` 欄位**：

- `system` block 中的 `cache_control` → 正確保留（`packages/core/src/transformer/anthropic.transformer.ts:64`）
- `tool_result` 中的 `cache_control` → 正確保留（`packages/core/src/transformer/anthropic.transformer.ts:99`）
- `user` content block 中的 `cache_control` → 正確保留（`packages/core/src/transformer/anthropic.transformer.ts:113-130`）

```typescript
// packages/core/src/transformer/anthropic.transformer.ts:58-65
const textParts = request.system
  .filter((item: any) => item.type === "text" && item.text)
  .map((item: any) => ({
    type: "text" as const,
    text: item.text,
    cache_control: item.cache_control,  // ✅ 保留
  }));
```

#### 下游 API（OpenAI-compatible）

使用 `openai` transformer 的 provider（如 `opencode-go`、`minimax`）：
- `OpenAITransformer` 是 **NO-OP**（`packages/core/src/transformer/openai.transformer.ts`），不做事
- 請求直接以 `UnifiedChatRequest` JSON 格式發送到下游
- 下游 API **不認識/不處理 `cache_control` 欄位**
- 回應中的 `prompt_tokens_details.cached_tokens` 永遠返回 `0`

#### 回應端（CCR → Claude Code）

`AnthropicTransformer.transformResponseIn()` 已正確映射 cached token 統計：

```typescript
// packages/core/src/transformer/anthropic.transformer.ts:489-493
cache_read_input_tokens:
  chunk.usage?.prompt_tokens_details?.cached_tokens || 0,
```

但因下游不支援，`cached_tokens` 永遠是 0。

### 完整資料流

```
Claude Code (帶 cache_control)
  │
  ▼
POST /v1/messages
  │
  ▼
Router 中間層 (改寫 model)
  │
  ▼
AnthropicTransformer.transformRequestOut()   ✅ 保留 cache_control
  │
  ▼
UnifiedChatRequest (含 cache_control)
  │
  ▼
Provider transformers (openai → NO-OP)
  │
  ▼
sendUnifiedRequest() → JSON.stringify → fetch()
  │
  ▼
下游 API (opencode.ai / minimax)
  ❌ 不處理 cache_control
  ❌ cached_tokens 永遠 = 0
  │
  ▼
AnthropicTransformer.transformResponseIn()   ✅ 映射 cached_tokens
  │
  ▼
Claude Code 收到回應 (cache_read_input_tokens = 0)
```

### 現有 `CleancacheTransformer` 行為

```typescript
// packages/core/src/transformer/cleancache.transformer.ts
export class CleancacheTransformer implements Transformer {
  name = "cleancache";
  async transformRequestIn(request: UnifiedChatRequest): Promise<UnifiedChatRequest> {
    // 遍歷所有 messages，刪除 cache_control 欄位
    // 避免下游 API 報錯（某些 API 不接受未知欄位）
  }
}
```

此 transformer 目前**未被任何 provider 使用**。如果未來需要清理 `cache_control`，需注意與 promptcache 的執行順序。

---

## 解決方案架構

### 策略選擇

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A: Router 端模擬**（本計畫採用） | 在 CCR 中實作 prefix caching，不依賴下游 | 不需改動下游 API；立即生效 | 不節省實際 token 消耗 |
| B: 下游 API 支援 | 要求 opencode/minimax 實作 Anthropic cache 規範 | 真正節省 token | 依賴第三方；週期長 |
| C: 本地 KV-cache proxy | 在 CCR 與下游之間插入 caching 層 | 完全自主可控 | 複雜度高；維護成本大 |

### 方案 A 架構圖

```
Claude Code (帶 cache_control)
  │
  ▼
┌────────────────────────────────────────┐
│  PromptCacheTransformer (NEW)           │
│                                         │
│  transformRequestIn:                     │
│    1. 檢測 cache_control breakpoints    │
│    2. 計算 prefix SHA256 hash           │
│    3. 查詢 PromptCacheStore             │
│    4. 將命中狀態存入 context            │
│    5. 移除 cache_control (下游不支援)    │
│                                         │
│  transformResponseOut:                   │
│    1. 攔截 stream/JSON 回應             │
│    2. 注入 cache_read_input_tokens       │
│       或 cache_creation_input_tokens     │
└────────────────────────────────────────┘
  │
  ▼
現有 transformer chain (不變)
  │
  ▼
下游 API
```

### Cache Key 設計

```typescript
// Cache key = SHA256(cacheable_prefix 的標準化 JSON)
// cacheable_prefix = system blocks + messages up to last cache_control breakpoint

function computePrefixHash(request: UnifiedChatRequest): string {
  const prefix = extractCacheablePrefix(request);
  const normalized = JSON.stringify(prefix, Object.keys(prefix).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
```

### Cache Entry 結構

```typescript
interface CacheEntry {
  prefixHash: string;       // SHA256 hash
  tokenCount: number;        // 已快取的 prefix token 數量
  createdAt: number;         // 建立時間 (Unix ms)
  lastAccessAt: number;      // 最後命中時間
  prefixLength: number;      // prefix 訊息數量
}

// LRU: max 100 entries, TTL: 5 minutes (Anthropic ephemeral cache 標準)
```

---

## Phase 1: 基礎實作（Router 端模擬）

### 目標

- Claude Code 端看到 `cache_read_input_tokens > 0`
- 不依賴下游 API 改動
- 不節省實際 token 消耗（Phase 2 目標）

### 檔案變更總覽

| 檔案 | 操作 | 說明 |
|------|------|------|
| `packages/core/src/services/cache-store.ts` | **新增** | LRU prefix cache store，SHA256 hash，prefix extraction |
| `packages/core/src/transformer/promptcache.transformer.ts` | **新增** | Transformer：偵測 cache_control，查詢/寫入 cache，注入回應 |
| `packages/core/src/transformer/index.ts` | **修改** | 註冊 PromptCacheTransformer (+3 行) |
| `config.json` | **修改** | 在 opencode-go/minimax provider 的 `transformer.use` 中加入 |

### Step 1: 新增 `cache-store.ts`

**路徑**: `packages/core/src/services/cache-store.ts`

```typescript
import { createHash } from "crypto";
import { UnifiedChatRequest, UnifiedMessage, TextContent, MessageContent } from "../types/llm";

// ============================================================
// Types
// ============================================================

export interface CacheEntry {
  prefixHash: string;
  tokenCount: number;
  createdAt: number;
  lastAccessAt: number;
  prefixLength: number;  // number of messages in cached prefix
}

export interface CacheLookupResult {
  hit: boolean;
  entry?: CacheEntry;
  prefixHash: string;
  tokenCount: number;     // cached token count (0 if miss)
}

// ============================================================
// LRU Cache Implementation (same pattern as utils/cache.ts)
// ============================================================

class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, V>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.capacity) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  get size(): number {
    return this.cache.size;
  }
}

// ============================================================
// PromptCacheStore
// ============================================================

export class PromptCacheStore {
  private cache: LRUCache<string, CacheEntry>;
  private ttlMs: number;

  constructor(maxEntries: number = 100, ttlMs: number = 5 * 60 * 1000) {
    this.cache = new LRUCache<string, CacheEntry>(maxEntries);
    this.ttlMs = ttlMs;
  }

  /**
   * Look up a prefix hash in the cache.
   * Returns the entry if found and not expired.
   */
  lookup(prefixHash: string): CacheLookupResult {
    const entry = this.cache.get(prefixHash);

    if (!entry) {
      return { hit: false, prefixHash, tokenCount: 0 };
    }

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(prefixHash);
      return { hit: false, prefixHash, tokenCount: 0 };
    }

    // Update last access time
    entry.lastAccessAt = Date.now();
    return { hit: true, entry, prefixHash, tokenCount: entry.tokenCount };
  }

  /**
   * Store a prefix hash with its token count.
   */
  store(prefixHash: string, tokenCount: number, prefixLength: number): void {
    const entry: CacheEntry = {
      prefixHash,
      tokenCount,
      createdAt: Date.now(),
      lastAccessAt: Date.now(),
      prefixLength,
    };
    this.cache.set(prefixHash, entry);
  }

  /**
   * Compute SHA256 hash of the cacheable prefix.
   */
  static computePrefixHash(prefix: any): string {
    const normalized = JSON.stringify(prefix, Object.keys(prefix).sort());
    return createHash("sha256").update(normalized).digest("hex");
  }

  /**
   * Extract the cacheable prefix from a UnifiedChatRequest.
   *
   * The cacheable prefix includes:
   *   - All system messages (with cache_control on the last block)
   *   - All non-system messages up to (and including) the message
   *     that contains the last cache_control breakpoint.
   *
   * Returns:
   *   - prefix: the cacheable message array
   *   - suffix: the remaining messages (not cached)
   *   - hasCacheControl: whether any cache_control was found
   */
  static extractCacheablePrefix(request: UnifiedChatRequest): {
    prefixMessages: UnifiedMessage[];
    suffixMessages: UnifiedMessage[];
    hasCacheControl: boolean;
    tokenCount: number;  // estimated
  } {
    const messages = request.messages;
    let lastCacheControlIndex = -1;

    // Scan messages for cache_control breakpoints
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Check top-level cache_control on message
      if (msg.cache_control) {
        lastCacheControlIndex = i;
      }

      // Check cache_control on content blocks
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ((block as TextContent).cache_control) {
            lastCacheControlIndex = i;
            break;
          }
        }
      }
    }

    const hasCacheControl = lastCacheControlIndex >= 0;

    // If no cache_control, no prefix to cache
    if (!hasCacheControl) {
      return {
        prefixMessages: [],
        suffixMessages: messages,
        hasCacheControl: false,
        tokenCount: 0,
      };
    }

    const prefixMessages = messages.slice(0, lastCacheControlIndex + 1);
    const suffixMessages = messages.slice(lastCacheControlIndex + 1);

    // Rough token estimation: ~4 chars per token
    const prefixText = JSON.stringify(prefixMessages);
    const tokenCount = Math.ceil(prefixText.length / 4);

    return {
      prefixMessages,
      suffixMessages,
      hasCacheControl: true,
      tokenCount,
    };
  }
}

// ============================================================
// Singleton
// ============================================================

export const promptCacheStore = new PromptCacheStore();
```

### Step 2: 新增 `promptcache.transformer.ts`

**路徑**: `packages/core/src/transformer/promptcache.transformer.ts`

```typescript
import { UnifiedChatRequest, TextContent, MessageContent } from "../types/llm";
import { Transformer, TransformerContext } from "../types/transformer";
import { promptCacheStore, PromptCacheStore, CacheLookupResult } from "../services/cache-store";

// ============================================================
// Types
// ============================================================

/**
 * Extended context to carry cache info between request and response phases.
 */
interface PromptCacheContext {
  cacheResult?: CacheLookupResult;
}

// ============================================================
// PromptCacheTransformer
// ============================================================

export class PromptCacheTransformer implements Transformer {
  name = "promptcache";

  /**
   * transformRequestIn: process BEFORE sending to downstream provider.
   *
   * 1. Detect cache_control breakpoints in the request
   * 2. Extract cacheable prefix and compute hash
   * 3. Look up in PromptCacheStore
   * 4. Attach result to context for response phase
   * 5. Remove cache_control fields (downstream doesn't support them)
   */
  async transformRequestIn(
    request: UnifiedChatRequest,
    provider?: any,
    context?: TransformerContext
  ): Promise<UnifiedChatRequest> {
    try {
      const { prefixMessages, suffixMessages, hasCacheControl, tokenCount } =
        PromptCacheStore.extractCacheablePrefix(request);

      let cacheResult: CacheLookupResult;

      if (hasCacheControl && prefixMessages.length > 0) {
        // Build prefix object for hashing (system-level + prefix messages)
        const prefixForHash = {
          messages: prefixMessages,
        };

        const prefixHash = PromptCacheStore.computePrefixHash(prefixForHash);

        // Look up in cache store
        cacheResult = promptCacheStore.lookup(prefixHash);

        if (!cacheResult.hit) {
          // Cache MISS: store this prefix for future requests
          promptCacheStore.store(prefixHash, tokenCount, prefixMessages.length);
        }
      } else {
        cacheResult = { hit: false, prefixHash: "", tokenCount: 0 };
      }

      // Attach cache result to context for the response phase
      if (context) {
        (context as any).promptCache = cacheResult;
      }

      // Remove cache_control fields from the request
      // (downstream APIs don't support them and may reject the request)
      request.messages.forEach((msg) => {
        if (msg.cache_control) {
          delete msg.cache_control;
        }
        if (Array.isArray(msg.content)) {
          (msg.content as MessageContent[]).forEach((block) => {
            if ((block as TextContent).cache_control) {
              delete (block as TextContent).cache_control;
            }
          });
        }
      });
    } catch (error) {
      // On error, pass through unchanged
      if (context?.req?.log) {
        context.req.log.warn(`[promptcache] Error in transformRequestIn: ${error}`);
      }
    }

    return request;
  }

  /**
   * transformResponseOut: process AFTER receiving downstream response.
   *
   * Injects cache statistics into the response:
   *   - Cache HIT  → cache_read_input_tokens
   *   - Cache MISS → cache_creation_input_tokens
   */
  async transformResponseOut(
    response: Response,
    context?: TransformerContext
  ): Promise<Response> {
    const cacheResult: CacheLookupResult | undefined = (context as any)?.promptCache;

    if (!cacheResult || cacheResult.tokenCount === 0) {
      return response; // No cache info to inject
    }

    const contentType = response.headers.get("Content-Type") || "";

    if (contentType.includes("text/event-stream")) {
      return this.injectCacheIntoStream(response, cacheResult);
    }

    if (contentType.includes("application/json")) {
      return this.injectCacheIntoJson(response, cacheResult);
    }

    return response;
  }

  /**
   * Inject cache statistics into a streaming SSE response.
   *
   * Claude Code reads usage from:
   *   - message_start event: usage.input_tokens, usage.output_tokens
   *   - message_delta event: usage.cache_read_input_tokens, usage.cache_creation_input_tokens
   *
   * We intercept the message_delta event (or message_stop) and inject the cache tokens.
   */
  private injectCacheIntoStream(
    response: Response,
    cacheResult: CacheLookupResult
  ): Response {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const transformedStream = new ReadableStream({
      start: async (controller) => {
        const reader = response.body!.getReader();
        let buffer = "";
        let cacheInjected = false;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              // Inject cache info into message_delta or message_start events
              if (!cacheInjected && line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") {
                  controller.enqueue(encoder.encode(line + "\n"));
                  continue;
                }

                try {
                  const event = JSON.parse(data);

                  // Anthropic SSE format: message_delta with usage
                  if (event.type === "message_delta") {
                    event.usage = event.usage || {};
                    if (cacheResult.hit) {
                      event.usage.cache_read_input_tokens = cacheResult.tokenCount;
                      event.usage.cache_creation_input_tokens = 0;
                    } else {
                      event.usage.cache_read_input_tokens = 0;
                      event.usage.cache_creation_input_tokens = cacheResult.tokenCount;
                    }
                    cacheInjected = true;
                  }

                  // OpenAI SSE format: inject into the chunk with usage
                  if (event.usage && !cacheInjected) {
                    event.usage.prompt_tokens_details =
                      event.usage.prompt_tokens_details || {};
                    if (cacheResult.hit) {
                      event.usage.prompt_tokens_details.cached_tokens =
                        cacheResult.tokenCount;
                    }
                    cacheInjected = true;
                  }

                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
                  );
                } catch {
                  // Pass through unparseable lines
                  controller.enqueue(encoder.encode(line + "\n"));
                }
              } else {
                controller.enqueue(encoder.encode(line + "\n"));
              }
            }
          }

          // Flush remaining buffer
          if (buffer) {
            controller.enqueue(encoder.encode(buffer));
          }
        } catch (error) {
          controller.error(error);
        } finally {
          controller.close();
          reader.releaseLock();
        }
      },
    });

    return new Response(transformedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  /**
   * Inject cache statistics into a non-streaming JSON response.
   */
  private async injectCacheIntoJson(
    response: Response,
    cacheResult: CacheLookupResult
  ): Promise<Response> {
    try {
      const json = await response.json();

      if (json.usage) {
        if (cacheResult.hit) {
          json.usage.cache_read_input_tokens = cacheResult.tokenCount;
          json.usage.cache_creation_input_tokens = 0;
        } else {
          json.usage.cache_read_input_tokens = 0;
          json.usage.cache_creation_input_tokens = cacheResult.tokenCount;
        }
      }

      return new Response(JSON.stringify(json), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response;
    }
  }
}
```

### Step 3: 註冊 Transformer

**路徑**: `packages/core/src/transformer/index.ts`

在現有 exports 中新增 import 和註冊：

```typescript
// 新增 import（在現有 import 區塊末尾）
import { PromptCacheTransformer } from "./promptcache.transformer";

// 在 export default 物件中新增一行
export default {
  // ... 現有項目 ...
  ForceReasoningTransformer,
  PromptCacheTransformer,  // ← 新增
};
```

### Step 4: 配置 Provider

**路徑**: `config.json`

在需要啟用 prompt caching 的 provider 中將 `promptcache` 加入 transformer chain**最前面**：

```json
{
  "Providers": [
    {
      "name": "opencode-go",
      "api_base_url": "https://opencode.ai/zen/go/v1/chat/completions",
      "api_key": "...",
      "models": [
        "glm-5.1",
        "deepseek-v4-pro",
        "deepseek-v4-flash",
        "kimi-k2.6",
        "mimo-v2.5-pro"
      ],
      "transformer": {
        "use": [
          "promptcache",   // ← 新增：必須在最前面，確保在其他 transformer 之前處理 cache_control
          "openai"
        ]
      }
    },
    {
      "name": "minimax",
      "api_base_url": "https://api.minimax.io/v1/chat/completions",
      "api_key": "...",
      "models": ["MiniMax-M3"],
      "transformer": {
        "use": [
          "promptcache",   // ← 新增
          "openai"
        ]
      }
    },
    {
      "name": "opencode-zen",
      "api_base_url": "https://opencode.ai/zen/go/v1/messages",
      "api_key": "...",
      "models": ["qwen3.7-max", "qwen3.7-plus"],
      "transformer": {
        "use": [
          "promptcache",   // ← 新增
          "Anthropic"
        ]
      }
    }
  ]
}
```

### Step 5: Claude Code 端配置

**路徑**: `~/.claude/settings.json`

在 `env` 區塊中加入強制 prompt caching 環境變數：

```json
{
  "env": {
    "FORCE_PROMPT_CACHING_5M": "1"
  }
}
```

此變數的作用：
- 確保 Claude Code **總是**在 system prompt 上發送 `cache_control: {"type": "ephemeral"}`
- 即使使用自訂模型（非 Anthropic 原生模型）也會發送
- 對應 Claude Code binary 中的 `FORCE_PROMPT_CACHING_5M` 旗標

若此變數無效，可嘗試替代變數：
- `ENABLE_PROMPT_CACHING_1H` — 啟用 1 小時快取（效果類似但 TTL 更長）

---

## Phase 2: 深度整合（節省下游 Token）

### 目標

Cache hit 時，**只發送 uncached suffix** 給下游 API，真正節省 token 成本。

### 額外需要的修改

| 檔案 | 操作 | 說明 |
|------|------|------|
| `packages/core/src/transformer/promptcache.transformer.ts` | **修改** | `transformRequestIn` 中 cache hit 時截斷 message list |
| `packages/core/src/services/cache-store.ts` | **修改** | 擴充 `CacheEntry` 儲存 suffix prompt 範本 |

### 實作要點

```typescript
// Cache HIT 時的行為變更：
if (cacheResult.hit) {
  // 1. 移除已快取的 prefix messages
  // 2. 在最前面插入一個 summary system message 告知下游有快取前綴
  // 3. 發送縮減後的請求
  request.messages = [
    {
      role: "system",
      content: `[Cached prefix: ${cacheResult.tokenCount} tokens from previous conversation. Continue from here.]`,
    },
    ...suffixMessages,
  ];

  // 4. 在回應中注入完整的 cache_read_input_tokens
}

// Cache MISS 時的行為不變：發送完整請求
```

### 風險

- 下游模型可能不正確處理截斷的對話歷史
- 需要驗證不同 provider 對「歷史缺失」的容忍度
- 建議先在單一 provider 上測試，再逐步推廣

---

## 實作優先級與階段

| 階段 | 範圍 | 預期效果 | 風險 |
|------|------|----------|------|
| **Phase 1** | Router 端 cache 模擬 | Claude Code 看到 cache hit，優化 prompt 策略 | 低 |
| **Phase 2** | 下游 token 節省 | 實際減少 API 費用 | 中（需驗證下游行為） |

## 測試策略

### 手動測試

1. **驗證 cache_control 傳遞**：

```bash
# 設定 debug logging
# config.json: "LOG_LEVEL": "debug"

# 發出請求並檢查 log
tail -f ~/.claude-code-router/logs/ccr-*.log | grep -i "promptcache\|cache_control"
```

2. **驗證 cache hit**：

```bash
# 使用相同 session 連續發送兩次請求
# 第一次：cache miss（cache_creation_input_tokens > 0）
# 第二次：cache hit（cache_read_input_tokens > 0）
```

3. **驗證 Claude Code 端**：

檢查 Claude Code 的 cost-tracker log 或 metrics 中 `cache_read_input_tokens` 是否 > 0。

### 自動化測試（建議）

```typescript
// 測試檔案: packages/core/src/__tests__/promptcache.transformer.test.ts

describe("PromptCacheTransformer", () => {
  it("should detect cache_control in system messages");
  it("should compute stable prefix hash");
  it("should return cache hit on second identical request");
  it("should return cache miss after TTL expiry");
  it("should inject cache_read_input_tokens on hit");
  it("should inject cache_creation_input_tokens on miss");
  it("should strip cache_control before downstream");
  it("should handle requests without cache_control gracefully");
});
```

## 潛在風險與緩解

| 風險 | 影響 | 緩解措施 |
|------|------|----------|
| Cache key 不穩定（session ID 等變動內容出現在 prefix 中） | 永遠 cache miss | `CLAUDE_CODE_ATTRIBUTION_HEADER=0` 已解決；必要時在 prefix hash 前過濾已知變動欄位 |
| Stream 攔截失敗 | 回應損壞，Claude Code 報錯 | try-catch 包裹，失敗時 pass-through 原始回應 |
| 記憶體使用過高 | 服務不穩 | LRU 上限 100 entries，每 entry ~50KB，總計 ~5MB |
| 與 cleancache transformer 順序衝突 | cache_control 被提前清除 | promptcache 必須在 transformer chain 最前面 |
| Anthropic/OpenAI SSE 格式差異 | cache 統計注入位置錯誤 | 同時處理兩種格式（見 Step 2 程式碼） |

## 附錄：Claude Code 相關環境變數

從 Claude Code binary 中提取的 cache 相關變數：

| 變數 | 作用 |
|------|------|
| `CLAUDE_CODE_ATTRIBUTION_HEADER=0` | 禁止在 user message 注入隨機 hex |
| `DISABLE_PROMPT_CACHING` | 全局禁用 prompt caching |
| `DISABLE_PROMPT_CACHING_SONNET` | 對 Sonnet 模型禁用 |
| `DISABLE_PROMPT_CACHING_OPUS` | 對 Opus 模型禁用 |
| `DISABLE_PROMPT_CACHING_HAIKU` | 對 Haiku 模型禁用 |
| `ENABLE_PROMPT_CACHING_1H` | 啟用 1 小時 TTL cache |
| `ENABLE_PROMPT_CACHING_1H_BEDROCK` | 對 Bedrock 啟用 1 小時 TTL |
| `FORCE_PROMPT_CACHING_5M` | 強制 5 分鐘 ephemeral cache（所有模型） |

建議設定組合：
```json
{
  "env": {
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
    "FORCE_PROMPT_CACHING_5M": "1"
  }
}
```
