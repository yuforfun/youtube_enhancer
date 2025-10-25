# YouTube 字幕增強器 - 專案情境總結 (v3.1.2)

## 1. 專案目標與核心功能

此應用程式是一個 Chrome Manifest V3 擴充功能，旨在即時攔截並翻譯 YouTube 影片字幕。它為使用者解決了觀看外語影片時，原生字幕品質不佳或無繁體中文選項的問題。

v3.0.0 架構的核心轉變是**完全 Serverless 化**。專案已移除所有對本地 Python (`backend.py`) 伺服器的依賴，將所有 AI 翻譯、金鑰管理和 Prompt 儲存邏輯全部遷移至擴充功能內部的 Service Worker (`background.js`) 中。

核心功能包含：
* **Serverless AI 翻譯**：由 `background.js` 直接呼叫 Google Gemini API (`generativelanguage.googleapis.com`) 進行字幕翻譯。
* **多金鑰管理**：使用者可在「管理後台」安全地儲存*多個* Gemini API Key。`background.js` 會在翻譯時自動依序重試，並內建配額 (Quota) 偵測與冷卻機制。
* **智慧錯誤處理 (v3.1.x)**：
    * **後端智慧分類**：`background.js` 能分析 API 失敗的根本原因，並回傳三種結構化錯誤：
        1.  `TEMPORARY_FAILURE` (可重試，如 429/503)
        2.  `PERMANENT_FAILURE` (應停止，如金鑰失效)
        3.  `BATCH_FAILURE` (批次內容錯誤)
    * **前端響應式 UI**：`content.js` 根據後端回傳的錯誤，執行三種不同的 UI 響應：
        1.  **(情境一 / 黃色)**：收到 `TEMPORARY_FAILURE`，顯示「黑底黃框 + 進度 %」圓環，並在 API 建議的延遲後自動重試。
        2.  **(情境二 / 紅色)**：收到 `PERMANENT_FAILURE`，顯示紅色 `!` 圓環，翻譯流程停止。
        3.  **(情境三 / 點擊)**：收到 `BATCH_FAILURE`，在字幕區顯示「點擊重試」，並允許進度條繼續。
* **雙語字幕顯示**：在 YouTube 播放器上渲染一個自訂的、可同時顯示「原文」與「譯文」的字幕介面。
* **智慧語言匹配**：自動比對影片可用字幕軌道與使用者的「偏好語言列表」，自動觸發翻譯流程。
* **永久翻譯快取**：已翻譯過的影片字幕會被儲存在 `chrome.storage.local`，下次觀看同一影片時可秒速載入。
* **標準化日誌系統**：所有關鍵錯誤（如 API 失敗、金鑰失效）都會被記錄在 `chrome.storage.session` 中，並顯示於「管理後台」供使用者除錯。

## 2. 系統架構與資訊流

### 架構組成：

* **後端 (Backend)**：
    * `background.js` (Chrome Service Worker)：**核心後端**。管理所有 `chrome.storage`、處理內部 API 請求 (`translateBatch`, `diagnoseAllKeys`)、組合 Prompts、並*直接*呼叫 Google Gemini API (`generativelanguage.googleapis.com`)。
* **前端 (Chrome Extension)**：
    * `injector.js` (MAIN World)："現場特工"。唯一能存取頁面 `window` 物件的腳本。負責攔截 `fetch` / `XHR` 網路請求 (抓取 `timedtext` 字幕) 並存取 `player` 物件 (獲取 `playerResponse`、強制 `setOption`)。
    * `content.js` (ISOLATED World)："指揮中心"。實作所有前端翻譯流程、UI 渲染 (雙語字幕、狀態圓環)、狀態管理，並作為 `injector.js` (透過 `postMessage`) 和 `background.js` (透過 `sendMessage`) 之間的溝通橋樑。
    * `options.html` / `popup.js`："管理後台"。提供多金鑰管理、Prompt 自訂、語言偏好設定、模型排序、金鑰診斷與日誌檢視。
    * `popup.html` / `popup.js`："遙控器"。提供快速開關、即時外觀調整、強制重跑。
* **資料儲存**：
    * `chrome.storage.local`: 儲存使用者設定 (`ytEnhancerSettings`)、影片翻譯快取 (`yt-enhancer-cache-[VIDEO_ID]`)、**使用者 API 金鑰 (`userApiKeys: []`)**、**自訂 Prompts (`customPrompts: {}`)**。
    * `chrome.storage.session`: 儲存標準化日誌 (`errorLogs: LogEntry[]`)、**金鑰冷卻狀態 (`apiKeyCooldowns: {}`)**。

