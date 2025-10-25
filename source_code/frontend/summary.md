# YouTube 字幕增強器 - 專案情境總結 (v2.1.3)

## 1. 專案目標與核心功能

此應用程式是一個 Chrome Manifest V3 (MV3) 擴充功能，旨在即時攔截並翻譯 YouTube 影片字幕，解決原生字幕品質不佳或無目標語言選項的問題。

專案採用**完全 Serverless 架構**，移除了對本地 Python 伺服器的依賴。所有核心邏輯均在擴充功能內部處理：`background.js` (Service Worker) 作為後端，`content.js` (Isolated World) 作為指揮中心，`injector.js` (Main World) 作為現場特工。

**核心功能 (v2.1.3)：**

* **Serverless AI 翻譯**：由 `background.js` 直接呼叫 Google Gemini API (`generativelanguage.googleapis.com`) 進行字幕翻譯。
* **多金鑰管理**：使用者可在「管理後台」安全地儲存多個 Gemini API Key。`background.js` 會在翻譯時自動依序重試，並內建配額 (Quota) 偵測與冷卻機制。
* **智慧錯誤處理 (v3.1.x 架構遺留)**：
    * `background.js` 能分析 API 失敗原因，並回傳三種結構化錯誤：`TEMPORARY_FAILURE` (可重試)、`PERMANENT_FAILURE` (應停止)、`BATCH_FAILURE` (批次內容錯誤)。
    * `content.js` 根據錯誤執行不同 UI 響應（黃色重試圓環、紅色停止圓環、點擊重試字幕行）。
* **[v2.0] 三層式語言決策引擎**：取代舊的「偏好/忽略」列表，實作全新的決策邏輯：
    1.  **Tier 1 (原文顯示)**：使用者設定的「原文顯示語言」列表 (零成本)。
    2.  **Tier 2 (自動翻譯)**：使用者設定的「自動翻譯語言」列表 (高品質 Prompt)。
    3.  **Tier 3 (按需翻譯)**：未命中前兩者的 Fallback 模式，提供右上角「翻譯」按鈕。
* **[v2.1.x] 語言等價性檢查**：在 `content.js` 中實作 `checkLangEquivalency` 函式，解決 `zh-Hant` vs `zh-TW` vs `zh` 等語言代碼不一致的匹配問題。
* **[v2.0] 資料庫自動遷移**：在 `popup.js` 中實作 v1.x -> v2.0 設定的自動遷移邏輯，確保舊使用者的自訂 Prompt (特別是日文) 能無痛繼承。
* **[v2.0] 友善的 UI/UX**：`options.html` 提供「語言搜尋 Popover」，使用者無需手動輸入 `ja`, `ko` 等語言代碼。
* **永久翻譯快取**：已翻譯的字幕儲存在 `chrome.storage.local` (`yt-enhancer-cache-[VIDEO_ID]`)。
* **標準化日誌系統**：關鍵錯誤儲存在 `chrome.storage.session` (`errorLogs`)，供管理後台檢視。

## 2. 系統架構與資訊流

* **架構組成**：
    * **後端**: `background.js` (Chrome Service Worker)。負責所有 API 呼叫、儲存管理、日誌。
    * **前端 (注入)**: `injector.js` (MAIN World)。唯一能存取頁面 `window` 物件的腳本，負責網路攔截與播放器操作。
    * **前端 (核心)**: `content.js` (ISOLATED World)。負責三層決策引擎、UI 渲染、狀態管理。
    * **前端 (介面)**: `options.html` / `popup.html` (由 `popup.js` 共享驅動)。
    * **資料儲存 (Local)**: `chrome.storage.local`
        * `ytEnhancerSettings`: 包含 v2.0 結構 `native_langs: []` 和 `auto_translate_priority_list: []`。
        * `userApiKeys: []`: 使用者金鑰列表。
        * `yt-enhancer-cache-[VIDEO_ID]`: 影片快取。
    * **資料儲存 (Session)**: `chrome.storage.session`
        * `errorLogs: []`: 錯誤日誌。
        * `apiKeyCooldowns: {}`: 金鑰冷卻狀態。

