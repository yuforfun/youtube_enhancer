# 系統架構規格書：v2.0 語言決策引擎

**專案代號：** Tiered-Logic-Refactor
**版本：** 4.0.0 (基於 v3.1.x 的重大升級)
**目標：** 廢除舊的「偏好/忽略」語言模型，實作全新的「三層式語言決策引擎 (Tier 1/2/3)」，並部署設計師提供的全新 UI 介面。

---

## 1. 執行規劃 (Phased Execution Plan)

此任務將分為三個可獨立開發和驗證的階段。

### 階段一：後端與資料庫重構 (Backend & Storage)

* **核心目標：** 讓「後端」(`background.js`) 和「資料庫」(`chrome.storage`) 支援新的 Tier 1 和 Tier 2 資料結構。
* **任務：**
    1.  **資料庫遷移：** 更新 `chrome.storage.local` 的結構。
    2.  **後端 API 更新：** 修改 `background.js` 中的 `translateBatch` 函式，使其能讀取並使用 Tier 2 的新資料結構（`auto_translate_priority_list`）來獲取自訂 Prompt。
* **驗證標準 (如何測試)：**
    * 此階段完成後，`options.html` 介面**仍是舊的**。
    * **手動驗證：** 使用 Chrome 開發者工具，**手動**在 `chrome.storage.local` 中建立新的 `auto_translate_priority_list` 資料。
    * **執行驗證：** 打開一個日文 (ja) 影片。如果 `background.js` 成功讀取到我們手動插入的 Tier 2 自訂 Prompt 並執行翻譯，則此階段成功。

### 階段二：管理後台 UI/UX 實作 (Options Page)

* **核心目標：** 根據設計師的 UI 稿，**完全重寫** `options.html` 的語言設定介面。
* **任務：**
    1.  **移除 (Cleanup)：** 刪除 `options.html` 中舊的「語言偏好設定」和「Prompt 自訂」卡片。
    2.  **資料庫 (Data)：** 在 `popup.js` 中建立 `LanguageDatabase` (語言資料庫)，用於支援 Popover 搜尋功能。
    3.  **UI 實作 (Tier 1)：** 實作「語言清單 A：原文顯示語言」介面 (Badge/Token 模式 + Popover 搜尋)。
    4.  **UI 實作 (Tier 2)：** 實作「語言清單 B：自動翻譯」介面 (Accordion 列表 + 拖曳排序 + Popover 搜尋 + Prompt 編輯)。
    5.  **樣式 (CSS)：** 在 `popup.css` 中新增所有必要的樣式（Badge, Accordion, Popover, Priority Tag...）。
* **驗證標準 (如何測試)：**
    * 打開 `options.html`。
    * **Tier 1 驗證：** 能否成功新增/刪除「英文 (en)」？儲存後，`chrome.storage.local` 中的 `native_langs` 陣列是否正確更新？
    * **Tier 2 驗證：**
        * **(A) 預設狀態：** 新安裝/遷移後，是否顯示「日文 (ja)」、「韓文 (ko)」、「英文 (en)」？
        * **(B) 編輯驗證：** 點開「日文 (ja)」，是否顯示**詳細版** Prompt？
        * **(C) 新增驗證：** 手動新增「法文 (fr)」，點開後是否顯示**通用模板** (`NEW_LANGUAGE_PROMPT_TEMPLATE`)？
        * **(D) 儲存驗證：** 能否儲存 Prompt？能否拖曳排序？儲存後 `auto_translate_priority_list` 物件陣列是否正確更新？

### 階段三：核心決策引擎實作 (Content Script)

* **核心目標：** 在 `content.js` 中實作全新的 Tier 1/2/3 決策邏輯，取代舊的 `start()` 函式。
* **任務：**
    1.  **移除 (Cleanup)：** 刪除 `content.js` 中 `start()` 函式的主體邏輯（即基於 `preferred_langs` / `ignored_langs` 的舊判斷）。
    2.  **引擎 (Engine)：** 重寫 `start()`，實作新的三層決策樹。
    3.  **UI (Tier 1/2)：** 實作 Tier 1 (原文顯示) 和 Tier 2 (自動翻譯) 的啟動邏輯。
    4.  **UI (Tier 3)：** 實作 Tier 3 (按需翻譯) 邏輯，包含：
        * 在 `style.css` 中新增「按需翻譯按鈕」(`OnDemandTranslateButton`) 的樣式（右上角、Hover 顯示）。
        * 在 `content.js` 中新增顯示/隱藏該按鈕，以及點擊後觸發翻譯的邏輯。
* **驗證標準 (如何測試)：**
    * (前置：在 `options.html` 中設定 Tier 1 = `['en']`，Tier 2 = `['ja']`)
    * **Tier 1 驗證：** 打開一個**英文**影片。**預期行為：** 系統應只顯示英文原文，不顯示 Orb，不顯示翻譯按鈕。
    * **Tier 2 驗證：** 打開一個**日文**影片。**預期行為：** 系統應**自動**開始翻譯，並顯示狀態圓環 (Orb)。
    * **Tier 3 驗證：** 打開一個**法文**影片 (未設定)。**預期行為：** 系統應只顯示法文原文。當滑鼠移至播放器右上角時，應出現「[ 翻譯 ]」按鈕。點擊該按鈕後，系統開始翻譯，按鈕替換為狀態圓環 (Orb)。

---

## 2. 系統實作細節

### 資料庫 (chrome.storage.local) 變更

此為**階段一**的核心任務。

* **金鑰：** `ytEnhancerSettings` (物件)
* **移除屬性：**
    * `preferred_langs` (型別: `string[]`)：被 Tier 2 列表取代。
    * `ignored_langs` (型別: `string[]`)：被 Tier 1 列表取代。
* **新增屬性：**
    * `native_langs` (型別: `string[]`)
        * **用途：** Tier 1 (原文顯示列表)。
        * **範例：** `['zh-Hant', 'en']`
    * `auto_translate_priority_list` (型別: `Object[]`)
        * **用途：** Tier 2 (自動翻譯列表)，**此結構必須保留順序**。
        * **範例：**
            ```json
            [
              { "langCode": "ja", "name": "日文", "customPrompt": "**日文風格指南...**" },
              { "langCode": "ko", "name": "韓文", "customPrompt": "--- 韓文自訂 Prompt ---" }
            ]
            ```
* **修改屬性：**
    * `customPrompts` (型別: `Object`)：此**頂層金鑰將被廢除**。其資料被合併到 `auto_translate_priority_list` 的每個項目中。

### 檔案修改藍圖

#### 階段一：`background.js` (後端 API)

* **`translateBatch` 函式 (區塊修改)：**
    * **修正原因：** 必須更新 Prompt 的獲取來源，從舊的 `customPrompts` 物件 改為新的 `auto_translate_priority_list` 陣列。
    * **替換指示：** 替換此函式內獲取 `customPromptPart` 的邏輯。
    * **舊邏輯 (將被移除)：**
        ```javascript
        const promptResult = await chrome.storage.local.get(['customPrompts']); 
        const storedPrompts = promptResult.customPrompts || DEFAULT_CUSTOM_PROMPTS; 
        const customPromptPart = storedPrompts[source_lang] || ""; 
        ```
    * **新邏輯 (將被替換為)：**
        ```javascript
        // 1. 獲取完整的設定
        const settingsResult = await chrome.storage.local.get(['ytEnhancerSettings']);
        const settings = settingsResult.ytEnhancerSettings || {};
        
        // 2. 從 Tier 2 列表中查找當前語言的設定
        const tier2List = settings.auto_translate_priority_list || [];
        const langConfig = tier2List.find(item => item.langCode === source_lang);
        
        // 3. 獲取自訂 Prompt，如果 Tier 2 列表沒有該語言，則 customPromptPart 為空字串
        const customPromptPart = langConfig ? langConfig.customPrompt : "";
        ```

