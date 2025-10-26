# YouTube 字幕增強器 - 專案情境總結 (v4.0.1)

## 1. 專案目標與核心功能

此應用程式是一個 Chrome Manifest V3 (MV3) 擴充功能，旨在即時攔截並翻譯 YouTube 影片字幕，解決原生字幕品質不佳或無目標語言選項的問題。

專案採用**完全 Serverless 架構**，所有核心邏輯均在擴充功能內部處理：`background.js` (Service Worker) 作為後端，`content.js` (Isolated World) 作為指揮中心，`injector.js` (Main World) 作為現場特工。

**核心功能 (v4.0.1)：**

* **[v8.0 架構] 播放器優先握手 (Player-First Handshake)**：
    * 為解決時序問題 (Race Condition)，`injector.js` (v4.0.1) 採用「播放器優先」架構。
    * `injector.js` 會等待 `yt-navigate-finish` 觸發，*主動*獲取 `playerResponse` 並暫存 (`isDataReady = true`)。
    * `content.js` (v4.0.1) 則會*主動*輪詢 (`REQUEST_PLAYER_RESPONSE`) 向 `injector.js` 請求資料，直到 `injector.js` 回傳 `PLAYER_RESPONSE_CAPTURED`。
* **Serverless AI 翻譯**：由 `background.js` 直接呼叫 Google Gemini API (`generativelanguage.googleapis.com`) 進行字幕翻譯。
* **[v2.2.0 UI] 動態金鑰管理**：
    * 重構 `options.html` 的金鑰管理介面 (v4.0.1)，廢除靜態表單。
    * `popup.js` (v4.0.1) 實作動態列表渲染 (`loadAndRenderApiKeys`)。
    * 新金鑰 (`.new-key-value-input`)：在 `blur` 時（且兩欄位皆有值）觸發*儲存*。
    * 已儲存金鑰 (`.key-value-input`)：在 `change` 時（`blur` 且值變更）觸發*更新*。
* **[v2.2.0 UI] 模型偏好設定**：
    * 重構 `options.html` 的模型設定介面 (v4.0.1)，廢除「雙列表」。
    * 改為「單一可拖曳排序列表 (`#selected-models`)」 + 「可添加的 Pill 標籤 (`#available-model-pills`)」。
* **[v2.3.0 UI] 卡片佈局重組**：
    * 重構 `options.html` (v2.3.0) 佈局，將「API Key 診斷」卡片的內容*合併*至「Google API 金鑰管理」卡片內部，並將該卡片移至「主要設定」頁籤的底部。
* **智慧錯誤處理 (v3.1.x 架構)**：
    * `background.js` 能分析 API 失敗原因，並回傳三種結構化錯誤：`TEMPORARY_FAILURE` (可重試)、`PERMANENT_FAILURE` (應停止)、`BATCH_FAILURE` (批次內容錯誤)。
    * `content.js` 根據錯誤執行不同 UI 響應（黃色重試圓環、紅色停止圓環、點擊重試字幕行）。
* **[v2.0] 三層式語言決策引擎**：
    1.  **Tier 1 (原文顯示)**：使用者設定的「原文顯示語言」列表 (零成本)。
    2.  **Tier 2 (自動翻譯)**：使用者設定的「自動翻譯語言」列表 (高品質 Prompt)。
    3.  **Tier 3 (按需翻譯)**：未命中前兩者的 Fallback 模式，提供右上角「翻譯」按鈕。
* **[v2.1.x] 語言等價性檢查**：在 `content.js` 中實作 `checkLangEquivalency` 函式，解決 `zh-Hant` vs `zh-TW` vs `zh` 等語言代碼不一致的匹配問題。
* **[v2.0] 資料庫自動遷移**：在 `popup.js` (v4.0.1) 中實作 v1.x -> v2.0 設定的自動遷移邏輯，確保舊使用者的自訂 Prompt (特別是日文) 能無痛繼承。
* **永久翻譯快取**：已翻譯的字幕儲存在 `chrome.storage.local` (`yt-enhancer-cache-[VIDEO_ID]`)。
* **標準化日誌系統**：關鍵錯誤儲存在 `chrome.storage.session` (`errorLogs`)，供管理後台檢視。

