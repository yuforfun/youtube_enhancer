# 架構轉型藍圖 (B 計畫 v1.1)：遷移至 Serverless (含多金鑰與日誌系統)

**文件版本:** 1.1 (基於 v1.0 進行修訂)
**核心目標:** (同 v1.0) 遷移 `backend.py` 邏輯至擴充功能內部。
**time:** 2025/10/24 2:02
**v1.1 修訂目標:**
1.  **金鑰管理:** 支援使用者輸入並管理*多個* API Key，以複製 `backend.py` 讀取多金鑰的重試/備援邏輯。
2.  **日誌系統:** 建立一個標準化的日誌格式與儲存機制，用於記錄所有非正常執行事件，並顯示在「狀態日誌」 區域。

---

## 1. 執行規劃 (Phased Rollout)

### 階段 1.A：[儲存] 多金鑰管理系統
* **任務:** 建立讓使用者輸入、儲存並刪除*多個* API Key 的機制。
* **涉及檔案:** `options.html`, `popup.js` (options 頁面邏輯), `background.js`。
* **規格 (UI 變更 - `options.html`)**:
    1.  **[變更]** 為了讓「金鑰」與「診斷」相鄰，我們將重新佈局 `tab-diag` 頁籤。
    2.  **[新增]** 在 `tab-diag` 內，新增一個「Google API 金鑰管理」卡片。此卡片應位於「API Key 診斷」 卡片的*正上方*。
    3.  此新卡片將包含一個「新增金鑰」的表單：
        * 輸入框 (text): `#apiKeyNameInput` (用於輸入「金鑰名稱」，例如："個人金鑰")。
        * 輸入框 (password): `#apiKeyInput` (用於輸入 API Key 值)。
        * 按鈕 (primary): `#addApiKeyButton` ("新增金鑰")。
    4.  在表單下方，新增一個「已儲存的金鑰」列表 (`#apiKeyList`)，用於顯示已添加的金鑰。
    5.  列表中的每一行應顯示「金鑰名稱」，並提供一個「刪除」按鈕 (例如：`<button class="delete-key" data-id="uuid-12345">刪除</button>`)。
* **規格 (邏輯變更 - `popup.js`)**:
    1.  `loadSettings` 載入時，需從 `chrome.storage.local` 讀取 `userApiKeys` 陣列，並將其動態渲染到 `#apiKeyList` 列表中。
    2.  `#addApiKeyButton` 點擊事件：
        * 讀取 `#apiKeyNameInput` 和 `#apiKeyInput` 的值。
        * 產生一個金鑰物件 (例如：`{ id: crypto.randomUUID(), name: '...', key: '...' }`)。
        * 從 `storage` 讀取 `userApiKeys` 陣列，將新物件 `push` 進去，然後儲存回 `storage`。
        * 重新渲染 `#apiKeyList` 列表。
    3.  `#apiKeyList` 上的「刪除」按鈕需使用事件委派 (event delegation)：
        * 點擊時，獲取 `data-id`。
        * 從 `storage` 讀取 `userApiKeys` 陣列，過濾 (filter) 掉該 `id` 的物件，然後儲存回 `storage`。
        * 重新渲染 `#apiKeyList` 列表。
* **規格 (資料庫變更 - `chrome.storage.local`)**:
    * **[移除]** (v1.0 藍圖中的) `userApiKey: '...'`。
    * **[新增]** `userApiKeys: [ { id: 'uuid', name: 'Personal', key: '...' }, { id: 'uuid2', name: 'Work', key: '...' } ]`。此結構取代了 `api_keys.txt`。
* **驗證標準:** 使用者可以在 `options.html` 中新增、檢視和刪除多個 API 金鑰，且資料在關閉頁面後依然保留。

### 測試方式與預期結果


1.  **測試步驟 (開啟介面):**

    1.  載入擴充功能。
    2.  點擊擴充功能圖示，開啟 `popup.html`。
    3.  點擊「進階管理後台」 按鈕，開啟 `options.html`。
    4.  點擊「診斷與日誌」 頁籤。

2.  **預期結果 (UI 驗證):**

      * 應在「資料管理」卡片 的*上方*看到一個新的「Google API 金鑰管理」卡片。
      * 卡片中應包含「金鑰名稱」輸入框、「API Key」密碼輸入框、一個「新增」按鈕。
      * 下方應有一個「已儲存的金鑰」列表，列表內目前應顯示「尚無金鑰」。
      * 測試結果：完成
3.  **測試步驟 (新增金鑰):**

    1.  在「金鑰名稱」 輸入框輸入 `MyTestKey`。
    2.  在「API Key」 輸入框輸入 `TestValue123`。
    3.  點擊「新增」 按鈕。

4.  **預期結果 (新增成功):**

      * 頁面頂端應跳出提示「金鑰 "MyTestKey" 已成功新增！」。
      * 「金鑰名稱」和「API Key」輸入框應被清空。
      * 下方的「已儲存的金鑰」列表 中應出現新的一行，顯示 `MyTestKey` 和一個「刪除」按鈕。
      * 測試結果：完成
5.  **測試步驟 (重新載入):**

    1.  關閉 `options.html` 分頁。
    2.  重新執行「測試步驟 (開啟介面)」。

6.  **預期結果 (資料持久化):**

      * 在「已儲存的金鑰」列表 中，*必須*仍然顯示 `MyTestKey`。
      * 測試結果：完成
7.  **測試步驟 (刪除金鑰):**

    1.  點擊 `MyTestKey` 旁邊的「刪除」 按鈕。
    2.  在跳出的 `confirm` 對話框中點擊「確定」。

8.  **預期結果 (刪除成功):**

      * 頁面頂端應跳出提示「金鑰已成功刪除。」。
      * `MyTestKey` 應從「已儲存的金鑰」列表 中消失，列表變回顯示「尚無金鑰」。
      * 測試結果：完成

### 階段 1.B：[核心] 標準化日誌系統
* **任務:** 建立一個標準化的日誌格式，並修改 `background.js` 和 `popup.js` 以實作和顯示這些日誌。
* **涉及檔案:** `background.js`, `popup.js` (options 頁面邏輯), `options.html`。
* **規格 (日誌格式定義)**:
    * 所有寫入「狀態日誌」的資料**必須**遵循此 `LogEntry` 介面：
    ```typescript
    interface LogEntry {
      timestamp: number;          // (時間) Date.now()
      level: 'ERROR' | 'WARN' | 'INFO'; // (級別)
      message: string;          // (白話說明)
      context?: string;         // (原始錯誤資訊) e.g., e.message
      solution?: string;        // (解決方法) e.g., "請檢查金鑰的 API 用量。"
    }
    ```
* **規格 (儲存機制 - `background.js`)**:
    1.  `chrome.storage.session` 中的 `errorLogs` 鍵，現在將儲存 `LogEntry[]` 陣列 (最多 20 筆)。
    2.  **[新增]** 在 `background.js` 中建立一個內部輔助函式：`async function writeToLog(level, message, context, solution)`。
    3.  此函式負責：
        * 建立一個 `LogEntry` 物件。
        * 從 `chrome.storage.session` 取得 `errorLogs` 陣列。
        * 將新日誌 `push` 到陣列頂端 (最新在前)。
        * `slice` 陣列以維持最大長度。
        * 將新陣列儲存回 `chrome.storage.session`。
    4.  **[修改]** `onMessage` 監聽器中的 `STORE_ERROR_LOG` case：
        * 當 `content.js` (例如 `handleCriticalFailure`) 發送舊格式的日誌時，`background.js` 負責將其轉換為新的 `LogEntry` 格式（例如，`level: 'ERROR'`），然後呼叫 `writeToLog` 函式。
* **規格 (日誌顯示 - `popup.js`)**:
    1.  **[修改]** `loadErrorLogs` 函式 (用於 `options.html`)：
        * 它現在會獲取 `LogEntry[]` 陣列。
        * **必須**修改其 `innerHTML` 渲染邏輯，以顯示新的豐富日誌格式。
        * (建議) 應為不同 `level` (ERROR, WARN) 的日誌條目添加不同的 CSS class (例如 `log-level-error`)，使其在 `options.html` 介面上更易於區分。
        * 範例渲染 ( `error-log-container` )：
        ```html
        <div class="log-entry log-level-warn">
            <div class="log-header">
                <span class="log-time">[14:30:05]</span>
                <span class="log-message">金鑰 'Personal' 已達用量上限</span>
            </div>
            <div class="log-details">
                <strong>[原始錯誤]</strong> 429 Quota Exceeded...
                <strong>[建議]</strong> 請檢查此金鑰的 Google Cloud 帳單與用量。
            </div>
        </div>
        ```