### 典型資訊流：

1.  **[流程一：啟動與握手]**
    1.  `background.js` 透過 `chrome.scripting.registerContentScripts` 將 `injector.js` 注入 `MAIN` World。
    2.  `content.js` (ISOLATED World) 載入，並透過 `window.postMessage('REQUEST_PLAYER_RESPONSE')` 開始輪詢 `injector.js`。
    3.  `injector.js` 監聽到 `yt-navigate-finish`，找到播放器實例，呼叫 `player.getPlayerResponse()` 獲取影片資料並暫存 (`state.playerResponse`)。
    4.  `injector.js` 收到 `REQUEST_PLAYER_RESPONSE` 信號，回傳 `PLAYER_RESPONSE_CAPTURED` 資料。
    5.  `content.js` 收到資料，停止輪詢，呼叫 `start()` 進入主流程。

2.  **[流程二：Serverless 翻譯 (v3.0)]**
    1.  `content.js` 於 `start()` 中匹配到偏好語言 (例如 `ja`)，檢查快取 (`getCache`)，確認無快取。
    2.  `content.js` 鎖定目標 `targetVssId`，啟動 `activationWatchdog` (3秒看門狗)，並透過 `postMessage('FORCE_ENABLE_TRACK', ...)` 命令 `injector.js`。
    3.  `injector.js` 執行 `player.setOption(...)` (含 3 次重試保險) 強制 YT 播放器請求該字幕。
    4.  `injector.js` 的網路攔截器捕獲 `/api/timedtext` 的 *回應 (Response)*，並 `postMessage('TIMEDTEXT_DATA', ...)`。
    5.  `content.js` 收到 `TIMEDTEXT_DATA`，驗證 `vssId` 匹配，解除 `activationWatchdog`。
    6.  `content.js` 呼叫 `activate()` -> `parseAndTranslate()` -> `processNextBatch()`。
    7.  `content.js` 呼叫 `chrome.runtime.sendMessage({ action: 'translateBatch', texts: [...] })` 將批次(30句)送至 `background.js`。
    8.  `background.js` 收到任務，從 `storage` 讀取 `userApiKeys` 和 `customPrompts`。
    9.  `background.js` 執行「金鑰-模型」雙重迴圈，呼叫 Google API。
    10. `background.js` 透過 `sendResponse({ data: [...] })` 將翻譯陣列回傳給 `content.js`。
    11. `content.js` 收到翻譯，更新 `state.translatedTrack`，並呼叫 `setCache` 存入 `chrome.storage.local`。

3.  **[流程三：智慧錯誤處理 (v3.1.2)]**
    1.  `background.js` 在(流程二 步驟 9)中呼叫 Google API 失敗。
    2.  `background.js` *分析* 錯誤。
    3.  **(情境 A: 暫時性過載)**：
        * `background.js` 偵測到 429/503 錯誤，記錄 `errorStats.temporary++`。
        * `background.js` 回傳 `{ error: 'TEMPORARY_FAILURE', retryDelay: 11 }` (例如 API 建議 11 秒)。
        * `content.js` (`catch` 區塊) 收到此錯誤，呼叫 `setOrbState('retrying')` (黃色圓環)，並執行 `setTimeout(() => this.processNextBatch(), 12000)`。
    4.  **(情境 B: 金鑰冷卻中繼)**：
        * (12 秒後) `content.js` 重試。
        * `background.js` 收到請求，檢查發現金鑰仍在 60 秒冷卻中 (例如剩 48 秒)。
        * `background.js` (v3.1.2 邏輯) **再次**回傳 `{ error: 'TEMPORARY_FAILURE', retryDelay: 48 }`。
        * `content.js` 收到此錯誤，繼續顯示黃色圓環，並執行 `setTimeout(..., 49000)`。
    5.  **(情境 C: 永久性失敗)**：
        * `background.js` 偵測到 "billing" 或 "api key not valid" 錯誤，記錄 `errorStats.permanent++`。
        * `background.js` 回傳 `{ error: 'PERMANENT_FAILURE', message: '...' }`。
        * `content.js` 收到此錯誤，呼叫 `handleTranslationError()` -> `setPersistentError(..., false)` (顯示紅色 `!` 圓環)，翻譯流程**停止**。
    6.  **(情境 D: 批次失敗)**：
        * `background.js` 偵測到模型無法處理內容，記錄 `errorStats.batch++`。
        * `background.js` 回傳 `{ error: 'BATCH_FAILURE' }`。
        * `content.js` 收到此錯誤，將該批次句子標記 `.tempFailed = true`，並**繼續呼叫 `this.processNextBatch()`** (進度條繼續推進)。
        * `updateSubtitleDisplay` 偵測到 `.tempFailed`，渲染「點擊重試」UI。

