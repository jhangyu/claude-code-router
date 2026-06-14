import { UnifiedChatRequest } from "@/types/llm";

/**
 * Strip all cache_control fields from a unified chat request.
 * Used by transformers that route to providers that don't support prompt caching.
 */
export function stripCacheControl(request: UnifiedChatRequest): void {
  delete request.cache_control;

  if (Array.isArray(request.messages)) {
    request.messages.forEach((msg) => {
      if (Array.isArray(msg.content)) {
        msg.content.forEach((item: any) => {
          delete item.cache_control;
        });
      }
      delete msg.cache_control;
    });
  }

  if (Array.isArray(request.tools)) {
    request.tools.forEach((tool) => {
      delete tool.cache_control;
    });
  }
}