* **驗證標準:** 1.  當 `background.js` 呼叫 `writeToLog` 時，該條目會立即以新格式顯示在 `options.html` 的「狀態日誌」區域。
    2.  `content.js` 觸發的舊錯誤也能被正確轉換並顯示。


### 測試方式與預期結果

1.  **測試步驟 (觸發日誌):**

    1.  載入擴充功能（包含本次 `content.js` 的修改）。
    2.  確保 `backend.py` 服務**未**啟動。
    3.  開啟一個 YouTube 影片頁面。
    4.  點擊擴充功能圖示，點擊「啟用翻譯」。
    5.  擴充功能將嘗試翻譯（例如，匹配到日文 `ja`）。
    6.  `sendBatchForTranslation` 中的 `fetch` 將會失敗，因為 `127.0.0.1:5001` 無法連線。

2.  **預期結果 (`content.js` 行為):**

      * `fetch` 失敗後，`catch` 區塊會呼叫 `handleTranslationError`。
      * `handleTranslationError` *立即*呼叫 `setPersistentError`。
      * `setPersistentError` 呼叫 `sendMessageToBackground` 並發送 `STORE_ERROR_LOG` 動作。
      * 影片播放器右上角應出現一個紅色的 `!` 狀態圓環。
      * 測試結果：完成
3.  **測試步驟 (驗證日誌顯示):**

    1.  開啟 `options.html` -\> 「診斷與日誌」 頁籤。
    2.  捲動到最下方的「狀態日誌」 卡片。

4.  **預期結果 (日誌顯示):**

      * 「狀態日誌」 區域現在*必須*顯示一個新的日誌條目。
      * 日誌條目應為淺紅色背景 (`log-level-error`)。
      * 訊息應類似於 `Failed to fetch`（或更詳細的 `NetworkError` 訊息）。
      * 該日誌應包含時間戳，但不包含 `[原始錯誤]` 或 `[建議]`（因為 `content.js` 尚未升級）。
      * 測試結果：完成


---

### 階段 2：[核心] 遷移翻譯邏輯 (已更新)
* **任務:** 將 `POST /api/translate` 功能遷移至 `background.js`，並使其*適應*新的多金鑰和日誌系統。
* **涉及檔案:** `background.js`, `content.js`, `manifest.json`。
* **規格 (v1.1 更新)**:
    1.  `manifest.json` 和 `content.js` 的變更同 v1.0 藍圖 (移除 `fetch`，改用 `sendMessage`)。
    2.  `background.js` 中 `case 'translateBatch'` 的邏輯**重大變更**：
        * **[取代]** 不再讀取 `userApiKey`，而是讀取 `userApiKeys: [...]` (來自階段 1.A)。
        * **[必要]** 如果 `userApiKeys` 陣列為空，**必須**呼叫 `writeToLog('ERROR', '沒有可用的 API Key', null, '請至「診斷與日誌」分頁新增您的 API Key。')`，並回傳錯誤給 `content.js`。
        * **[必要]** **必須**遍歷 `userApiKeys` 陣列 (外層迴圈) 和 `models_preference` 陣列 (內層迴圈)，**完整複製** `backend.py` 中「金鑰 -> 模型」的重試邏輯。
        * **[必要]** 當 `fetch` 呼叫失敗時 (例如 429 Quota)，**必須**呼叫 `writeToLog('WARN', \`金鑰 '${key.name}' 呼叫模型 '${model_name}' 失敗\`, e.message, '正在嘗試下一個金鑰或模型...')`。
        * 如果所有金鑰和模型都失敗，**必須**呼叫 `writeToLog('ERROR', '所有 API 金鑰與模型均嘗試失敗', '...', '請檢查日誌中的詳細錯誤，並確認金鑰有效性與網路連線。')`。
* **驗證標準:** 翻譯正常運作。當一個金鑰失效 (例如 Quota) 時，系統會自動嘗試下一個金鑰，並在「狀態日誌」 中留下 `WARN` 級別的日誌。

### 測試方式與預期結果

**前置準備 (設定金鑰):**

1.  載入擴充功能（包含本次所有修改）。
2.  開啟 `options.html` -\> 「診斷與日誌」 頁籤。
3.  在「Google API 金鑰管理」 卡片中，新增*至少一個*您**有效**的 Google API Key。

**測試步驟 (驗證翻譯):**

1.  開啟一個有*日文* (`ja`) 字幕的 YouTube 影片頁面。
2.  點擊擴充功能圖示，點擊「啟用翻譯」。
3.  擴充功能應自動匹配到 `ja` 字幕。
4.  `content.js` 應呼叫 `sendMessage({ action: 'translateBatch', ... })`。
5.  `background.js` 應接收到任務，使用您儲存的 API Key 和 `gemini-2.5-flash` 模型 呼叫 Google API。

**預期結果 (翻譯成功):**

  * 影片字幕區域應*成功*顯示雙語字幕。
  * 原文 應為日文，翻譯 應為繁體中文。
  * 由於 `backend.py` 已被移除，整個過程應在**不**啟動 `backend.py` 的情況下完成。
  * 測試結果：完成
**測試步驟 (驗證金鑰為空):**

1.  開啟 `options.html` -\> 「診斷與日誌」。
2.  刪除所有已儲存的 API Key。
3.  重新整理先前的 YouTube 影片頁面（或開啟新影片）。
4.  點擊「啟用翻譯」。

**預期結果 (金鑰為空):**

  * `background.js` 應檢測到 `apiKeys.length === 0`。
  * 影片播放器右上角應出現紅色的 `!` 狀態圓環。
  * 開啟 `options.html` -\> 「診斷與日誌」，查看「狀態日誌」。
  * 日誌中*必須*出現一條 `ERROR` 級別的日誌，訊息為「翻譯失敗：未設定 API Key」，並包含建議：「請至「診斷與日誌」分頁新增您的 API Key。」。
  * 測試結果：完成



### 階段 3：[功能] 遷移 Prompt 管理
* *(同 v1.0 藍圖，此階段不受金鑰或日誌系統變更的影響)*
* **任務:** 將 Prompt 管理從 `backend.py` 遷移至 `chrome.storage.local`。
* **規格:** `popup.js` (options 邏輯) 中 `load/save` Prompt 的 `fetch` 呼叫，改為 `chrome.storage.local.get/set`。
* **驗證標準:** 在 `options.html` 儲存的 Prompt 會被 `background.js` 的 `translateBatch` 流程正確使用。

### 測試方式與預期結果

1.  **測試步驟 (儲存與持久化):**

    1.  載入擴充功能（包含本次所有修改）。
    2.  開啟 `options.html` -\> 「主要設定」 頁籤。
    3.  在「Prompt 自訂」 區塊，語言選擇「日文 (ja)」。
    4.  **預期結果 1:** `textarea` 應自動載入 `DEFAULT_CUSTOM_PROMPTS` 中的日文預設內容（例如包含「町田啟太」）。
    5.  在 `textarea` 末尾新增一行：`- ABCDE -> 12345`。
    6.  點擊「儲存 Prompt」 按鈕。
    7.  **預期結果 2:** 應顯示「Prompt 已成功儲存！」 的提示。
    8.  重新整理 `options.html` 頁面，再次切到「主要設定」 -\> 「日文 (ja)」。
    9.  **預期結果 3:** `textarea` *必須*顯示包含 `- ABCDE -> 12345` 的*修改後*內容。

2.  **測試步驟 (驗證翻譯):**

    1.  （需有有效的 API Key）
    2.  開啟一個包含日文字幕（例如 `ja`）的 YouTube 影片。
    3.  影片字幕原文中需要有 `ABCDE` 這個詞。
    4.  啟用翻譯。
    * 測試結果：完成
3.  **預期結果 (翻譯驗證):**

      * 翻譯結果*必須*將 `ABCDE` 顯示為 `12345`。
      * 這證明 `background.js` 成功地從 `chrome.storage.local` 讀取了您儲存的自訂 Prompt，並將其用於 API 呼叫。
      * 整個過程不再需要 `backend.py` 運行。
      * 測試結果：完成