#### 階段二：`options.html` (UI 介面)

* **`#tab-main` 區塊 (替換)：**
    * **修正原因：** 部署全新的 Tier 1 和 Tier 2 UI 介面。
    * **替換指示：** 刪除 id="tab-main" 內部舊的「語言偏好設定」卡片。刪除 id="tab-main" 內部舊的「Prompt 自訂」卡片。
    
    * **新增內容 (結構示意)：**
        ```html
        <div id="tab-main" class="tab-content active">
        
            <div class="card" id="tier-1-card">
                <h2 class.card-title">語言清單 A：原文顯示語言 (零成本模式)</h2>
                <p class.card-hint">設定您能看懂的語言。當影片有這些語言字幕時，系統將不發送 API 請求，直接顯示原文。</p>
                
                <div id="tier-1-badge-container" class="badge-container">
                    </div>

                <button id="tier-1-add-button" class="button-secondary add-lang-button">+ 新增語言</button>
                
                <div class="card-hint info-box" style="margin-top: 16px;">
                    💡 **節費提示：** 當字幕是您設定的語言時，系統會直接顯示原文，不會消耗 API 配額。
                </div>
            </div>

            <div class="card" id="tier-2-card">
                <h2 class="card-title">語言清單 B：自動翻譯與 Prompt 管理</h2>
                <p class="card-hint">設定需要自動翻譯的語言，並為每個語言自訂 Prompt。系統會依列表順序檢查並觸發第一個匹配的語言。</p>
                
                <ul id="tier-2-accordion-list" class="sortable-list accordion-list">
                    </ul>

                <button id="tier-2-add-button" class="button-secondary add-lang-button">+ 新增語言</button>

                <div class="card-hint warning-box" style="margin-top: 16px;">
                    ⚠️ **優先級說明：** 系統會依序檢查列表，並觸發第一個匹配的翻譯。拖曳項目可調整優先序。
                </div>
            </div>

            <div id="language-search-popover" class="popover-backdrop" style="display: none;">
                <div class="popover-content">
                    <h3>新增語言</h3>
                    <input type="text" id="language-search-input" placeholder="搜尋語言 (例如: 日文, ja, Japanese)...">
                    <ul id="language-search-results">
                        </ul>
                </div>
            </div>

            </div>
        ```

#### 階段二：`popup.css` (UI 樣式)

* **`popup.css` (大量新增)：**
    * **修正原因：** 必須新增樣式以支援 中的全新 UI。
    * **新增內容：** 需要新增以下所有選擇器的 CSS 規則：
        * `.badge-container`, `.lang-badge`, `.remove-badge` (Tier 1)
        * `.add-lang-button` (Tier 1/2 新增按鈕)
        * `.info-box`, `.warning-box` (提示框)
        * `.accordion-list`, `.accordion-item`, `.accordion-header`, `.accordion-content` (Tier 2)
        * `.drag-handle`, `.priority-badge`, `.delete-item`, `.toggle-icon` (Tier 2)
        * `.popover-backdrop`, `.popover-content`, `#language-search-input`, `#language-search-results` (Popover)

#### 階段二：`popup.js` (UI 邏輯)

* **`popup.js` (大規模重寫)：**
    * **修正原因：** 廢除舊的語言設定邏輯，實作全新的 Tier 1/2 UI 互動。
    * **全域新增 (Data)：**
        * `const LANGUAGE_DATABASE = [ { code: 'ja', name: '日文', search: ['ja', 'japanese', '日文'] }, { code: 'en', name: '英文', search: ['en', 'english', '英文'] }, ... ];` (擴展 `LANG_CODE_MAP`)
    * **【關鍵修正點】全域新增 (Template)：**
        * 新增 `const NEW_LANGUAGE_PROMPT_TEMPLATE`，內容為您指定的「通用模板」，用於**手動新增**語言時填充 `textarea`。
            ```javascript
            const NEW_LANGUAGE_PROMPT_TEMPLATE = `**風格指南:**
- 翻譯需符合台灣人的說話習慣，並保留說話者的情感語氣。
- (可選) 翻譯風格應偏向 (口語化/書面語/專業/活潑)。

**人名/專有名詞對照表 (優先級最高):**
- (範例) 原文名稱/讀音 -> 應翻譯的專有名詞
`;
            ```
    * **【關鍵修正點】全域修改 (Data)：**
        * `DEFAULT_CUSTOM_PROMPTS`：此常數**應被保留**。
        * **用途變更：** 它的用途**僅限於**「首次安裝資料庫遷移」時，用以為 `ja`, `ko`, `en` 填充預設值（特別是保留您詳細的日文 Prompt）。
    * **`loadSettings` 函式 (重寫)：**
        * **新增 (資料庫遷移邏輯)：**
            1.  `const result = await chrome.storage.local.get('ytEnhancerSettings');`
            2.  `let settings = result.ytEnhancerSettings;`
            3.  **檢查舊資料：** `if (settings.preferred_langs)`
            4.  **執行遷移：**
                * `settings.auto_translate_priority_list = settings.preferred_langs.map(lang => ({ langCode: lang, name: LANG_CODE_MAP[lang] || lang, customPrompt: DEFAULT_CUSTOM_PROMPTS[lang] || '' }));`
                * `delete settings.preferred_langs;`
                * `delete settings.ignored_langs;`
                * `await chrome.storage.local.set({ ytEnhancerSettings: settings });`
            5.  **新增 (UI 渲染)：**
                * `renderTier1Badges(settings.native_langs || []);`
                * `renderTier2Accordions(settings.auto_translate_priority_list || []);`
    * **移除函式：**
        * `updateListUI` (被 `renderTier1Badges` 和 `renderTier2Accordions` 取代)
    * **新增函式 (Tier 1 邏輯)：**
        * `renderTier1Badges(langs)`：將 `native_langs` 陣列渲染為 Badge UI。
        * `handleTier1Add()`：開啟 Popover，並設定 Popover 的回呼 (Callback) 為新增 Tier 1。
        * `handleTier1Remove(langCode)`：從 `native_langs` 移除語言並重新渲染。
        * `saveTier1Settings()`：儲存 `native_langs` 陣列到 `chrome.storage` (自動儲存)。
    * **新增函式 (Tier 2 邏輯)：**
        * `renderTier2Accordions(list)`：將 `auto_translate_priority_list` 渲染為 Accordion UI，並**綁定拖曳事件** (`initializeSortableList`)。
        * `handleTier2Add()`：開啟 Popover，回呼為新增 Tier 2。
        * **【關鍵修正點】**：當此函式建立一個新的 Accordion 項目時（例如使用者新增了「法文」），其 `textarea` 的預設內容**必須**使用 `NEW_LANGUAGE_PROMPT_TEMPLATE`。
        * `handleTier2Remove(langCode)`：移除項目。
        * `handleTier2Expand(itemElement)`：展開一個 Accordion 項目，並**折疊所有其他項目** (單一展開邏輯)。
        * `handleTier2SavePrompt(langCode)`：儲存 `textarea` 內容到 `auto_translate_priority_list` 中。
    * **新增函式 (共用 Popover 邏輯)：**
        * `openLanguagePopover(onSelectCallback)`：開啟 Popover 並綁定回呼。
        * `handleLanguageSearch()`：處理 `language-search-input` 的 `input` 事件，過濾 `LANGUAGE_DATABASE` 並顯示結果。

#### 階段三：`style.css` (影片 UI)