## 3. 專案檔案結構與職責

* **後端 (Backend)**：
    * `background.js`: (Service Worker) **核心後端**。實作所有 Serverless 邏輯：`translateBatch` (Gemini API 呼叫、多金鑰迴圈、冷卻機制)、`diagnoseAllKeys` (金鑰診斷)、`writeToLog` (日誌系統)、`get/setCache` (快取代理)、`get/setSettings` (設定管理)。
* **前端 (Frontend)**：
    * `injector.js`: (MAIN World) "現場特工"。攔截 `timedtext` 網路請求、存取 `player` 物件 (`getPlayerResponse`, `setOption`)。
    * `content.js`: (ISOLATED World) "指揮中心"。實作所有前端翻譯流程、UI 渲染 (字幕/圓環)、狀態管理 (包含 v3.1.x 錯誤處理、`activationWatchdog` 和語言切換重置邏輯)，並作為所有組件的溝通橋樑。
* **介面與邏輯 (UI & Logic)**：
    * `manifest.json`: (v3.0.0) 擴充功能清單。**關鍵權限**：`storage`, `scripting`, `tabs`, `host_permissions: ["...youtube.com/*", "...googleapis.com/*"]`。
    * `popup.html`: "遙控器" (Action Popup) 的 UI 介面。
    * `options.html`: "管理後台" (Options Page) 的 UI 介面。**關鍵區域**：`#apiKeyList` (金鑰管理), `#error-log-container` (日誌顯示)。
    * `popup.js`: **共享腳本**。處理 `popup.html` 和 `options.html` 的所有 DOM 事件與邏輯。**關鍵邏輯**：多金鑰 CRUD、`loadErrorLogs` 渲染、Prompt 存取 (`chrome.storage.local`)、`diagnoseKeysButton` 事件。
* **樣式與資源**：
    * `style.css`: `content.js` 注入的 CSS，定義雙語字幕容器 (`#enhancer-subtitle-container`)、狀態圓環 (`#enhancer-status-orb`)、**錯誤行 (`.enhancer-error-line`)** 及原生字幕隱藏規則 (`!important`)。
    * `popup.css`: `popup.html` 和 `options.html` 的共享樣式。

## 4. 後端 API 溝通協議

系統使用 `chrome.runtime.sendMessage` 進行內部 API 呼叫 (由 `background.js` 處理)。

* **`chrome.runtime.sendMessage({ action: 'translateBatch', ... })`**
    * **功能**: (取代 `POST /api/translate`) 翻譯一個批次的文字。
    * **請求**: `{ action: 'translateBatch', texts: ["..."], source_lang: "ja", models_preference: ["..."] }`
    * **成功回應**: `{ data: ["...", "..."] }`
    * **失敗回應 (v3.1.x)**:
        * `{ error: 'TEMPORARY_FAILURE', retryDelay: <Number> }`
        * `{ error: 'PERMANENT_FAILURE', message: "..." }`
        * `{ error: 'BATCH_FAILURE', message: "..." }`
* **`chrome.runtime.sendMessage({ action: 'diagnoseAllKeys' })`**
    * **功能**: (取代 `POST /api/keys/diagnose`) 診斷所有儲存在 `storage` 中的 API 金鑰。
    * **請求**: `{ action: 'diagnoseAllKeys' }`
    * **回應**: `[ { "name": "Key1", "status": "valid" | "invalid", "error": "..." } ]`
* **`chrome.runtime.sendMessage({ action: 'STORE_ERROR_LOG', ... })`**
    * **功能**: (日誌系統) 供 `content.js` 寫入持續性錯誤。
    * **請求**: `{ action: 'STORE_ERROR_LOG', payload: { message: "...", ... } }`
    * **回應**: `{ success: true }`

## 5. 關鍵決策與歷史包袱 (重要)

* **[決策] Serverless 架構遷移 (v3.0.0)**：
    **原因**：(Plan.md) 為了消除對本地 Python (`backend.py`) 的依賴、簡化安裝流程、移除安全風險 (CORS `*`) 並降低維護成本，我們將所有後端邏輯（API 呼叫、金鑰管理、Prompt 組合）全部遷移到 `background.js` 中。