### 階段 4：[功能] 遷移金鑰診斷 (已更新)
* **任務:** 將 `POST /api/keys/diagnose` 功能遷移至 `background.js`，並使其適應新的多金鑰和日誌系統。
* **涉及檔案:** `options.html`, `popup.js`, `background.js`。
* **規格 (v1.1 更新)**:
    1.  `options.html`：`diagnoseKeysButton` 的文字應為「開始診斷所有金鑰」（因為現在是多金鑰）。`diagnose-results` 區塊**必須**能顯示一個*列表*，而不僅是單一結果。
    2.  `popup.js`：`diagnoseKeysButton` 的點擊事件，從 `fetch` 改為 `chrome.runtime.sendMessage({ action: 'diagnoseAllKeys' })`。
    3.  `background.js`：
        * **[取代]** `case 'diagnoseMyKey'` (v1.0 藍圖) 應改為 `case 'diagnoseAllKeys'`。
        * **[必要]** 此監聽器將遍歷 `chrome.storage.local.userApiKeys` 陣列中的*每一個*金鑰。
        * 對於*每一個*金鑰，它都會執行一次測試 `fetch` 呼叫。
        * **[必要]** **必須**為*每一個*金鑰的測試結果呼叫 `writeToLog`：
            * 成功: `writeToLog('INFO', \`金鑰 '${key.name}' 診斷有效\`)`。
            * 失敗: `writeToLog('ERROR', \`金鑰 '${key.name}' 診斷無效\`, e.message, '請確認金鑰是否複製正確或已被停用。')`。
        * `sendResponse` 應回傳一個結果陣列 (同 `backend.py` 的 `/api/keys/diagnose` 回應)，供 `popup.js` 渲染到 `diagnose-results` 區塊。
* **驗證標準:** 點擊診斷按鈕後，`diagnose-results` 區域會顯示所有金鑰的有效/無效狀態，同時「狀態日誌」 區域會出現對應的 INFO 或 ERROR 日誌條目。

-----

### 測試方式與預期結果

**前置準備 (設定金鑰):**

1.  載入擴充功能（包含本次所有修改）。
2.  開啟 `options.html` -\> 「診斷與日誌」 頁籤。
3.  **情境 A (有效金鑰):** 新增一個*有效*的 Google API Key，命名為 `ValidKey`。
4.  **情境 B (無效金鑰):** 新增一個*無效*的金鑰（例如 `AIzaSy...abcde`），命名為 `InvalidKey`。

**測試步驟 (執行診斷):**

1.  在「診斷與日誌」 頁籤中。
2.  點擊「開始診斷所有金鑰」 按鈕。

**預期結果 (UI 顯示):**

  * 按鈕應短暫顯示「診斷中...」。
  * 「API Key 診斷」 卡片下方的結果區域 (`#diagnose-results`) 應顯示：
      * 一行綠色的 `ValidKey: 有效`。
      * 一行紅色的 `InvalidKey: 無效 - ...`。
  * 整個過程**不**需要 `backend.py` 運行。
* 測試結果：完成
**預期結果 (日誌驗證):**

  * 捲動到最下方的「狀態日誌」 卡片。
  * 日誌中*必須*出現兩條新的日誌：
      * 一條 `INFO` 級別日誌，訊息為「金鑰 'ValidKey' 診斷有效。」。
      * 一條 `ERROR` 級別日誌，訊息為「金鑰 'InvalidKey' 診斷無效。」，並包含 `[原始錯誤]` 和 `[建議]` 資訊。
* 測試結果：完成

### 階段 5：[清理] 移除本地後端依賴
* *(同 v1.0 藍圖)*
* **任務:** 移除所有對 `127.0.0.1` 的殘餘呼叫，並刪除 `backend.py`。
* **驗證標準:** 擴充功能在 `backend.py` **未執行**的情況下，所有功能 (翻譯、設定、多金鑰診斷、日誌) 均可 100% 正常運作。

---

## 2. 系統實作細節 (v1.1 修訂)

### A. API 變更
* *(同 v1.0 藍圖)*
* **[移除]** 所有 `127.0.0.1` API 端點。
* **[新增]** `background.js` 對 `https://generativelanguage.googleapis.com/` 的 `fetch` 呼叫。

### B. 前端 (擴充功能) 變更
* **`manifest.json`**: (同 v1.0) 移除 `127.0.0.1`，新增 `...googleapis.com`。
* **`options.html`**:
    * **[新增]** 「Google API 金鑰管理」卡片，包含 `#apiKeyNameInput`, `#apiKeyInput`, `#addApiKeyButton` 和 `#apiKeyList`。
    * **[移動]** 將上述卡片與「API Key 診斷」、「狀態日誌」 卡片一同放置在 `tab-diag` 頁籤下。
* **`popup.js`** (options 邏輯):
    * **[新增]** 多金鑰 CRUD (新增/讀取/刪除) 邏輯 (見階段 1.A)。
    * **[修改]** `loadCustomPrompts` / `savePromptButton`：`fetch` -> `chrome.storage.local` (見階段 3)。
    * **[修改]** `diagnoseKeysButton`：`fetch` -> `sendMessage('diagnoseAllKeys')` (見階段 4)。
    * **[修改]** `loadErrorLogs`：**必須**重寫，以渲染新的 `LogEntry` 物件陣列 (見階段 1.B)。
* **`content.js`**:
    * **[修改]** `sendBatchForTranslation`：`fetch` -> `sendMessage('translateBatch')` (見階段 2)。
    * **[修改]** `setPersistentError` -> `STORE_ERROR_LOG` 邏輯不變，由 `background.js` 負責轉換格式 (見階段 1.B)。
* **`background.js`**:
    * **[新增]** `writeToLog` 內部輔助函式 (見階段 1.B)。
    * **[修改]** `onMessage` 監聽器：
        * `STORE_ERROR_LOG`: 增加格式轉換邏輯。
        * `translateBatch` (新增): 實作多金鑰/多模型重試 及日誌記錄 (見階段 2)。
        * `diagnoseAllKeys` (新增): 實作遍歷診斷及日誌記錄 (見階段 4)。

### C. 資料庫 (Chrome Storage) 變更
* **`chrome.storage.local`**:
    * **[新增]** `userApiKeys: LogEntry[]` (取代 `api_keys.txt`)。
    * **[新增]** `customPrompts: { ... }` (取代 `custom_prompts.json`)。
    * **[不變]** `ytEnhancerSettings`, `yt-enhancer-cache-*`。
* **`chrome.storage.session`**:
    * **[修改]** `errorLogs: LogEntry[]` (儲存的資料結構變更為 `LogEntry` 物件)。

---

## 3. 修改完成後的預期結果

### 使用者視角
1.  **安裝流程:** (同 v1.0) 安裝擴充功能後，至「進階管理後台」 -> 「診斷與日誌」 頁籤。
2.  **金鑰設定:** 使用者在「Google API 金鑰管理」卡片中，可以輸入「名稱」和「金鑰」，並點擊「新增」。他們可以新增*多個*金鑰作為備援。
3.  **診斷流程:** 使用者點擊「開始診斷所有金鑰」，下方會顯示*每一個*金鑰的「有效」或「無效」狀態。
4.  **日誌監控:** 在「狀態日誌」 區域，使用者現在可以看到更詳細的系統活動。例如，當一個金鑰（'Key A'）額度用盡時，他們會看到一條 `WARN` 日誌，告知 'Key A' 失敗，系統正在嘗試 'Key B'。如果所有金鑰都失敗，他們會看到一條 `ERROR` 日誌，並附帶解決建議。

### 系統行為
1.  **`backend.py` 移除:** (同 v1.0)
2.  **流量轉移:** (同 v1.0)
3.  **風險轉移:** (同 v1.0)
4.  **金鑰重試 (新):** `background.js` 的 `translateBatch` 流程現在會完整複製 `backend.py` 的金鑰/模型迴圈邏輯。它會優先使用第一個金鑰和偏好的模型。如果失敗（例如 Quota），它會自動嘗試下一個模型，或下一個金鑰，直到成功或全部失敗。
5.  **日誌記錄 (新):** 所有關鍵的失敗（翻譯重試、診斷失敗）或成功（診斷成功）事件，都會被 `background.js` 的 `writeToLog` 函式捕捉，並寫入 `chrome.storage.session`，供使用者在 `options.html` 介面中隨時查閱。