* **典型資訊流**：

    1.  **[流程一：啟動與握手 (v8.0 架構)]**
        1.  `background.js` 透過 `chrome.scripting.registerContentScripts` 將 `injector.js` 注入 `MAIN` World。
        2.  `content.js` (ISOLATED World) 載入，*主動*輪詢 (`REQUEST_PLAYER_RESPONSE`) 向 `injector.js` 請求資料。
        3.  `injector.js` 監聽到 `yt-navigate-finish`，獲取 `player.getPlayerResponse()` 並暫存。
        4.  `injector.js` 收到 `REQUEST_PLAYER_RESPONSE` 信號，回傳 `PLAYER_RESPONSE_CAPTURED` 資料。
        5.  `content.js` 收到資料，停止輪詢，呼叫 `start()` 進入決策引擎。

    2.  **[流程二：三層決策引擎 (v2.1.x)]** (於 `content.js` 的 `start()` 執行)
        1.  `content.js` 獲取 `availableLangs` 和 `settings`。
        2.  **Tier 1 檢查**：遍歷 `settings.native_langs` (v2.1 優先級修正)，使用 `checkLangEquivalency` (v2.1.1) 檢查 `availableLangs`。
        3.  (若命中) -> 呼叫 `runTier1_NativeView()`。 (流程結束)
        4.  **Tier 2 檢查**：遍歷 `settings.auto_translate_priority_list`，使用 `checkLangEquivalency` (v2.1.1) 檢查 `availableLangs`。
        5.  (若命中) -> 檢查快取。 (若無快取) -> 鎖定 `targetVssId`，命令 `injector.js` (`FORCE_ENABLE_TRACK`)。 (流程結束)
        6.  **Tier 3 檢查**：(若未命中) -> 呼叫 `runTier3_OnDemand()`。 (流程結束)

    3.  **[流程三：Tier 2 Serverless 翻譯]**
        1.  `injector.js` 執行 `player.setOption(...)` (含 3 次重試保險)。
        2.  `injector.js` 的網路攔截器捕獲 `/api/timedtext` 的 *回應 (Response)*，並 `postMessage('TIMEDTEXT_DATA', ...)`。
        3.  `content.js` (`onMessageFromInjector`) 收到 `TIMEDTEXT_DATA`。
        4.  (看門狗 `activationWatchdog` 驗證 `vssId` 或 `lang` 成功) -> 解除看門狗 -> 呼叫 `activate()`。
        5.  `content.js` (`activate` -> `parseAndTranslate` -> `processNextBatch`)。
        6.  `content.js` 呼叫 `chrome.runtime.sendMessage({ action: 'translateBatch', ... })`。
        7.  `background.js` 收到任務，從 `storage` 讀取 `userApiKeys` 和 `ytEnhancerSettings.auto_translate_priority_list` (v2.0 邏輯) 來組合 Prompt。
        8.  `background.js` 執行「金鑰-模型」迴圈。
        9.  (成功) `sendResponse({ data: [...] })`。
        10. (失敗) `sendResponse({ error: 'TEMPORARY_FAILURE', retryDelay: ... })` (v3.1.x 錯誤)。
        11. `content.js` (`catch` 區塊) 處理智慧錯誤 (例如顯示黃色圓環並 `setTimeout` 重試)。

    4.  **[流程四：手動切換字幕 (v2.1.x Bug 修正)]** (於 `content.js` 的 `onMessageFromInjector`)
        1.  `content.js` 收到 `TIMEDTEXT_DATA` (非看門狗觸發，即手動切換)。
        2.  偵測到語言變更，執行「溫和重置」（清除舊狀態）。
        3.  **重新執行三層決策樹 (v2.1.2 鏡像邏輯)**：
        4.  (Tier 1 命中) -> 呼叫 `activateNativeView()` (僅原文)。
        5.  (Tier 2 命中) -> 呼叫 `activate()` (完整翻譯)。
        6.  (Tier 3 命中) -> 建立「翻譯」按鈕 + 呼叫 `activateNativeView()` (僅原文)。