## 2. 系統架構與資訊流

* **架構組成**：
    * **後端**: `background.js` (Chrome Service Worker)。負責所有 API 呼叫、儲存管理、日誌、動態腳本註冊。
    * **前端 (注入)**: `injector.js` (MAIN World)。負責網路攔截、播放器操作、v8.0 握手 (回應方)。
    * **前端 (核心)**: `content.js` (ISOLATED World)。負責三層決策引擎、UI 渲染、v8.0 握手 (請求方)。
    * **前端 (介面)**: `options.html` / `popup.html` (由 `popup.js` 共享驅動)。
    * **資料儲存 (Local)**: `chrome.storage.local`
        * `ytEnhancerSettings`: 包含 v2.0 結構 `native_langs: []` 和 `auto_translate_priority_list: []`。
        * `userApiKeys: []`: 使用者金鑰列表 (v2.2.0 UI)。
        * `yt-enhancer-cache-[VIDEO_ID]`: 影片快取。
    * **資料儲存 (Session)**: `chrome.storage.session`
        * `errorLogs: []`: 錯誤日誌。
        * `apiKeyCooldowns: {}`: 金鑰冷卻狀態。

* **典型資訊流**：

    1.  **[流程一：啟動與握手 (v8.0 架構)]**
        1.  `background.js` (`onInstalled`) 透過 `chrome.scripting.registerContentScripts` 將 `injector.js` (v4.0.1) 註冊到 `MAIN` World (runAt: `document_start`)。
        2.  `content.js` (v4.0.1) (ISOLATED World) 載入，*主動*輪詢 (`REQUEST_PLAYER_RESPONSE`) 向 `injector.js` 請求資料。
        3.  `injector.js` (v4.0.1) 監聽到 `yt-navigate-finish`，獲取 `player.getPlayerResponse()` 並暫存，設定 `state.isDataReady = true`。
        4.  `injector.js` 收到 `REQUEST_PLAYER_RESPONSE` 信號，檢查 `isDataReady` 為 true，回傳 `PLAYER_RESPONSE_CAPTURED` 資料。
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
        2.  `injector.js` 的網路攔截器 (Fetch/XHR) 捕獲 `/api/timedtext` 的 *回應 (Response)*，並 `postMessage('TIMEDTEXT_DATA', ...)`。
        3.  `content.js` (`onMessageFromInjector`) 收到 `TIMEDTEXT_DATA`。
        4.  (看門狗 `activationWatchdog` 驗證 `vssId` 或 `lang` 成功) -> 解除看門狗 -> 呼叫 `activate()`。
        5.  `content.js` (`activate` -> `parseAndTranslate` -> `processNextBatch`)。
        6.  `content.js` 呼叫 `chrome.runtime.sendMessage({ action: 'translateBatch', ... })`。
        7.  `background.js` 收到任務，從 `storage` 讀取 `userApiKeys` 和 `ytEnhancerSettings.auto_translate_priority_list` (v2.0 邏輯) 來組合 Prompt。
        8.  `background.js` 執行「金鑰-模型」迴圈 (含 v1.2 冷卻機制)。
        9.  (成功) `sendResponse({ data: [...] })`。
        10. (失敗) `sendResponse({ error: 'TEMPORARY_FAILURE', retryDelay: ... })` (v3.1.x 錯誤)。
        11. `content.js` (`catch` 區塊) 處理智慧錯誤 (例如顯示黃色圓環並 `setTimeout` 重試)。

    4.  **[流程四：手動切換字幕 (v2.1.x 邏輯)]** (於 `content.js` 的 `onMessageFromInjector`)
        1.  `content.js` 收到 `TIMEDTEXT_DATA` (非看門狗觸發，即手動切換)。
        2.  偵測到語言變更 (`checkLangEquivalency` 檢查 `this.state.sourceLang`)，執行「溫和重置」（清除舊狀態）。
        3.  **重新執行三層決策樹 (v2.1.2 鏡像邏輯)**：
        4.  (Tier 1 命中) -> 呼叫 `activateNativeView()` (僅原文)。
        5.  (Tier 2 命中) -> 呼叫 `activate()` (完整翻譯)。
        6.  (Tier 3 命中) -> 建立「翻譯」按鈕 + 呼叫 `activateNativeView()` (僅原文)。

