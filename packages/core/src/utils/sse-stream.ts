import { v4 as uuidv4 } from "uuid";

interface SSEStreamLogger {
  debug?: (obj: any, msg: string) => void;
  warn?: (...args: any[]) => void;
}

interface SSEStreamOptions {
  logger?: SSEStreamLogger;
}

export function processSSEStream(
  response: Response,
  options?: SSEStreamOptions
): Response {
  if (!response.body) {
    return response;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let hasTextContent = false;
  let reasoningContent = "";
  let isReasoningComplete = false;
  let hasToolCall = false;
  let buffer = "";

  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();

      const processBuffer = (
        buf: string,
        ctrl: ReadableStreamDefaultController,
        enc: TextEncoder
      ) => {
        const lines = buf.split("\n");
        for (const line of lines) {
          if (line.trim()) {
            ctrl.enqueue(enc.encode(line + "\n"));
          }
        }
      };

      const processLine = (
        line: string,
        context: {
          controller: ReadableStreamDefaultController;
          encoder: TextEncoder;
          hasTextContent: () => boolean;
          setHasTextContent: (val: boolean) => void;
          reasoningContent: () => string;
          appendReasoningContent: (content: string) => void;
          isReasoningComplete: () => boolean;
          setReasoningComplete: (val: boolean) => void;
        }
      ) => {
        const { controller: ctrl, encoder: enc } = context;

        if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
          const jsonStr = line.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            if (data.usage) {
              options?.logger?.debug?.(
                { usage: data.usage, hasToolCall },
                "usage"
              );
              if (data.choices?.[0]) {
                data.choices[0].finish_reason = hasToolCall
                  ? "tool_calls"
                  : "stop";
              }
            }

            if (data.choices?.[0]?.finish_reason === "error") {
              ctrl.enqueue(
                enc.encode(
                  `data: ${JSON.stringify({
                    error: data.choices?.[0].error,
                  })}\n\n`
                )
              );
            }

            if (
              data.choices?.[0]?.delta?.content &&
              !context.hasTextContent()
            ) {
              context.setHasTextContent(true);
            }

            if (data.choices?.[0]?.delta?.reasoning) {
              context.appendReasoningContent(data.choices[0].delta.reasoning);
              const thinkingChunk = {
                ...data,
                choices: [
                  {
                    ...data.choices?.[0],
                    delta: {
                      ...data.choices[0].delta,
                      thinking: {
                        content: data.choices[0].delta.reasoning,
                      },
                    },
                  },
                ],
              };
              if (thinkingChunk.choices?.[0]?.delta) {
                delete thinkingChunk.choices[0].delta.reasoning;
              }
              ctrl.enqueue(
                enc.encode(`data: ${JSON.stringify(thinkingChunk)}\n\n`)
              );
              return;
            }

            if (
              data.choices?.[0]?.delta?.content &&
              context.reasoningContent() &&
              !context.isReasoningComplete()
            ) {
              context.setReasoningComplete(true);
              const signature = Date.now().toString();
              const thinkingChunk = {
                ...data,
                choices: [
                  {
                    ...data.choices?.[0],
                    delta: {
                      ...data.choices[0].delta,
                      content: null,
                      thinking: {
                        content: context.reasoningContent(),
                        signature: signature,
                      },
                    },
                  },
                ],
              };
              if (thinkingChunk.choices?.[0]?.delta) {
                delete thinkingChunk.choices[0].delta.reasoning;
              }
              ctrl.enqueue(
                enc.encode(`data: ${JSON.stringify(thinkingChunk)}\n\n`)
              );
            }

            if (data.choices?.[0]?.delta?.reasoning) {
              delete data.choices[0].delta.reasoning;
            }

            if (
              data.choices?.[0]?.delta?.tool_calls?.length &&
              !Number.isNaN(
                parseInt(data.choices?.[0]?.delta?.tool_calls[0].id, 10)
              )
            ) {
              data.choices?.[0]?.delta?.tool_calls.forEach((tool: any) => {
                tool.id = `call_${uuidv4()}`;
              });
            }

            if (
              data.choices?.[0]?.delta?.tool_calls?.length &&
              !hasToolCall
            ) {
              hasToolCall = true;
            }

            if (
              data.choices?.[0]?.delta?.tool_calls?.length &&
              context.hasTextContent()
            ) {
              if (typeof data.choices[0].index === "number") {
                data.choices[0].index += 1;
              } else {
                data.choices[0].index = 1;
              }
            }

            ctrl.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch (e) {
            ctrl.enqueue(enc.encode(line + "\n"));
          }
        } else {
          ctrl.enqueue(enc.encode(line + "\n"));
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              processBuffer(buffer, controller, encoder);
            }
            break;
          }

          if (!value || value.length === 0) {
            continue;
          }

          let chunk;
          try {
            chunk = decoder.decode(value, { stream: true });
          } catch (decodeError) {
            console.warn("Failed to decode chunk", decodeError);
            continue;
          }

          if (chunk.length === 0) {
            continue;
          }

          buffer += chunk;

          if (buffer.length > 1000000) {
            console.warn("Buffer size exceeds limit, processing partial data");
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.trim()) {
                try {
                  processLine(line, {
                    controller,
                    encoder,
                    hasTextContent: () => hasTextContent,
                    setHasTextContent: (val) => (hasTextContent = val),
                    reasoningContent: () => reasoningContent,
                    appendReasoningContent: (content) =>
                      (reasoningContent += content),
                    isReasoningComplete: () => isReasoningComplete,
                    setReasoningComplete: (val) => (isReasoningComplete = val),
                  });
                } catch (error) {
                  console.error("Error processing line:", line, error);
                  controller.enqueue(encoder.encode(line + "\n"));
                }
              }
            }
            continue;
          }

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              processLine(line, {
                controller,
                encoder,
                hasTextContent: () => hasTextContent,
                setHasTextContent: (val) => (hasTextContent = val),
                reasoningContent: () => reasoningContent,
                appendReasoningContent: (content) =>
                  (reasoningContent += content),
                isReasoningComplete: () => isReasoningComplete,
                setReasoningComplete: (val) => (isReasoningComplete = val),
              });
            } catch (error) {
              console.error("Error processing line:", line, error);
              controller.enqueue(encoder.encode(line + "\n"));
            }
          }
        }
      } catch (error) {
        console.error("Stream error:", error);
        controller.error(error);
      } finally {
        try {
          reader.releaseLock();
        } catch (e) {
          console.error("Error releasing reader lock:", e);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
