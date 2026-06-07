# opencode.ai/zen (Qwen) Auth Header Fix

## 問題

`opencode.ai/zen` API 端點需要使用 `x-api-key` header 進行認證，但不接受 `Authorization: Bearer` 格式。

當 CCR 使用 `opencode-zen` provider 搭配 `qwen3.7-max` 等模型時，所有請求都會返回：

```json
{"type":"error","error":{"type":"AuthError","message":"Missing API key."}}
```

## 根因分析

1. `opencode.ai/zen` 的 `/v1/messages` 端點只接受 `x-api-key` header
2. 其他 provider（如 OpenAI）使用 `Authorization: Bearer` header
3. CCR 的 `routes.ts` 原本硬編碼 `Authorization: Bearer` 格式，無法支援不同的認證方式

## 修復方案

在 `sendRequestToProvider()` 函數中，當 provider **沒有配置 transformer** 時，自動呼叫 transformer 的 `auth()` 方法來取得正確的 header 格式。

### 程式碼修改位置

`packages/core/src/api/routes.ts` - `sendRequestToProvider()` 函數

### 修改內容

在發送 HTTP 請求前，增加對無 transformer provider 的 auth 處理：

```typescript
// Handle authentication:
const hasProviderTransformer = provider.transformer?.use?.length > 0;
if ((bypass || !hasProviderTransformer) && typeof transformer.auth === "function") {
  const auth = await transformer.auth(requestBody, provider);
  // ... 處理 auth headers (x-api-key 或 Bearer)
}
```

## Provider 設定方式

對於需要 `x-api-key` 認證的 provider（如 opencode-zen），在 `config.json` 中**不配置 transformer**：

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
      ]
      // 不加 transformer，讓它 passthrough，自動使用 x-api-key
    }
  ]
}
```

## Transformer 的 auth() 行為

不同 transformer 的 `auth()` 方法會返回不同的 header 格式：

| Transformer | Header 格式 |
|-------------|-----------|
| Anthropic (UseBearer: false) | `x-api-key: <api_key>` |
| Anthropic (UseBearer: true) | `Authorization: Bearer <api_key>` |
| OpenAI | `Authorization: Bearer <api_key>` |
| Gemini | `x-goog-api-key: <api_key>` |

## 測試方式

```bash
curl -X POST http://127.0.0.1:3456/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-api-key>" \
  -d '{"model":"opencode-zen,qwen3.7-max","max_tokens":50,"messages":[{"role":"user","content":"Hi"}]}'
```

成功回應：
```json
{"type":"message","content":[{"type":"text","text":"Hello! How can I help you today?"}]}
```