# YouTube 字幕增強器 - 專案情境總結 (v3.0.0)

## 1. 專案目標與核心功能

此應用程式是一個 Chrome 擴充功能，旨在即時攔截並翻譯 YouTube 影片字幕。它為使用者解決了觀看外語影片時，原生字幕品質不佳或無繁體中文選項的問題。

v3.0.0 架構的核心轉變是**完全 Serverless 化**。專案已移除所有對本地 Python (`backend.py`) 伺服器的依賴，將所有 AI 翻譯、金鑰管理和 Prompt 儲存邏輯全部遷移至擴充功能內部的 Service Worker (`background.js`) 中。

核心功能包含：
* **Serverless AI 翻譯**：由 `background.js` 直接呼叫 Google Gemini API (`generativelanguage.googleapis.com`) 進行字幕翻譯。
* **多金鑰管理**：使用者可在「管理後台」安全地儲存*多個* Gemini API Key。`background.js` 會在翻譯時自動依序重試，並內建配額 (Quota) 偵測與冷卻機制。
* **雙語字幕顯示**：在 YouTube 播放器上渲染一個自訂的、可同時顯示「原文」與「譯文」的字幕介面。
* **智慧語言匹配**：自動比對影片可用字幕軌道與使用者的「偏好語言列表」，自動觸發翻譯流程。
* **永久翻譯快取**：已翻譯過的影片字幕會被儲存在 `chrome.storage.local`，下次觀看同一影片時可秒速載入。
* **標準化日誌系統**：所有關鍵錯誤（如 API 失敗、金鑰失效）都會被記錄在 `chrome.storage.session` 中，並顯示於「管理後台」供使用者除錯。

## 2. 系統架構與資訊流

### 架構組成：

* **後端 (Backend)**：
    * **[已移除]** `backend.py` (Python Flask 伺服器)。
    * **[取代]** `background.js` (Chrome Service Worker)。
    * **職責**：作為擴充功能的核心後端。管理所有 `chrome.storage`、處理內部 API 請求 (`translateBatch`, `diagnoseAllKeys`)、組合 Prompts、並*直接*呼叫 Google Gemini API (`generativelanguage.googleapis.com`)。
* **前端 (Chrome Extension)**：
    * **Injector Script (`injector.js`)**: **(MAIN World)** "現場特工"。唯一能存取頁面 `window` 物件的腳本。負責攔截 `fetch` / `XHR` 網路請求 (抓取 `timedtext` 字幕) 並存取 `player` 物件 (獲取 `playerResponse`、強制 `setOption`)。
    * **Content Script (`content.js`)**: **(ISOLATED World)** "指揮中心"。實作所有前端翻譯流程、UI 渲染 (雙語字幕、狀態圓環)、狀態管理，並作為 `injector.js` (透過 `postMessage`) 和 `background.js` (透過 `sendMessage`) 之間的溝通橋樑。
    * **Options (`options.html` / `popup.js`)**: "管理後台"。提供多金鑰管理、Prompt 自訂、語言偏好設定、模型排序、金鑰診斷與日誌檢視。
    * **Popup (`popup.html` / `popup.js`)**: "遙控器"。提供快速開關、即時外觀調整、強制重跑。
* **資料儲存**：
    * `chrome.storage.local`: 儲存使用者設定 (`ytEnhancerSettings`)、影片翻譯快取 (`yt-enhancer-cache-[VIDEO_ID]`)、**使用者 API 金鑰 (`userApiKeys: []`)**、**自訂 Prompts (`customPrompts: {}`)**。
    * `chrome.storage.session`: 儲存標準化日誌 (`errorLogs: LogEntry[]`)。

### 典型資訊流：

1.  **[流程一：啟動與握手]**
    1.  `background.js` 透過 `chrome.scripting.registerContentScripts` 將 `injector.js` 注入 `MAIN` World。
    2.  `content.js` (ISOLATED World) 載入，並透過 `window.postMessage('REQUEST_PLAYER_RESPONSE')` 開始輪詢 `injector.js`。
    3.  `injector.js` 監聽到 `yt-navigate-finish`，找到播放器實例，呼叫 `player.getPlayerResponse()` 獲取影片資料並暫存 (`state.playerResponse`)。
    4.  `injector.js` 收到 `REQUEST_PLAYER_RESPONSE` 信號，回傳 `PLAYER_RESPONSE_CAPTURED` 資料。
    5.  `content.js` 收到資料，停止輪詢，呼叫 `start()` 進入主流程。