總結本次「架構轉型藍圖 v1.1」 更新中的關鍵決策、護欄與遺留的歷史包袱。

### 1. 關鍵決策 (Key Decisions)

* **Serverless 架構遷移 (藍圖 B)**：
    這是本次更新最核心的決策。我們決定將所有後端邏輯（包括金鑰管理、Prompt 組合、API 呼叫）從 `backend.py` 完整遷移到擴充功能內部的 `background.js` 執行。此決策的目的是徹底消除對本地 Python 環境的依賴、安全風險與未來的維護成本。

* **強化基礎建設 (多金鑰與日誌系統)**：
    在遷移的基礎上，我們決定不只是平移舊功能，而是*立即升級*基礎建設。您決定在「階段 1」 就導入「多金鑰管理」（取代 `api_keys.txt`）和「標準化日誌系統」(`LogEntry`)，這提高了系統的健壯性與可除錯性。

* **即時錯誤修正**：
    在「階段 3」 中，我們發現了「階段 2」 引入的 Google API URL 打字錯誤 (`generativelace...`)。我們決定*立即修正*此錯誤，而不是等到所有階段完成，因為它阻礙了後續功能的測試。

### 2. 護欄 (Guardrails)

* **嚴格遵循藍圖 (v1.1)**：
    我們全程以「架構轉型藍圖 v1.1」 作為「單一事實來源」。所有開發工作都嚴格按照「階段 1.A、1.B、2、3、4、5」 的順序拆解執行，沒有進行規格外的功能添加。

* **保持 API 介面兼容**：
    在「階段 4」（金鑰診斷） 中，我們遵循了一個重要護欄：`background.js` 中新的 `diagnoseAllKeys` 動作，其回傳的 `results` 陣列格式，被要求必須與舊 `backend.py` 的 API `/api/keys/diagnose` *完全一致*。這使得 `popup.js` 的前端渲染邏輯 無需修改即可重用。

### 3. 歷史包袱 (Historical Baggage / Technical Debt)

* **(已移除) 本地 Python 依賴**：
    本次更新最大的成就，就是清除了「必須依賴本地 `backend.py` 運行」 這個最主要的歷史包袱。包括所有平台特定程式碼（如 `sys.platform == 'win32'`）都已隨 `backend.py` 一同被刪除。

* **(已識別) 語言偏好設定 Bug**：
    我們在更新前曾討論過「語言偏好設定有很大的誤差」。我們*刻意決定*將這個 Bug *保留*並遷移到新架構中，而不在即將刪除的 `backend.py` 上修復它。這是一個我們已識別並明確同意延後處理的「技術債」。

* **(遷移中) 重複日誌**：
    如您所觀察到的，目前系統在單次錯誤（如「未設定金鑰」）時會產生兩筆日誌。一筆由 `background.js` 的新邏KEP統 (`writeToLog`) 產生，另一筆由 `content.js` 的舊錯誤處理 (`STORE_ERROR_LOG`) 產生。這是遷移過程中因新舊系統並存而產生的暫時性包袱，我們已瞭解其成因。


# 架構修正藍圖 v1.2 (定稿)：還原金鑰冷卻機制

**文件版本:** 1.2 (定稿)
**基礎版本:** v1.1 (當前實作的程式碼)
**核心目標:**
1.  **[修復 Bug]** 修正 `content.js` 中對 `AbortError` 的錯誤判斷，避免「正常中斷」被錯誤回報為「紅色 !」。
2.  **[還原功能]** 還原 `backend.py` 中遺漏的「狀態化金鑰冷卻」機制，將其遷移至 `background.js`，解決因暫時性配額 (Quota) 失敗而導致的過早報錯問題。
**time:** 2025/10/24 21:00

---

## 1. 執行規劃 (Phased Rollout)

### 階段 1：[容錯] 修正 `content.js` 的 `AbortError` 判斷缺陷
* **任務:** 修正 `content.js` `processNextBatch` `catch` 區塊中對 `AbortError` 的判斷邏輯。
* **涉及檔案:** `content.js`
* **規格 (邏輯變更 - `content.js`)**:
    1.  **[修改]** `processNextBatch` 函式的 `catch (e)` 區塊。
    2.  **目標:** `if (e.name !== 'AbortError')` 這行判斷式。
    3.  **修改為:** `if (e.message !== 'AbortError')`
    4.  **修正原因：** `new Error('AbortError')` 產生的錯誤物件，其 `e.name` 是 `"Error"`，而 `e.message` 才是 `"AbortError"`。原始判斷式 `e.name !== 'AbortError'` 永遠為真，導致 `AbortError` 永遠無法被正確忽略，進而錯誤地觸發了 `handleTranslationError`。
    5.  `catch` 區塊內的 `handleTranslationError` 呼叫應保持不變，因為它將在「階段 2」完成後，用於接收 `background.js` 傳來的*真正*永久性錯誤。
* **驗證標準:**
    1.  在翻譯過程中（例如 Orb 正在顯示 % 數時），快速重新整理頁面或導航至其他 YouTube 影片。
    2.  檢查 `options.html` 的「狀態日誌」區域。
    3.  日誌中**不應**再出現任何 `AbortError` 相關的錯誤紀錄。

### 階段 2：[韌性] 於 `background.js` 還原「狀態化金鑰冷卻」機制
* **任務:** 還原 `backend.py` 中的 `exhausted_key_timestamps` 邏輯。使 `background.js` 能夠記憶哪些金鑰因配額問題而失敗，並在冷卻期內自動跳過它們。
* **涉及檔案:** `background.js`
* **規格 (常數定義 - `background.js`)**:
    1.  **[新增]** 在檔案頂部（靠近 `SAFETY_SETTINGS`）新增冷卻時間常數（60 秒，參照 `backend.py` 的 60 秒）：
        ```javascript
        const API_KEY_COOLDOWN_SECONDS = 60; // 金鑰因配額失敗後的冷卻時間（秒）
        ```
* **規格 (儲存機制 - `chrome.storage.session`)**:
    1.  **[新增]** 我們將使用 `chrome.storage.session`（瀏覽器開啟期間保持）來儲存冷卻列表，取代 `backend.py` 的記憶體變數。
    2.  **鍵名:** `apiKeyCooldowns`
    3.  **結構:** `{ "key-id-123": 1678886400000, "key-id-456": 1678886405000 }` (儲存 `keyInfo.id` 和失敗的 `Date.now()`)
* **規格 (邏輯變更 - `background.js` - `case 'translateBatch'`)**:
    1.  **[新增]** 在 `(async () => {` 函式開頭，獲取當前時間和冷卻列表：
        ```javascript
        const now = Date.now();
        const cooldownResult = await chrome.storage.session.get({ 'apiKeyCooldowns': {} });
        const cooldowns = cooldownResult.apiKeyCooldowns;
        let cooldownsUpdated = false; // 追蹤是否需要回存
        ```
    2.  **[新增]** *在* `for (const keyInfo of apiKeys)` 迴圈的*最上方*（遍歷每個金鑰時），加入金鑰檢查與冷卻邏輯：
        ```javascript
        const keyId = keyInfo.id; // 來自 v1.1 階段 1.A
        const keyName = keyInfo.name || '未命名金鑰'; //
        const currentKey = keyInfo.key; //
        const cooldownTimestamp = cooldowns[keyId];

        if (cooldownTimestamp && now < cooldownTimestamp + (API_KEY_COOLDOWN_SECONDS * 1000)) {
            // 1. 金鑰仍在冷卻期，跳過
            await writeToLog('INFO', `金鑰 '${keyName}' 仍在冷卻中，已跳過。`);
            continue; 
        } else if (cooldownTimestamp) {
            // 2. 金鑰冷卻期已過，將其從列表移除
            delete cooldowns[keyId];
            cooldownsUpdated = true;
        }
        ```
    3.  **[修改]** 移除 `for` 迴圈內原有的 `keyName` 和 `currentKey` 宣告，因為我們已在*迴圈頂部*宣告它們。
    4.  **[重大修改]** *在* `catch (e)` 區塊中，針對 "quota" / "billing" 錯誤（即 `break;` 之前）：
        * **[取代]** 原有的 `writeToLog` 呼叫。
        * **[新增]** 將金鑰加入冷卻列表並*立即儲存*的邏輯：
        ```javascript
        // 原始日誌: await writeToLog('WARN', `金鑰 '${keyName}' 已達用量上限...`, ...);
        // --- 替換為以下 ---
        await writeToLog('WARN', `金鑰 '${keyName}' 已達用量上限，將冷卻 ${API_KEY_COOLDOWN_SECONDS} 秒。`, e.message, '系統將自動嘗試下一個金鑰。');
        
        cooldowns[keyId] = Date.now();
        await chrome.storage.session.set({ apiKeyCooldowns: cooldowns }); 
        
        break; // (保持不變)
        // --- 替換結束 ---
        ```
    5.  **[新增]** *在* `(async () => {` 函式的*最末端*，`await writeToLog('ERROR', ...)` 呼叫*之前*：
        * **功能:** 儲存因冷卻期滿而被移除的金鑰列表。
        ```javascript
        if (cooldownsUpdated) {
            await chrome.storage.session.set({ apiKeyCooldowns: cooldowns });
        }
        // (現有的) await writeToLog('ERROR', '所有 API Key 與模型均嘗試失敗。', ...);
        // (現有的) sendResponse({ error: '所有模型與 API Key 均嘗試失敗。' });
        ```