* **`style.css` (新增)：**
    * **修正原因：** 實作 Tier 3 (按需翻譯) 的 Hover 按鈕。
    * **新增內容：**
        ```css
        /* --- Tier 3: 按需翻譯按鈕 --- */
        #enhancer-ondemand-button {
            position: absolute;
            top: 10px;
            right: 10px;
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background-color: rgba(0, 0, 0, 0.8);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            opacity: 0; /* 預設隱藏 */
            pointer-events: none; /* 預設不可點擊 */
            transition: opacity 0.3s;
            /* (可選) 翻譯圖示 SVG */
        }

        /* (可選) 定義一個熱區來觸發顯示 */
        #movie_player:hover #enhancer-ondemand-button {
            opacity: 1;
            pointer-events: auto;
        }
        ```

#### 階段三：`content.js` (決策引擎)

* **`start` 函式 (完全重寫)：**
    * **修正原因：** 廢除舊邏輯，實作 Tier 1/2/3 決策樹。
    * **替換指示：** 刪除 `start` 函式現有的所有內容。
    * **新邏輯 (完整)：**
        ```javascript
        async start() {
            this._log(`[決策 v2.0] --- 主流程 Start ---`);
            if (!this.currentVideoId || !this.state.playerResponse) {
                this._log(`❌ [決策] 啟動失敗，缺少 VideoID 或 playerResponse。`);
                return;
            }

            const availableTracks = this.getAvailableLanguagesFromData(this.state.playerResponse, true);
            const availableLangs = availableTracks.map(t => t.languageCode);
            this._log(`[決策] 可用語言: [${availableLangs.join(', ')}]`);

            const { native_langs = [], auto_translate_priority_list = [] } = this.settings;

            // --- TIER 1 檢查：原文顯示 (零成本) ---
            const nativeMatch = availableLangs.find(lang => native_langs.includes(lang));
            if (nativeMatch) {
                this._log(`[決策] -> Tier 1 命中：匹配到原文顯示語言 (${nativeMatch})。`);
                this.runTier1_NativeView(availableTracks.find(t => t.languageCode === nativeMatch));
                return; // 流程結束
            }

            // --- TIER 2 檢查：自動翻譯 (高品質) ---
            let tier2Match = null;
            for (const priorityItem of auto_translate_priority_list) {
                if (availableLangs.includes(priorityItem.langCode)) {
                    tier2Match = availableTracks.find(t => t.languageCode === priorityItem.langCode);
                    break; // 找到第一個匹配的，停止搜尋
                }
            }
            
            if (tier2Match) {
                this._log(`[決策] -> Tier 2 命中：匹配到自動翻譯語言 (${tier2Match.languageCode})。`);
                
                // (重用舊的 activate 邏輯)
                this.state.sourceLang = tier2Match.languageCode;
                this._log('[意圖鎖定] 已將期望語言 sourceLang 設為:', this.state.sourceLang);
                
                const cacheKey = `yt-enhancer-cache-${this.currentVideoId}`;
                const cachedData = await this.getCache(cacheKey);
                
                if (cachedData && cachedData.translatedTrack) {
                    this.state.translatedTrack = cachedData.translatedTrack;
                    this.activate(cachedData.rawPayload); // 觸發翻譯
                } else {
                    this.state.targetVssId = tier2Match.vssId;
                    this.state.activationWatchdog = setTimeout(() => this.handleActivationFailure(), 3000);
                    window.postMessage({ from: 'YtEnhancerContent', type: 'FORCE_ENABLE_TRACK', payload: tier2Match }, '*');
                }
                return; // 流程結束
            }

            // --- TIER 3 檢查：按需翻譯 (Fallback) ---
            const fallbackTrack = availableTracks[0];
            if (fallbackTrack) {
                this._log(`[決策] -> Tier 3 觸發：進入按需翻譯模式 (${fallbackTrack.languageCode})。`);
                this.runTier3_OnDemand(fallbackTrack);
            } else {
                this._log(`[決策] -> 無任何可用字幕，停止。`);
            }
        }
        ```
* **新增輔助函式 (Tier 1 & 3)：**
    * **`runTier1_NativeView(trackToEnable)`**
        * **功能：** 僅顯示原文，不翻譯。
        * **邏輯：**
            1.  `this.cleanup();` (確保清除舊狀態)
            2.  `this.toggleNativeSubtitles(false);` (確保原生字幕是關閉的)
            3.  `this.createSubtitleContainer();`
            4.  `this.state.sourceLang = trackToEnable.languageCode;`
            5.  **不**呼叫 `activate()`。
            6.  **(可選)** 呼叫 `window.postMessage` 強制啟用軌道，並監聽 `TIMEDTEXT_DATA`，但只渲染原文。
    * **`runTier3_OnDemand(trackToEnable)`**
        * **功能：** 顯示原文 + 右上角 Hover 按鈕。
        * **邏輯：**
            1.  (同 Tier 1) 顯示原文。
            2.  `const btn = document.createElement('div'); btn.id = 'enhancer-ondemand-button';`
            3.  `btn.innerHTML = '翻譯';` // (或 SVG 圖示)
            4.  `btn.addEventListener('click', () => this.handleOnDemandTranslateClick(trackToEnable));`
            5.  `playerContainer.appendChild(btn);`
    * **`handleOnDemandTranslateClick(trackToEnable)`**
        * **功能：** Tier 3 按鈕的點擊事件。
        * **邏輯：**
            1.  `document.getElementById('enhancer-ondemand-button')?.remove();` (移除按鈕)
            2.  (同 Tier 2) 檢查快取或觸發 `activate()` 流程。
            3.  `this.state.sourceLang = trackToEnable.languageCode;`
            4.  `this.state.targetVssId = trackToEnable.vssId;`
            5.  `window.postMessage({ from: 'YtEnhancerContent', type: 'FORCE_ENABLE_TRACK', payload: trackToEnable }, '*');`
            6.  **(關鍵)** `activate()` 成功後，`setCache` 會自動儲存結果，下次進入此頁面將自動變為 Tier 2 快取邏輯。

---

## 3. 系統實作細節：修改完成後的預期結果

### 使用者視角

1.  **管理後台 (`options.html`)：**
    * 「我不再需要輸入 `ja` 這種代碼了。我可以像設定 Trello 標籤一樣，搜尋並點選『日文』或『英文』。」
    * **(Tier 1)** 「我可以把我懂的語言（如 `英文`）放進『原文顯示列表』。這樣我看英文教學影片時，就不會浪費 API 費用了。」
    * **(Tier 2)** 「我安裝完，『日文』就已經在『自動翻譯列表』裡了，點開就是那個很詳細的 Prompt。當我手動新增『法文』時，它會給我一個通用的 Prompt 模板讓我自己填。」

2.  **影片觀看 (`content.js`)：**
    * **(Tier 1 行為)** 「當我打開一個『英文』影片時（已設為原文），擴充功能只會顯示乾淨的英文字幕，不會自動翻譯。」
    * **(Tier 2 行為)** 「當我打開一個『日文』影片時（已設為自動翻譯），擴充功能會**自動開始翻譯**，並顯示我設定的狀態圓環 (Orb)。」
    * **(Tier 3 行為)** 「當我打開一個『法文』影片時（我從未設定過），擴充功能一開始**不會打擾我**，只會顯示法文原文。當我把滑鼠移到右上角時，會出現一個『翻譯』按鈕。我點擊它，它才開始翻譯。」

### 系統行為

1.  **`chrome.storage.local`** 將不再包含 `preferred_langs` 和 `ignored_langs`。取而代之的是 `native_langs` 和 `auto_translate_priority_list`。
2.  `background.js` 的 `translateBatch` API 現在會動態查詢 `auto_translate_priority_list` 來獲取 Prompt，不再依賴舊的 `customPrompts` 物件。
3.  `content.js` 的 `start()` 函式成為一個三層決策樹，依序檢查 Tier 1、Tier 2、Tier 3。
4.  `popup.js` 成為一個小型應用程式，管理著 `LanguageDatabase`、Popover 狀態、Accordion 狀態以及拖曳排序邏輯，並使用 `NEW_LANGUAGE_PROMPT_TEMPLATE` 來處理新語言的添加。