## 3. 專案檔案結構與職責

* **後端 (Backend)**：
    * `background.js`: (Service Worker) **核心後端**。實作 `translateBatch` (Gemini API 呼叫、多金鑰迴圈、冷卻機制、v2.0 Prompt 獲取)、`diagnoseAllKeys`、`writeToLog`、`get/setCache`、`get/setSettings`、`toggleGlobalState`。**關鍵：** 持有 v2.0 結構的 `defaultSettings` (Bug 1 修正)。
* **前端 (Frontend)**：
    * `injector.js`: (MAIN World) "現場特工"。攔截 `timedtext` 網路請求、存取 `player` 物件 (`getPlayerResponse`, `setOption`)、`yt-navigate-finish` 監聽、v8.0 偵錯日誌。
    * `content.js`: (ISOLATED World) "指揮中心"。實作 **v2.1.x 三層決策引擎** (`start`, `onMessageFromInjector`)、**語言等價性檢查** (`checkLangEquivalency`)、UI 渲染 (字幕/圓環/Tier 3 按鈕)、v3.1.x 錯誤處理、`activationWatchdog`、v8.0 偵錯日誌。
* **介面與邏輯 (UI & Logic)**：
    * `manifest.json`: (推測) MV3，**關鍵權限**：`storage`, `scripting`, `tabs`, `host_permissions: ["...youtube.com/*", "...googleapis.com/*"]`。
    * `popup.html`: "遙控器" (Action Popup) 的 UI 介面。
    * `options.html`: "管理後台" (Options Page) 的 UI 介面，包含 Tier 1/2 (v2.0) 和金鑰管理。
    * `popup.js`: (v2.1.0) **共享腳本**。處理 `popup.html` 和 `options.html` 的所有 DOM 事件與邏輯。**關鍵邏輯**：**v1.x -> v2.0 資料庫遷移邏輯** (`loadSettings`)、Tier 1/2 UI 互動 (`renderTier1Badges`, `renderTier2Accordions`)、金鑰 CRUD、日誌渲染、`LANGUAGE_DATABASE` (Popover 搜尋)。
* **樣式與資源**：
    * `style.css`: `content.js` 注入的 CSS，定義雙語字幕容器 (`#enhancer-subtitle-container`)、狀態圓環 (`#enhancer-status-orb`)、**Tier 3 按鈕 (`#enhancer-ondemand-button`)**。
    * `popup.css`: `popup.html` 和 `options.html` 的共享樣式，定義 **Tier 1/2 列表 (`.badge-list`, `.accordion-item`)** 和 **Popover (`.popover-backdrop`)**。

## 4. 後端 API 溝通協議

系統使用 `chrome.runtime.sendMessage` 進行內部 API 呼叫 (由 `background.js` 處理)。

* **`chrome.runtime.sendMessage({ action: 'translateBatch', ... })`**
    * **功能**: 翻譯一個批次的文字。
    * **請求**: `{ action: 'translateBatch', texts: ["..."], source_lang: "ja", models_preference: ["..."] }`
    * **成功回應**: `{ data: ["...", "..."] }`
    * **失敗回應 (v3.1.x)**:
        * `{ error: 'TEMPORARY_FAILURE', retryDelay: <Number> }`
        * `{ error: 'PERMANENT_FAILURE', message: "..." }`
        * `{ error: 'BATCH_FAILURE', message: "..." }`
* **`chrome.runtime.sendMessage({ action: 'getSettings' })`**
    * **功能**: 獲取 `ytEnhancerSettings` (含 v2.0 結構)。
* **`chrome.runtime.sendMessage({ action: 'updateSettings', data: ... })`**
    * **功能**: 儲存 `ytEnhancerSettings` (含 v2.0 結構)。