* **驗證標準:**
    1.  （前置作業）在 `options.html` 中設定兩個金鑰：'Key A' (已達配額) 和 'Key B' (有效)。
    2.  觸發翻譯。
    3.  **預期行為 1:** `background.js` 應嘗試 'Key A'，失敗。`options.html`「狀態日誌」 應顯示「金鑰 'Key A' 已達用量上限，將冷卻 60 秒。」。
    4.  **預期行為 2:** `background.js` 應*立即*自動嘗試 'Key B' 並翻譯成功。
    5.  立即在*同一個*影片觸發「重新翻譯」（`forceRerun`）。
    6.  **預期行為 3:** `options.html`「狀態日誌」 應*立即*顯示「金鑰 'Key A' 仍在冷卻中，已跳過。」。
    7.  **預期行為 4:** `background.js` 應*立即*使用 'Key B' 翻譯成功。

---

## 2. 系統實作細節 (v1.2 修訂)

### A. API 變更
* (無變更)

### B. 前端 (擴充功能) 變更 (v1.1 -> v1.2)
* **`content.js`**:
    * **[修改]** `processNextBatch` `catch` 區塊：
        1.  修正 `AbortError` 判斷式為 `e.message !== 'AbortError'`。
* **`background.js`**:
    * **[新增]** `API_KEY_COOLDOWN_SECONDS` 常數。
    * **[修改]** `case 'translateBatch'`：
        1.  在開頭從 `chrome.storage.session` 讀取 `apiKeyCooldowns`。
        2.  在 `for` 迴圈頂部*新增*檢查邏輯，`continue` 處於冷卻狀態的金鑰。
        3.  在 `catch` 區塊的 "quota" 判斷中，*新增*將 `keyInfo.id` 寫入 `apiKeyCooldowns` 並*儲存*回 `chrome.storage.session` 的邏輯。

### C. 資料庫 (Chrome Storage) 變更
* **`chrome.storage.session`**:
    * **[新增]** `apiKeyCooldowns: { [keyId: string]: number }`。用於儲存金鑰失敗的時間戳。

---

## 3. 修改完成後的預期結果

### 使用者視角
1.  **智慧型錯誤處理:** 當一個金鑰（'Key A'）額度用盡時，使用者*不會*看到任何錯誤。系統會自動在背景將 'Key A' 冷卻 60 秒，並立即嘗試 'Key B' 完成翻譯。
2.  **不再有虛假警報:** 切換影片或重新整理頁面時，不會再觸發紅色 "!" 或在日誌中留下 `AbortError` 紀錄。
3.  **真實的永久錯誤:** 只有在*所有*金鑰都*同時*處於冷卻狀態時，`background.js` 才會回報「所有金鑰均嘗試失敗」，此時 `content.js` *才會*顯示紅色 "!"（這是正確的行為）。使用者在 60 秒冷卻期過後重新整理頁面，系統將自動恢復運作。

### 系統行為
1.  **`content.js` (已修正):** `catch` 區塊能正確忽略 `e.message === 'AbortError'`。它已不再具有重試職責，完全信任 `background.js` 的錯誤報告。
2.  **`background.js` (已修正):** `translateBatch` 函式現在是*有狀態的*。它使用 `chrome.storage.session` 來維護一個 `apiKeyCooldowns` 列表，其行為*完全還原*了 `backend.py` 的金鑰冷卻邏輯，從而實現了高韌性的翻譯服務。

關於您提出的問題，我將逐一進行深入說明：

### 1\. 關於 `AbortError` 與日誌區域的關係

您的理解完全正確。`AbortError` 是一個預期中的「正常中斷」訊號，**不應**被視為錯誤，也**不該**出現在「狀態日誌」區域。

v1.2 藍圖的第一階段就是為了修正這個 v1.1 的 Bug。目前 `content.js` 錯誤地將這個正常中斷提報為錯誤。在 v1.2 修正後，`AbortError` 將會被 `content.js` 正確地識別並安靜地忽略。

**修正後結果：** 此行為將*不會*在 Console 留下紀錄，也*不會*被傳送到「狀態日誌」區域。

### 2\. 關於金鑰冷卻的單位 (Key vs Model)

您的觀察非常精準，您提供的圖片也證實了 RPM (每分鐘請求數) 確實是針對*模型*的重要限制。

**結論是：我們不需要為「模型」增加*額外的*冷卻機制，因為 `backend.py` 的原始邏輯（我們已遷移到 `background.js`）已經透過「區分錯誤類型」來隱性地處理了這個問題。**

說明如下：

  * **v1.2 的「金鑰冷卻」(`break`)：**

      * **觸發時機：** 當 `background.js` 收到 "quota" (配額) 或 "billing" (帳單) 錯誤時。
      * **代表意義：** 這代表這把**金鑰 (Key) 本身**出問題了（例如沒錢了、日用量爆了）。
      * **執行動作：** 執行 `break`，*中斷*目前金鑰的模型迴圈，並將這把**金鑰**加入 60 秒冷卻。

  * **v1.1 的「模型切換」(`continue`)：**

      * **觸發時機：** 當 `background.js` 收到*任何其他*錯誤時，例如您提到的 RPM (429 Too Many Requests) 錯誤。
      * **代表意義：** 這代表「`Key A` + `Model 1`」這個*組合*暫時失敗。
      * **執行動作：** 執行 `continue`，*繼續*模型迴圈，立刻嘗試「`Key A` + `Model 2`」。

**這就是隱性的「模型冷卻」**：
當 `Model 1` 達到 RPM 上限時，`background.js` 會跳過它，改用 `Model 2`、`Model 3`...。這使得 `Model 1` 獲得了休息時間，而系統仍能透過其他模型（或下一個金鑰）繼續運作。

因此，v1.2 的「金鑰冷卻」是專門為了應對 "quota" 這種金鑰級別的災難性錯誤；而既有的 `continue` 邏輯，則已經完美地處理了您所擔心的 RPM 這類模型級別的暫時性錯誤。

### 3\. 關於 v1.2 的「重複日誌」問題與解決方案

這是一個很好的問題。您不希望看到「歷史包袱」被當作理所當然，這點我完全同意。

**問題根源 (如我先前分析)：**

1.  **`background.js` (核心)：** 嘗試所有金鑰失敗後，呼叫 `writeToLog(...)` **(日誌 1)**。
2.  **`content.js` (介面)：** 收到 `background.js` 的失敗回傳後，呼叫 `setPersistentError(...)`。
3.  **`content.js` (介面)：** `setPersistentError` 內部*再次*呼叫 `sendMessageToBackground({ action: 'STORE_ERROR_LOG', ... })` **(日誌 2)**。

**解決方案 (我的看法)：**
我認為「錯誤的最終裁決者」應該是 `background.js`（我們的核心伺服器）。因此，**日誌 1** 是必要且正確的。我們應該消除的是 **日誌 2**。

**具體執行規劃：**
我建議為 `content.js` 中的 `setPersistentError` 函式 增加一個參數，以決定是否要回報日誌，這能完美解決此問題，同時不影響其他區域的報錯。