# 系統架構規格書：語言決策引擎 v2.0 - options.html UI/UX 規範

**核心原則**: 使用者不應被要求記憶或輸入語言代碼。所有列表新增必須透過友善的語言名稱 (例如: 日文) 進行。

## 1. 介面綜述 (總體變更)

* **位置**: `options.html` 主頁面的兩個獨立卡片。
* **變更**: 舊有的「語言偏好設定」卡片和「Prompt 自訂」卡片將被移除。
* **新增**: 兩個新的、功能獨立的卡片來定義 Tier 1 和 Tier 2。

## 2. 層級一規範：原文顯示語言 (節費模式)

### 2.1 核心目標 (Tier 1)
* **功能**: 定義使用者能**看得懂**的語言。
* **目的**: 當影片有這些語言字幕時，系統將**強制啟用**原文顯示，**不發送 API 請求**（成本為 0）。
* **命名**: 卡片標題：「**語言清單 A：原文顯示語言 (零成本模式)**」。

### 2.2 UI 元件與操作 (Component & UX)
由於此列表不涉及優先級，設計應比 Tier 2 簡潔。

| 元件 | 標籤/樣式 | 行為規範 |
| :--- | :--- | :--- |
| **主要列表** | 語言標籤 (Tokens) 顯示區 | 以簡潔的標籤 (Tag/Token) 形式顯示已選擇的語言。 |
| **新增機制** | **多選下拉搜尋框** | **解決 UX 痛點**: 點擊後，彈出一個可搜尋的下拉選單 (例如: 輸入「日」出現「日文 (ja)」)。點擊後，語言被新增至列表。 |
| **移除** | 每個標籤上應有「X」圖示 | 點擊「X」後，該語言立即從列表中移除。 |
| **儲存** | (隱含) | 應在新增或移除時，立即將列表內容自動存入 `chrome.storage.local`。 |

### 2.3 資料結構 (Storage Key)
* **金鑰**: `ytEnhancerSettings.native_langs` (取代舊的 `ignored_langs`)
* **格式**: 無序字串陣列 (例如: `['zh-Hant', 'en', 'fr']`)。

## 3. 層級二規範：自動翻譯語言 (高品質 Prompt)

### 3.1 核心目標 (Tier 2)
* **功能**: 定義需要自動翻譯、且需**套用自訂 Prompt** 的語言。
* **目的**: 列表順序決定系統檢查和翻譯的優先級。
* **命名**: 卡片標題：「**語言清單 B：自動翻譯與 Prompt 管理**」。

### 3.2 UI 元件與操作 (Component & UX)
此設計繼承自討論結果，採用「可擴展的清單 (Accordion List)」模式。

| 元件 | 標籤/樣式 | 行為規範 |
| :--- | :--- | :--- |
| **主要列表** | **可拖曳排序的 Accordion 列表** | 列表項目必須能通過拖曳改變順序。 |
| **新增機制** | **多選下拉搜尋框** | **解決 UX 痛點**: 與層級一相同，使用友善名稱新增語言。 |
| **列表項目** | **折疊/展開區塊** | **折疊狀態**: 顯示語言名稱、拖曳圖示、刪除 (X)。**展開狀態**: 顯示該語言專屬的 `textarea` (Prompt 編輯區)。 |
| **Prompt 編輯區** | `textarea` | 僅在項目展開時可見。下方應有「儲存」和「取消」按鈕。 |
| **儲存** | (明確) | 點擊「儲存」按鈕時，該語言的 Prompt 內容和列表順序被存入 `chrome.storage.local`。 |

### 3.3 資料結構 (Storage Key)
* **金鑰**: `ytEnhancerSettings.auto_translate_priority_list` (取代舊的 `preferred_langs`)
* **格式**: **有序物件陣列** (必須保留順序與 Prompt 內容)。
    ```json
    [
      { "langCode": "ja", "customPrompt": "**風格指南:** ...", "order": 1 },
      { "langCode": "ko", "customPrompt": "--- 韓文自訂 Prompt ---", "order": 2 }
    ]
    ```

## 4. 層級三規範：按需翻譯 (Fallback 模式)

### 4.1 核心目標 (Tier 3)
* **功能**: 處理未命中層級一和層級二的所有其他語言 (例如: `fr`, `de`)。
* **目的**: 提供「零干擾」的解決方案，讓使用者可以**按需**（On-Demand）觸發翻譯。

### 4.2 UI/UX 規範 (options.html)
* **結論**: **層級三不需要在 `options.html` 中新增任何設定或選項**。
* **原因**: 層級三是一種**系統的預設行為**。它的行為 (Hover-to-Reveal 按鈕) 發生在影片介面 (`content.js` / `style.css`)，而不是設定頁面。
* **說明**: 只需要在 `options.html` 內的診斷頁面提供文字說明，告知使用者如果影片語言未在清單 A 和 B 中，將進入此模式，等待使用者在影片右上角操作。

## 5. 檔案變更總覽 (架構師總結)

| 檔案 | 變更描述 |
| :--- | :--- |
| **`options.html`** | 移除舊的語言卡片和 Prompt 卡片，新增 Tier 1 (簡潔列表) 和 Tier 2 (Accordion 列表) 的 HTML 結構。 |
| **`popup.js`** | **核心邏輯重寫**：新增「友善名稱搜尋語言」功能，並重寫 `loadSettings`/`saveSettings` 邏輯，以處理新的 `native_langs` 和 `auto_translate_priority_list` 資料結構。 |
| **`background.js`** | `translateBatch` 函式獲取 Prompt 的邏輯將需要調整，以遍歷新的**有序** `auto_translate_priority_list` 陣列，而不是讀取舊的硬編碼物件。 |
| **`content.js`** | `start()` 函式將被**完全重寫**，以實現新的三層決策樹，並實作 Tier 3 的「零干擾原文顯示」和「按需翻譯」邏輯。 |



以下是設計師回饋內容
我已經根據您提供的詳細系統架構規格書，成功重新設計了「YT 字幕增強器」的 options.html UI/UX。以下是完成的功能：


🎯 核心改進


層級一：原文顯示語言（零成本模式）
✅ 簡潔的 Badge/Token 顯示介面
✅ Popover 搜尋式新增語言（支援中文、英文、原生語言搜尋）
✅ 一鍵移除語言
✅ 即時自動儲存
✅ 清晰的節費提示


層級二：自動翻譯與 Prompt 管理
✅ 可拖曳排序的 Accordion 列表
✅ 優先級 Badge 顯示（優先級 1、優先級 2...）
✅ 每個語言獨立的 Prompt 編輯區
✅ 展開/收起切換（同時只能展開一個）
✅ Popover 搜尋式新增語言
✅ 儲存/取消按鈕（只有 Prompt 需要明確儲存）
✅ 預設 Prompt 範本自動填充


層級三：按需翻譯（Fallback 模式）
✅ 在診斷頁面提供清晰的說明文檔
✅ 解釋自動觸發邏輯
✅ 無需在 UI 中設定

🎨 UX 優化亮點


零語言代碼輸入 - 使用者只需搜尋「日」或「Japanese」即可找到日文
即時搜尋 - 輸入即過濾，無需按 Enter
拖曳排序 - 視覺化調整優先級
自動儲存 - 除了 Prompt 外，所有設定都即時儲存
清晰的視覺層次 - Badge、色彩、間距設計清晰
友善的提示訊息 - 每個卡片都有清楚的說明和使用提示
🎯 新增語言完整流程總結


