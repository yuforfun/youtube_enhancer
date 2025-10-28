# 規格說明書 (v4.1.0) - Prompt 實驗室 (Developer Tool)

## 1. 執行規劃

此任務的目標是建立一個僅供開發者使用的「Prompt 實驗室」，用於 A/B 測試 Prompt 翻譯效果。此功能將對一般使用者完全隱藏。

我們將此任務拆解為 3 個獨立階段：

1.  **Phase 1: 後端 API 擴充**
    * **目標**: 修改 `background.js`，使其 `translateBatch` 動作能接收一個可選的「覆蓋用 Prompt」參數。這是整個方案的核心，且必須保證向下相容。
2.  **Phase 2: 前端介面建立**
    * **目標**: 建立一個全新的 `lab.html` 檔案，包含 JSON 輸入區、Prompt A/B 比較區、觸發按鈕與輸出區。
    * **存取**: 此檔案僅供開發者透過 URL (`chrome-extension://[ID]/lab.html`) 手動存取。
3.  **Phase 3: 前端邏輯實作**
    * **目標**: 建立一個全新的 `lab.js` 檔案，用於處理 `lab.html` 的 UI 邏輯。它將並行呼叫 Phase 1 擴充的 API，並將結果渲染為對照表格。

## 2. 系統實作細節

### 檔案變更

* `background.js`: **[修改]**
* `lab.html`: **[新增]**
* `lab.js`: **[新增]**
* (所有其他檔案，如 `content.js`, `popup.js`, `options.html` 等，保持不變)

---

### A. API 規格 (後端變更)

**檔案**: `background.js`
**動作**: `translateBatch`

**變更描述**:
我們將修改 `translateBatch` 動作 的訊息處理邏輯，使其能接收一個新的可選屬性：`overridePrompt`。

* **修改前 (v4.0.1)**:
    * `const { texts, source_lang, models_preference } = request;`
    * `customPromptPart` 總是從 `chrome.storage.local` 的 `auto_translate_priority_list` 中讀取。

* **修改後 (v4.1.0)**:
    1.  接收新參數:
        `const { texts, source_lang, models_preference, overridePrompt } = request;`
    2.  修改 Prompt 載入邏輯：
        ```javascript
        let customPromptPart = "";
        
        if (overridePrompt) {
            // 情境 1: 請求來自 lab.js (開發者測試)
            // 直接使用傳入的實驗性 Prompt
            customPromptPart = overridePrompt;
        } else {
            // 情境 2: 請求來自 content.js (正式翻譯)
            // 100% 執行 v4.0.1 的舊邏輯
            const settingsResult = await chrome.storage.local.get(['ytEnhancerSettings']);
            const settings = settingsResult.ytEnhancerSettings || {};
            const tier2List = settings.auto_translate_priority_list || [];
            const langConfig = tier2List.find(item => item.langCode === source_lang);
            customPromptPart = langConfig ? langConfig.customPrompt : "";
        }
        
        // ... 後續的 fullPrompt 組合與 API 呼叫邏輯完全不變 ...
        ```

### B. 前端介面 (lab.html 藍圖)

**檔案**: `lab.html` (新檔案)

此檔案應包含以下 UI 結構（可重用 `popup.css` 以獲取樣式）：

1.  **標題**: `<h1>Prompt 實驗室 (v4.1.0)</h1>`
2.  **ASR 輸入卡片**:
    * Title: "1. 輸入 ASR 字幕原文"
    * Hint: "請貼上 JSON 陣列格式的原文 (例如: `["第一句", "第二句"]`)。"
    * `textarea` ID: `lab-input-json`
3.  **Prompt A (基準)**:
    * Title: "2. Prompt A (基準)"
    * Hint: "預設或正式環境使用的 Prompt。"
    * `textarea` ID: `lab-prompt-a`
4.  **Prompt B (實驗)**:
    * Title: "3. Prompt B (實驗)"
    * Hint: "您想要測試的新版本 Prompt。"
    * `textarea` ID: `lab-prompt-b`
5.  **觸發按鈕**:
    * `button` ID: `lab-run-button` (使用 `.button-primary` 樣式)
    * Text: "執行比較翻譯"
6.  **輸出卡片**:
    * Title: "4. 輸出結果"
    * `div` ID: `lab-output-area` (初始為空，用於顯示狀態或結果表格)

