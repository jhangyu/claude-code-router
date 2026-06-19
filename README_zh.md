![](blog/images/claude-code-router-img.png)

[![](https://img.shields.io/badge/%F0%9F%87%AC%F0%9F%87%A7-English-000aff?style=flat)](README.md)
[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?&logo=discord&logoColor=white)](https://discord.gg/rdftVMaUcS)
[![](https://img.shields.io/github/license/jhangyu/claude-code-router)](https://github.com/jhangyu/claude-code-router/blob/main/LICENSE)

[從 CLI 工具風格看工具漸進式披露](/blog/zh/從CLI工具風格看工具漸進式披露.md)

> 一款強大的工具，可將 Claude Code 請求路由到不同的模型，並自訂任何請求。

![](blog/images/claude-code.png)


## ✨ 功能

-   **模型路由**：根據場景將請求路由到不同模型 — 預設、後台任務、推理/思考、長上下文、網路搜尋與圖片任務。
-   **Agent 角色路由**：自動從系統提示詞中偵測 agent 角色（architect、planner、explorer、debugger、reviewer、implementer、tester），並將各角色路由到專用模型。
-   **自訂路由器**：支援最高優先級的 `provider,model` 顯式選擇。透過 JavaScript 模組實現自訂路由邏輯，按優先級順序評估：顯式模型覆寫、長上下文、子代理標籤、後台任務、agent 角色偵測、網路搜尋、思考模式。
-   **子代理模型標籤**：在子代理提示詞開頭使用 `<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>` 標籤指定模型。
-   **多提供商支援**：支援 OpenRouter、DeepSeek、Ollama、Gemini、Volcengine、ModelScope、DashScope 以及任何 OpenAI 相容 API。
-   **請求/回應轉換**：模組化的 transformer 管線，用於適配不同提供商 API 的請求與回應格式。Transformer 可全域套用、按模型套用或帶自訂選項套用。
-   **Prompt Cache Control 轉發**：將 prompt cache control（`cache_control`）轉發到支援此功能的上游 LLM 提供商，降低重複提示的延遲與成本。
-   **GLM 5.2 推理支援**：內建 GLM 5.2 模型的 reasoning/thinking transformer，支援交錯思考模式。
-   **預設管理**：透過預設系統（`ccr preset`）匯出、匯入、分享和重用設定。匯出時自動清理敏感資料。
-   **動態模型切換**：在 Claude Code 中使用 `/model` 命令動態切換模型，或透過 `ccr model` 互動式管理模型。
-   **外掛系統**：使用自訂 transformer 和外掛（如 token-speed 監控、status line）擴展功能。
-   **Agent SDK 整合**：使用 `ccr activate` 命令設定環境變數，直接使用 `claude` 命令，或與 Agent SDK 應用程式整合。
-   **x-api-key 認證透傳**：支援透過 `x-api-key` header 認證的提供商（如 OpenCode Zen、本地提供商）。
-   **CI/CD 整合**：透過 `NON_INTERACTIVE_MODE` 相容 GitHub Actions、Docker 等非互動式環境。

## 🚀 快速入門

### 1. 安裝

首先，請確保您已安裝 [Claude Code](https://docs.anthropic.com/en/docs/claude-code/quickstart)：

```shell
npm install -g @anthropic-ai/claude-code
```

然後，安裝 Claude Code Router：

```shell
npm install -g @jhangyu/claude-code-router
```

### 2. 設定

建立並設定您的 `~/.claude-code-router/config.json` 檔案。有關更多詳細資訊，您可以參考 repo 中的 `config.example.json`。

`config.json` 檔案有幾個關鍵部分：
-   **`PROXY_URL`** (選用)：您可以為 API 請求設定代理，例如：`"PROXY_URL": "http://127.0.0.1:7890"`。
-   **`LOG`** (選用)：您可以透過將其設定為 `true` 來啟用日誌記錄。當設定為 `false` 時，將不會建立日誌檔案。預設值為 `true`。
-   **`LOG_LEVEL`** (選用)：設定日誌級別。可用選項包括：`"fatal"`、`"error"`、`"warn"`、`"info"`、`"debug"`、`"trace"`。預設值為 `"debug"`。
-   **日誌系統**：Claude Code Router 使用兩個獨立的日誌系統：
  - **伺服器級別日誌**：HTTP 請求、API 呼叫和伺服器事件使用 pino 記錄在 `~/.claude-code-router/logs/` 目錄中，檔案名稱類似 `ccr-*.log`
  - **應用程式級別日誌**：路由決策和業務邏輯事件記錄在 `~/.claude-code-router/claude-code-router.log` 檔案中
-   **`APIKEY`** (選用)：您可以設定一個密鑰來進行身份驗證。設定後，客戶端請求必須在 `Authorization` 請求頭（例如，`Bearer your-secret-key`）或 `x-api-key` 請求頭中提供此密鑰。例如：`"APIKEY": "your-secret-key"`。
-   **`HOST`** (選用)：您可以設定服務的主機位址。如果未設定 `APIKEY`，出於安全考量，主機位址將強制設定為 `127.0.0.1`，以防止未經授權的存取。例如：`"HOST": "0.0.0.0"`。
-   **`NON_INTERACTIVE_MODE`** (選用)：當設定為 `true` 時，啟用與非互動式環境（如 GitHub Actions、Docker 容器或其他 CI/CD 系統）的相容性。這會設定適當的環境變數（`CI=true`、`FORCE_COLOR=0` 等）並設定 stdin 處理，以防止程序在自動化環境中掛起。例如：`"NON_INTERACTIVE_MODE": true`。
-   **`Providers`**：用於設定不同的模型提供商。
-   **`Router`**：用於設定路由規則。`default` 指定預設模型，如果未設定其他路由，則該模型將用於所有請求。
-   **`API_TIMEOUT_MS`**：API 請求超時時間，單位為毫秒。

#### 環境變數插值

Claude Code Router 支援環境變數插值，以實現安全的 API 金鑰管理。您可以使用 `$VAR_NAME` 或 `${VAR_NAME}` 語法在 `config.json` 中引用環境變數：

```json
{
  "OPENAI_API_KEY": "$OPENAI_API_KEY",
  "GEMINI_API_KEY": "${GEMINI_API_KEY}",
  "Providers": [
    {
      "name": "openai",
      "api_base_url": "https://api.openai.com/v1/chat/completions",
      "api_key": "$OPENAI_API_KEY",
      "models": ["gpt-5", "gpt-5-mini"]
    }
  ]
}
```

這使您可以將敏感 API 金鑰保留在環境變數中，而不是寫死在設定檔案中。插值會遞迴作用於巢狀物件和陣列。

這是一個綜合範例：

```json
{
  "APIKEY": "your-secret-key",
  "PROXY_URL": "http://127.0.0.1:7890",
  "LOG": true,
  "API_TIMEOUT_MS": 600000,
  "NON_INTERACTIVE_MODE": false,
  "Providers": [
    {
      "name": "openrouter",
      "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
      "api_key": "sk-xxx",
      "models": [
        "google/gemini-2.5-pro-preview",
        "anthropic/claude-sonnet-4",
        "anthropic/claude-3.5-sonnet",
        "anthropic/claude-3.7-sonnet:thinking"
      ],
      "transformer": {
        "use": ["openrouter"]
      }
    },
    {
      "name": "deepseek",
      "api_base_url": "https://api.deepseek.com/chat/completions",
      "api_key": "sk-xxx",
      "models": ["deepseek-chat", "deepseek-reasoner"],
      "transformer": {
        "use": ["deepseek"],
        "deepseek-chat": {
          "use": ["tooluse"]
        }
      }
    },
    {
      "name": "ollama",
      "api_base_url": "http://localhost:11434/v1/chat/completions",
      "api_key": "ollama",
      "models": ["qwen2.5-coder:latest"]
    },
    {
      "name": "gemini",
      "api_base_url": "https://generativelanguage.googleapis.com/v1beta/models/",
      "api_key": "sk-xxx",
      "models": ["gemini-2.5-flash", "gemini-2.5-pro"],
      "transformer": {
        "use": ["gemini"]
      }
    },
    {
      "name": "volcengine",
      "api_base_url": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      "api_key": "sk-xxx",
      "models": ["deepseek-v3-250324", "deepseek-r1-250528"],
      "transformer": {
        "use": ["deepseek"]
      }
    },
    {
      "name": "modelscope",
      "api_base_url": "https://api-inference.modelscope.cn/v1/chat/completions",
      "api_key": "",
      "models": ["Qwen/Qwen3-Coder-480B-A35B-Instruct", "Qwen/Qwen3-235B-A22B-Thinking-2507"],
      "transformer": {
        "use": [
          [
            "maxtoken",
            {
              "max_tokens": 65536
            }
          ],
          "enhancetool"
        ],
        "Qwen/Qwen3-235B-A22B-Thinking-2507": {
          "use": ["reasoning"]
        }
      }
    },
    {
      "name": "dashscope",
      "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      "api_key": "",
      "models": ["qwen3-coder-plus"],
      "transformer": {
        "use": [
          [
            "maxtoken",
            {
              "max_tokens": 65536
            }
          ],
          "enhancetool"
        ]
      }
    },
    {
      "name": "aihubmix",
      "api_base_url": "https://aihubmix.com/v1/chat/completions",
      "api_key": "sk-",
      "models": [
        "Z/glm-4.5",
        "claude-opus-4-20250514",
        "gemini-2.5-pro"
      ]
    }
  ],
  "Router": {
    "default": "deepseek,deepseek-chat",
    "background": "ollama,qwen2.5-coder:latest",
    "think": "deepseek,deepseek-reasoner",
    "longContext": "openrouter,google/gemini-2.5-pro-preview",
    "longContextThreshold": 60000,
    "webSearch": "gemini,gemini-2.5-flash"
  }
}
```


### 3. 使用 Router 執行 Claude Code

使用 router 啟動 Claude Code：

```shell
ccr code
```

> **注意**：修改設定檔案後，需要重啟服務使設定生效：
> ```shell
> ccr restart
> ```

### 4. UI 模式

為了獲得更直觀的體驗，您可以使用 UI 模式來管理您的設定：

```shell
ccr ui
```

這將開啟一個基於 Web 的介面，您可以在其中輕鬆檢視和編輯您的 `config.json` 檔案。

![UI](/blog/images/ui.png)

### 5. CLI 模型管理

對於偏好終端機工作流程的使用者，可以使用互動式 CLI 模型選擇器：

```shell
ccr model
```

該命令提供互動式介面來：

-   檢視目前設定
-   檢視所有已設定的模型（default、background、think、longContext、webSearch、image）
-   切換模型：快速更改每個路由器類型使用的模型
-   新增模型：向現有提供商新增模型
-   建立新提供商：設定完整的提供商設定，包括：
   -   提供商名稱和 API 端點
   -   API 金鑰
   -   可用模型
   -   Transformer 設定，支援：
     -   多個轉換器（openrouter、deepseek、gemini 等）
     -   Transformer 選項（例如，帶自訂限制的 maxtoken）
     -   特定於提供商的路由（例如，OpenRouter 提供商偏好）

CLI 工具驗證所有輸入並提供有用的提示來引導您完成設定過程，使管理複雜的設定變得容易，無需手動編輯 JSON 檔案。

### 6. 預設管理

預設允許您輕鬆儲存、分享和重複使用設定。您可以將目前設定匯出為預設，並從檔案或 URL 安裝預設。

```shell
# 將目前設定匯出為預設
ccr preset export my-preset

# 使用中繼資料匯出
ccr preset export my-preset --description "我的 OpenAI 設定" --author "您的名字" --tags "openai,生產環境"

# 從本地目錄安裝預設
ccr preset install /path/to/preset

# 列出所有已安裝的預設
ccr preset list

# 顯示預設資訊
ccr preset info my-preset

# 刪除預設
ccr preset delete my-preset
```

**預設功能：**
-   **匯出**：將目前設定儲存為預設目錄（包含 manifest.json）
-   **安裝**：從本地目錄安裝預設
-   **敏感資料處理**：匯出期間自動清理 API 金鑰和其他敏感資料（標記為 `{{field}}` 佔位符）
-   **動態設定**：預設可以包含輸入結構描述，用於在安裝期間收集所需資訊
-   **版本控制**：每個預設包含版本中繼資料，用於追蹤更新

**預設檔案結構：**
```
~/.claude-code-router/presets/
├── my-preset/
│   └── manifest.json    # 包含設定和中繼資料
```

### 7. Activate 命令（環境變數設定）

`activate` 命令允許您在 shell 中全域設定環境變數，使您能夠直接使用 `claude` 命令或將 Claude Code Router 與使用 Agent SDK 構建的應用程式整合。

要啟用環境變數，請執行：

```shell
eval "$(ccr activate)"
```

此命令會以 shell 友好的格式輸出必要的環境變數，這些變數將在目前的 shell 工作階段中設定。啟用後，您可以：

-   **直接使用 `claude` 命令**：無需使用 `ccr code` 即可執行 `claude` 命令。`claude` 命令將自動透過 Claude Code Router 路由請求。
-   **與 Agent SDK 應用程式整合**：使用 Anthropic Agent SDK 構建的應用程式將自動使用設定的路由器和模型。

`activate` 命令設定以下環境變數：

-   `ANTHROPIC_AUTH_TOKEN`：來自設定的 API 金鑰
-   `ANTHROPIC_BASE_URL`：本地路由器端點（預設：`http://127.0.0.1:3456`）
-   `NO_PROXY`：設定為 `127.0.0.1` 以防止代理干擾
-   `DISABLE_TELEMETRY`：禁用遙測
-   `DISABLE_COST_WARNINGS`：禁用成本警告
-   `API_TIMEOUT_MS`：來自設定的 API 超時時間

> **注意**：在使用啟用的環境變數之前，請確保 Claude Code Router 服務正在執行（`ccr start`）。環境變數僅在目前 shell 工作階段中有效。要使其持久化，您可以將 `eval "$(ccr activate)"` 新增到您的 shell 設定檔（例如 `~/.zshrc` 或 `~/.bashrc`）中。

#### Providers

`Providers` 陣列是您定義要使用的不同模型提供商的地方。每個提供商物件都需要：

-   `name`：提供商的唯一名稱。
-   `api_base_url`：聊天補全的完整 API 端點。
-   `api_key`：您提供商的 API 金鑰。
-   `models`：此提供商可用的模型名稱列表。
-   `transformer` (選用)：指定用於處理請求和回應的轉換器。

針對透過 `x-api-key` header（而非 `Authorization: Bearer`）驗證的提供商，路由器支援透傳驗證 — 設定 `api_key` 欄位後，請求將以適當的 header 轉發。

#### Transformers

Transformers 允許您修改請求和回應負載，以確保與不同提供商 API 的相容性。

-   **全域 Transformer**：將轉換器應用於提供商的所有模型。在此範例中，`openrouter` 轉換器將應用於 `openrouter` 提供商下的所有模型。
    ```json
     {
       "name": "openrouter",
       "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
       "api_key": "sk-xxx",
       "models": [
         "google/gemini-2.5-pro-preview",
         "anthropic/claude-sonnet-4",
         "anthropic/claude-3.5-sonnet"
       ],
       "transformer": { "use": ["openrouter"] }
     }
    ```
-   **特定於模型的 Transformer**：將轉換器應用於特定模型。在此範例中，`deepseek` 轉換器應用於所有模型，而額外的 `tooluse` 轉換器僅應用於 `deepseek-chat` 模型。
    ```json
     {
       "name": "deepseek",
       "api_base_url": "https://api.deepseek.com/chat/completions",
       "api_key": "sk-xxx",
       "models": ["deepseek-chat", "deepseek-reasoner"],
       "transformer": {
         "use": ["deepseek"],
         "deepseek-chat": { "use": ["tooluse"] }
       }
     }
    ```

-   **向 Transformer 傳遞選項**：某些轉換器（如 `maxtoken`）接受選項。要傳遞選項，請使用巢狀陣列，其中第一個元素是轉換器名稱，第二個元素是選項物件。
    ```json
    {
      "name": "siliconflow",
      "api_base_url": "https://api.siliconflow.cn/v1/chat/completions",
      "api_key": "sk-xxx",
      "models": ["moonshotai/Kimi-K2-Instruct"],
      "transformer": {
        "use": [
          [
            "maxtoken",
            {
              "max_tokens": 16384
            }
          ]
        ]
      }
    }
    ```

**可用的內建 Transformer：**

-   `Anthropic`：如果你只使用這一個轉換器，則會直接透傳請求和回應（你可以用它來接入其他支援 Anthropic 端點的服務商）。
-   `deepseek`：適配 DeepSeek API 的請求/回應。
-   `gemini`：適配 Gemini API 的請求/回應。
-   `openrouter`：適配 OpenRouter API 的請求/回應。它還可以接受一個 `provider` 路由參數，以指定 OpenRouter 應使用哪些底層提供商。有關更多詳細資訊，請參閱 [OpenRouter 文件](https://openrouter.ai/docs/features/provider-routing)。請參閱下面的範例：
    ```json
      "transformer": {
        "use": ["openrouter"],
        "moonshotai/kimi-k2": {
          "use": [
            [
              "openrouter",
              {
                "provider": {
                  "only": ["moonshotai/fp8"]
                }
              }
            ]
          ]
        }
      }
    ```
-   `groq`：適配 groq API 的請求/回應
-   `maxtoken`：設定特定的 `max_tokens` 值。
-   `tooluse`：最佳化某些模型的工具使用（透過 `tool_choice` 參數）。
-   `gemini-cli` (實驗性)：透過 Gemini CLI [gemini-cli.js](https://gist.github.com/musistudio/1c13a65f35916a7ab690649d3df8d1cd) 對 Gemini 的非官方支援。
-   `reasoning`：用於處理 `reasoning_content` 欄位。支援 GLM 5.2 及其他具備推理/思考能力的模型，包含交錯思考模式。
-   `sampling`：用於處理採樣資訊欄位，如 `temperature`、`top_p`、`top_k` 和 `repetition_penalty`。
-   `enhancetool`：對 LLM 回傳的工具呼叫參數增加一層容錯處理（這會導致不再流式回傳工具呼叫資訊）。
-   `cleancache`：清除請求中的 `cache_control` 欄位。預設情況下，路由器會將 prompt cache control header 轉發到支援此功能的上游提供商。若您需要移除 cache control，請使用此 transformer。
-   `vertex-gemini`：處理使用 vertex 鑑權的 gemini api。
-   `chutes-glm`：透過 Chutes 對 GLM 4.5 的非官方支援 [chutes-glm-transformer.js](https://gist.github.com/vitobotta/2be3f33722e05e8d4f9d2b0138b8c863)。
-   `qwen-cli` (實驗性)：透過 Qwen CLI [qwen-cli.js](https://gist.github.com/musistudio/f5a67841ced39912fd99e42200d5ca8b) 對 qwen3-coder-plus 的非官方支援。
-   `rovo-cli` (experimental)：透過 Atlassian Rovo Dev CLI [rovo-cli.js](https://gist.github.com/SaseQ/c2a20a38b11276537ec5332d1f7a5e53) 對 GPT-5 的非官方支援。

**自訂 Transformer：**

您還可以建立自己的轉換器，並透過 `config.json` 中的 `transformers` 欄位載入它們。

```json
{
  "transformers": [
      {
        "path": "/User/xxx/.claude-code-router/plugins/gemini-cli.js",
        "options": {
          "project": "xxx"
        }
      }
  ]
}
```

#### Router

`Router` 物件定義了在不同場景下使用哪個模型：

-   `default`：用於一般任務的預設模型。
-   `background`：用於後台任務的模型。這可以是一個較小的本地模型以節省成本。
-   `think`：用於推理密集型任務（如計劃模式）的模型。
-   `longContext`：用於處理長上下文（例如，> 60K 令牌）的模型。
-   `longContextThreshold` (選用)：觸發長上下文模型的令牌數閥值。如果未指定，預設為 60000。
-   `webSearch`：用於處理網路搜尋任務，需要模型本身支援。如果使用 `openrouter` 需要在模型後面加上 `:online` 後綴。
-   `image` (測試版)：用於處理圖片類任務（採用 CCR 內建的 agent 支援），如果該模型不支援工具呼叫，需要將 `config.forceUseImageAgent` 屬性設定為 `true`。

##### Agent 角色路由

除了上述的場景路由外，自訂路由器還支援根據系統提示詞中偵測到的 agent 角色進行路由。啟用 `CUSTOM_ROUTER_PATH` 後，以下角色路由可用：

-   `architect`：系統架構、API 設計、微服務模式。
-   `planner`：實作規劃、軟體設計、將模糊需求轉化為具體計劃。
-   `explorer`：程式碼庫探索、功能發現、唯讀程式碼搜尋。
-   `debugger`：根本原因調查、錯誤分析、假設驅動除錯。
-   `reviewer`：程式碼審查、安全審計、靜態分析。
-   `implementer`：功能實作、程式碼構建、平行功能開發。
-   `tester`：測試自動化、TDD 工作流程、測試套件建立。

在您的 `Router` 中與其他場景一同設定這些路由：

```json
{
  "Router": {
    "default": "openrouter,anthropic/claude-sonnet-4",
    "background": "ollama,qwen2.5-coder:latest",
    "think": "deepseek,deepseek-reasoner",
    "architect": "openrouter,anthropic/claude-opus-4-20250514",
    "planner": "openrouter,anthropic/claude-opus-4-20250514",
    "explorer": "openrouter,anthropic/claude-haiku-4-5-20251001",
    "debugger": "deepseek,deepseek-reasoner",
    "reviewer": "openrouter,anthropic/claude-sonnet-4",
    "implementer": "deepseek,deepseek-chat",
    "tester": "openrouter,anthropic/claude-haiku-4-5-20251001",
    "longContext": "openrouter,google/gemini-2.5-pro-preview",
    "longContextThreshold": 60000,
    "webSearch": "gemini,gemini-2.5-flash"
  }
}
```

您還可以使用 `/model` 命令在 Claude Code 中動態切換模型：
`/model provider_name,model_name`
範例：`/model openrouter,anthropic/claude-3.5-sonnet`

#### 自訂路由器

對於更進階的路由邏輯，您可以在 `config.json` 中透過 `CUSTOM_ROUTER_PATH` 欄位指定一個自訂路由器腳本。這允許您實現超出預設場景的複雜路由規則。

在您的 `config.json` 中設定：

```json
{
  "CUSTOM_ROUTER_PATH": "/User/xxx/.claude-code-router/custom-router.js"
}
```

自訂路由器檔案必須是一個匯出 `async` 函數的 JavaScript 模組。該函數接收請求物件和設定物件作為參數，並應回傳提供商和模型名稱的字串（例如 `"provider_name,model_name"`），如果回傳 `null` 則回退到預設路由。

##### 路由優先級

自訂路由器按嚴格優先級順序評估場景：

1.  **顯式模型**（最高優先級）：如果 `req.body.model` 包含一個存在於設定中的有效 `"provider,model"` 字串，則直接使用。這讓您可以明確控制哪個模型處理請求。
2.  **長上下文**：當請求的 token 數量超過 `longContextThreshold` 時，使用 `longContext` 模型。
3.  **子代理模型標籤**：從子代理提示詞中擷取 `<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>` 標籤。
4.  **後台任務**：偵測 Claude Haiku 請求並路由到 `background` 模型。
5.  **Agent 角色**：從系統提示詞中偵測 agent 角色（architect、planner、explorer、debugger、reviewer、implementer、tester）。
6.  **網路搜尋**：當請求包含網路搜尋工具時。
7.  **思考模式**：當請求包含思考模式（`req.body.thinking`）時。
8.  **預設**（回退）：使用 `Router` 中的 `default` 模型。

這是一個基於 `custom-router.example.js` 的 `custom-router.js` 範例：

```javascript
// /User/xxx/.claude-code-router/custom-router.js

/**
 * 一個自訂路由函數，用於根據請求確定使用哪個模型。
 *
 * @param {object} req - 來自 Claude Code 的請求物件，包含請求體。
 * @param {object} config - 應用程式的設定物件。
 * @returns {Promise<string|null>} - 一個解析為 "provider,model_name" 字串的 Promise，如果回傳 null，則使用預設路由。
 */
module.exports = async function router(req, config) {
  const userMessage = req.body.messages.find(m => m.role === 'user')?.content;

  if (userMessage && userMessage.includes('解釋這段程式碼')) {
    // 為程式碼解釋任務使用更強大的模型
    return 'openrouter,anthropic/claude-3.5-sonnet';
  }

  // 回退到預設的路由設定
  return null;
};
```

完整的實作（包含所有場景偵測器、agent 角色匹配與顯式模型解析）請參考倉庫中的 `custom-router.js`。

##### 子代理路由

對於子代理內的路由，您必須在子代理提示詞的**開頭**包含 `<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>` 來指定特定的提供商和模型。這樣可以將特定的子代理任務定向到指定的模型。

**範例：**

```
<CCR-SUBAGENT-MODEL>openrouter,anthropic/claude-3.5-sonnet</CCR-SUBAGENT-MODEL>
請幫我分析這段程式碼是否存在潛在的最佳化空間...
```

標籤會在請求轉發到上游提供商之前自動從提示詞中移除。

## Status Line (Beta)
為了在執行時更好的檢視 claude-code-router 的狀態，claude-code-router 在 v1.0.40 內建了一個 statusline 工具，你可以在 UI 中啟用它，
![statusline-config.png](/blog/images/statusline-config.png)

效果如下：
![statusline](/blog/images/statusline.png)

## 🤖 GitHub Actions

將 Claude Code Router 整合到您的 CI/CD 管道中。在設定 [Claude Code Actions](https://docs.anthropic.com/en/docs/claude-code/github-actions) 後，修改您的 `.github/workflows/claude.yaml` 以使用路由器：

```yaml
name: Claude Code

on:
  issue_comment:
    types: [created]
  # ... other triggers

jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      # ... other conditions
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Prepare Environment
        run: |
          curl -fsSL https://bun.sh/install | bash
          mkdir -p $HOME/.claude-code-router
          cat << 'EOF' > $HOME/.claude-code-router/config.json
          {
            "log": true,
            "NON_INTERACTIVE_MODE": true,
            "OPENAI_API_KEY": "${{ secrets.OPENAI_API_KEY }}",
            "OPENAI_BASE_URL": "https://api.deepseek.com",
            "OPENAI_MODEL": "deepseek-chat"
          }
          EOF
        shell: bash

      - name: Start Claude Code Router
        run: |
          nohup ~/.bun/bin/bunx @jhangyu/claude-code-router@1.0.8 start &
        shell: bash

      - name: Run Claude Code
        id: claude
        uses: anthropics/claude-code-action@beta
        env:
          ANTHROPIC_BASE_URL: http://localhost:3456
        with:
          anthropic_api_key: "any-string-is-ok"
```

這種設定可以實現有趣的自動化，例如在非尖峰時段執行任務以降低 API 成本。

## 📝 深入閱讀

-   [專案動機和工作原理](blog/zh/專案初衷及原理.md)
-   [也許我們可以用路由器做更多事情](blog/zh/或許我們能在Router中做更多事情.md)
-   [GLM-4.6 支援思考及思維鏈回傳](blog/zh/GLM-4.6支持思考及思维链回传.md)

## 🐳 Docker 部署

### 使用 Docker Compose（推薦）

建立 `docker-compose.yml`：

```yaml
services:
  claude-code-router:
    container_name: claude-code-router
    image: jhangyu/claude-code-router:latest
    ports:
      - "3456:3456"
    volumes:
      - ~/.claude-code-router:/root/.claude-code-router
    restart: unless-stopped
```

```shell
# 啟動服務
docker compose up -d

# 查看日誌
docker compose logs -f

# 停止服務
docker compose down
```

### 使用 Docker Run

```shell
docker run -d \
  --name claude-code-router \
  -p 3456:3456 \
  -v ~/.claude-code-router:/root/.claude-code-router \
  --restart unless-stopped \
  jhangyu/claude-code-router:latest
```

### 設定

在啟動容器前，將 `config.json` 放置在 `~/.claude-code-router/config.json`。設定目錄已作為 volume 掛載，重啟後變更即可生效：

```shell
# 修改設定後重啟
docker restart claude-code-router
```

您也可以透過環境變數插值功能傳入設定（參閱上方[環境變數插值](#環境變數插值)）。

### 從原始碼構建

**多架構構建（amd64 + arm64）：**

```shell
docker build -f Dockerfile.multiarch -t claude-code-router .
```

**僅構建伺服器：**

```shell
docker build -f packages/server/Dockerfile -t claude-code-router .
```

### 健康檢查

容器在埠 `3456` 上提供健康檢查端點。驗證服務是否正常執行：

```shell
curl http://localhost:3456/health
```

### 環境變數

| 變數 | 說明 | 預設值 |
|----------|-------------|---------|
| `PORT` | 伺服器監聽埠 | `3456` |
| `LOG_LEVEL` | 日誌等級（`fatal`/`error`/`warn`/`info`/`debug`/`trace`） | `debug` |
| `API_TIMEOUT_MS` | API 請求逾時時間（毫秒） | `600000` |

這些可以在 `docker-compose.yml` 中設定：

```yaml
services:
  claude-code-router:
    # ...
    environment:
      - LOG_LEVEL=info
      - API_TIMEOUT_MS=300000
```