1.  **修改 `content.js` - `setPersistentError` 函式：**

      * **原始：** `setPersistentError(message)`
      * **修改為：** `setPersistentError(message, logThisError = true)`
      * **內部邏輯：**
        ```javascript
        // ...
        this.state.persistentError = message;

        // 【關鍵修正點】只在需要時才回報日誌
        if (logThisError) { 
            this.sendMessageToBackground({
                action: 'STORE_ERROR_LOG',
                payload: { message, timestamp: Date.now() }
            }).catch(e => this._log('❌ 無法儲存錯誤日誌:', e));
        }

        // ... (更新 UI (紅色 !) 的邏輯保持不變)
        // ...
        ```

2.  **修改 `content.js` - `handleTranslationError` 函式：**

      * **說明：** 此函式處理的是*來自 `background.js` 的錯誤*（`background.js` 已經自己記錄了 **日誌 1**）。
      * **原始：** `setPersistentError(errorMessage);`
      * **修改為：** `setPersistentError(errorMessage, false);`
      * **結果：** `content.js` 仍會顯示紅色 "\!" UI，但*不會*再發送重複的 **日誌 2**。

3.  **修改 `content.js` - `handleCriticalFailure` 函式：**

      * **說明：** 此函式處理的是\* `content.js` 自己的錯誤\*（例如「找不到播放器」）。
      * **原始：** `setPersistentError(...)`
      * **修改為：** `setPersistentError(..., true);` (或保持預設 `setPersistentError(...)`)
      * **結果：** 這確保了*僅發生在客戶端*的錯誤，依然會被正確地記錄到「狀態日誌」中。

**總結：**
此方案可以安全地消除「永久性翻譯失敗」時的重複日誌，同時*完整保留*了「客戶端獨有錯誤」的日誌回報能力，解決了您擔心的「影響其他區域報錯」的問題。

 

好的，以下是我們剛剛完成的 v1.2 (韌性) 與 v1.3 (UX 優化) 兩次修改的統整摘要。

### 統整 v1.2 (韌性) + v1.3 (UX) 程式碼修改

本次更新的核心目標是**提高擴充功能的錯誤處理能力與使用者體驗**，使其在面對 API 暫時性失敗（如金鑰配額、模型過載）時，表現得更智慧、更具韌性。

---

### 1. v1.2：韌性修復 (Resilience Fixes)

此階段專注於還原 `backend.py` 中遺失的核心錯誤處理邏輯，並修正 v1.1 遷移時引入的 Bug。

* **`background.js` (核心後端)：**
    * **還原「金鑰冷卻」機制**：
        * 新增了 `API_KEY_COOLDOWN_SECONDS = 60` 常數。
        * `translateBatch` 函式現在是「有狀態的」。它會使用 `chrome.storage.session` 來讀寫 `apiKeyCooldowns` 列表。
        * **金鑰配額 (Quota) 錯誤：** 當金鑰因 "quota" 或 "billing" 失敗時，系統會將該金鑰 ID 存入 `apiKeyCooldowns` 列表冷卻 60 秒，並 `break` 嘗試下一個金鑰。
        * **金鑰冷卻中：** 在嘗試金鑰前，會檢查其是否在冷卻中。若是，則記錄一條 `INFO` 日誌（例如：「金鑰 'Key A' 仍在冷卻中...」）並 `continue` 跳過該金鑰。

* **`content.js` (指揮中心)：**
    * **修正 `AbortError` Bug**：
        * 在 `processNextBatch` 的 `catch` 區塊中，將錯誤判斷式從 `e.name` 修正為 `e.message` (`errorMsg === 'aborterror'`)。
        * **結果：** 使用者切換影片或重整頁面時的「正常中斷」行為，不會再被錯誤地當成失敗，也**不會**再顯示紅色 `!` 或污染日誌。
    * **修正「重複日誌」Bug**：
        * `setPersistentError` 函式被修改為 `setPersistentError(message, logThisError = true)`。
        * `handleTranslationError` (處理來自 `background.js` 的失敗) 現在會呼叫 `setPersistentError(errorMessage, false)`。
        * **結果：** `background.js` 記錄「所有金鑰均失敗」的 `ERROR` 日誌後，`content.js` 雖然仍會顯示紅色 `!`，但**不會**再發送第二條重複的日誌到日誌區域。

---

### 2. v1.3：使用者體驗優化 (UX Optimization)

此階段專注於解決您提出的 UX 痛點：將暫時性的「模型過載」(503 錯誤) 與永久性的「失敗」區分開來。

* **`content.js` (指揮中心)：**
    * **新增「自動重試」邏輯**：
        * `processNextBatch` 的 `catch` 區塊現在功能更強大。
        * 它會檢查錯誤訊息是否包含 "503"、"overloaded" 或 "unavailable" (來自您的日誌)。
        * **結果：** 如果偵測到這類「暫時性錯誤」，系統**不會**顯示紅色 `!`，而是會：
            1.  呼叫 `this.setOrbState('retrying')`。
            2.  設定 `setTimeout` 在 10 秒後自動重新呼叫 `this.processNextBatch()`。
    * **新增 `retrying` 狀態**：
        * `setOrbState` 函式中新增了一個 `case 'retrying':`。
        * **結果：**
            * Orb 圓環內部顯示 `⌛`。
            * 滑鼠停留提示 (title) 顯示「模型暫時過載，10 秒後自動重試...」。

* **`style.css` (介面樣式)：**
    * **新增 `retrying` 樣式**：
        * 新增了 `#enhancer-status-orb.state-retrying` 規則，將背景色設為黃色 (`#f59e0b`)。
        * **結果：** 新的「重試中」狀態在視覺上明確區分為黃色，而非代表失敗的紅色。

---

### 總結：修改後的系統行為

1.  **切換影片 (正常中斷)：** 安靜地停止，不會有任何錯誤提示 (v1.2 修正)。
2.  **金鑰配額用盡 (暫時失敗)：** `background.js` 自動冷卻該金鑰 60 秒，並嘗試下一個金鑰。UI 不會顯示錯誤 (v1.2 還原)。
3.  **模型過載 503 (暫時失敗)：** `content.js` 顯示**黃色 `⌛`** 圖示，並在 10 秒後自動重試 (v1.3 優化)。
4.  **永久失敗 (例如所有金鑰都失效)：** `content.js` 顯示**紅色 `!`** 圖示，且日誌區只會顯示一條來自 `background.js` 的 `ERROR` 紀錄 (v1.2 修正)。

# 規格說明書：v3.1.0 智慧錯誤處理與 UI 優化

## 1. 執行規劃

此任務將分為三個階段，依序從後端（錯誤分類）推進到前端（邏輯響應），最後是 UI（樣式調整）。

* **階段 1：後端 (`background.js`) 智慧化**
    * **任務**：修改 `translateBatch` 函式，使其不再回報籠統的「所有 API Key 均嘗試失敗」。
    * **目標**：在 `translateBatch` 內部追蹤所有金鑰/模型的失敗類型，並在最終失敗時，回傳三種結構化錯誤之一：`TEMPORARY_FAILURE`、`PERMANENT_FAILURE` 或 `BATCH_FAILURE`。

* **階段 2：前端 (`content.js`) 邏輯適配**
    * **任務**：修改 `processNextBatch` 中的 `catch` 區塊，使其能接收並處理來自階段 1 的三種新錯誤。
    * **目標**：
        * **(A)** 實現**情境一（黃色重試）**：收到 `TEMPORARY_FAILURE` 時，觸發 `setOrbState('retrying')` 並設定 `setTimeout` 自動重試。
        * **(B)** 實現**情境二（紅色停止）**：收到 `PERMANENT_FAILURE` 時，呼叫 `setPersistentError` 顯示紅色 `!`。

* **階段 3：前端 (`content.js` + `style.css`) UI 實現**
    * **任務**：實現**情境三（批次點擊重試）**並優化**情境一**的 UI。
    * **目標**：
        * **(A)** 收到 `BATCH_FAILURE` 時，重新啟用「點擊重試」UI，並確保進度條 % 數能繼續推進。
        * **(B)** 修改 `setOrbState` 函式，使 `retrying` 狀態能顯示「進度 % 數」，而不只是 `⌛`。
        * **(C)** 修改 `style.css`，將 `retrying` 狀態的樣式改為「黑底 + 黃色外框」。

---

## 2. 系統實作細節

### 階段 1：後端 (`background.js`) 智慧化

**檔案**：`background.js`
**目標函式**：`chrome.runtime.onMessage` 監聽器中的 `case 'translateBatch'` (約 `background.js:203`)

