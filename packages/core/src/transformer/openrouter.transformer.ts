import { UnifiedChatRequest } from "@/types/llm";
import { Transformer, TransformerOptions } from "../types/transformer";
import { stripCacheControl } from "@/utils/cache-control";
import { processSSEStream } from "@/utils/sse-stream";

export class OpenrouterTransformer implements Transformer {
  static TransformerName = "openrouter";
  logger?: any;

  constructor(private readonly options?: TransformerOptions) {}

  async transformRequestIn(
    request: UnifiedChatRequest
  ): Promise<UnifiedChatRequest> {
    if (!request.model.includes("claude")) {
      stripCacheControl(request);
      // Keep image handling for non-claude
      if (Array.isArray(request.messages)) {
        request.messages.forEach((msg) => {
          if (Array.isArray(msg.content)) {
            msg.content.forEach((item: any) => {
              if (item.type === "image_url") {
                if (!item.image_url.url.startsWith("http")) {
                  item.image_url.url = `${item.image_url.url}`;
                }
                delete item.media_type;
              }
            });
          }
        });
      }
    } else {
      request.messages.forEach((msg) => {
        if (Array.isArray(msg.content)) {
          msg.content.forEach((item: any) => {
            if (item.type === "image_url") {
              if (!item.image_url.url.startsWith("http")) {
                item.image_url.url = `data:${item.media_type};base64,${item.image_url.url}`;
              }
              delete item.media_type;
            }
          });
        }
      });
    }
    Object.assign(request, this.options || {});
    return request;
  }

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
}
