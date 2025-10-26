/**
 * @file popup.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 4.0.1
 *
 * Handles logic for both popup.html (Remote Control) and options.html (Admin Panel).
 */

// 【關鍵修正點】: v2.0 - 將所有邏輯包裹在 DOMContentLoaded 內部
document.addEventListener('DOMContentLoaded', () => {
    // 功能: 整個 popup.html 和 options.html 腳本的啟動入口。

    const isOptionsPage = document.body.style.width === 'auto';

    const LANG_CODE_MAP = {
        'ja': '日文', 'ko': '韓文', 'en': '英文',
        'zh-Hant': '繁體中文', 'zh-Hans': '簡體中文',
        'vi': '越南文', 'th': '泰文', 'id': '印尼文',
        'es': '西班牙文', 'fr': '法文', 'de': '德文', 'ru': '俄文',
        'zh-TW': '繁體中文 (台灣)', 'zh-CN': '簡體中文 (中國)', 'zh-HK': '繁體中文 (香港)'
    };

    // --- [v2.0] 新增常數 (步驟 2.B) ---
    const LANGUAGE_DATABASE = [
        { code: 'ja', name: '日文', search: ['ja', 'japanese', '日文', '日語'] },
        { code: 'en', name: '英文', search: ['en', 'english', '英文', '英語'] },
        { code: 'ko', name: '韓文', search: ['ko', 'korean', '韓文', '韓語'] },
        { code: 'zh-Hant', name: '繁體中文', search: ['zh-hant', 'traditional chinese', '繁體中文', '正體中文'] },
        { code: 'zh-Hans', name: '簡體中文', search: ['zh-hans', 'simplified chinese', '簡體中文'] },
        { code: 'fr', name: '法文', search: ['fr', 'french', '法文', '法語'] },
        { code: 'de', name: '德文', search: ['de', 'german', '德文', '德語'] },
        { code: 'es', name: '西班牙文', search: ['es', 'spanish', '西班牙文', '西班牙語'] },
        { code: 'ru', name: '俄文', search: ['ru', 'russian', '俄文', '俄語'] },
        { code: 'vi', name: '越南文', search: ['vi', 'vietnamese', '越南文', '越南語'] },
        { code: 'th', name: '泰文', search: ['th', 'thai', '泰文', '泰語'] },
        { code: 'id', name: '印尼文', search: ['id', 'indonesian', '印尼文', '印尼語'] },
        { code: 'it', name: '義大利文', search: ['it', 'italian', '義大利文', '義大利語'] },
        { code: 'pt', name: '葡萄牙文', search: ['pt', 'portuguese', '葡萄牙文', '葡萄牙語'] },
        { code: 'ar', name: '阿拉伯文', search: ['ar', 'arabic', '阿拉伯文', '阿拉伯語'] },
        { code: 'hi', name: '北印度文', search: ['hi', 'hindi', '北印度文', '印度語'] },
        { code: 'tr', name: '土耳其文', search: ['tr', 'turkish', '土耳其文', '土耳其語'] }
    ];

    const NEW_LANGUAGE_PROMPT_TEMPLATE = `**風格指南:**
- 翻譯需符合台灣人的說話習慣，並保留說話者的情感語氣。
- (可選) 翻譯風格應偏向 (口語化/書面語/專業/活潑)。

**人名/專有名詞對照表 (優先級最高):**
- (範例) 原文名稱/讀音 -> 應翻譯的專有名詞
`;
    // --- [v2.0] 常數結束 ---

    const ALL_MODELS = {
        'gemini-2.5-pro': { name: 'Gemini 2.5 Pro', tip: '最高品質，適合複雜推理任務。' },
        'gemini-2.5-flash': { name: 'Gemini 2.5 Flash', tip: '效能與速度的平衡點。' },
        'gemini-2.5-flash-lite': { name: 'Gemini 2.5 Flash-Lite', tip: '速度極快，適合高頻率即時回應。' },
        'gemini-2.0-flash': { name: 'Gemini 2.0 Flash', tip: '舊版高速模型。' },
        'gemini-2.0-flash-lite': { name: 'Gemini 2.0 Flash-Lite', tip: '舊版最快模型。' }
    };

    // 【關鍵修正點】: v1.1 - 從 backend.py 遷移預設 Prompts
    const DEFAULT_CUSTOM_PROMPTS = {
        "ja": `**風格指南:**
- 翻譯需符合台灣人的說話習慣，並保留說話者(日本偶像)的情感語氣。

**人名/專有名詞對照表 (優先級最高):**
無論上下文如何，只要看到左側的原文或讀音，就必須嚴格地翻譯為右側的詞彙。
- まちだ / まち田 / まちだ けいた -> 町田啟太
- さとう たける -> 佐藤健
- しそん じゅん -> 志尊淳
- しろたゆう -> 城田優
- みやざき ゆう -> 宮崎優
- 天ブランク -> TENBLANK
- グラスハート -> 玻璃之心
- Fujitani Naoki -> 藤谷直季
- Takaoka Sho -> 高岡尚
- Sakamoto Kazushi -> 坂本一志
- 西條朱音 -> 西條朱音
- 菅田將暉 -> 菅田暉
- ノブ -> ノブ
`,
        "ko": "--- 韓文自訂 Prompt (請在此輸入風格與對照表) ---",
        "en": "--- 英文自訂 Prompt (請在此輸入風格與對照表) ---"
    };

    // --- 通用函數 ---
    const sendMessage = (message) => chrome.runtime.sendMessage(message);
    const getActiveTab = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    };
    
    function translateToFriendlyError(errorMessage) {
        // 功能: 將後端或網路層返回的技術性錯誤訊息，轉換為使用者看得懂的友善提示。
        const msg = String(errorMessage).toLowerCase();
        if (msg.includes('failed to fetch')) return "無法連線至後端翻譯伺服器。請確認後端程式是否已啟動。";
        if (msg.includes('quota') || msg.includes('billing')) return "API Key 已達用量上限或帳戶需要綁定付款方式。請更換金鑰。";
        if (msg.includes('api key not valid')) return "API Key 無效。請檢查 api_keys.txt 中的金鑰是否正確。";
        if (msg.includes('permission denied')) return "後端權限不足，無法寫入設定檔 (例如 custom_prompts.json)。";
        if (msg.includes('503')) return "所有 API Key 與模型均嘗試失敗，請檢查後端日誌以獲取詳細資訊。";
        return errorMessage;
    }
    
    let settings = {};

    // 功能: [v2.0] 獲取設定，並包含從 v1.x 到 v2.0 的資料庫自動遷移邏輯。
    async function loadSettings() {
        console.log('[v2.0] 開始載入設定...');
        
        const minimumDefaults = {
            fontSize: 22,
            showOriginal: true,
            showTranslated: true,
            fontFamily: 'Microsoft JhengHei, sans-serif'
        };

        try {
            // 【關鍵修正點】: v2.G - 一次性獲取所有 storage 資料，避免 get(['key']) 的不穩定
            const allStorageData = await chrome.storage.local.get(null);
            
            let currentSettings = allStorageData.ytEnhancerSettings;
            if (!currentSettings) {
                const response = await sendMessage({ action: 'getSettings' }); // Fallback
                currentSettings = response.data || {};
            }

            let needsSave = false; // 追蹤是否執行了遷移

            // 【關鍵修正點】開始: v2.0 資料庫遷移邏輯 (v2.G 修復版)
            if (currentSettings.preferred_langs) {
                console.log('[v2.0 Migration] 偵測到旧版設定 (preferred_langs)，正在執行資料庫遷移...');
                if (isOptionsPage) { 
                    showOptionsToast('偵測到舊版設定，正在升級資料庫...', 4000);
                }

                // 1. 【關鍵修正點】: 從 allStorageData 中安全地獲取 userPrompts
                const userPrompts = allStorageData.customPrompts; // 絕對讀取，如果不存在才是 undefined

                // 2. 正確合併 Prompt (以 DEFAULT 為基底，用 userPrompts 覆蓋)
                const mergedPrompts = { ...DEFAULT_CUSTOM_PROMPTS, ...userPrompts };
                
                // 3. 遷移 Tier 2 (自動翻譯列表)
                currentSettings.auto_translate_priority_list = currentSettings.preferred_langs.map(lang => {
                    const name = LANG_CODE_MAP[lang] || lang;
                    // 4. 從合併後的物件中取值
                    const customPrompt = mergedPrompts[lang] || NEW_LANGUAGE_PROMPT_TEMPLATE;
                    
                    return { langCode: lang, name: name, customPrompt: customPrompt };
                });

                // 5. 遷移 Tier 1 (原文顯示列表)
                currentSettings.native_langs = currentSettings.ignored_langs || ['zh-Hant'];

                // 6. 刪除舊屬性
                delete currentSettings.preferred_langs;
                delete currentSettings.ignored_langs;
                
                needsSave = true;

                // 7. [關鍵] 刪除舊的頂層 customPrompts 儲存金鑰
                await chrome.storage.local.remove('customPrompts');
                console.log('[v2.0 Migration] 舊的 customPrompts 鍵已移除。');
            }
            // 【關鍵修正點】結束

            settings = { ...minimumDefaults, ...currentSettings };
            
            if (needsSave) {
                console.log('[v2.0 Migration] 遷移完成，正在儲存 v2.0 設定...');
                await sendMessage({ action: 'updateSettings', data: settings });
            }
            
            if (isOptionsPage) {
                renderTier1Badges(settings.native_langs || []);
                renderTier2Accordions(settings.auto_translate_priority_list || []);
            }

            updateUI();

        } catch (e) {
            console.error('loadSettings 函式發生嚴重錯誤:', e);
            settings = minimumDefaults;
            updateUI();
        }
        console.log('[v2.0] 設定載入完畢。');
    }

    // 【關鍵修正點】: (Phase 2 Bug Fix) 替換此函式
    // 功能: [v2.2.0 修復] 將使用者在 UI 上的設定變動儲存到 background.js
    // input: showToast (boolean) - 是否顯示儲存提示
    // output: (Promise) 儲存操作
    // 其他補充: (Plan.md) 移除了 models_preference 的 DOM 讀取邏輯
    async function saveSettings(showToast = false) {
        // 功能: 將使用者在 UI 上的設定變動儲存到 background.js
        if (isOptionsPage) {
            // [v2.0] Tier 1/2 的 settings 已由各自的處理函式 (handleTier1Add/Remove, handleTier2SavePrompt, etc.) 即時更新
            
            // 【關鍵修正點】: (Phase 2 Bug Fix) 移除此行錯誤的覆蓋程式碼
            // const selectedList = document.getElementById('selected-models');
            // if (selectedList) { 
            //      settings.models_preference = [...selectedList.querySelectorAll('li')].map(li => li.dataset.id);
            // }
            // 說明: models_preference 陣列現在由 initializeSortableList (拖曳) 
            // 和 initializeModelSelector (新增/移除) 兩個監聽器自行更新，
            // saveSettings 只負責儲存。
        }
        
        await sendMessage({ action: 'updateSettings', data: settings });
        
        const tab = await getActiveTab();
        if (tab?.url?.includes("youtube.com")) {
            chrome.tabs.sendMessage(tab.id, { action: 'settingsChanged', settings: settings }).catch(() => {});
        }
        if (showToast && isOptionsPage) showOptionsToast('設定已儲存！');
    }
    // --- [v2.0] 核心函式 (步驟 2.E) ---
    function updateUI() {
        // 功能: 根據 settings 更新所有 UI 元件
        if (isOptionsPage) {
            // 【關鍵修正點】: (步驟 2.E) 移除舊的 updateListUI 和 ignored-lang-input 參照
            populateModelLists(); 
            const fontFamilySelect = document.getElementById('fontFamilySelect');
            if (fontFamilySelect) fontFamilySelect.value = settings.fontFamily;
        } else {
            // Popup 頁面邏輯
            const fontSizeSlider = document.getElementById('fontSizeSlider');
            if (fontSizeSlider) {
                fontSizeSlider.value = settings.fontSize ?? 22;
                document.getElementById('fontSizeValue').textContent = (settings.fontSize ?? 22) + 'px';
            }
            const showOriginal = document.getElementById('showOriginal');
            if (showOriginal) showOriginal.checked = settings.showOriginal ?? true;
            
            const showTranslated = document.getElementById('showTranslated');
            if (showTranslated) showTranslated.checked = settings.showTranslated ?? true;
        }
    }

    // --- Options Page 專屬邏輯 ---
    if (isOptionsPage) {

        // --- [保留] 頁籤 (Tab) 邏輯 ---
        const tabLinks = document.querySelectorAll('.tab-link');
        const tabContents = document.querySelectorAll('.tab-content');
        tabLinks.forEach(link => {
            link.addEventListener('click', () => {
                tabLinks.forEach(l => l.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                link.classList.add('active');
                document.getElementById(link.dataset.tab).classList.add('active');
            });
        });
        
        // 【關鍵修正點】: (Phase 2) 替換此函式
        // 功能: [v2.2.0 重構] 綁定模型偏好設定 UI (單一列表 + 標籤) 的事件
        // input: 無 (DOM 事件)
        // output: (DOM 事件綁定)
        // 其他補充: (Plan.md) 移除舊的雙列表邏輯，新增「添加」和「移除」事件
        function initializeModelSelector() {
            const selectedList = document.getElementById('selected-models');
            // 【關鍵修正點】: (Plan.md) 獲取新的標籤容器
            const availablePillsContainer = document.getElementById('available-model-pills');

            if (!selectedList || !availablePillsContainer) return; // [修復] 增加 null 檢查

            // 【關鍵修正點】: (Plan.md) 移除舊的 #add-model, #remove-model 監聽器
            // (DOM 元素已在 options.html 中被刪除)

            // 【關鍵修正點】: (Plan.md) 移除舊的 li.selected 點擊切換邏輯
            // (舊的 list.addEventListener('click', (e) => ... li.classList.toggle('selected') ...); 已被移除)

            // 【關鍵修正點】: (Plan.md) 保留拖曳排序功能
            initializeSortableList('selected-models', () => {
                // 拖曳結束後，從 DOM 讀取順序並儲存
                settings.models_preference = [...selectedList.querySelectorAll('li')].map(li => li.dataset.id);
                saveSettings(true); // 顯示提示
            });

            // 【關鍵修正點】: (Plan.md) 新增: 監聽「已選用列表」中的「移除」按鈕
            selectedList.addEventListener('click', (e) => {
                if (e.target.classList.contains('remove-model-item')) {
                    const modelId = e.target.dataset.id;
                    // 從陣列中移除
                    settings.models_preference = (settings.models_preference || []).filter(id => id !== modelId);
                    saveSettings(true); // 儲存並顯示提示
                    populateModelLists(); // 立即重繪兩個列表
                }
            });

            // 【關鍵修正點】: (Plan.md) 新增: 監聽「可添加模型」標籤的點擊
            availablePillsContainer.addEventListener('click', (e) => {
                if (e.target.classList.contains('add-model-pill')) {
                    const modelId = e.target.dataset.id;
                    if (!settings.models_preference) settings.models_preference = [];
                    // 添加到陣列末尾
                    settings.models_preference.push(modelId);
                    saveSettings(true); // 儲存並顯示提示
                    populateModelLists(); // 立即重繪兩個列表
                }
            });
        } 

        // 【關鍵修正點】: (Phase 2) 替換此函式
        // 功能: [v2.2.0 重構] 渲染「已選用模型」列表和「可添加模型」標籤
        // input: 無 (從 settings 讀取)
        // output: (DOM 操作) 更新 #selected-models 和 #available-model-pills
        // 其他補充: (Plan.md) 根據 settings.models_preference 動態分配模型到兩個容器
        function populateModelLists() {
            const selectedList = document.getElementById('selected-models');
            // 【關鍵修正點】: (Plan.md) 獲取新的標籤容器
            const availablePillsContainer = document.getElementById('available-model-pills');
            
            if (!selectedList || !availablePillsContainer) return; // [修復] 增加 null 檢查
            
            selectedList.innerHTML = '';
            availablePillsContainer.innerHTML = '';
            
            const preferred = settings.models_preference || [];
            const preferredSet = new Set(preferred);

            // 【關鍵修正點】: 1. 渲染「已選用模型」列表
            preferred.forEach(modelId => {
                if (ALL_MODELS[modelId]) {
                    // 使用 createModelListItem 建立帶有「移除」按鈕的 li
                    selectedList.appendChild(createModelListItem(modelId));
                }
            });

            // 【關鍵修正點】: 2. 渲染「可添加模型」標籤
            Object.keys(ALL_MODELS).forEach(modelId => {
                if (!preferredSet.has(modelId)) {
                    // (Plan.md) 動態生成 "Available Pills"
                    const pill = document.createElement('button');
                    pill.className = 'add-model-pill';
                    pill.dataset.id = modelId;
                    pill.textContent = `+ ${ALL_MODELS[modelId].name}`;
                    availablePillsContainer.appendChild(pill);
                }
            });
        }

        // 【關鍵修正點】: (Phase 2) 替換此函式
        // 功能: [v2.2.0 重構] 建立一個用於「已選用模型」列表的 li 元素 (含移除按鈕)
        // input: id (string) - 模型 ID (例如 'gemini-2.5-flash')
        // output: li (HTMLElement) - 包含移除按鈕的列表項
        function createModelListItem(id) {
            const li = document.createElement('li');
            li.dataset.id = id;
            li.draggable = true;
            // 【關鍵修正點】: (Plan.md) 新增 <div> 包裹內容，並添加「移除」按鈕
            li.innerHTML = `
                <div class="model-list-item-content">
                    <span>${ALL_MODELS[id].name}</span>
                    <span class="model-tooltip" title="${ALL_MODELS[id].tip}">?</span>
                </div>
                <button class="remove-model-item" data-id="${id}" title="移除">×</button>
            `;
            return li;
        }
        initializeModelSelector();
        
        // --- [保留] 進階外觀 ---
        const fontFamilySelect = document.getElementById('fontFamilySelect');
        if (fontFamilySelect) {
            fontFamilySelect.addEventListener('change', (e) => {
                settings.fontFamily = e.target.value;
                saveSettings(true);
            });
        }

        // 【關鍵修正點】: (Phase 1) 替換此函式
        // 功能: [v2.2.0] 讀取 userApiKeys 陣列並將其渲染為可編輯的 input 列表
        // input: 無 (從 chrome.storage.local 讀取)
        // output: (DOM 操作) 更新 #apiKeyList
        // 其他補充: (Plan.md) 最後會動態附加「+ 新增金鑰」按鈕
        async function loadAndRenderApiKeys() {
            const listElement = document.getElementById('apiKeyList');
            if (!listElement) return;
            try {
                const result = await chrome.storage.local.get(['userApiKeys']);
                const keys = result.userApiKeys || [];
                
                listElement.innerHTML = ''; // 清空列表
                
                if (keys.length === 0) {
                    // listElement.innerHTML = '<li style="color: var(--text-light-color); justify-content: center;">尚無金鑰</li>';
                    // (v2.2.0: 不顯示 "尚無金鑰"，直接顯示新增按鈕)
                }

                // 【關鍵修正點】: (Plan.md) 渲染已儲存的金鑰
                keys.forEach(key => {
                    const li = document.createElement('li');
                    li.className = 'api-key-item-saved'; // 標記為已儲存
                    li.innerHTML = `
                        <input type="text" class="key-name-input" value="${key.name || ''}" data-id="${key.id}" placeholder="金鑰名稱">
                        <input type="password" class="key-value-input" value="${key.key || ''}" data-id="${key.id}" placeholder="請在此貼上您的 Google API">
                        <button class="delete-key" data-id="${key.id}">刪除</button>
                    `;
                    listElement.appendChild(li);
                });

                // 【關鍵修正點】: (Plan.md) 在 ul 內部渲染「+ 新增金鑰」按鈕
                const addRow = document.createElement('li');
                addRow.className = 'add-key-row';
                addRow.innerHTML = `<button id="addNewKeyRowButton" class="button-secondary add-lang-button" style="width: 100%;">+ 新增金鑰</button>`;
                listElement.appendChild(addRow);

            } catch (e) {
                console.error('無法載入 API Keys:', e);
                listElement.innerHTML = '<li style="color: var(--danger-color);">載入金鑰失敗</li>';
            }
        }

        // 【關鍵修正點】: (Phase 1) 替換此函式
        // 功能: [v2.2.0 重構] 綁定金鑰管理區塊 (新增/刪除/更新) 的所有事件監聽器
        // input: 無 (DOM 事件)
        // output: (chrome.storage.local 操作)
        // 其他補充: (Plan.md) 採用事件委派模式，處理暫時列 (blur 儲存) 與已儲存列 (change 更新)
        function setupApiKeyListeners() {
            
            // 【關鍵修正點】: (Plan.md) 移除舊的 input 和 add-button 參照
            const listElement = document.getElementById('apiKeyList');
            if (!listElement) return;

            // --- 1. [v2.2.0] 點擊事件委派 (新增/刪除) ---
            listElement.addEventListener('click', async (e) => {
                const target = e.target;

                // [保留] 邏輯: 點擊「刪除」 (已儲存的金鑰)
                if (target.classList.contains('delete-key')) {
                    const keyId = target.dataset.id;
                    if (!keyId || !confirm('您確定要刪除此 API Key 嗎？')) return;
                    try {
                        target.disabled = true;
                        target.textContent = '刪除中...';
                        const result = await chrome.storage.local.get(['userApiKeys']);
                        let keys = (result.userApiKeys || []).filter(key => key.id !== keyId);
                        await chrome.storage.local.set({ userApiKeys: keys });
                        showOptionsToast('金鑰已成功刪除。');
                        await loadAndRenderApiKeys(); // 重繪
                    } catch (err) {
                        console.error('刪除 API Key 失敗:', err);
                        showOptionsToast('刪除金鑰時發生錯誤。', 5000);
                        await loadAndRenderApiKeys();
                    }
                }

                // [新增] 邏輯: 點擊「+ 新增金鑰」按鈕
                if (target.id === 'addNewKeyRowButton') {
                    // 檢查是否已存在暫時列，避免重複新增
                    const existingTempRow = listElement.querySelector('li.api-key-item-new');
                    if (existingTempRow) {
                        existingTempRow.querySelector('.new-key-name-input').focus();
                        return;
                    }
                    
                    const newLi = document.createElement('li');
                    newLi.className = 'api-key-item-new'; // 暫時 class
                    newLi.innerHTML = `
                        <input type="text" class="new-key-name-input" placeholder="金鑰名稱">
                        <input type="text" class="new-key-value-input" placeholder="請在此貼上您的 Google API">
                        <button class="delete-temp-row-button">刪除</button>
                    `;
                    // 插在「新增」按鈕之前
                    listElement.insertBefore(newLi, target.closest('li.add-key-row'));
                    newLi.querySelector('.new-key-name-input').focus();
                }

                // [新增] 邏輯: 點擊「刪除」 (暫時列)
                if (target.classList.contains('delete-temp-row-button')) {
                    target.closest('li.api-key-item-new').remove();
                }
            });

            // --- 2. [v2.2.0] 儲存 (on blur) 事件委派 (for 暫時列) ---
            // 使用 'blur' (capture: true) 來捕捉 input 失去焦點
            listElement.addEventListener('blur', async (e) => {
                const li = e.target.closest('li.api-key-item-new');
                if (!li) return; // 不是暫時列

                // 【關鍵修正點】: (Plan.md) 檢查焦點是否移出整個 li
                // relatedTarget 是焦點 *將要* 移往的元素
                const relatedTarget = e.relatedTarget;
                if (relatedTarget && li.contains(relatedTarget)) {
                    // 焦點仍在 li 內部 (例如: 切換 input, 點擊刪除鈕)，不儲存
                    return;
                }

                // 如果我們在這裡，表示焦點已移出 li
                const nameInput = li.querySelector('.new-key-name-input');
                const keyInput = li.querySelector('.new-key-value-input');

                // 【關鍵修正點】: (Plan.md) 兩者都必須有值才儲存
                if (nameInput.value.trim() && keyInput.value.trim()) {
                    const name = nameInput.value.trim();
                    const key = keyInput.value.trim();
                    
                    if (!key.startsWith('AIzaSy')) {
                        showOptionsToast('金鑰格式似乎不正確，請再次確認。', 4000);
                    }
                    
                    try {
                        // 顯示儲存中狀態 (暫時替換 li)
                        li.innerHTML = `<span>儲存中...</span>`;
                        
                        const newKey = { id: crypto.randomUUID(), name: name, key: key };
                        const result = await chrome.storage.local.get(['userApiKeys']);
                        const keys = result.userApiKeys || [];
                        keys.push(newKey);
                        await chrome.storage.local.set({ userApiKeys: keys });
                        
                        showOptionsToast(`金鑰 "${name}" 已成功新增！`);
                        await loadAndRenderApiKeys(); // 【關鍵修正點】: 儲存後立即重新渲染整個列表

                    } catch (err) {
                        console.error('新增 API Key 失敗:', err);
                        showOptionsToast('新增金鑰時發生錯誤，請檢查控制台日誌。', 5000);
                        await loadAndRenderApiKeys(); // 失敗也要重繪
                    }
                }
                // 如果任一為空，on blur 不做事，等待使用者刪除或填寫
            }, true); // 使用 capture: true

            // --- 3. [v2.2.0] 更新 (on change) 事件委派 (for 已儲存的金鑰) ---
            // 'change' 事件會在 input 失去焦點 *且* 值已改變時觸發
            listElement.addEventListener('change', async (e) => {
                const target = e.target;
                // 【關鍵修正點】: (Plan.md) 只響應 "已儲存" 金鑰的 input
                if (!target.classList.contains('key-name-input') && !target.classList.contains('key-value-input')) {
                    return;
                }
                
                const keyId = target.dataset.id;
                if (!keyId) return;

                try {
                    const result = await chrome.storage.local.get(['userApiKeys']);
                    const keys = result.userApiKeys || [];
                    const keyToUpdate = keys.find(k => k.id === keyId);

                    if (!keyToUpdate) return;
                    
                    let nameChanged = false;
                    if (target.classList.contains('key-name-input')) {
                        keyToUpdate.name = target.value.trim();
                        nameChanged = true;
                    } else {
                        keyToUpdate.key = target.value.trim();
                    }
                    
                    await chrome.storage.local.set({ userApiKeys: keys });
                    
                    // 只有在 key-value input (密碼框) 變更時才重設 type
                    if (target.classList.contains('key-value-input')) {
                        target.type = 'password';
                    }
                    
                    showOptionsToast(`金鑰 "${keyToUpdate.name}" 已更新。`);

                } catch (err) {
                    console.error('更新 API Key 失敗:', err);
                    showOptionsToast('更新金鑰時發生錯誤，請檢查控制台日誌。', 5000);
                }
            });
            
            // --- 4. [v2.2.0] 密碼框點擊顯示/隱藏 (UX 優化) ---
            // [新增] 點擊 (focusin) 密碼框時顯示文字
            listElement.addEventListener('focusin', (e) => {
                if (e.target.classList.contains('key-value-input')) {
                    e.target.type = 'text';
                }
            });
            // [新增] 移開 (focusout) 密碼框時隱藏文字
            listElement.addEventListener('focusout', (e) => {
                if (e.target.classList.contains('key-value-input')) {
                    e.target.type = 'password';
                }
            });
        }
        
        loadAndRenderApiKeys();
        setupApiKeyListeners();

        // --- [保留] 診斷與日誌 ---
        document.getElementById('clearCacheButton')?.addEventListener('click', async () => {
            const res = await sendMessage({ action: 'clearAllCache' });
            showOptionsToast(`成功清除了 ${res.count} 個影片的暫存！`);
        });
        
        document.getElementById('diagnoseKeysButton')?.addEventListener('click', async (e) => {
            e.target.disabled = true;
            e.target.textContent = '診斷中...';
            const resultsContainer = document.getElementById('diagnose-results');
            resultsContainer.innerHTML = '';
            try {
                 const results = await sendMessage({ action: 'diagnoseAllKeys' }); 
                 if (!results) throw new Error('背景服務未回傳診斷結果。');
                 resultsContainer.innerHTML = ''; 
                 if (results.length === 0) {
                     resultsContainer.innerHTML = `<div class="diag-result status-invalid">未在瀏覽器儲存區找到可診斷的 API Key。</div>`;
                 } else {
                     results.forEach(res => {
                        const resultEl = document.createElement('div');
                        resultEl.className = `diag-result status-${res.status}`;
                        resultEl.innerHTML = `<strong>${res.name}:</strong> ${res.status === 'valid' ? '有效' : '無效'}`; 
                        if(res.error) {
                            resultEl.title = res.error; 
                            resultEl.innerHTML += ` - ${res.error.substring(0, 50)}...`;
                        }
                        resultsContainer.appendChild(resultEl);
                    });
                 }
            } catch(err) {
                 const userFriendlyError = translateToFriendlyError(err.message);
                 resultsContainer.innerHTML = `<div class="diag-result status-invalid">診斷失敗：${userFriendlyError}</div>`;
            } finally {
                e.target.disabled = false;
                e.target.textContent = '開始診斷所有金鑰'; 
            }
        });
        
        async function loadErrorLogs() {
            // 功能: (已修改) 從 background.js 獲取錯誤日誌並顯示在診斷頁面。
            // input from: (自動執行)
            // output to: (DOM 操作) #error-log-container
            // 其他補充: 【關鍵修正點】 v1.1 - 重寫以渲染豐富的 LogEntry 物件
            const logContainer = document.getElementById('error-log-container');
            if (!logContainer) return;
            const response = await sendMessage({ action: 'getErrorLogs' }); 
            if (response.success && response.data && response.data.length > 0) {
                logContainer.innerHTML = ''; 
                response.data.forEach(log => {
                    const entryEl = document.createElement('div');
                    entryEl.className = `log-entry log-level-${log.level.toLowerCase()}`; 
                    let detailsHtml = '';
                    if (log.context) detailsHtml += `<div><strong>[原始錯誤]</strong> ${log.context}</div>`;
                    if (log.solution) detailsHtml += `<div><strong>[建議]</strong> ${log.solution}</div>`;
                    entryEl.innerHTML = `
                        <div class="log-header">
                            <span class="log-time">[${new Date(log.timestamp).toLocaleTimeString()}]</span>
                            <span class="log-message">${log.message}</span>
                        </div>
                        ${detailsHtml ? `<div class="log-details">${detailsHtml}</div>` : ''}
                    `;
                    logContainer.appendChild(entryEl);
                });
            } else {
                 logContainer.innerHTML = '<p class="log-placeholder">目前沒有持續性錯誤紀錄。</p>'; 
            }
        }
        loadErrorLogs();

        // --- [v2.0] Tier 1: 原文顯示 (Badge/Token) 邏輯 (步驟 2.C) ---
        // 【關鍵修正點】: v2.1 - 完全重寫 Tier 1 邏輯以支援拖曳排序

        // 功能: [v2.1] 將 native_langs 陣列渲染為可拖曳的 <li> 列表
        function renderTier1Badges(langs = []) {
            const container = document.getElementById('tier-1-badge-list');
            if (!container) return; 
            container.innerHTML = ''; 
            langs.forEach(langCode => {
                const langName = LANGUAGE_DATABASE.find(L => L.code === langCode)?.name || langCode;
                const li = document.createElement('li'); // 替換為 li
                li.className = 'lang-badge-item'; // 使用 li 樣式 (css 中已定義)
                li.dataset.langCode = langCode;
                li.draggable = true; 
                
                li.innerHTML = `
                    <span class="drag-handle" title="拖曳調整優先級">⋮⋮</span>
                    <span>${langName} (${langCode})</span>
                    <button class="remove-badge" data-lang="${langCode}" title="移除">×</button>
                `;
                container.appendChild(li);
            });

            // 【關鍵修正點】: v2.1 - 綁定拖曳排序功能
            initializeSortableList('tier-1-badge-list', saveTier1Settings);
        }

        // 功能: [v2.1.2 修正] 儲存 Tier 1 列表的當前 DOM 順序
        async function saveTier1Settings(showToast = false) {
            const listElement = document.getElementById('tier-1-badge-list');
            if (!listElement) return;

            // 根據 DOM 順序讀取 langCode
            const newList = [...listElement.querySelectorAll('li')].map(li => li.dataset.langCode);
            
            // 【關鍵修正點】: 移除錯誤的 if 檢查。
            // 必須無條件以 DOM 的當前狀態為準，更新全域 settings 並儲存。
            const hasChanged = JSON.stringify(settings.native_langs) !== JSON.stringify(newList);
            
            settings.native_langs = newList;
            await saveSettings(showToast); // 呼叫通用的儲存函式
            
            // 僅在真正發生變更時才顯示提示 (避免拖曳後放回原位也跳提示)
            if (showToast && hasChanged) {
                showOptionsToast('原文語言優先級已更新！', 3000);
            }
        }

        // 功能: [v2.1] 處理新增語言到 Tier 1
        function handleTier1Add() {
            openLanguagePopover((selectedLang) => {
                if (!settings.native_langs) settings.native_langs = [];
                if (settings.native_langs.includes(selectedLang.code)) {
                    showOptionsToast(`語言 "${selectedLang.name}" 已存在於清單 A 中`, 3000);
                    return;
                }
                if (settings.auto_translate_priority_list?.some(item => item.langCode === selectedLang.code)) {
                    if (confirm(`"${selectedLang.name}" 已在「清單 B (自動翻譯)」中。\n\n您確定要將它移至「清單 A (原文顯示)」嗎？`)) {
                        settings.auto_translate_priority_list = settings.auto_translate_priority_list.filter(item => item.langCode !== selectedLang.code);
                        renderTier2Accordions(settings.auto_translate_priority_list); 
                    } else {
                        return; 
                    }
                }
                
                settings.native_langs.push(selectedLang.code);
                renderTier1Badges(settings.native_langs); 
                saveTier1Settings(false); // 【關鍵修正點】: 呼叫 saveTier1Settings 而不是 saveSettings
                
                showOptionsToast(`已新增 "${selectedLang.name}" 到清單 A`, 3000);
            });
        }

        // 功能: [v2.1] 處理從 Tier 1 移除語言
        function handleTier1Remove(langCode) {
            settings.native_langs = (settings.native_langs || []).filter(lang => lang !== langCode);
            renderTier1Badges(settings.native_langs);
            saveTier1Settings(false); // 【關鍵修正點】: 呼叫 saveTier1Settings 而不是 saveSettings
            showOptionsToast(`已從清單 A 移除 (${langCode})`, 3000);
        }

        // --- [v2.0] Tier 2: 自動翻譯 (Accordion) 邏輯 (步驟 2.C) ---
        function renderTier2Accordions(list = []) {
            const container = document.getElementById('tier-2-accordion-list');
            if (!container) return; 
            container.innerHTML = ''; 
            
            list.forEach((item, index) => {
                const li = document.createElement('li');
                li.className = 'accordion-item';
                li.dataset.langCode = item.langCode;
                li.draggable = true; 

                const langName = item.name || LANGUAGE_DATABASE.find(L => L.code === item.langCode)?.name || item.langCode;

                li.innerHTML = `
                    <div class="accordion-header">
                        <span class="drag-handle" title="拖曳調整優先級">⋮⋮</span>
                        <span class="priority-badge">優先級 ${index + 1}</span>
                        <span class="lang-name">${langName} (${item.langCode})</span>
                        <div class="accordion-controls">
                            <span class="toggle-icon" title="編輯 Prompt">▼</span>
                            <span class="delete-item" title="刪除">×</span>
                        </div>
                    </div>
                    <div class="accordion-content">
                        <h3 class="card-subtitle" style="margin-top: 0; margin-bottom: 8px;">自訂 Prompt (${langName})</h3>
                        <textarea class="prompt-textarea" rows="10" placeholder="請輸入此語言專屬的風格指南與專有名詞對照表...">${item.customPrompt || ''}</textarea>
                        <div class="accordion-prompt-controls">
                            <button class="button-secondary cancel-prompt-button">取消</button>
                            <button class="button-primary save-prompt-button">儲存 Prompt</button>
                        </div>
                    </div>
                `;
                container.appendChild(li);
            });
            
            initializeSortableList('tier-2-accordion-list', () => {
                const listElement = document.getElementById('tier-2-accordion-list');
                const newList = [...listElement.querySelectorAll('.accordion-item')].map(item => {
                    const langCode = item.dataset.langCode;
                    return settings.auto_translate_priority_list.find(L => L.langCode === langCode);
                });
                settings.auto_translate_priority_list = newList;
                renderTier2Accordions(settings.auto_translate_priority_list); 
                saveSettings(true); 
                showOptionsToast('優先級已更新！', 3000);
            });
        }

        function handleTier2Add() {
            openLanguagePopover((selectedLang) => {
                if (!settings.auto_translate_priority_list) settings.auto_translate_priority_list = [];
                if (settings.auto_translate_priority_list.some(item => item.langCode === selectedLang.code)) {
                    showOptionsToast(`語言 "${selectedLang.name}" 已存在於清單 B 中`, 3000);
                    return;
                }
                if (settings.native_langs?.includes(selectedLang.code)) {
                    if (confirm(`"${selectedLang.name}" 已在「清單 A (原文顯示)」中。\n\n您確定要將它移至「清單 B (自動翻譯)」嗎？`)) {
                        settings.native_langs = settings.native_langs.filter(lang => lang !== selectedLang.code);
                        renderTier1Badges(settings.native_langs); 
                    } else {
                        return; 
                    }
                }
                const newItem = {
                    langCode: selectedLang.code,
                    name: selectedLang.name,
                    customPrompt: NEW_LANGUAGE_PROMPT_TEMPLATE 
                };
                settings.auto_translate_priority_list.push(newItem);
                renderTier2Accordions(settings.auto_translate_priority_list); 
                const newItemElement = document.querySelector(`.accordion-item[data-lang-code="${selectedLang.code}"]`);
                if (newItemElement) {
                    handleTier2Expand(newItemElement);
                    newItemElement.querySelector('textarea').focus(); 
                }
                saveSettings(true); 
                showOptionsToast(`已新增 "${selectedLang.name}" 到清單 B`, 3000);
            });
        }

        function handleTier2Remove(langCode) {
            if (confirm(`您確定要刪除 (${langCode}) 的自動翻譯設定嗎？`)) {
                settings.auto_translate_priority_list = (settings.auto_translate_priority_list || []).filter(item => item.langCode !== langCode);
                renderTier2Accordions(settings.auto_translate_priority_list);
                saveSettings(true); 
                showOptionsToast(`已從清單 B 移除 (${langCode})`, 3000);
            }
        }

        function handleTier2Expand(itemElement) {
            const isExpanded = itemElement.classList.contains('expanded');
            document.querySelectorAll('#tier-2-accordion-list .accordion-item').forEach(item => {
                item.classList.remove('expanded');
            });
            if (!isExpanded) {
                itemElement.classList.add('expanded');
            }
        }

        function handleTier2SavePrompt(langCode, itemElement) {
            const textarea = itemElement.querySelector('.prompt-textarea');
            const newPrompt = textarea.value;
            const itemInSettings = settings.auto_translate_priority_list.find(item => item.langCode === langCode);
            if (itemInSettings) {
                itemInSettings.customPrompt = newPrompt;
                saveSettings(true); 
                showOptionsToast(`(${langCode}) 的 Prompt 已儲存！`, 3000);
                handleTier2Expand(itemElement); 
            } else {
                showOptionsToast(`儲存失敗：找不到 ${langCode} 的設定`, 4000);
            }
        }

        // --- [v2.0] Popover: 語言搜尋 (共用) 邏輯 (步驟 2.C) ---
        let currentPopoverCallback = null;

        function openLanguagePopover(onSelectCallback) {
            currentPopoverCallback = onSelectCallback;
            const popover = document.getElementById('language-search-popover');
            const searchInput = document.getElementById('language-search-input');
            searchInput.value = '';
            renderLanguageSearchResults(''); 
            popover.style.display = 'flex';
            searchInput.focus(); 
        }

        function closeLanguagePopover() {
            const popover = document.getElementById('language-search-popover');
            popover.style.display = 'none';
            currentPopoverCallback = null;
        }

        function renderLanguageSearchResults(query) {
            const resultsContainer = document.getElementById('language-search-results');
            resultsContainer.innerHTML = '';
            const lowerQuery = query.toLowerCase().trim();
            const filteredLangs = LANGUAGE_DATABASE.filter(lang => 
                lowerQuery === '' || lang.search.some(term => term.toLowerCase().includes(lowerQuery))
            );
            if (filteredLangs.length === 0) {
                resultsContainer.innerHTML = '<li>無匹配結果</li>';
                return;
            }
            const disabledTier1 = new Set(settings.native_langs || []);
            const disabledTier2 = new Set((settings.auto_translate_priority_list || []).map(item => item.langCode));

            filteredLangs.forEach(lang => {
                const li = document.createElement('li');
                li.dataset.langCode = lang.code;
                li.dataset.langName = lang.name;
                let isDisabled = false;
                let reason = '';
                if (currentPopoverCallback === handleTier1Add && disabledTier1.has(lang.code)) {
                    isDisabled = true;
                    reason = '(已在清單 A)';
                } else if (currentPopoverCallback === handleTier2Add && disabledTier2.has(lang.code)) {
                    isDisabled = true;
                    reason = '(已在清單 B)';
                }
                li.innerHTML = `<span class="lang-name">${lang.name}</span> <span class="lang-code">${lang.code} ${reason}</span>`;
                if (isDisabled) li.classList.add('disabled');
                resultsContainer.appendChild(li);
            });
        }

        // --- [v2.0] 綁定所有 v2.0 事件監聽器 (步驟 2.C) ---
        document.getElementById('tier-1-add-button')?.addEventListener('click', handleTier1Add);
        
        // 【關鍵修正點】: v2.1 - 修改監聽器以適配 ul > li 結構
        document.getElementById('tier-1-badge-list')?.addEventListener('click', (e) => {
            const removeButton = e.target.closest('.remove-badge');
            if (removeButton) {
                handleTier1Remove(removeButton.dataset.lang);
            }
        });

        document.getElementById('tier-2-add-button')?.addEventListener('click', handleTier2Add);
        document.getElementById('tier-2-accordion-list')?.addEventListener('click', (e) => {
            const target = e.target;
            const header = target.closest('.accordion-header');
            const item = target.closest('.accordion-item');
            if (!item) return;
            const langCode = item.dataset.langCode;
            if (target.classList.contains('delete-item')) {
                handleTier2Remove(langCode);
            } else if (target.classList.contains('save-prompt-button')) {
                handleTier2SavePrompt(langCode, item);
            } else if (target.classList.contains('cancel-prompt-button')) {
                renderTier2Accordions(settings.auto_translate_priority_list);
            } else if (header) {
                handleTier2Expand(item);
            }
        });

        const popover = document.getElementById('language-search-popover');
        popover?.addEventListener('click', (e) => {
            if (e.target.id === 'language-search-popover') {
                closeLanguagePopover();
            }
            const li = e.target.closest('li');
            if (li && !li.classList.contains('disabled') && currentPopoverCallback) {
                currentPopoverCallback({
                    code: li.dataset.langCode,
                    name: li.dataset.langName
                });
                closeLanguagePopover();
            }
        });
        document.getElementById('language-search-input')?.addEventListener('input', (e) => {
            renderLanguageSearchResults(e.target.value);
        });
        // --- [v2.0] 事件監聽器結束 ---

    } else {
        // --- Popup Page 專屬邏輯 ---
        const toggleButton = document.getElementById('toggleButton');
        const statusText = document.getElementById('status');
        
        async function updatePopupStatus() {
            const tab = await getActiveTab();
            if (tab?.url?.includes("youtube.com")) {
                toggleButton.disabled = false;
                const response = await sendMessage({ action: 'getGlobalState' });
                const isEnabled = response?.isEnabled ?? false; 
                toggleButton.textContent = isEnabled ? '停用翻譯' : '啟用翻譯';
                toggleButton.classList.toggle('active', isEnabled);
                statusText.textContent = isEnabled ? '已啟用' : '未啟用';
            } else {
                toggleButton.disabled = true;
                toggleButton.textContent = '請在 YouTube 頁面使用';
                statusText.textContent = '...';
            }
        }
        toggleButton.addEventListener('click', async () => {
            const response = await sendMessage({ action: 'toggleGlobalState' });
            const isEnabled = response?.isEnabled ?? false; 
            toggleButton.textContent = isEnabled ? '停用翻譯' : '啟用翻譯';
            toggleButton.classList.toggle('active', isEnabled);
            statusText.textContent = isEnabled ? '已啟用' : '未啟用';
        });
        updatePopupStatus();

        document.getElementById('fontSizeSlider').addEventListener('input', e => {
            document.getElementById('fontSizeValue').textContent = e.target.value + 'px';
        });
        document.getElementById('fontSizeSlider').addEventListener('change', e => {
            settings.fontSize = parseInt(e.target.value, 10);
            saveSettings();
        });
        document.getElementById('showOriginal').addEventListener('change', e => {
            settings.showOriginal = e.target.checked;
            saveSettings();
        });
        document.getElementById('showTranslated').addEventListener('change', e => {
            settings.showTranslated = e.target.checked;
            saveSettings();
        });
        
        const forceRerunButton = document.getElementById('forceRerunButton');
        forceRerunButton.addEventListener('click', async () => {
            const tab = await getActiveTab();
            if (tab) chrome.tabs.sendMessage(tab.id, { action: 'forceRerun' });
            forceRerunButton.textContent = '指令已發送 ✓';
            forceRerunButton.disabled = true;
            setTimeout(() => window.close(), 800);
        });
        
        const overrideSelect = document.getElementById('overrideLanguageSelect');
        if (overrideSelect) {
            overrideSelect.addEventListener('change', async (e) => {
                if (e.target.value === 'auto') return;
                const tab = await getActiveTab();
                if (tab) {
                    chrome.tabs.sendMessage(tab.id, { action: 'translateWithOverride', language: e.target.value });
                }
                statusText.textContent = '語言覆蓋指令已發送...';
                setTimeout(() => window.close(), 800);
            });
        }
        
        async function loadAvailableLangs() {
            // 【關鍵修正點】: v2.0 - overrideSelect 已被廢除，安全檢查
            if (!overrideSelect) return; 
            
            const response = await sendMessage({ action: 'getAvailableLangs' });
            overrideSelect.innerHTML = '<option value="auto">自動 (推薦)</option>';
            if (response.success && response.data && Array.isArray(response.data) && response.data.length > 0) {
                response.data.forEach(lang => {
                    const option = document.createElement('option');
                    option.value = lang;
                    option.textContent = LANG_CODE_MAP[lang] ? `${LANG_CODE_MAP[lang]} (${lang})` : lang;
                    overrideSelect.appendChild(option);
                });
                overrideSelect.disabled = false; 
            } else {
                const placeholderOption = document.createElement('option');
                placeholderOption.value = 'none';
                placeholderOption.textContent = '無可用語言';
                placeholderOption.disabled = true;
                overrideSelect.appendChild(placeholderOption);
                overrideSelect.disabled = true;
            }
        }
        loadAvailableLangs();

        document.getElementById('openOptionsButton').addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });
    }

    // --- 通用初始化 ---
    loadSettings();

    // --- 通用輔助函式 ---
    function initializeSortableList(listId, onSortEndCallback) {
        const list = document.getElementById(listId);
        if (!list) return;
        let draggingElement = null;
        list.addEventListener('dragstart', e => {
            if (e.target.tagName !== 'LI') return;
            draggingElement = e.target;
            setTimeout(() => e.target.classList.add('dragging'), 0);
        });
        list.addEventListener('dragend', () => {
            if (!draggingElement) return;
            draggingElement.classList.remove('dragging');
            draggingElement = null;
            onSortEndCallback();
        });
        list.addEventListener('dragover', e => {
            e.preventDefault();
            if (!draggingElement) return;
            const afterElement = getDragAfterElement(list, e.clientY);
            if (afterElement == null) {
                list.appendChild(draggingElement);
            } else {
                list.insertBefore(draggingElement, afterElement);
            }
        });
    }

    function getDragAfterElement(container, y) {
        const draggable = [...container.querySelectorAll('li:not(.dragging)')];
        return draggable.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    let toastTimeout = null;
    function showOptionsToast(message, duration = 3000) {
        const toast = document.getElementById('options-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
    }
});