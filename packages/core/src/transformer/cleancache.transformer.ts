import { UnifiedChatRequest } from "@/types/llm";
import { Transformer } from "../types/transformer";
import { stripCacheControl } from "@/utils/cache-control";

export class CleancacheTransformer implements Transformer {
  name = "cleancache";

  async transformRequestIn(request: UnifiedChatRequest): Promise<UnifiedChatRequest> {
    stripCacheControl(request);
    return request;
  }
}