**修改藍圖**：

1.  **初始化錯誤統計**：
    * 在 `(async () => {` 之後，`for (const keyInfo of apiKeys)` 迴圈**之前**，初始化一個統計物件。
    * `let errorStats = { temporary: 0, permanent: 0, batch: 0, totalAttempts: 0 };`

2.  **分類並記錄錯誤**：
    * 在 `for (const modelName of models_preference)` 迴圈內的 `catch (e)` 區塊 (約 `background.js:296`) 中：
    * `errorStats.totalAttempts++;`
    * 移除 `await writeToLog('WARN', ...)`。
    * 修改 `if (errorStr.includes('quota') || errorStr.includes('billing'))` 邏輯，將其拆分：
        * **永久性錯誤 (金鑰級)**：`if (errorStr.includes('billing') || errorStr.includes('api key not valid'))`
            * `errorStats.permanent++;`
            * `await writeToLog('ERROR', \`金鑰 '${keyName}' 驗證失敗 (Billing/Invalid)，將永久跳過此金鑰。\`, e.message, '請更換金鑰。');`
            * `break;` (跳出模型迴圈，嘗試下一個金鑰)
        * **暫時性錯誤 (配額/過載)**：`else if (errorStr.includes('quota') || errorStr.includes('429') || errorStr.includes('503') || errorStr.includes('overloaded'))`
            * `errorStats.temporary++;`
            * (保留 `cooldowns[keyId] = Date.now();` 的冷卻邏輯)
            * `await writeToLog('WARN', \`金鑰 '${keyName}' 遭遇暫時性錯誤 (Quota/Overload)，將冷卻 ${API_KEY_COOLDOWN_SECONDS} 秒。\`, e.message, '系統將自動嘗試下一個金鑰。');`
            * `break;` (跳出模型迴圈，嘗試下一個金鑰)
        * **批次錯誤 (模型級)**：`else`
            * `errorStats.batch++;`
            * `await writeToLog('WARN', \`金鑰 '${keyName}' 呼叫模型 '${modelName}' 失敗 (可能為格式錯誤)。\`, e.message, '系統將自動嘗試下一個模型。');`
            * `continue;` (嘗試下一個模型)

3.  **回傳智慧錯誤**：
    * 在 `(結束 金鑰 迴圈)` (約 `background.js:316`) 之後。
    * **移除** `await writeToLog('ERROR', '所有 API Key ...');`
    * **移除** `sendResponse({ error: '所有模型與 API Key 均嘗試失敗。' });`
    * **替換為**新的智慧回報邏輯：

    ```javascript
    // (接在 '結束 金鑰 迴圈' 之後)

    // 5. 根據錯誤統計，回傳結構化錯誤
    if (errorStats.temporary > 0) {
        // 情境一：只要有一次是 429/503，就優先回報為可重試的暫時錯誤
        // 嘗試從日誌中解析建議的重試秒數，若無則預設 10 秒
        const lastTemporaryError = (await chrome.storage.session.get({ 'errorLogs': [] })).errorLogs[0];
        let retryDelay = 10; // 預設 10 秒
        if (lastTemporaryError && lastTemporaryError.context) {
            const match = lastTemporaryError.context.match(/retryDelay": "(\d+)/);
            if (match && match[1]) {
                retryDelay = parseInt(match[1], 10);
            }
        }
        await writeToLog('WARN', `所有金鑰/模型均暫時不可用，將於 ${retryDelay} 秒後重試。`);
        sendResponse({ error: 'TEMPORARY_FAILURE', retryDelay: retryDelay });

    } else if (errorStats.permanent > 0 && errorStats.permanent === errorStats.totalAttempts) {
        // 情境二：所有嘗試均為永久性金鑰錯誤
        await writeToLog('ERROR', '所有 API Key 均失效 (Billing/Invalid)。', '翻譯流程已停止。', '請檢查並更換您的 API Key。');
        sendResponse({ error: 'PERMANENT_FAILURE', message: '所有 API Key 均失效 (Billing/Invalid)。' });

    } else if (errorStats.batch > 0) {
        // 情境三：沒有暫時性或永久性金鑰錯誤，但模型無法處理內容
        await writeToLog('WARN', '模型無法處理此批次內容。', '可能為格式或內容錯誤。', '前端將標記此批次為可點擊重試。');
        sendResponse({ error: 'BATCH_FAILURE', message: '模型無法處理此批次內容。' });
        
    } else {
        // 兜底：其他未知情況
        await writeToLog('ERROR', '所有 API Key 與模型均嘗試失敗 (未知原因)。', '請檢查日誌。', '請確認金鑰有效性、用量配額與網路連線。');
        sendResponse({ error: '所有模型與 API Key 均嘗試失敗。' });
    }

    // (結束 'translateBatch' 的 async 函式)
    ```

### 階段 2：前端 (`content.js`) 邏輯適配 (情境 1 & 2)

**檔案**：`content.js`
**目標函式**：`processNextBatch` (約 `content.js:338`)

**修改藍圖**：

1.  **修改 `catch (e)` 區塊**：
    * 找到 `try { ... } catch (e) { ... }` 區塊 (約 `content.js:380`)。
    * **移除** `if (errorMsg.includes('503') || ...)` 相關的舊重試邏輯 (`content.js:390-403`)。
    * **替換為**新的 `catch` 邏輯：

    ```javascript
    // (在 processNextBatch 的 catch (e) 區塊)
    } catch (e) {
        const errorMsg = String(e.message);

        // 1. (v1.2 Bug 修正) 處理 AbortError
        if (errorMsg.includes('AbortError')) {
            this._log("翻譯任務已中止 (AbortError)，此為正常操作。");
            return; // 結束，不重試
        }

        this._log("❌ 翻譯批次失敗:", errorMsg);

        // --- (新邏輯開始) ---

        if (errorMsg.includes('TEMPORARY_FAILURE')) {
            // 情境一：暫時性錯誤 (429/503)
            const retryDelayMatch = errorMsg.match(/retryDelay: (\d+)/);
            const retryDelay = (retryDelayMatch && retryDelayMatch[1]) ? parseInt(retryDelayMatch[1], 10) : 10;
            const retryDelayMs = retryDelay * 1000;
            
            this._log(`偵測到模型暫時性過載，${retryDelay} 秒後重試...`);
            this.setOrbState('retrying'); // 顯示黃色狀態
            
            setTimeout(() => {
                // 檢查狀態，如果使用者已導航離開，則不重試
                if (this.state.isProcessing && this.state.abortController) {
                    this.processNextBatch();
                }
            }, retryDelayMs); // 使用 API 建議的延遲

        } else if (errorMsg.includes('PERMANENT_FAILURE')) {
            // 情境二：永久性金鑰錯誤
            this.handleTranslationError("所有 API Key 均失效或帳單錯誤，翻譯已停止。");
        
        } else if (errorMsg.includes('BATCH_FAILURE')) {
            // 情境三：模型無法處理此批次 (階段 3 實作)
            this._log("此批次翻譯失敗，標記為可重試。");
            indicesToUpdate.forEach(index => {
                if (this.state.translatedTrack[index]) {
                    this.state.translatedTrack[index].tempFailed = true; // 標記為臨時失敗
                }
            });
            // 關鍵：繼續執行下一批次，以推進進度條
            await this.processNextBatch(); 

        } else {
            // 兜底：處理其他永久性錯誤 (例如 "未設定金鑰" 或舊的錯誤)
            this.handleTranslationError(e.message);
        }
        // --- (新邏輯結束) ---
    }
    ```

2.  **修改 `sendBatchForTranslation`**：
    * **目標函式**：`sendBatchForTranslation` (約 `content.js:424`)。
    * **修改**：確保 `response.error` 能被正確拋出。
    * 找到 `if (response?.error)` 區塊 (約 `content.js:439`)。
    * **替換為**：
        ```javascript
        if (response?.error) {
            // 如果 background.js 處理失敗 (例如 TEMPORARY_FAILURE)
            // 將包含 retryDelay 的完整錯誤訊息拋出
            let structuredError = response.error;
            if (response.retryDelay) {
                structuredError += ` (retryDelay: ${response.retryDelay})`;
            }
            throw new Error(structuredError); 
        }
        ```

### 階段 3：前端 (`content.js` + `style.css`) UI 實現 (情境 3 & UI 優化)

**檔案**：`content.js`