## 3. 專案檔案結構與職責

* **後端 (Backend)**：
    * `background.js` (v4.0.1): (Service Worker) **核心後端**。實作 `chrome.scripting.registerContentScripts` (v8.0)、`translateBatch` (Gemini API 呼叫、多金鑰迴圈、冷卻機制、v2.0 Prompt 獲取)、`diagnoseAllKeys`、`writeToLog`、`get/setCache`、`get/setSettings`、`toggleGlobalState`。
* **前端 (Frontend)**：
    * `injector.js` (v4.0.1): (MAIN World) "現場特工"。實作 **v8.0 握手回應方** (`onNavigate`, `handleContentMessage`)、攔截 `timedtext` (Fetch/XHR 雙攔截器)、存取 `player` 物件 (`getPlayerResponse`, `setOption`)。
    * `content.js` (v4.0.1): (ISOLATED World) "指揮中心"。實作 **v8.0 握手請求方** (`requestPlayerResponse`)、**v2.1.x 三層決策引擎** (`start`, `onMessageFromInjector`)、**語言等價性檢查** (`checkLangEquivalency`)、UI 渲染 (字幕/圓環/Tier 3 按鈕)、v3.1.x 錯誤處理。
* **介面與邏輯 (UI & Logic)**：
    * `manifest.json`: (推測) MV3，**關鍵權限**：`storage`, `scripting`, `tabs`, `host_permissions: ["...youtube.com/*", "...googleapis.com/*"]`。
    * `popup.html` (v4.0.1): "遙控器" (Action Popup) 的 UI 介面。**[v2.2.0 UI]** 包含新的 Toggle 開關和 Range Slider 樣式。
    * `options.html` (v2.3.0): "管理後台" (Options Page) 的 UI 介面。**[v2.2.0 UI]** 包含動態金鑰列表和模型偏好列表。**[v2.3.0 UI]** 包含合併後的「金鑰管理 + 診斷」卡片佈局。
    * `popup.js` (v4.0.1): **共享腳本**。處理 `popup.html` 和 `options.html` 的所有 DOM 事件與邏輯。
        * **[v2.2.0 UI] 核心邏輯**：實作 `loadAndRenderApiKeys`, `setupApiKeyListeners` (動態金鑰管理)。
        * **[v2.2.0 UI] 核心邏輯**：實作 `initializeModelSelector`, `populateModelLists` (模型偏好設定)。
        * **[v2.0] 核心邏輯**：實作 v1.x -> v2.0 資料庫遷移邏輯 (`loadSettings`)。
        * **[v2.0] 核心邏輯**：實作 Tier 1/2 UI 互動 (`renderTier1Badges`, `renderTier2Accordions`)、`LANGUAGE_DATABASE` (Popover 搜尋)。
* **樣式與資源**：
    * `style.css` (v4.0.1): `content.js` 注入的 CSS，定義雙語字幕容器 (`#enhancer-subtitle-container`)、狀態圓環 (`#enhancer-status-orb`)、Tier 3 按鈕 (`#enhancer-ondemand-button`)。
    * `popup.css` (v4.0.1): `popup.html` 和 `options.html` 的共享樣式。
        * **[v2.4.0 UI]**：定義全局色彩主題 (v2.4.0 修正為灰色點綴色 `--accent-pill-*`)。
        * **[v2.2.0 UI]**：定義動態金鑰列表 (`.api-key-list`)、模型偏好設定 (`.model-list`, `.add-model-pill`)、新 Toggle (`.toggle-switch`) 和 Slider 樣式。

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

* **[決策] v8.0 握手架構 (v4.0.1)**：
    **原因**：解決 `content.js` (Isolated) 和 `injector.js` (Main) 之間的時序競爭 (Race Condition)。
    **決策**：改為 `content.js` (請求方) *主動輪詢* `injector.js` (回應方)，`injector.js` 則等待 `yt-navigate-finish` 確保 `playerResponse` 可用後才回應。
* **[決策] v2.2.0 API Key UI (v4.0.1)**：
    **原因**：(v2.2.0 藍圖) 改善 v2.1 的靜態表單 UX，使其更直觀。
    **決策**：在 `popup.js` 中實作動態列表，使用 `blur` (capture: true) 儲存新項目，使用 `change` 更新舊項目。