### C. 前端邏輯 (lab.js 藍圖)

**檔案**: `lab.js` (新檔案)

此檔案將執行以下邏輯：

1.  **綁定事件**:
    * 監聽 `DOMContentLoaded`。
    * 獲取所有 UI 元素 (textareas, button, output-area)。
    * 為 `#lab-run-button` 綁定 `click` 事件。
2.  **點擊處理 (`async function runComparison()`)**:
    * **(a) 讀取與驗證**:
        * 讀取 `#lab-input-json` 的值。
        * 使用 `try...catch` 執行 `JSON.parse()`。如果失敗，在 `#lab-output-area` 顯示錯誤並停止。
        * 確保解析結果是一個字串陣列 (`texts`)。
        * 讀取 `#lab-prompt-a` (P_A) 和 `#lab-prompt-b` (P_B)。
    * **(b) 讀取共用設定 (確保環境一致)**:
        * 從 `chrome.storage.local.get('ytEnhancerSettings')` 讀取 `models_preference`。
    * **(c) 執行並行翻譯**:
        * 在 `#lab-output-area` 顯示 "翻譯中..."。
        * 使用 `Promise.all()` 並行發送兩個 `chrome.runtime.sendMessage` 請求：
            * **請求 A**: `{ action: 'translateBatch', texts, source_lang: 'ja', models_preference, overridePrompt: P_A }`
            * **請求 B**: `{ action: 'translateBatch', texts, source_lang: 'ja', models_preference, overridePrompt: P_B }`
            * *(備註: `source_lang` 可暫時寫死為 `ja`，或未來在 UI 上增加一個下拉選單)*
    * **(d) 處理結果**:
        * 等待 `Promise` 回傳 `[resultA, resultB]`。
        * 檢查 `resultA.error` 或 `resultB.error`，若有錯誤則顯示。
        * 若成功，呼叫 `renderResults(texts, resultA.data, resultB.data)`。
3.  **渲染邏輯 (`function renderResults(originals, translationsA, translationsB)`)**:
    * 此函式接收三個陣列：原文、譯文 A、譯文 B。
    * 動態建立一個 HTML `<table>` 字串。
    * 表格標頭: `<thead><tr><th>原文</th><th>譯文 A (基準)</th><th>譯文 B (實驗)</th></tr></thead>`。
    * 表格內容: 遍歷 `originals` 陣列，為每一行建立 `<tr><td>${originals[i]}</td><td>${translationsA[i]}</td><td>${translationsB[i]}</td></tr>`。
    * 將完整的 `<table>` 插入 `#lab-output-area`。

### D. 資料庫變動

* **無**。
* `lab.html` / `lab.js` 不會寫入 `chrome.storage`。所有 Prompt 僅為臨時測試用，開發者應自行複製貼上。

---

## 3. 修改完成後的預期結果

### 使用者視角 (一般使用者)

* **完全無變化**。
* 使用者看到的 `options.html` 和 `popup.html` 介面與 v4.0.x 完全相同。
* 使用者不會知道 `lab.html` 的存在。

### 使用者視角 (開發者)

* **存取**: 開發者可以手動導航至 `chrome-extension://[擴充功能ID]/lab.html`。
* **操作**:
    1.  開發者可以在「ASR 輸入」框中貼上 `["原文1", "原文2"]`。
    2.  在「Prompt A」中貼入當前 `options.html` 中的日文 Prompt。
    3.  在「Prompt B」中貼入修改後的新 Prompt。
    4.  點擊「執行比較翻譯」。
* **結果**: 頁面下方的「輸出結果」區會顯示一個表格，清晰並列三欄：「原文」、「譯文 A」、「譯文 B」。

### 系統行為

* **主功能 (安全)**:
    * 使用者在 YouTube 頁面觀看影片時，`content.js` 會發起 `translateBatch` 請求。
    * 此請求**不包含** `overridePrompt` 參數。
    * `background.js` 會進入 `else` 邏輯，100% 執行 v4.0.1 的行為，即從 `chrome.storage` 讀取 Tier 2 Prompt。
    * **結論：主功能不受任何影響**。
* **實驗室功能 (隔離)**:
    * `lab.js` 發起的 `translateBatch` 請求**包含** `overridePrompt` 參數。
    * `background.js` 會進入 `if (overridePrompt)` 邏輯，使用該臨時 Prompt 進行翻譯，**繞過** `chrome.storage`。
    * **結論：實驗室的操作不會汙染正式設定**。


