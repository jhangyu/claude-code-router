# Cache Control Forwarding Refactoring Plan

> Scope: `packages/core/src/` — transformers, converters, utilities, types
> Baseline: commit `1082770` + `stripCacheControl` extraction

## Verified Issues (15 valid, grouped by theme)

### Theme A: DRY — Duplicated Cache Stripping & SSE Stream Logic

| # | Severity | Issue | Location | Status |
|---|----------|-------|----------|--------|
| 2 | High | `openrouter` and `vercel` still inline cache_control stripping instead of using `stripCacheControl` | openrouter.transformer.ts:14-38, vercel.transformer.ts:14-38 | Open |
| 3 | High | `openrouter` and `vercel` transformResponseOut are ~300 lines of nearly identical SSE stream processing | Both files entire `transformResponseOut` | Open |
| 12 | Low | Guarded delete (`if (x) delete x`) vs unconditional delete inconsistency across transformers | openrouter/vercel vs cleancache/groq | Superseded by #2 |

### Theme B: Cache Control Forwarding Gaps

| # | Severity | Issue | Location | Status |
|---|----------|-------|----------|--------|
| 4 | High | `convertToOpenAI` drops `request.cache_control` and `msg.cache_control` | converter.ts:97-109, 148-154 | Open |
| 8 | Medium | `buildRequestBody` in vertex-claude.util drops message-level and content-block cache_control | vertex-claude.util.ts:76-133 | Open |
| 9 | Medium | `convertFromOpenAI` / `convertFromAnthropic` drop message-level cache_control | converter.ts:190-239, 264-461 | Open |
| 13 | Medium | `convertFromAnthropic` drops content-block-level cache_control | converter.ts:264-461 | Open |

### Theme C: Type Safety

| # | Severity | Issue | Location | Status |
|---|----------|-------|----------|--------|
| 7 | Medium | `cache_control` type `{ type?: string; ttl?: string }` repeated 4 times | llm.ts:32-35, 61-64, 74-77, 97-100 | Open |
| 15 | Low | `(tool as any).cache_control` bypasses type safety | converter.ts:48,62, vertex-claude.util.ts:214 | Open |

### Theme D: Robustness

| # | Severity | Issue | Location | Status |
|---|----------|-------|----------|--------|
| 6 | High | `data.choices[0]` unguarded access when `choices` is empty (usage-only SSE chunk) | openrouter.transformer.ts:119, vercel.transformer.ts:119 | Open |
| 11 | Medium | `includes("stream")` content-type check too broad; should be `text/event-stream` | groq.ts:27, openrouter.ts:65, vercel.ts:65 | Open |
| 5 | Medium | `JSON.parse(JSON.stringify())` deep clone — use `structuredClone` | anthropic.transformer.ts:73 | Open |
| 10 | Low | Multiple filter/find passes over same array in assistant branch | anthropic.transformer.ts:138-163 | Open |

### Theme E: Dead Code & Cleanup

| # | Severity | Issue | Location | Status |
|---|----------|-------|----------|--------|
| 16 | Low | Dead `delete clone.cache_control` in normalizeRequestContent | openai.responses.transformer.ts:612 | Open |
| 18 | Low | Silent chunk loss when JSON.stringify fails in SSE stream | anthropic.transformer.ts:830-854 | Open |

### Invalidated Issues

| # | Original Severity | Reason |
|---|-------------------|--------|
| 1 | Critical | `groq` and `cleancache` already use `stripCacheControl` which has `Array.isArray` guard; `openrouter`/`vercel` receive typed `UnifiedChatRequest` so `messages` is always an array |
| 14 | Medium | `cleancache.transformer.ts` is already 12 lines clean after `stripCacheControl` extraction |
| 17 | Low | Both groq and cleancache now use same `stripCacheControl` utility |

---

## Execution Plan

### Batch 1 — Foundation (no functional change, enables later batches)

**Task 1-1: Extract `CacheControl` type** (Theme C #7)
- File: `types/llm.ts`
- Extract `CacheControl` interface, replace 4 inline definitions
- Fix `(tool as any).cache_control` in converter.ts and vertex-claude.util.ts (#15)

**Task 1-2: Extract shared SSE stream processor** (Theme A #3)
- Create `utils/sse-stream.ts` with shared `processSSEStream` utility
- Both openrouter and vercel `transformResponseOut` delegate to it
- Preserve per-transformer differences via options/callbacks

**Task 1-3: Refactor openrouter/vercel to use `stripCacheControl`** (Theme A #2)
- Both transformers call `stripCacheControl(request)` for non-claude models
- Remove inline cache_control deletion loops

### Batch 2 — Cache Control Forwarding Fixes

**Task 2-1: Forward cache_control in `convertToOpenAI`** (Theme B #4)
- Forward `request.cache_control` to result
- Forward `msg.cache_control` on each message

**Task 2-2: Forward cache_control in `convertFromOpenAI` / `convertFromAnthropic`** (Theme B #9, #13)
- Preserve `msg.cache_control` on message level
- Preserve content-block-level cache_control from Anthropic blocks

**Task 2-3: Forward cache_control in vertex-claude `buildRequestBody`** (Theme B #8)
- Forward message-level cache_control
- Forward content-block-level cache_control

### Batch 3 — Robustness & Cleanup

**Task 3-1: Guard `data.choices[0]` access** (Theme D #6)
- Add `data.choices?.[0]` guard in openrouter and vercel (if using shared SSE util, fix there)

**Task 3-2: Tighten content-type check** (Theme D #11)
- Replace `includes("stream")` with `includes("text/event-stream")` in groq, openrouter, vercel

**Task 3-3: Replace JSON deep clone with structuredClone** (Theme D #5)
- anthropic.transformer.ts:73

**Task 3-4: Single-pass array processing in anthropic assistant branch** (Theme D #10)
- Combine filter/find calls at lines 138-163

**Task 3-5: Remove dead code and improve error handling** (Theme E #16, #18)
- Remove dead `delete clone.cache_control` in openai.responses.transformer.ts
- Add warning log for JSON.stringify failure in anthropic SSE stream