* **[決策] v2.2.0 模型偏好 UI (v4.0.1)**：
    **原因**：(v2.2.0 藍圖) 改善 v2.1 僵化的「雙列表」UX。
    **決策**：改為「單一可拖曳列表」 + 「Pill 標籤」的模式。
* **[決策] v2.3.0 介面佈局 (v2.3.0)**：
    **原因**：(v2.3.0 藍圖) 提升 UX，將關聯功能（金鑰管理、金鑰診斷）放在一起。
    **決策**：在 `options.html` 中，將「診斷」卡片合併入「金鑰管理」卡片。
* **[決策] Serverless 架構 (v3.0)**：
    **原因**：(v2.1.3 summary) 為了消除對本地 Python (`backend.py`) 的依賴、簡化安裝，將所有後端邏輯遷移到 `background.js`。
* **[決策] 智慧錯誤分類 (v3.1.x)**：
    **原因**：(v2.1.3 summary) 解決 v3.0 籠統的錯誤回報。
    **決策**：`background.js` (後端) 實作三分類錯誤 (`TEMPORARY`, `PERMANENT`, `BATCH`)，`content.js` (前端) 實作三種對應的 UI 響應。
* **[決策] 三層式語言引擎 (v2.0)**：
    **原因**：(v2.1.3 summary) 廢除 v1.x 僵化的 `preferred_langs`，解決「不想翻譯但想看原文」和「非偏好語言無法翻譯」的痛點。
    **決策**：實作 Tier 1 (原文顯示), Tier 2 (自動翻譯), Tier 3 (按需翻譯) 決策樹。
* **[決策] 資料庫自動遷移 (v2.0)**：
    **原因**：(v2.1.3 summary) 確保 v1.x 使用者升級時，其儲存在 `customPrompts` 的資料 (尤其是日文 Prompt) 能被無痛繼承。
    **決策**：在 `popup.js` (v4.0.1) 的 `loadSettings` 中實作一個「自動遷移」邏輯。
* **[決策] 抽象化「語言等價性」 (v2.1.x)**：
    **原因**：(v2.1.3 summary) 修復 Bugs 2, 3, 4。YouTube 提供的 `zh-TW` 或 `zh` 無法匹配使用者設定的 `zh-Hant`。
    **決策**：在 `content.js` (v4.0.1) 中建立 `checkLangEquivalency` 函式，定義「繁體中文群組」和「簡體中文群組」。
* **[包袱] v1.x 遷移邏輯 (v2.0)**：
    **影響**：`popup.js` (v4.0.1) 的 `loadSettings` 中的 `if (currentSettings.preferred_langs)` 區塊，其**唯一**存在的理由就是為了服務 v1.x -> v2.0 的資料庫遷移。
* **[包袱] `DEFAULT_CUSTOM_PROMPTS` 同步債 (v4.0.1)**：
    **影響**：`DEFAULT_CUSTOM_PROMPTS` 常數同時存在於 `background.js` (v4.0.1) 和 `popup.js` (v4.0.1)。`popup.js` 中的版本用於 v1.x 遷移，`background.js` 中的版本用於 v2.0 新增 Tier 2 項目時的預設值。兩者必須保持同步。
* **[包袱] `injector.js` 的 3 次重試保險**：
    **原因**：(v2.1.3 summary) 為了解決 `player.setOption()` 偶爾失效的問題，`injector.js` (v4.0.1) 在收到 `FORCE_ENABLE_TRACK` 指令時，會分別在 0ms, 250ms, 500ms *執行 3 次* `setOption`。

## 6. 嚴格護欄 (Guard Rails) (最重要)

