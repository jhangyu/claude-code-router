# SSE Stream Processor Extraction Plan

> Issue: refactor_issue.md #3 — openrouter/vercel `transformResponseOut` ~300 lines duplicated
> Diff result: 12 lines differ (Chinese vs English comments only), logic 100% identical

## Problem

`OpenrouterTransformer.transformResponseOut` and `VercelTransformer.transformResponseOut` contain identical SSE stream processing logic (~310 lines each). This includes:

- ReadableStream construction with buffer management
- SSE line parsing (`data: ` prefix handling, `[DONE]` passthrough)
- Reasoning/thinking content extraction and signature injection
- Tool call ID rewriting (numeric → `call_uuid`)
- Tool call tracking and `finish_reason` patching
- Content index adjustment when text + tool_calls coexist
- Error chunk forwarding
- 1MB buffer overflow protection

Both methods also share the same non-stream JSON passthrough branch.

## Proposed Solution

### New file: `packages/core/src/utils/sse-stream.ts`

```typescript
interface SSEStreamOptions {
  logger?: { debug: (obj: any, msg: string) => void };
}

function processSSEStream(response: Response, options?: SSEStreamOptions): Response
```

The function:
1. Takes a `Response` with `text/event-stream` body
2. Returns a new `Response` with the transformed stream
3. Handles all shared logic internally
4. Uses `options.logger` for usage debug logging

### Refactored transformers

Both `openrouter.transformer.ts` and `vercel.transformer.ts` `transformResponseOut` become:

```typescript
async transformResponseOut(response: Response): Promise<Response> {
  if (response.headers.get("Content-Type")?.includes("application/json")) {
    const jsonResponse = await response.json();
    return new Response(JSON.stringify(jsonResponse), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } else if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    return processSSEStream(response, { logger: this.logger });
  }
  return response;
}
```

~310 lines → ~10 lines per transformer.

## Execution Plan

### Batch 1 (1 agent)

**Task 1: Create `utils/sse-stream.ts`**
- File: `packages/core/src/utils/sse-stream.ts`
- Extract the full `transformResponseOut` SSE branch from `openrouter.transformer.ts` lines 55-353
- Wrap in `processSSEStream(response, options?)` function
- Export the function
- Remove all Chinese comments, use English-only or no comments per project convention
- Keep `uuid` import for tool call ID rewriting

### Batch 2 (2 agents in parallel)

**Task 2a: Refactor `openrouter.transformer.ts`**
- File: `packages/core/src/transformer/openrouter.transformer.ts`
- Replace `transformResponseOut` SSE branch with `processSSEStream` call
- Keep JSON passthrough branch
- Import `processSSEStream` from `@/utils/sse-stream`
- Remove unused imports (`uuid`)

**Task 2b: Refactor `vercel.transformer.ts`**
- File: `packages/core/src/transformer/vercel.transformer.ts`
- Same changes as 2a
- Remove unused imports (`uuid`)

### Batch 3 (1 agent)

**Task 3: Verify build + test**
- Run `pnpm build:server` to verify TypeScript compilation
- Run existing cache-forwarding tests if applicable
- Grep for any remaining duplicated SSE logic