# 藍圖 v4.1.0：高品質分句引擎 (HQS Engine) 整合

## 1. 執行規劃 (Execution Plan)

此任務的核心是將 `python segment_test.py` 的三階段邏輯，從 Python 轉譯為 JavaScript，並替換 `content.js` 中現有的 `parseRawSubtitles` 函式。

* **階段一：邏輯轉譯 (Porting)**
    * **任務：** 在 `content.js` 中，建立三個新的內部輔助函式 (helper functions)，1:1 對應 `python segment_test.py` 的三階段邏輯：
        1.  `_phase1_cleanAndStructureEvents` (對應 `clean_subtitle_events`)
        2.  `_phase2_segmentByGapsAndLinguistics` (對應 `segment_blocks_by_internal_gaps`)
        3.  `_phase3_mergeSentences` (對應 `post_process_merges`)
    * **驗證：** 確保這些函式是純粹的 (pure functions)，只依賴輸入參數。

* **階段二：常數植入 (Constants)**
    * **任務：** 將 `python segment_test.py` 頂部的所有設定（`PAUSE_THRESHOLD_MS`, `LINGUISTIC_MARKERS` 等）轉譯為 JavaScript `const` 變數，放置在 `content.js` 的頂部。
    * **驗證：** 確保 `LINGUISTIC_MARKERS` 和 `CONNECTIVE_PARTICLES_TO_MERGE` 被正確定義為 JS 陣列或 Set，以便高效查找。

* **階段三：核心整合 (Integration)**
    * **任務：** 鎖定 `content.js` 中的 `parseRawSubtitles(payload)` 函式。
    * **關鍵動作：** **完全替換** `parseRawSubtitles` 的*內部實作*。
    * **新實作：** 函式內部將依序呼叫階段一的三個新函式，形成一個處理管線 (pipeline)。
    * **驗證：** 確保 `parseRawSubtitles` 最終 `return` 的資料結構，與*舊版*的輸出結構**完全一致**：`[{ start, end, text, translatedText: null }, ...]`。

## 2. 系統實作細節 (Implementation Details)

### API 變更
* **無。**
* `background.js` 的 `translateBatch` API 完全不受影響。它本來就是設計用來接收*任意*的文字陣列。整合後，它只會收到*更多、更短、語意更完整*的句子，這將**自動提升** Gemini API 的翻譯上下文準確性。

### 前端邏輯/UI 變更

#### 檔案: `content.js`

1.  **[新增] 頂層常數 (HQS Engine Constants)**
    * 需從 `python segment_test.py` 轉譯以下常數：
    ```javascript
    const HQS_PAUSE_THRESHOLD_MS = 500;
    const HQS_LINGUISTIC_PAUSE_MS = 150;
    const HQS_LINGUISTIC_MARKERS = [
        'です', 'でした', 'ます', 'ました', 'ません','ますか','ない',
        'だ','かな﻿','かしら', 'ください', '。', '？', '！'
    ];
    const HQS_CONNECTIVE_PARTICLES_TO_MERGE = new Set([
        'に', 'を', 'は', 'で', 'て', 'と', 'も', 'の' ,'本当','やっぱ','ども','お'
    ]);
    ```

2.  **[新增] 輔助函式 1: `_phase1_cleanAndStructureEvents(rawPayload)`**
    * **對應：** `clean_subtitle_events`
    * **輸入：** `rawPayload` (即 `TIMEDTEXT_DATA` 的 `payload`，格式同 `subtitle_data.json`)
    * **邏輯：**
        1.  過濾 `rawPayload.events`，移除所有 `segs` 為空或 `segs` 內容為 `\n` 的事件。
        2.  遍歷清理後的 "內容事件" (content_events)。
        3.  計算每個事件的 `actual_end_ms`（取 `planned_end_ms` 和 `next_event.tStartMs` 的最小值）。
        4.  **核心：** 遍歷事件中的 `segs`，將其轉換為包含*絕對時間*的 `segments_with_absolute_time` 陣列。
    * **輸出 (結構)：** `[{ block_start_ms, block_end_ms, segments: [{text, start_ms}, ...] }, ...]`