* **[禁止]**：**嚴格禁止**重新引入任何對本地伺服器 (`127.0.0.1` 或 `backend.py`) 的依賴或 `fetch` 呼叫。專案必須保持 100% Serverless。
* **[禁止]**：**嚴格禁止**在 `content.js` (Isolated World) 中直接存取 `window.player` 或 `window.fetch`。所有與頁面 `window` 的互動*必須*透過 `postMessage` 委派給 `injector.js` (Main World)。
* **[禁止]**：**嚴格禁止** `background.js` 的 `translateBatch` 回傳*籠統的錯誤字串*。它*必須*回傳結構化的 `{ error: 'TEMPORARY_FAILURE' | 'PERMANENT_FAILURE' | 'BATCH_FAILURE', ... }` 物件。
* **[禁止]**：**[護欄 1 (Popup)] `popup.js` 是共享腳本**。
    * **規則**：(v2.1.3 summary) 存取*只存在於* `options.html` 的 DOM 元素 (例如 `apiKeyList`, `tier-1-badge-list`) 之前，**必須**使用 `if (isOptionsPage)` 或 `if (element)` 進行嚴格的 `null` 檢查。
    * **後果**：若違反，`popup.html`（小彈窗）將立即崩潰。
* **[禁止]**：**[護欄 2 (Popup)] `DOMContentLoaded` 是執行起點**。
    * **規則**：(v2.1.3 summary) **所有** `popup.js` (v4.0.1) 的頂層執行邏輯（包含事件綁定）都**必須**被包裹在 `document.addEventListener('DOMContentLoaded', () => { ... });` 內部。
    * **後果**：若違反，腳本會因 DOM 未載入而崩潰。
* **[禁止]**：**[護欄 3 (Content)] 語言匹配的唯一性**。
    * **規則**：(v2.1.3 summary) 在 `content.js` (v4.0.1) 中，**所有**語言代碼比對**必須**使用 `checkLangEquivalency` 函式。
    * **後果**：若使用 `===` 或 `.includes()`，將導致 Tier 1/2/3 匹配失敗 (Bugs 2, 3, 4 迴歸)。
* **[禁止]**：**[護欄 4 (Content)] 決策樹的鏡像原則**。
    * **規則**：(v2.1.3 summary) `content.js` (v4.0.1) 的兩個入口點：`start()`（自動載入） 和 `onMessageFromInjector`（手動切換） 內部的 Tier 1/2/3 判斷邏輯**必須**保持 100% 鏡像同步。
    * **後果**：若只修改其一，將導致手動切換字幕時決策邏輯錯誤 (Bug 3 迴歸)。
* **[禁止]**：**[護欄 5 (Backend)] `defaultSettings` 的結構同步**。
    * **規則**：(v2.1.3 summary) `background.js` (v4.0.1) 中的 `defaultSettings` 常數**必須**與 `ytEnhancerSettings` 的資料結構保持鏡像同步 (v2.0 結構)。
    * **後果**：若不同步，`toggleGlobalState` 函式將汙染 `storage`，導致 v1.x 遷移邏輯被重複觸發 (Bug 1 迴歸)。
* **[禁止]**：**[護欄 6 (Popup)] Tier 1 儲存的無條件性**。
    * **規則**：(v2.1.3 summary) `popup.js` (v4.0.1) 中的 `saveTier1Settings` 函式 (由 `initializeSortableList` 呼叫) **必須**無條件從 DOM 讀取最新列表並呼叫 `saveSettings()`。
    * **後果**：若加入 `if` 檢查，將導致刪除或拖曳操作無法儲存 (Bug 5 迴歸)。
* **[禁止]**：**[護欄 7 (Popup)] `popup.html` 的全形空白**。
    * **規則**：(v2.4.0 藍圖) 嚴格禁止移除 `popup.html` (v4.0.1) 中「原文」 (`showOriginal`) 標籤前的全形空白 (`　`)。
    * **後果**：違反此規則將破壞 UI 的視覺對齊。
* **[禁止]**：**[護欄 8 (Popup)] API 金鑰儲存邏輯**。
    * **規則**：(v2.2.0 藍圖) `popup.js` (v4.0.1) 中的 `setupApiKeyListeners` 必須區分兩種儲存：
        1.  **新金鑰 (`.new-key-value-input`)**：*必須*使用 `blur` 事件 (capture: true) 並在 `name` 和 `key` 都有值時觸發*儲存 (push)*。
        2.  **已儲存金鑰 (`.key-value-input`)**：*必須*使用 `change` 事件 (on blur) 觸發*更新 (update)*。
    * **後果**: 混淆 `blur` 和 `change` 將導致新金鑰無法儲存，或已儲存金鑰在 `blur` 時被重複儲存。