* **`chrome.runtime.sendMessage({ action: 'diagnoseAllKeys' })`**
    * **功能**: 診斷所有儲存在 `storage` 中的 API 金鑰。
    * **回應**: `[ { "name": "Key1", "status": "valid" | "invalid", "error": "..." } ]`
* **`chrome.runtime.sendMessage({ action: 'toggleGlobalState' })`**
    * **功能**: 切換擴充功能總開關 (v2.1.x Bug 1 相關)。
* **`chrome.runtime.sendMessage({ action: 'getErrorLogs' | 'STORE_ERROR_LOG' })`**
    * **功能**: 存取 `chrome.storage.session` 日誌。
* **`chrome.runtime.sendMessage({ action: 'getCache' | 'setCache' })`**
    * **功能**: 存取 `chrome.storage.local` 影片快取。

## 5. 關鍵決策與歷史包袱 (重要)

* **[決策] Serverless 架構 (v3.0)**：
    **原因**：(v3.1.3 summary) 為了消除對本地 Python (`backend.py`) 的依賴、簡化安裝，將所有後端邏輯遷移到 `background.js`。
* **[決策] 智慧錯誤分類 (v3.1.x)**：
    **原因**：(v3.1.3 summary) 解決 v3.0 籠統的錯誤回報。
    **決策**：`background.js` (後端) 實作三分類錯誤 (`TEMPORARY`, `PERMANENT`, `BATCH`)，`content.js` (前端) 實作三種對應的 UI 響應（黃色重試、紅色停止、點擊重試）。
* **[決策] 三層式語言引擎 (v2.0)**：
    **原因**：(Plan.md v2.0) 廢除 v1.x 僵化的 `preferred_langs`，解決「不想翻譯但想看原文」和「非偏好語言無法翻譯」的痛點。
    **決策**：實作 Tier 1 (原文顯示), Tier 2 (自動翻譯), Tier 3 (按需翻譯) 決策樹。
* **[決策] 資料庫自動遷移 (v2.0)**：
    **原因**：(Bug 總結) 確保 v1.x 使用者升級時，其儲存在 `customPrompts` 的資料 (尤其是日文 Prompt) 能被無痛繼承。
    **決策**：在 `popup.js` 的 `loadSettings` 中實作一個「自動遷移」邏輯。
* **[決策] 抽象化「語言等價性」 (v2.1.x)**：
    **原因**：(Bug 總結) 修復 Bugs 2, 3, 4。YouTube 提供的 `zh-TW` 或 `zh` 無法匹配使用者設定的 `zh-Hant`。
    **決策**：在 `content.js` 中建立 `checkLangEquivalency` 函式，定義「繁體中文群組」和「簡體中文群組」。
* **[決策] 升級 `background.js` 的 `defaultSettings` (v2.1.x)**：
    **原因**：(Bug 總結) 修復 Bug 1。`toggleGlobalState` 會用 v1.x 的 `defaultSettings` 汙染 v2.0 的 `storage`，導致遷移邏輯被重複觸發。
    **決策**：將 `background.js` 中的 `defaultSettings` 常數升級為 v2.0 結構。
* **[包袱] v1.x 遷移邏輯 (v2.0)**：
    **影響**：(Bug 總結) `popup.js` 的 `loadSettings` 中的 `if (preferred_langs)` 區塊，以及 `DEFAULT_CUSTOM_PROMPTS` 常數，其**唯一**存在的理由就是為了服務 v1.x -> v2.0 的資料庫遷移。
* **[包袱] `checkLangEquivalency` 的硬編碼 (v2.1.x)**：
    **影響**：(Bug 總結) `content.js` 中的繁簡中文群組是硬編碼的。如果未來 YouTube 新增 `zh-SG`（新加坡中文），此函式將過時且必須手動維護。
* **[包袱] `defaultSettings` 的同步債 (v2.1.x)**：
    **影響**：(Bug 總結) `background.js` 的 `defaultSettings` 必須與 `ytEnhancerSettings` 的資料結構保持同步。未來若新增屬性，必須同時修改這兩個地方，否則 Bug 1 會迴歸。