3.  **[新增] 輔助函式 2: `_phase2_segmentByGapsAndLinguistics(cleanedBlocks)`**
    * **對應：** `segment_blocks_by_internal_gaps`
    * **輸入：** `cleanedBlocks` (來自 Phase 1)
    * **邏輯：**
        1.  遍歷 `cleanedBlocks`。
        2.  在每個 block 內部，遍歷其 `segments` 陣列。
        3.  比較 `segments[i+1].start_ms` 和 `segments[i].start_ms` 來計算 `pause_duration`。
        4.  檢查 `pause_duration > HQS_PAUSE_THRESHOLD_MS`。
        5.  檢查 `HQS_LINGUISTIC_MARKERS` 命中且 `pause_duration > HQS_LINGUISTIC_PAUSE_MS`。
        6.  基於上述條件或 `is_last_segment_in_block` 進行切分。
    * **輸出 (結構)：** `[{ text, start_ms, end_ms, reason }, ...]`

4.  **[新增] 輔助函式 3: `_phase3_mergeSentences(intermediateSentences)`**
    * **對應：** `post_process_merges`
    * **輸入：** `intermediateSentences` (來自 Phase 2)
    * **邏輯：**
        1.  建立一個新的 `final_merged = []` 陣列。
        2.  使用 `for` 迴圈遍歷 `intermediateSentences`。
        3.  檢查 `final_merged` 中的*最後一項* (`previous`)。
        4.  **合併條件：** 如果 `previous.reason === 'End of Block'` **或** `HQS_CONNECTIVE_PARTICLES_TO_MERGE.has(previous.text.trim().slice(-1))`。
        5.  **合併執行：**
            * `previous.text += current.text`
            * `previous.end_ms = current.end_ms`
            * `previous.reason = current.reason` (繼承 Reason)
        6.  **新增執行：**
            * 如果不符合合併條件，`final_merged.push(current)`。
    * **輸出 (結構)：** `[{ text, start_ms, end_ms, reason }, ...]`

5.  **[修改] 核心函式: `parseRawSubtitles(payload)`**
    * **對應：** `content.js` 中的現有函式。
    * **新實作 (替換)：**
        ```javascript
        parseRawSubtitles(payload) {
            // 呼叫三階段管線
            const cleanedBlocks = this._phase1_cleanAndStructureEvents(payload);
            const intermediateSentences = this._phase2_segmentByGapsAndLinguistics(cleanedBlocks);
            const finalSentences = this._phase3_mergeSentences(intermediateSentences);

            // 格式化為 translateTrack 結構
            return finalSentences.map(s => ({
                start: s.start_ms,
                end: s.end_ms,
                text: s.text.trim(), // 確保移除前後空白
                translatedText: null
            }));
        }
        ```

### 資料庫/儲存變更
* **無。**
* `chrome.storage.local` 中的 `yt-enhancer-cache-[VIDEO_ID]` 將自動儲存新的、高品質分句後的 `translatedTrack`，無需任何結構變更。

## 3. 預期結果 (Expected Results)

* **使用者視角:**
    * 字幕的斷點將從「時間驅動」變為「語意驅動」。
    * **(改善前):** "我昨天去了" (00:01-00:03) / "公園。" (00:03-00:04)
    * **(改善後):** "我昨天去了公園。" (00:01-00:04) (透過 `post_process_merges` 合併)
    * **(改善前):** "他說「你好嗎？」然後離開了。" (00:05-00:08)
    * **(改善後):** "他說「你好嗎？」" (00:05-00:06) / "然後離開了。" (00:06-00:08) (透過 `segment_blocks_by_internal_gaps` 切分)
    * 翻譯品質大幅提升，因為發送給 Gemini 的 "句子" 是完整的，上下文更準確。

* **系統行為:**
    * `content.js` 的 `activate` 函式呼叫 `parseAndTranslate`，`parseAndTranslate` 接著呼叫*新的* `parseRawSubtitles`。
    * `this.state.translatedTrack` 將包含一個*更長*的陣列 (句子總數變多)，但每句的 `text` 更短、更精確。
    * `processNextBatch` 函式的工作負載不變，它會忠實地將這些新的、更細的句子分批傳送到 `background.js`。
    * `handleTimeUpdate` 會更頻繁地找到匹配的 `currentSub`，使字幕滾動看起來更流暢、更即時。