2.  **[流程二：Serverless 翻譯 (無快取)]**
    1.  `content.js` 於 `start()` 中比對軌道與偏好，匹配成功 (例如 `ja`)。
    2.  `content.js` 檢查快取 (`getCache`)，確認無快取。
    3.  `content.js` 鎖定目標 `targetVssId`，啟動 `activationWatchdog` (3秒看門狗)，並透過 `postMessage('FORCE_ENABLE_TRACK', ...)` 命令 `injector.js`。
    4.  `injector.js` 執行 `player.setOption(...)` (含 3 次重試保險) 強制 YT 播放器請求該字幕。
    5.  `injector.js` 的網路攔截器捕獲 `/api/timedtext` 的 *回應 (Response)*。
    6.  `injector.js` 透過 `postMessage('TIMEDTEXT_DATA', ...)` 將字幕內容 (`data`)、`lang` 和 `vssId` 傳給 `content.js`。
    7.  `content.js` 收到 `TIMEDTEXT_DATA`，驗證 `vssId` 匹配，解除 `activationWatchdog`。
    8.  `content.js` 呼叫 `activate()` -> `parseAndTranslate()` -> `processNextBatch()`。
    9.  `content.js` **(關鍵變更)** 呼叫 `chrome.runtime.sendMessage({ action: 'translateBatch', texts: [...] })` 將批次(30句)送至 `background.js`。
    10. `background.js` 收到 `translateBatch` 任務，從 `chrome.storage.local` 讀取 `userApiKeys` 和 `customPrompts`。
    11. `background.js` 執行「金鑰-模型」雙重迴圈，組合 `fullPrompt`，並 `fetch` 呼叫 `https://generativelanguage.googleapis.com/...`。
    12. `background.js` 收到 Google 回應，解析 `JSON.parse(responseData.candidates[0].content.parts[0].text)`。
    13. `background.js` 透過 `sendResponse({ data: [...] })` 將翻譯陣列回傳給 `content.js`。
    14. `content.js` 收到翻譯，更新 `state.translatedTrack`，並呼叫 `setCache` 存入 `chrome.storage.local`。

## 3. 專案檔案結構與職責

* **後端 (Backend)**：
    * `backend.py`: **[已棄用]** (v2.1.0 歷史檔案)。
    * `background.js`: (Service Worker) **核心後端**。實作所有 Serverless 邏輯：`translateBatch` (Gemini API 呼叫)、`diagnoseAllKeys` (金鑰診斷)、`writeToLog` (日誌系統)、`get/setCache` (快取代理)、`get/setSettings` (設定管理)。
* **前端 (Frontend)**：
    * `injector.js`: (MAIN World) "現場特工"。攔截 `timedtext` 網路請求、存取 `player` 物件 (`getPlayerResponse`, `setOption`)。
    * `content.js`: (Isolated World) "指揮中心"。實作所有前端翻譯流程、UI 渲染 (字幕/圓環)、狀態管理 (包含 `activationWatchdog` 和語言切換重置邏輯)，並作為所有組件的溝通橋樑。
* **介面與邏輯 (UI & Logic)**：
    * `manifest.json`: (v3.0.0) 擴充功能清單。**關鍵權限**：`storage`, `scripting`, `tabs`, `host_permissions: ["...youtube.com/*", "...googleapis.com/*"]`。
    * `popup.html`: "遙控器" (Action Popup) 的 UI 介面。
    * `options.html`: "管理後台" (Options Page) 的 UI 介面。**關鍵區域**：`#apiKeyList` (金鑰管理), `#error-log-container` (日誌顯示)。
    * `popup.js`: **共享腳本**。處理 `popup.html` 和 `options.html` 的所有 DOM 事件與邏輯。**關鍵邏輯**：多金鑰 CRUD、`loadErrorLogs` 渲染、Prompt 存取 (`chrome.storage.local`)、`diagnoseKeysButton` 事件。
* **樣式與資源**：
    * `style.css`: `content.js` 注入的 CSS，定義雙語字幕容器 (`#enhancer-subtitle-container`)、狀態圓環 (`#enhancer-status-orb`) 及原生字幕隱藏規則 (`!important`)。
    * `popup.css`: `popup.html` 和 `options.html` 的共享樣式。

## 4. 後端 API 溝通協議

**[已棄用]** v2.1.0 的 `127.0.0.1:5001` HTTP API 已全部移除。
系統改為使用 `chrome.runtime.sendMessage` 進行內部 API 呼叫 (由 `background.js` 處理)。

* **`chrome.runtime.sendMessage({ action: 'translateBatch', ... })`**
    * **功能**: (取代 `POST /api/translate`) 翻譯一個批次的文字。
    * **請求 (Request)**: `{ action: 'translateBatch', texts: ["..."], source_lang: "ja", models_preference: ["..."] }`
    * **成功回應 (Response)**: `{ data: ["...", "..."] }`
    * **失敗回應 (Response)**: `{ error: "錯誤訊息" }`