層級一（Tier 1）- 原文顯示語言
點擊「新增語言」→ Popover 彈出
輸入搜尋關鍵字（例如：「法」、「fr」、「French」）
點擊匹配的語言
Badge 立即出現在列表中
Popover 自動關閉並清空搜尋
自動儲存 ✅


層級二（Tier 2）- 自動翻譯語言
點擊「新增語言」→ Popover 彈出
輸入搜尋關鍵字（例如：「韓」、「ko」、「Korean」）
點擊匹配的語言
新項目自動展開，顯示 Prompt 編輯區 📝
Textarea 已預填充預設 Prompt 範本
使用者編輯 Prompt（加入專有名詞對照表等）
點擊「儲存」→ Accordion 自動收起
自動儲存 ✅


🎨 關鍵 UX 優化


✅ 自動聚焦：Popover 打開時搜尋框自動聚焦
✅ 即時過濾：輸入即搜尋，無需按 Enter
✅ 自動清空：Popover 關閉時自動清空搜尋內容
✅ 自動展開：新增 Tier 2 語言後自動展開編輯區
✅ 預填充：Prompt 編輯區預填充精心設計的範本
✅ 單一展開：同時只能展開一個項目，避免混淆
✅ Toast 提示：每次操作都有清晰的視覺反饋



剛剛完成了 v2.0 語言決策引擎的階段一（後端）和階段二（管理後台）。

這兩個階段的實作過程，特別是我們一起經歷的除錯，確實產生了幾個非常關鍵的決策、歷史包袱與護欄。

以下是階段一與階段二的總結：

### 1. 關鍵決策 (Key Decisions)

在階段一和二中，我們做出的最核心的決策是：

1.  **資料庫遷移 (Database Migration) 的實作：**
    * **決策：** 我們決定**不**拋棄 v1.x 使用者的舊設定（`preferred_langs`, `customPrompts`），而是選擇在 `popup.js` 的 `loadSettings` 函式中實作一個「自動遷移」邏輯。
    * **原因：** 這是為了確保未來上架時，所有舊使用者的資料（特別是您精心撰寫的日文 Prompt）都能被**無痛繼承**到 v2.0 的新資料結構（`auto_translate_priority_list`）中，而不是被清空。

2.  **Prompt 繼承邏輯 (Merge Logic)：**
    * **決策：** 在遷移過程中，我們最終採用了 `const mergedPrompts = { ...DEFAULT_CUSTOM_PROMPTS, ...userPrompts };` 的合併策略。
    * **原因：** 這是我們在測試中發現的關鍵錯誤。此決策確保了儲存在 `storage` 中的使用者自訂 Prompt（例如您測試用的 `ko`），其**優先級高於**寫死在程式碼中的 `DEFAULT_CUSTOM_PROMPTS`，成功解決了遷移資料被覆蓋的問題。

3.  **UI 介面 (Popover Search) 的採用：**
    * **決策：** 我們為 Tier 1 和 Tier 2 實作了「語言搜尋 Popover」介面，並建立了一個 `LANGUAGE_DATABASE` 常數。
    * **原因：** 這解決了 v1.x 最大的痛點之一：使用者（您）不再需要記憶或手動輸入 `ja`, `ko` 等語言代碼，而是可以透過「日文」、「韓文」等友善名稱進行搜尋。

4.  **新舊 UI (Card) 的保留：**
    * **決策：** 我們修正了藍圖，保留了「模型偏好設定」和「API 金鑰管理」等卡片。
    * **原因：** 澄清了 v2.0 語言引擎是**功能擴充**，而非取代。金鑰管理、模型排序與語言決策是三項獨立的功能，必須共存。

### 2. 歷史包袱 (Historical Baggage)

實作完成後，我們現在也背負了一些「歷史包袱」，未來需要注意：

1.  **`DEFAULT_CUSTOM_PROMPTS` 常數：**
    * **包袱：** 這個在 `popup.js` 頂部的常數（包含詳細的日文 Prompt），其**唯一**存在的理由就是為了服務「v1.x -> v2.0 資料庫遷移」。
    * **影響：** 對於 v2.0 的新使用者（或您未來新增的「法文」），系統會改用 `NEW_LANGUAGE_PROMPN_TEMPLATE`。這個舊常數未來在 v3.0 時或可被移除，但目前是遷移所必需的。

2.  **`loadSettings` 內的遷移區塊：**
    * **包袱：** `loadSettings` 函式中，那段檢查 `if (currentSettings.preferred_langs)` 的遷移程式碼，對於任何已升級到 v2.0 的使用者（包含您）來說，都只會執行**一次**。
    * **影響：** 它會永遠存在於程式碼中，作為保護未來可能出現的 v1.x 使用者的「防禦性程式碼」。

### 3. 關鍵護欄 (Guard Rails)

在我們共同除錯的過程中，我們確立了兩個未來開發**絕對不能違反**的關鍵護欄：

1.  **[護欄 1] `popup.js` 是共享腳本 (最重要)：**
    * **規則：** `popup.js` 同時被 `popup.html`（小彈窗）和 `options.html`（管理後台）共用。
    * **教訓：** 任何**只存在於** `options.html` 的 DOM 元素（例如 `tier-1-card`, `apiKeyList`），在 `popup.js` 中存取它之前，**必須**使用 `if (isOptionsPage)` 或 `if (element)` 進行嚴格的 `null` 檢查。
    * **後果：** 如果違反此護欄（例如直接呼叫 `document.getElementById('apiKeyList')`），將導致 `popup.html`（小彈窗）**立即崩潰**。

2.  **[護欄 2] `DOMContentLoaded` 是執行起點：**
    * **規則：** **所有** `popup.js` 的頂層執行邏輯（包含事件綁定、函式呼叫）都**必須**被包裹在 `document.addEventListener('DOMContentLoaded', () => { ... });` 內部。
    * **教訓：** 這是我們在 [步驟 2.C] 遇到的核心錯誤。如果在 DOM 載入完成前嘗試存取任何元素（`getElementById`），都會因取到 `null` 而導致**整個腳本崩潰**，進而引發「遷移失敗」、「UI 假死」、「金鑰功能失效」等連鎖反應。

---


# 系統架構規格書：v2.1 修正案 (Tier 1 優先級與 Tier 3 觸發 Bug)

**版本：** 4.0.1 (基於 v4.0.0 的修正)
**目標：** 修復 v2.0 架構中遺留的兩個邊界情境 (Edge Case) 問題，以完善三層式語言決策引擎。

---

## 1. 執行規劃 (Phased Execution Plan)

此修正案將分為兩個獨立的任務，您可以分開指派與驗證。

### 任務一：修正 Tier 1 (原文顯示) 優先級問題

* **核心目標：** 允許使用者為「語言清單 A (原文顯示語言)」 進行排序，並確保系統**嚴格遵守**此順序。
* **任務：**
    1.  **UI 變更 (`options.html`)：** 將 Tier 1 的靜態 Badge 容器 升級為**可拖曳排序**的列表 (類似 Tier 2 的 `<ul>`)。
    2.  **UI 邏輯 (`popup.js`)：**
        * 綁定 `initializeSortableList` 到 Tier 1 列表。
        * 修改 `saveTier1Settings()`（或相關儲存邏輯），確保 `native_langs` 陣列**嚴格按照 DOM 順序**儲存。
    3.  **引擎邏輯 (`content.js`)：** **修改 `start()` 函式** 中的 Tier 1 檢查邏輯，使其**遍歷使用者偏好的 `native_langs` 順序**，而不是遍歷影片的 `availableLangs` 順序。
* **驗證標準 (如何測試)：**
    1.  在 `options.html` 設定 Tier 1 列表順序為：1. `繁體中文 (zh-Hant)`, 2. `簡體中文 (zh-Hans)`。
    2.  打開一個**同時提供**這兩種字幕的影片。
    3.  **預期行為：** 系統**必須**啟用 `繁體中文 (zh-Hant)` 字幕，並進入 Tier 1 (原文顯示) 模式。

