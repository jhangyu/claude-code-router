# opencode-zen 認證 Header 修復說明

## 問題

使用 `opencode-zen` provider 搭配 `qwen3.7-max` 等模型時，所有請求都會返回 401 錯誤：

```json
{"type":"error","error":{"type":"AuthError","message":"Missing API key."}}
```

原因：`opencode.ai/zen` 的 `/v1/messages` 端點只接受 `x-api-key` header，不接受 `Authorization: Bearer` 格式。

---

## 根因分析

舊有文件建議「不加 transformer，讓它 passthrough，自動使用 x-api-key」，並要求在 `packages/core/src/api/routes.ts` 的 `sendRequestToProvider()` 增加 `hasProviderTransformer` 判斷。這個方案有三個根本缺陷：

### 缺陷一：程式碼修改從未被套用

`packages/core/src/api/routes.ts` 第 312 行目前仍然是：

```typescript
if (bypass && typeof transformer.auth === "function") {
```

並不存在 `hasProviderTransformer` 條件，文件描述的 code 修改從未合入。

### 缺陷二：「不加 transformer」不等於 passthrough

`shouldBypassTransformers()` 函數的邏輯要求：

```
provider.transformer.use.length === 1
&& use[0].name === transformer.name
```

當 provider **沒有設定 transformer** 時，條件不成立 → `bypass = false`。

### 缺陷三：`bypass=false` 導致雙重錯誤

`bypass=false` 會觸發兩個問題：

1. **`auth()` 不被呼叫** → 只發送 `Authorization: Bearer` → opencode-zen 回傳 `401 Missing API key`。
2. **格式轉換被錯誤執行** → 跑 `transformRequestOut`（Anthropic→OpenAI）與 `transformResponseIn`（OpenAI→Anthropic）；但 zen `/v1/messages` 收/回都是 **Anthropic 原生格式**，被當成 OpenAI 格式轉換會導致 `choices[0] undefined` → 500 或串流回應空白。

---

## 正確方案（純 config 變更，不需改任何程式碼）

給 `opencode-zen` provider 設定 `"transformer": { "use": ["Anthropic"] }`：

```json
{
  "Providers": [
    {
      "name": "opencode-zen",
      "api_base_url": "https://opencode.ai/zen/go/v1/messages",
      "api_key": "sk-xxx",
      "models": [
        "qwen3.7-max",
        "qwen3.7-plus"
      ],
      "transformer": {
        "use": ["Anthropic"]
      }
    }
  ]
}
```

### 原理

`AnthropicTransformer` 的 `name = "Anthropic"`、`endPoint = "/v1/messages"`。

此設定使 `shouldBypassTransformers()` 命中條件 → `bypass = true`，產生三個效果：

1. **跳過 `transformRequestOut`** → request 維持 Anthropic 格式，原樣送往 zen。
2. **呼叫 `transformer.auth()`** → `AnthropicTransformer` 預設 `UseBearer = false`，因此送出 `x-api-key: <api_key>` 而非 `Authorization: Bearer`。
3. **跳過 `transformResponseIn`** → Anthropic 原生回應原樣返回，不做 OpenAI→Anthropic 轉換。

---

## 完整 config 範例

```json
{
  "Providers": [
    {
      "name": "opencode-zen",
      "api_base_url": "https://opencode.ai/zen/go/v1/messages",
      "api_key": "sk-your-opencode-zen-key",
      "models": [
        "qwen3.7-max",
        "qwen3.7-plus",
        "qwen3.235-a22b"
      ],
      "transformer": {
        "use": ["Anthropic"]
      }
    },
    {
      "name": "opencode-go",
      "api_base_url": "https://opencode.ai/zen/go/v1/chat/completions",
      "api_key": "sk-your-opencode-go-key",
      "models": [
        "gpt-4o",
        "gpt-4o-mini"
      ],
      "transformer": {
        "use": ["OpenAI"]
      }
    }
  ]
}
```

---

## 端點區分

| Provider | 端點 | 格式 | Transformer |
|----------|------|------|-------------|
| `opencode-zen` | `https://opencode.ai/zen/go/v1/messages` | Anthropic 原生 | `Anthropic` |
| `opencode-go` | `https://opencode.ai/zen/go/v1/chat/completions` | OpenAI 格式 | `OpenAI` |

兩者使用不同端點、不同格式，**不可混用 transformer**。

---

## 實測佐證

以下測試結果由主 agent 直打 opencode.ai 驗證：

| 測試情境 | 狀態碼 | 結果 |
|----------|--------|------|
| zen + `x-api-key` + Anthropic body | 200 | 正常回傳 Anthropic 格式（含 thinking/content blocks） |
| zen + `Authorization: Bearer`（無 x-api-key）| 401 | `{"type":"error","error":{"type":"AuthError","message":"Missing API key."}}` |
| zen + 同時帶 `x-api-key` 與 `Bearer` | 200 | bypass 模式殘留的 Bearer 無害，仍正常回應 |

---

## 測試方式

啟動 CCR 後，透過本機端點發送請求（model 格式為 `provider,model`）：

```bash
curl -X POST http://127.0.0.1:3456/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-ccr-api-key>" \
  -d '{
    "model": "opencode-zen,qwen3.7-max",
    "max_tokens": 50,
    "messages": [{"role": "user", "content": "Hi"}]
  }'
```

預期成功回應（Anthropic 格式）：

```json
{
  "type": "message",
  "role": "assistant",
  "content": [{"type": "text", "text": "Hello! How can I help you today?"}],
  "stop_reason": "end_turn"
}
```

---

## 已知殘留與未來強化

`sendRequestToProvider()` 預設加的是大寫 `Authorization`（第 338 行），而 `AnthropicTransformer.auth()` 用小寫 `authorization: undefined` 清除，兩者是不同的 header key，因此 bypass 模式下會同時送出 `x-api-key` 與 `Authorization: Bearer`。

對 opencode-zen 無害（實測仍回 200），但未來可在 code 層統一處理 header key 大小寫，避免多餘的 header 被帶出去。