* **`chrome.runtime.sendMessage({ action: 'diagnoseAllKeys' })`**
    * **功能**: (取代 `POST /api/keys/diagnose`) 診斷所有儲存在 `storage` 中的 API 金鑰。
    * **請求 (Request)**: `{ action: 'diagnoseAllKeys' }`
    * **回應 (Response)**: `[ { "name": "Key1", "status": "valid" | "invalid", "error": "..." } ]`
* **`chrome.runtime.sendMessage({ action: 'STORE_ERROR_LOG', ... })`**
    * **功能**: (日誌系統) 供 `content.js` 寫入持續性錯誤。
    * **請求 (Request)**: `{ action: 'STORE_ERROR_LOG', payload: { message: "...", ... } }`
    * **回應 (Response)**: `{ success: true }`
* **[資料儲存 API (取代 `/api/prompts`)]**
    * **功能**: `popup.js` (Options 頁) 和 `background.js` (翻譯時) 直接透過 `chrome.storage.local.get/set` 存取 `userApiKeys` 和 `customPrompts` 物件。

## 5. 關鍵決策與歷史包袱 (重要)

* **[決策] Serverless 架構遷移 (v3.0.0)**：
    **原因**：這是 `Plan.md` 的核心決策。為了消除對本地 Python (`backend.py`) 的依賴、簡化安裝流程、移除安全風險 (CORS `*`) 並降低維護成本，我們將所有後端邏輯（API 呼叫、金鑰管理、Prompt 組合）全部遷移到 `background.js` 中。
* **[決策] 引入多金鑰管理 (`userApiKeys`)**：
    **原因**：在 Serverless 架構下，我們不能再依賴讀取本地 `api_keys.txt` 檔案。`Plan.md` (階段 1.A) 決定在 `options.html` 中建立一個 UI，讓使用者將多個金鑰儲存在 `chrome.storage.local`。`background.js` 則複製了舊後端的金鑰迴圈重試邏輯。
* **[決策] 引入標準化日誌 (`LogEntry`)**：
    **原因**：`background.js` 的呼叫失敗時（例如 Quota 耗盡、金鑰無效），使用者無法像 `backend.py` 那樣查看終端機。`Plan.md` (階段 1.B) 決定建立一個標準化 `LogEntry` 格式，將所有錯誤/警告儲存在 `chrome.storage.session` 中，並顯示在 `options.html`，以實現可除錯性。
* **[決策] `injector.js` 攔截「回應 (Response)」**：
    **原因**：我們必須*取得* YouTube 伺服器回傳的字幕*內容* (`response.json()`)，而不是僅僅知道請求被發出。
* **[決策] `content.js` 的 `activationWatchdog`**：
    **原因**：`player.setOption()` 指令有時會被 YT 播放器靜默忽略。`content.js` 在發出指令後會啟動一個 3 秒看門狗。如果 3 秒內*目標 `vssId`* 的字幕沒回來 (`TIMEDTEXT_DATA`)，流程會被標記為失敗並顯示提示，避免無限等待。
* **[歷史包袱] `injector.js` 的 3 次重試保險**：
    **原因**：為了解決上述 `player.setOption()` 偶爾失效的問題，`injector.js` 在收到 `FORCE_ENABLE_TRACK` 指令時，會分別在 0ms, 250ms, 500ms *執行 3 次* `setOption`，以最大努力確保指令至少有一次被成功執行。

## 6. 嚴格護欄 (Guard Rails) (最重要)

* **[禁止]**：**嚴格禁止**重新引入任何對本地伺服器 (`127.0.0.1` 或 `backend.py`) 的依賴或 `fetch` 呼叫。專案必須保持 100% Serverless。
* **[禁止]**：**嚴格禁止**修改 `injector.js` 的注入設定 (`world: "MAIN"`)。這是存取 `player` 物件和攔截 `fetch` 的唯一方法。
* **[禁止]**：**嚴格禁止**在 `content.js` (Isolated World) 中直接存取 `window.player` 或 `window.fetch`。所有與頁面 `window` 的互動*必須*透過 `postMessage` 委派給 `injector.js`。
* **[禁止]**：**嚴格禁止**修改 `background.js` 中 `translateBatch` 的成功回應格式。`content.js` 依賴其回傳 `{ data: [...] }` 結構。
* **[禁止]**：**嚴格禁止**將 API 金鑰或自訂 Prompts 硬編碼 (Hardcode) 在 `background.js` 中。所有金鑰和 Prompts *必須*從 `chrome.storage.local` 動態讀取。
* **[禁止]**：**嚴格禁止**在 `background.js` 中使用 `console.error` 以外的方式處理致命錯誤。所有可預期的錯誤（金鑰失效、Quota、模型錯誤）*必須*呼叫 `writeToLog` 函式寫入 `chrome.storage.session`，以確保使用者可在 UI 上看到日誌。