### 任務二：修正 Tier 3 (按需翻譯) 邏輯漏洞

* **核心目標：** 確保使用者**手動切換 CC 字幕**的行為，依然 100% 遵守 Tier 1/2/3 決策引擎，防止 Tier 3 語言被錯誤地自動翻譯。
* **任務：**
    1.  **引擎邏輯 (`content.js`)：**
        * **修改 `onMessageFromInjector`** 函式中的 `case 'TIMEDTEXT_DATA'` 區塊。
        * 在此區塊中（特別是處理非 `activationWatchdog` 觸發的字幕時），**完整複製/實作** `start()` 函式 中的「三層決策樹」邏輯。
* **驗證標準 (如何測試)：**
    1.  在 `options.html` 設定 Tier 1/2 中**不**包含「法文 (fr)」。
    2.  打開一個法文影片。
    3.  **預期行為 1：** 系統應正確進入 Tier 3 模式（顯示原文 + 右上角按需翻譯按鈕）。
    4.  **手動操作：** **手動點擊**播放器原生的 [CC] 按鈕，並重新選擇「法文」。
    5.  **預期行為 2：** 系統**必須**再次進入 Tier 3 模式（顯示原文 + 按需翻譯按鈕），**絕不能**觸發自動翻譯 (Orb 狀態環)。

---

## 2. 系統實作細節

### 任務一：修正 Tier 1 優先級問題

#### 2.1 問題根本原因 (Root Cause Analysis)

* **v2.0 缺陷：** 我們的 v2.0 藍圖將 Tier 1 設計為「無序」的 Badge 集合，並在 `content.js` 的 `start()` 函式 中使用了 `availableLangs.find(lang => native_langs.includes(lang))` 的邏輯。
* **錯誤行為：** 此邏輯會匹配「**影片方**」提供的字幕列表（`availableLangs`）中的第一個匹配項，而不是「**使用者**」在 `native_langs` 中設定的最高優先級。

#### 2.2 檔案修改藍圖

* **`options.html`**
    * **替換指示：** 替換 `<div id="tier-1-badge-container" ...>` (靜態 `div`)。
    * **新邏輯 (示意)：**
        ```html
        <ul id="tier-1-badge-list" class="sortable-list badge-list">
            </ul>
        ```

* **`popup.css`**
    * **新增指示：** 必須新增/修改 CSS 規則，使 `tier-1-badge-list` 及其 `li` 元素看起來像可拖曳的 Badge，而不是 Tier 2 的 Accordion。

* **`popup.js`**
    * **修改指示：**
        1.  在 `loadSettings` (或相關初始化函式) 中，呼叫 `initializeSortableList('tier-1-badge-list', saveTier1Settings)`，使其具備拖曳能力。
        2.  修改 `saveTier1Settings()`（或您實作的儲存函式），確保 `native_langs` 陣列是**根據 `tier-1-badge-list` 中 `li` 元素的 DOM 順序**產生的。

* **`content.js`**
    * **替換指示：** 替換 `start()` 函式 內部的「TIER 1 檢查」邏輯區塊。
    * **舊邏輯 (將被移除)：**
        ```javascript
        const nativeMatch = availableLangs.find(lang => native_langs.includes(lang));
        if (nativeMatch) {
            // ... (Tier 1 執行) ...
        }
        ```
    * **新邏輯 (將被替換為)：**
        ```javascript
        // --- TIER 1 檢查 (v2.1 修正：尊重使用者排序) ---
        let nativeMatch = null;
        const orderedNativeLangs = this.settings.native_langs || [];
        
        // 遍歷使用者偏好的 Tier 1 順序
        for (const preferredLang of orderedNativeLangs) {
            // 檢查影片是否提供此語言
            if (availableLangs.includes(preferredLang)) {
                nativeMatch = preferredLang; // 找到了！這就是最高優先級的
                break; // 停止搜尋
            }
        }
        
        if (nativeMatch) {
            this._log(`[決策 v2.1] -> Tier 1 命中：匹配到最高優先級原文 (${nativeMatch})。`);
            this.runTier1_NativeView(availableTracks.find(t => t.languageCode === nativeMatch));
            return; // 流程結束
        }
        
        // --- TIER 2 檢查 (邏輯不變) ---
        // ... (Tier 2 邏輯) ...
        ```

---

### 任務二：修正 Tier 3 邏輯漏洞

#### 2.1 問題根本原因 (Root Cause Analysis)

* **v2.0 缺陷：** 我們的 v2.0 藍圖只重寫了 `start()` 函式（頁面載入時觸發） 的決策邏輯。
* **邏輯漏洞：** 我們**遺漏**了 `content.js` 中的**第二個**字幕觸發點：`onMessageFromInjector` 函式內的 `case 'TIMEDTEXT_DATA'` 區塊。
* **錯誤行為：** 當使用者手動點擊 CC 按鈕時，`TIMEDTEXT_DATA` 事件被觸發，並執行了**舊的 v1.x 邏輯**（即「收到字幕就翻譯」），完全繞過了 v2.0 的三層決策引擎。

#### 2.2 檔案修改藍圖

* **`content.js`**
    * **替換指示：** **重寫 `onMessageFromInjector` 函式中的 `case 'TIMEDTEXT_DATA'` 區塊**。
    * **新邏輯 (示意)：**
        ```javascript
        // 位於 onMessageFromInjector 函式內
        case 'TIMEDTEXT_DATA':
            const { payload: timedTextPayload, lang, vssId } = payload;
            this._log(`[v2.1] 收到 [${lang}] (vssId: ${vssId || 'N/A'}) 的 TIMEDTEXT_DATA。`);
            
            // (防護機制：忽略非啟用狀態的字幕)
            if (!this.settings.isEnabled && !this.state.isOverride) {
                // ... (保留 v3.1.3 的防護邏輯) ...
                return;
            }

            // (看門狗邏輯：處理 v2.0 的 TIER 2 自動啟用)
            if (this.state.activationWatchdog) {
                // ... (保留 v2.0 的看門狗驗證邏輯) ...
                
                // (看門狗成功，解除並執行 activate)
                clearTimeout(this.state.activationWatchdog);
                this.state.activationWatchdog = null;
                this.state.targetVssId = null;
                this.state.sourceLang = lang;
                this.state.hasActivated = true;
                this.activate(timedTextPayload); // Tier 2 流程
                return; // Tier 2 流程結束
            }

            // --- 【v2.1 關鍵修正點】---
            // 如果不是看門狗觸發的 (例如手動切換CC)，則必須重新執行三層決策
            
            // 0. 檢查是否為重複數據
            if (this.state.hasActivated && lang === this.state.sourceLang) {
                this._log('語言相同，忽略重複的 timedtext 數據。');
                return;
            }
            
            // 1. 執行 Tier 1 檢查
            const availableTracks = this.getAvailableLanguagesFromData(this.state.playerResponse, true);
            const { native_langs = [], auto_translate_priority_list = [] } = this.settings;
            
            if (native_langs.includes(lang)) {
                this._log(`[決策 v2.1/手動] -> Tier 1 命中： (${lang})。`);
                this.runTier1_NativeView(availableTracks.find(t => t.languageCode === lang));
                return;
            }

            // 2. 執行 Tier 2 檢查
            const tier2Config = auto_translate_priority_list.find(item => item.langCode === lang);
            if (tier2Config) {
                this._log(`[決策 v2.1/手動] -> Tier 2 命中： (${lang})。`);
                this.state.sourceLang = lang;
                this.state.hasActivated = true;
                this.activate(timedTextPayload); // 觸發翻譯
                return;
            }

            // 3. 執行 Tier 3 (Fallback)
            this._log(`[決策 v2.1/手動] -> Tier 3 觸發： (${lang})。`);
            this.runTier3_OnDemand(availableTracks.find(t => t.languageCode === lang));
            break;
        ```