* **[包袱] `injector.js` 的 3 次重試保險**：
    **原因**：(`injector.js`) 為了解決 `player.setOption()` 偶爾失效的問題，`injector.js` 在收到 `FORCE_ENABLE_TRACK` 指令時，會分別在 0ms, 250ms, 500ms *執行 3 次* `setOption`。

## 6. 嚴格護欄 (Guard Rails) (最重要)

* **[禁止]**：**嚴格禁止**重新引入任何對本地伺服器 (`127.0.0.1` 或 `backend.py`) 的依賴或 `fetch` 呼叫。專案必須保持 100% Serverless。
* **[禁止]**：**嚴格禁止**在 `content.js` (Isolated World) 中直接存取 `window.player` 或 `window.fetch`。所有與頁面 `window` 的互動*必須*透過 `postMessage` 委派給 `injector.js` (Main World)。
* **[禁止]**：**嚴格禁止** `background.js` 的 `translateBatch` 回傳*籠統的錯誤字串*。它*必須*回傳結構化的 `{ error: 'TEMPORARY_FAILURE' | 'PERMANENT_FAILURE' | 'BATCH_FAILURE', ... }` 物件。
* **[禁止]**：**[護欄 1 (Popup)] `popup.js` 是共享腳本**。
    * **規則**：(Bug 總結) 存取*只存在於* `options.html` 的 DOM 元素 (例如 `apiKeyList`, `tier-1-badge-list`) 之前，**必須**使用 `if (isOptionsPage)` 或 `if (element)` 進行嚴格的 `null` 檢查。
    * **後果**：若違反，`popup.html`（小彈窗）將立即崩潰。
* **[禁止]**：**[護欄 2 (Popup)] `DOMContentLoaded` 是執行起點**。
    * **規則**：(Bug 總結) **所有** `popup.js` 的頂層執行邏輯（包含事件綁定）都**必須**被包裹在 `document.addEventListener('DOMContentLoaded', () => { ... });` 內部。
    * **後果**：若違反，腳本會因 DOM 未載入而崩潰。
* **[禁止]**：**[護欄 3 (Content)] 語言匹配的唯一性**。
    * **規則**：(Bug 總結 v2.1) 在 `content.js` 中，**所有**語言代碼比對**必須**使用 `checkLangEquivalency` 函式。
    * **後果**：若使用 `===` 或 `.includes()`，將導致 Tier 1/2/3 匹配失敗 (Bugs 2, 3, 4 迴歸)。
* **[禁止]**：**[護欄 4 (Content)] 決策樹的鏡像原則**。
    * **規則**：(Bug 總結 v2.1) `content.js` 的兩個入口點：`start()`（自動載入） 和 `onMessageFromInjector`（手動切換） 內部的 Tier 1/2/3 判斷邏輯**必須**保持 100% 鏡像同步。
    * **後果**：若只修改其一，將導致手動切換字幕時決策邏輯錯誤 (Bug 3 迴歸)。
* **[禁止]**：**[護欄 5 (Backend)] `defaultSettings` 的結構同步**。
    * **規則**：(Bug 總結 v2.1) `background.js` 中的 `defaultSettings` 常數**必須**與 `ytEnhancerSettings` 的資料結構保持鏡像同步。
    * **後果**：若不同步，`toggleGlobalState` 函式將汙染 `storage`，導致 v1.x 遷移邏輯被重複觸發 (Bug 1 迴歸)。
* **[禁止]**：**[護欄 6 (Popup)] Tier 1 儲存的無條件性**。
    * **規則**：(Bug 總結 v2.1) `popup.js` 中的 `saveTier1Settings` 函式**必須**無條件從 DOM 讀取最新列表並呼叫 `saveSettings()`。
    * **後果**：若加入 `if` 檢查，將導致刪除或拖曳操作無法儲存 (Bug 5 迴歸)。