1.  **修改 `updateSubtitleDisplay` (顯示點擊重試)**：
    * **目標函式**：`updateSubtitleDisplay` (約 `content.js:520`)。
    * **修改**：在 `let html = '';` 之後，加入對 `tempFailed` 旗標的檢查。
    * **新增邏輯**：
        ```javascript
        // (在 updateSubtitleDisplay 函式頂部)
        const currentSub = this.state.translatedTrack ? this.state.translatedTrack.find(sub => currentTime >= sub.start && currentTime < sub.end) : null;

        // (新增) 檢查是否為批次失敗
        if (currentSub && currentSub.tempFailed) {
            html = `<div class="enhancer-line enhancer-error-line" data-start-ms="${currentSub.start}">此批次翻譯失敗，<a class="retry-link" role="button" tabindex="0">點擊重試</a></div>`;
            this.state.subtitleContainer.innerHTML = html;
            this.addRetryClickListener(); // 確保點擊監聽器已綁定
            return; // 結束此函式
        }

        // (原邏輯繼續)
        this.updateSubtitleDisplay(currentSub?.text, currentSub?.translatedText);
        ```
    * *註*：原 `updateSubtitleDisplay` 的參數 `(originalText, translatedText)` 需移除，改為在函式內部自行獲取 `currentSub`，如上所示。

2.  **新增 `addRetryClickListener` 與 `handleRetryBatchClick` (綁定點擊)**：
    * 在 `YouTubeSubtitleEnhancer` class 中新增兩個函式：

    ```javascript
    // (新增函式)
    addRetryClickListener() {
        if (this.state.hasRetryListener || !this.state.subtitleContainer) return;
        
        // 綁定 'handleRetryBatchClick'，並確保 this 上下文正確
        this.handleRetryBatchClick = this.handleRetryBatchClick.bind(this);
        
        this.state.subtitleContainer.addEventListener('click', this.handleRetryBatchClick);
        this.state.hasRetryListener = true;
    }

    // (新增函式)
    async handleRetryBatchClick(e) {
        if (!e.target.classList.contains('retry-link')) return;
        
        const line = e.target.closest('.enhancer-error-line');
        if (!line) return;

        const startMs = parseInt(line.dataset.startMs, 10);
        if (isNaN(startMs)) return;

        this._log(`[插隊重試] 收到點擊，重試 ${startMs}ms 附近的批次...`);

        // 1. 找出所有標記為 tempFailed 的句子
        const segmentsToRetry = [];
        const indicesToUpdate = [];
        this.state.translatedTrack.forEach((sub, i) => {
            if (sub.tempFailed) {
                segmentsToRetry.push(sub.text);
                indicesToUpdate.push(i);
            }
        });

        if (segmentsToRetry.length === 0) {
            this._log('[插隊重試] 未找到標記為失敗的句子。');
            return;
        }

        e.target.textContent = '翻譯中...';
        e.target.style.pointerEvents = 'none'; // 防止重複點擊

        // 2. 執行一次性的翻譯請求
        try {
            const translatedTexts = await this.sendBatchForTranslation(
                segmentsToRetry, 
                new AbortController().signal // 使用一個新 signal
            );

            if (translatedTexts.length !== segmentsToRetry.length) {
                throw new Error("翻譯回傳的句數與請求不符。");
            }

            // 3. 更新數據
            translatedTexts.forEach((text, i) => {
                const trackIndex = indicesToUpdate[i];
                if (this.state.translatedTrack[trackIndex]) {
                    this.state.translatedTrack[trackIndex].translatedText = text;
                    this.state.translatedTrack[trackIndex].tempFailed = false; // 清除旗標
                }
            });

            // 4. 儲存快取並立即刷新 UI
            await this.setCache(`yt-enhancer-cache-${this.currentVideoId}`, {
                translatedTrack: this.state.translatedTrack,
                rawPayload: this.state.rawPayload
            });
            this.handleTimeUpdate(); // 立即刷新當前字幕

        } catch (error) {
            this._log('❌ [插隊重試] 失敗:', error);
            e.target.textContent = '重試失敗!';
            e.target.style.pointerEvents = 'auto';
            // 讓使用者可以再次嘗試
        }
    }
    ```
    * **修改 `resetState`** (約 `content.js:231`)：
        * 新增 `hasRetryListener: false`。
    * **修改 `cleanup`** (約 `content.js:261`)：
        * 在 `this.state.videoElement.removeEventListener` 之前，新增：
        ```javascript
        if (this.state.subtitleContainer && this.state.hasRetryListener) {
            this.state.subtitleContainer.removeEventListener('click', this.handleRetryBatchClick);
            this._log('已移除批次重試點擊監聽器。');
        }
        ```

3.  **修改 `setOrbState` (優化黃色 UI)**：
    * **目標函式**：`setOrbState` (約 `content.js:630`)。
    * **修改 `case 'retrying'`**：
        * **移除** `orb.innerHTML = '<div>⌛</div>';`
        * **替換為**：
        ```javascript
        case 'retrying':
            // (新邏輯) 顯示進度 % 數
            if (progress && progress.total > 0) {
                const percent = Math.round((progress.done / progress.total) * 100);
                orb.innerHTML = `<div>${percent}%</div>`;
                orb.title = `模型暫時過載，自動重試中... (${progress.done}/${progress.total})`;
            } else {
                orb.innerHTML = '<div>%</div>'; // Fallback
                orb.title = '模型暫時過載，自動重試中...';
            }
            break;
        ```

**檔案**：`style.css`

1.  **修改 `state-retrying` 樣式 (黃色外框)**：
    * **目標**：`#enhancer-status-orb.state-retrying` (約 `style.css:122`)。
    * **替換為**：
    ```css
    /* 【關鍵修正點】: v3.1 - 修改為黑底黃框 */
    #enhancer-status-orb.state-retrying {
        background-color: rgba(0, 0, 0, 0.8); /* 黑底 */
        border: 2px solid #f59e0b; /* 黃色外框 (Amber 600) */
        box-sizing: border-box; /* 確保邊框不會撐大圓圈 */
        cursor: default;
    }
    ```

2.  **確保「點擊重試」樣式存在**：
    * 藍圖已改為重用 `.enhancer-error-line` 和 `.enhancer-error-line a` (`style.css:65`)。
    * *確認*：`style.css` 中已包含 `.enhancer-error-line a`，並且其擁有 `pointer-events: auto;`。
    * *結論*：無需新增 CSS，重用現有樣式即可實現點擊。

---

## 3. 預期結果

* **使用者視角 (情境一)**：
    * 當遭遇 `429` 或 `503` 錯誤時，右上角圓環**不再**顯示 `⌛`，而是顯示「**黑底黃框 + 當前進度 % 數**」。
    * 字幕翻譯會暫停，圓環標題提示「自動重試中」。
    * 等待約 10 秒（或 API 指定秒數）後，圓環恢復成 `translating` 狀態，翻譯繼續。

* **使用者視角 (情境二)**：
    * 當所有金鑰均因 `Billing` 或 `Invalid` 失效時，右上角圓環顯示**紅色 `!`**。
    * 翻譯完全停止。圓環標題提示「所有 API Key 均失效」。

* **使用者視角 (情境三)**：
    * 當模型無法翻譯某個批次時，進度條會「跳過」該批次並繼續推進 (例如從 10% -> 20%)。
    * 當影片播放到該失敗批次時，字幕會顯示「**此批次翻譯失敗，點擊重試**」。
    * 使用者點擊「點擊重試」文字後，該文字變為「翻譯中...」，數秒後成功顯示翻譯。
    * 下次重新整理或觀看此影片時，該批次會被**自動重新翻譯**，無需手動點擊。

* **系統行為**：
    * `background.js` 會根據失敗類型，正確回傳 `TEMPORARY_FAILURE`、`PERMANENT_FAILURE` 或 `BATCH_FAILURE`。
    * `content.js` 的 `processNextBatch` 會正確攔截這三種錯誤，並分別執行 `setTimeout`、`setPersistentError` 或「標記 `tempFailed` 並繼續」。
    * `content.js` 的 `updateSubtitleDisplay` 會在偵測到 `tempFailed` 旗標時，渲染出可點擊的 `<a>` 連結。
    * 點擊該連結會觸發 `handleRetryBatchClick`，執行一次性的插隊翻譯，並將修正結果存入 `chrome.storage.local`。