---

## 3. 預期結果 (v2.1)

* **使用者視角 (困擾 1)：** 「我打開法文影片（Tier 3），手動點擊 CC 按鈕，它**不再**自動翻譯了。它正確地顯示了原文和右上角的『翻譯』按鈕。」
* **使用者視角 (困擾 2)：** 「我把『繁體中文』拖到『簡體中文』上面（Tier 1）。現在當我打開同時有這兩種字幕的影片時，它總是**優先顯示繁體中文**。」
* **系統行為：** `content.js` 中的兩個主要入口點 (`start` 和 `onMessageFromInjector`) 現在都 100% 遵守 v2.1 的三層式語言決策引擎。


---
## 語言重置Bug

這個 Bug 與 v1.x 遷移*本身*無關，而是\*\*`popup.html`（小彈窗）的「啟用/停用翻譯」按鈕觸發的一個嚴重 Bug\*\*，它錯誤地還原了 v1.x 的資料，導致遷移邏輯被「重複觸發」。

### 執行規劃：問題分析與修正方法論

1.  **問題根源 (Root Cause Analysis)：**

      * **核心缺陷：** `background.js`（我們的後端）中的 `defaultSettings` 常數（預設設定）仍然是 v1.x 的舊結構。
      * **缺陷程式碼 (位於 `background.js`)：**
        ```javascript
        const defaultSettings = {
            // ...
            preferred_langs: ['ja', 'ko', 'en'], // 【v1.x 舊資料】
            ignored_langs: ['zh-Hant']         // 【v1.x 舊資料】
        };
        ```

2.  **Bug 觸發流程（SOP）：**

    1.  您的 `options.html` 運作正常，`chrome.storage` 中的 `ytEnhancerSettings` 已經是 v2.0 結構（包含 `native_langs: []` 和 `auto_translate_priority_list: []`）。
    2.  您點擊了 `popup.html`（小彈窗）中的「啟用翻譯」按鈕。
    3.  這個按鈕觸發了 `background.js` 中的 `toggleGlobalState` 動作。
    4.  `toggleGlobalState` 函式執行了這行程式碼：`chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings }, ...)`。
    5.  **【Bug 爆發點】**：`get` 函式會執行「合併」。它會拿您 v2.0 的設定，並用 `defaultSettings`（v1.x）來**填補**「您設定中不存在的屬性」。
    6.  結果，`background.js` 記憶體中的 `newSettings` 物件變成了：
        ```json
        {
          "native_langs": [],
          "auto_translate_priority_list": [],
          "isEnabled": false,
          // ...
          "preferred_langs": ["ja", "ko", "en"], // <-- 舊資料被錯誤地加回來了！
          "ignored_langs": ["zh-Hant"]         // <-- 舊資料被錯誤地加回來了！
        }
        ```
    7.  `background.js` 接著將這個被汙染的物件**儲存**回 `chrome.storage.local`。
    8.  **【連鎖反應】**：您下次打開 `options.html` 時，`popup.js` 中的 `loadSettings` 執行。
    9.  它讀取到被汙染的設定，`if (currentSettings.preferred_langs)` 判斷變為 **True**。
    10. v1.x 的遷移邏輯**被錯誤地再次觸發**，它根據 `preferred_langs: ['ja', 'ko', 'en']` 重新建立了您的 Tier 2 列表，導致您的 `[]`（空列表）設定被覆蓋。

3.  **修正方法論 (Fix Strategy)：**
    我們必須修正 `background.js`，將其內部的 `defaultSettings` 常數從 v1.x 結構**升級為 v2.0 結構**。

      * **移除**：`preferred_langs` 和 `ignored_langs`。
      * **新增**：`native_langs` 和 `auto_translate_priority_list`，並填入與 `popup.js` 的 `DEFAULT_CUSTOM_PROMPTS` 一致的預設值，以確保新使用者安裝時的體驗一致。



---


好的，我們在執行 v2.1 修正案 的過程中，確實遇到並解決了幾個相互關聯的 Bug。

以下是本次修改從頭到尾遇到的 Bug、根本原因以及解決方法的總結：

### Bug 1：語言設定被「啟用/停用」按鈕重置

* **Bug 描述：**
    當使用者在 `options.html` 將 Tier 1 / Tier 2 列表設為空之後，只要點擊 `popup.html`（小彈窗） 的「啟用/停用翻譯」按鈕，下次再打開 `options.html` 時，語言列表會被重置回 v1.x 的預設值（例如 `ja, ko, en`）。

* **根本原因 (Root Cause)：**
    問題出在 `background.js`。
    1.  `background.js` 中的 `defaultSettings` 常數 仍然是 v1.x 的舊結構（包含 `preferred_langs` 和 `ignored_langs`）。
    2.  當 `popup.js` 觸發 `toggleGlobalState` 動作時，`background.js` 會執行 `chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings }, ...)`。
    3.  這個 `get` 操作會將 v2.0 的設定（在 `storage` 中）與 v1.x 的 `defaultSettings`（在程式碼中） 進行「合併」。
    4.  這導致 `preferred_langs` 這個 v1.x 屬性被錯誤地**重新加回**並儲存到 `storage` 中。
    5.  下次 `popup.js` 載入時，`loadSettings` 偵測到 `if (currentSettings.preferred_langs)` 為 `true`，因此**錯誤地再次觸發** v1.x 遷移邏輯，覆蓋了使用者的 v2.0 設定。

* **解決方法：**
    修改 `background.js`，將 `defaultSettings` 常數 **完整升級為 v2.0 結構**，移除 `preferred_langs` 和 `ignored_langs`，替換為 `native_langs` 和 `auto_translate_priority_list`。

---

### Bug 2：Tier 1 優先級匹配失敗 (zh-Hant vs zh-TW)

* **Bug 描述：**
    在 `options.html` 設定 Tier 1 列表順序為 `[zh-Hant, zh-Hans]`。當打開一個同時提供 `[zh-TW, zh-Hans]` 字幕的影片時，系統忽略了 `zh-Hant`（繁中），錯誤地匹配了 `zh-Hans`（簡中）。

* **根本原因 (Root Cause)：**
    `content.js` 中的 `start` 函式（v2.1.0 版本） 在檢查 Tier 1 時，使用了 `availableLangs.includes(preferredLang)` 進行嚴格字串比對。JavaScript 無法將 `zh-TW`（影片提供） 視為等同於 `zh-Hant`（使用者設定），導致匹配失敗。

* **解決方法 (v2.1.1)：**
    1.  在 `content.js` 中新增一個 `checkLangEquivalency` 輔助函式。
    2.  此函式定義了「繁體中文群組」（`['zh-Hant', 'zh-TW', 'zh-HK']`） 和「簡體中文群組」（`['zh-Hans', 'zh-CN']`）。
    3.  修改 `start` 與 `onMessageFromInjector` 函式中的所有 Tier 1 和 Tier 2 檢查邏輯，**用 `checkLangEquivalency` 取代 `includes()`**。

---

### Bug 3：手動切換 Tier 3 語言時錯誤觸發翻譯

* **Bug 描述：**
    修正 Bug 2 後，在 T1/T2 為空的情況下，手動從 CC 選單選擇 `zh-TW` 字幕（應為 Tier 3 原文模式），系統卻顯示 `找不到 zh-TW 的軌道物件`，並錯誤地掉入兜底邏輯，觸發了 Tier 2（翻譯）流程。