* **[決策] 後端錯誤智慧分類 (v3.1.0)**：
    **原因**：(開發者論述) 為了響應 v3.0 中「所有 API Key 均嘗試失敗」的籠統錯誤。
    **決策**：`background.js` (後端) 升級為「智慧三分類錯誤」機制 (`TEMPORARY`, `PERMANENT`, `BATCH`)，`content.js` (前端) 則被賦予三種對應的 UI 響應（黃色重試、紅色停止、點擊重試）。
* **[決策] 金鑰冷卻中繼邏輯 (v3.1.2)**：
    **原因**：(開發者論述) 為了解決 v3.1.1 中發現的「前端 11 秒重試 vs 後端 60 秒冷卻」的衝突 Bug。
    **決策**：`background.js` (後端) 新增了一個最高優先級的檢查。當它發現「所有金鑰都在冷卻中」時，它會主動計算「最短剩餘冷卻秒數」(例如 48 秒)，並**再次**回報 `TEMPORARY_FAILURE`，迫使前端繼續等待，直到後端的 60 秒冷卻期結束。
* **[決策] `activationWatchdog` (vssId 驗證)**：
    **原因**：(`content.js`) `player.setOption()` 指令有時會被 YT 播放器靜默忽略。`content.js` 在發出指令後會啟動一個 3 秒看門狗。如果 3 秒內*目標 `vssId`* 的字幕沒回來 (`TIMEDTEXT_DATA`)，流程會被標記為失敗並顯示提示，避免無限等待。
* **[歷史包袱] 60秒金鑰冷卻 (API_KEY_COOLDOWN_SECONDS = 60)**：
    **原因**：(開發者論述) 這個常數最初是為了應對「每分鐘 X 次」的*速率限制*而設計的。
    **現狀 (v3.1.2 的 Bug)**：在測試中發現，當面對「*每日配額* (requests_per_day)」時，這個 60 秒的冷卻變得毫無意義。它導致系統陷入「等待 60 秒 -> 重試 -> 再次撞上每日配額 -> 再等待 60 秒」的無限迴圈。**這是 v3.1.3 待修復的核心問題**。
* **[歷史包袱] `injector.js` 的 3 次重試保險**：
    **原因**：(`injector.js`) 為了解決 `player.setOption()` 偶爾失效的問題，`injector.js` 在收到 `FORCE_ENABLE_TRACK` 指令時，會分別在 0ms, 250ms, 500ms *執行 3 次* `setOption`，以最大努力確保指令至少有一次被成功執行。

## 6. 嚴格護欄 (Guard Rails) (最重要)

* **[禁止]**：**嚴格禁止**重新引入任何對本地伺服器 (`127.0.0.1` 或 `backend.py`) 的依賴或 `fetch` 呼叫。專案必須保持 100% Serverless。
* **[禁止]**：**嚴格禁止**修改 `injector.js` 的注入設定 (`world: "MAIN"`)。這是存取 `player` 物件和攔截 `fetch` 的唯一方法。
* **[禁止]**：**嚴格禁止**在 `content.js` (Isolated World) 中直接存取 `window.player` 或 `window.fetch`。所有與頁面 `window` 的互動*必須*透過 `postMessage` 委派給 `injector.js`。
* **[禁止]**：**嚴格禁止**在 `style.css` 中移除 `.yt-enhancer-active .ytp-caption-window-container { display: none !important; }` 規則。這是隱藏原生字幕的關鍵。
* **[禁止]**：**嚴格禁止** `background.js` 的 `translateBatch` 回傳*籠統的錯誤字串*。它*必須*回傳結構化的 `{ error: 'TEMPORARY_FAILURE' | 'PERMANENT_FAILURE' | 'BATCH_FAILURE', ... }` 物件。`content.js` 的 `processNextBatch` `catch` 區塊*完全依賴*此結構。
* **[禁止]**：**嚴格禁止**在 `content.js` 的 `handleTranslationError` (處理 `PERMANENT_FAILURE` 時) 呼叫 `setPersistentError(..., true)`。*必須*使用 `setPersistentError(..., false)` 以防止 v1.2 修復的「重複日誌」問題迴歸。
* **[禁止]**：**嚴格禁止**在 `content.js` 的 `processNextBatch` 的 `catch` 區塊中，忽略對 `AbortError` (v1.2 修正) 的檢查。所有正常的中斷都*必須*被安靜地 `return`，以防止 UI 顯示虛假的紅色 `!`。
* **[禁止]**：**嚴格禁止**將 API 金鑰或自訂 Prompts 硬編碼 (Hardcode) 在 `background.js` 中。所有金鑰和 Prompts *必須*從 `chrome.storage.local` 動態讀取。