* **根本原因 (Root Cause)：**
    `onMessageFromInjector` 函式（v2.1.1 版本） 自身存在缺陷。
    1.  雖然 T1/T2 檢查已更新為 `checkLangEquivalency`，但在 Tier 3 邏輯區塊中，當它試圖尋找軌道物件以建立「翻譯」按鈕時，**遺漏了**使用 `checkLangEquivalency`。
    2.  它使用了錯誤的 `availableTracks.find(t => t.languageCode === lang)`。
    3.  這導致 `zh-TW`（來自 `timedtext`） 無法匹配 `zh-Hant`（來自 `playerResponse`），`find` 失敗，程式掉入錯誤的 `else` 兜底區塊，觸發了 Tier 2。

* **解決方法 (v2.1.2)：**
    修正 `onMessageFromInjector` 函式中的 Tier 3 邏輯，將 `find` 函式也改為使用 `this.checkLangEquivalency(t.languageCode, lang)`，並將 `else` 兜底區塊的行為修正為「執行 Tier 3 (僅原文)」。

---

### Bug 4：泛用 'zh' 代碼未被 Tier 1 識別

* **Bug 描述：**
    影片提供了 `zh`（泛中文）字幕，但 Tier 1 中的 `zh-Hans` 未能匹配它，導致系統錯誤地執行了 Tier 2（例如 `ja`） 或 Tier 3。

* **根本原因 (Root Cause)：**
    `checkLangEquivalency` 函式 的簡體中文群組（`['zh-Hans', 'zh-CN']`） 遺漏了 `zh` 這個常見的泛用代碼。

* **解決方法 (v2.1.3)：**
    修正 `content.js` 中的 `checkLangEquivalency` 函式，將 `'zh'` 添加到 `simplifiedGroup` 陣列中。

---

### Bug 5：Tier 1 列表（新增/刪除）無法儲存

* **Bug 描述：**
    在 `options.html` 中對 Tier 1 列表進行的新增、刪除或拖曳排序，在重新整理頁面後失效（被還原）。

* **根本原因 (Root Cause)：**
    `popup.js` 中的 `saveTier1Settings` 函式 存在邏輯缺陷。
    1.  它在一個 `if (JSON.stringify(settings.native_langs) !== JSON.stringify(newList))` 判斷式**之後**才執行儲存。
    2.  當使用者「刪除」時，`handleTier1Remove` 會先更新記憶體 (`settings.native_langs`)，再更新 DOM，最後才呼叫 `saveTier1Settings`。
    3.  這導致 `saveTier1Settings` 在比較（已更新的記憶體）和（已更新的 DOM）時，兩者恆等，`if` 判斷為 `false`，因此**跳過了** `await saveSettings()` 儲存步驟。

* **解決方法：**
    修正 `popup.js` 中的 `saveTier1Settings` 函式，**移除**該 `if` 判斷式，使其無條件地從 DOM 讀取最新列表、更新 `settings.native_langs`，並執行 `await saveSettings()`。


---

是的，在我們剛剛完成的 v2.1.x 修正案（包含 Bug 1 到 Bug 5）的過程中，我們確實確立了幾個非常重要的新決策、背負了新的歷史包袱，並因此需要建立新的關鍵護欄。

以下是我的總結：

### 1. 關鍵決策 (Key Decisions)

在這次除錯中，我們被迫做出了三個影響深遠的架構決策：

1.  **【決策】抽象化「語言等價性」檢查 (Bugs 2, 3, 4)：**
    * **決策：** 我們不再使用 `===` 或 `.includes()` 來進行語言代碼的字串比對。我們決定在 `content.js` 中建立一個新的輔助函式 `checkLangEquivalency`。
    * **原因：** Bug 2 和 Bug 4 證明，YouTube 提供的語言代碼（如 `zh-TW`, `zh`）與使用者在 `options.html` 設定的代碼（如 `zh-Hant`）之間存在不一致。`checkLangEquivalency` 透過定義「繁體中文群組」 和「簡體中文群組」，從根本上解決了這個匹配問題。

2.  **【決策】升級 `background.js` 的 `defaultSettings` (Bug 1)：**
    * **決策：** 我們將 `background.js` 中的 `defaultSettings` 常數 從 v1.x 結構（`preferred_langs`） 升級到了 v2.0 結構（`native_langs`, `auto_translate_priority_list`）。
    * **原因：** 這是為了解決 Bug 1。`toggleGlobalState` 函式 會使用 `defaultSettings` 來「填補」`storage` 中缺少的屬性。使用舊結構 會汙染 v2.0 設定，導致 v1.x 遷移邏輯 被重複觸發。

3.  **【決策】簡化儲存函式的職責 (Bug 5)：**
    * **決策：** 我們移除了 `popup.js` 中 `saveTier1Settings` 函式 內部的 `if` 檢查。
    * **原因：** Bug 5 證明，這個 `if` 檢查 的邏輯是錯誤的。它在呼叫時（例如在 `handleTier1Remove` 之後），記憶體 和 DOM 都已經被更新了，導致 `if` 判斷恆為 `false` 並跳過了儲存。此決策確立了「儲存函式」的職責就是無條件讀取 DOM 並儲存。

### 2. 歷史包袱 (Historical Baggage)

這些決策也為我們帶來了新的、未來需要維護的「歷史包袱」：

1.  **【包袱】`checkLangEquivalency` 函式的硬編碼 (Bugs 2, 4)：**
    * **包袱：** `checkLangEquivalency` 函式 本身就是一個新的包袱。它包含了我們對 YouTube 語言代碼的「領域知識」（Domain Knowledge）。
    * **影響：** 如果未來 YouTube 停止使用 `zh-TW` 或新增了 `zh-SG`（新加坡中文），這個函式 就會立刻過時，我們必須手動維護並更新這兩個群組。

2.  **【包袱】`defaultSettings` 的同步債 (Bug 1)：**
    * **包袱：** 雖然我們修復了 Bug 1，但 `background.js` 中的 `toggleGlobalState` 函式 仍然依賴 `defaultSettings` 進行合併。
    * **影響：** 這意味著未來只要 `ytEnhancerSettings` 的資料結構有*任何*變更（例如新增一個 `v3.0` 的屬性），我們都**必須**記得同時更新 `background.js` 中的 `defaultSettings` 常數，否則 Bug 1 會以新的形式再次出現。

### 3. 關鍵護欄 (Guard Rails)

基於以上決策與包袱，我們必須建立以下三條新的「關鍵護欄」：

1.  **[護欄 1] 語言匹配的唯一性 (Bugs 2, 3, 4)：**
    * **規則：** 在 `content.js` 中，**所有**需要比對「影片語言代碼」和「使用者設定代碼」的邏輯，**必須**使用 `checkLangEquivalency` 函式。
    * **禁止：** 嚴格禁止再使用 `lang === settingLang` 或 `array.includes(lang)` 進行語言代碼比對。

2.  **[護欄 2] 決策樹的鏡像原則 (Bug 3)：**
    * **規則：** `content.js` 有兩個入口點會觸發決策樹：`start()`（自動載入） 和 `onMessageFromInjector`（手動切換）。
    * **禁止：** 這兩個函式 內部的 Tier 1/2/3 判斷邏輯**必須**保持 100% 鏡像同步。只修改其中一個（例如 `start`）而忘記另一個（`onMessageFromInjector`），將立刻導致 Bug 3 迴歸。

3.  **[護欄 3] `defaultSettings` 的結構同步 (Bug 1)：**
    * **規則：** `background.js` 中的 `defaultSettings` 常數 **必須**被視為 `ytEnhancerSettings` 資料結構的「鏡像」或「藍圖」。
    * **禁止：** 嚴格禁止在 `ytEnhancerSettings` 中新增/刪除屬性後，卻忘記同步修改 `background.js` 中的 `defaultSettings`。

    