/**
 * @file popup.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 2.1.0
 *
 * Handles logic for both popup.html (Remote Control) and options.html (Admin Panel).
 */

document.addEventListener('DOMContentLoaded', () => {
    // 功能: 整個 popup.html 和 options.html 腳本的啟動入口。
    // input: (DOM 事件)
    // output: 無
    // 其他補充: 確保在頁面 DOM 元素都載入完成後才執行腳本。
    const isOptionsPage = document.body.style.width === 'auto';

    const LANG_CODE_MAP = {
        'ja': '日文', 'ko': '韓文', 'en': '英文',
        'zh-Hant': '繁體中文', 'zh-Hans': '簡體中文',
        'vi': '越南文', 'th': '泰文', 'id': '印尼文',
        'es': '西班牙文', 'fr': '法文', 'de': '德文', 'ru': '俄文',
        'zh-TW': '繁體中文 (台灣)', 'zh-CN': '簡體中文 (中國)', 'zh-HK': '繁體中文 (香港)'
    };

    const ALL_MODELS = {
        'gemini-2.5-pro': { name: 'Gemini 2.5 Pro', tip: '最高品質，適合複雜推理任務。' },
        'gemini-2.5-flash': { name: 'Gemini 2.5 Flash', tip: '效能與速度的平衡點。' },
        'gemini-2.5-flash-lite': { name: 'Gemini 2.5 Flash-Lite', tip: '速度極快，適合高頻率即時回應。' },
        'gemini-2.0-flash': { name: 'Gemini 2.0 Flash', tip: '舊版高速模型。' },
        'gemini-2.0-flash-lite': { name: 'Gemini 2.0 Flash-Lite', tip: '舊版最快模型。' }
    };
    
    const EXAMPLE_PROMPT_CONTENT = `**風格指南:**
- 翻譯需符合台灣人的說話習慣，使用台灣慣用語。
- 保留說話者（例如：偶像、實況主）活潑或溫柔的語氣。

**人名/專有名詞對照表 (優先級最高):**
- しそん じゅん -> 志尊淳
- さとう たける -> 佐藤健
- まちだ けいた -> 町田啟太
`;

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
- 菅田將暉 -> 菅田將暉
- ノブ -> ノブ
`,
        "ko": "--- 韓文自訂 Prompt (請在此輸入風格與對照表) ---",
        "en": "--- 英文自訂 Prompt (請在此輸入風格與對照表) ---"
    };

    // --- 通用函數 ---
    const sendMessage = (message) => chrome.runtime.sendMessage(message);
        // 功能: 向 background.js 發送訊息的簡化輔助函式。
    const getActiveTab = async () => {
        // 功能: 獲取當前使用者正在檢視的分頁。
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    };
    
    function translateToFriendlyError(errorMessage) {
        // 功能: 將後端或網路層返回的技術性錯誤訊息，轉換為使用者看得懂的友善提示。
        const msg = String(errorMessage).toLowerCase();
        if (msg.includes('failed to fetch')) {
            return "無法連線至後端翻譯伺服器。請確認後端程式是否已啟動。";
        }
        if (msg.includes('quota') || msg.includes('billing')) {
            return "API Key 已達用量上限或帳戶需要綁定付款方式。請更換金鑰。";
        }
        if (msg.includes('api key not valid')) {
            return "API Key 無效。請檢查 api_keys.txt 中的金鑰是否正確。";
        }
        if (msg.includes('permission denied')) {
            return "後端權限不足，無法寫入設定檔 (例如 custom_prompts.json)。";
        }
        if (msg.includes('503')) {
            return "所有 API Key 與模型均嘗試失敗，請檢查後端日誌以獲取詳細資訊。";
        }
        return errorMessage;
    }
    
    let settings = {};

    async function loadSettings() {
        // 功能: (偵錯模式) 獲取設定，並將收到的原始資料和最終處理結果都印出來。
        console.log('--- 開始載入設定 ---');
        try {
            const response = await sendMessage({ action: 'getSettings' });
            
            // 【關鍵偵錯點】 1: 印出從 background.js 收到的最原始的回應
            console.log('1. 從 background.js 收到的原始 response:', response);

            const minimumDefaults = {
                fontSize: 22,
                showOriginal: true,
                showTranslated: true,
            };

            if (response?.success) {
                settings = { ...minimumDefaults, ...response.data };
                
                // 【關鍵偵錯點】 2: 印出即將用於更新 UI 的最終 settings 物件
                console.log('2. 合併後的最終 settings 物件:', settings);

                updateUI();
            } else {
                settings = minimumDefaults;
                console.log('X. 載入失敗，使用預設 settings 物件:', settings);
                updateUI();
            }
        } catch (e) {
            console.error('loadSettings 函式發生嚴重錯誤:', e);
        }
        console.log('--- 設定載入完畢 ---');
    }

    async function saveSettings(showToast = false) {
        // 功能: 將使用者在 UI 上的設定變動儲存到 background.js，並通知 content.js 即時更新。
        // input from: UI 元件的事件 (例如拖曳、點擊)
        // output to: background.js -> updateSettings
        //            content.js -> settingsChanged (透過 background.js 廣播)
        if (isOptionsPage) {
            const selectedList = document.getElementById('selected-models');
            settings.models_preference = [...selectedList.querySelectorAll('li')].map(li => li.dataset.id);
        }
        
        // 【關鍵修正點】: 修正：使用 { data: settings } 結構傳輸，與 background.js 期待的 updateSettings 結構一致。
        await sendMessage({ action: 'updateSettings', data: settings });
        
        const tab = await getActiveTab();
        if (tab?.url?.includes("youtube.com")) {
            // 【關鍵修正點】: 修正：sendMessage 的參數必須是 { action: ..., settings: ... }，而不是直接傳遞 settings。
            chrome.tabs.sendMessage(tab.id, { action: 'settingsChanged', settings: settings }).catch(() => {});
        }
        if (showToast && isOptionsPage) showOptionsToast('設定已儲存！');
    }

    function updateUI() {
        // 功能: 根據 settings 全域變數的內容，更新 popup 或 options 頁面上所有 UI 元件的狀態（例如滑桿位置、勾選框狀態等）。
        // input: (全域變數) settings
        // output: (DOM 操作)
        if (isOptionsPage) {
            updateListUI('preferred-lang-list', settings.preferred_langs);
            document.getElementById('ignored-lang-input').value = (settings.ignored_langs || []).join(', ');
            populateModelLists(); 
            document.getElementById('fontFamilySelect').value = settings.fontFamily;
        } else {
            // 【關鍵修正點】: 針對 Popup UI 元素，安全地讀取設定，預設為 true/22
            document.getElementById('fontSizeSlider').value = settings.fontSize ?? 22;
            document.getElementById('fontSizeValue').textContent = (settings.fontSize ?? 22) + 'px';
            
            // 【關鍵修正點】: 處理布林值時，使用 ?? true 確保預設勾選，解決問題 4
            document.getElementById('showOriginal').checked = settings.showOriginal ?? true; 
            document.getElementById('showTranslated').checked = settings.showTranslated ?? true;
        }
    }

    // --- Options Page 專屬邏輯 ---
    if (isOptionsPage) {
        const promptTextarea = document.getElementById('customPromptTextarea');

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
        
        function initializeModelSelector() {
            // 功能: 初始化「模型偏好設定」區塊的 UI 和事件監聽。
            const selectedList = document.getElementById('selected-models');
            const availableList = document.getElementById('available-models');

            document.getElementById('add-model').addEventListener('click', () => {
                moveSelectedItems(availableList, selectedList);
            });
            document.getElementById('remove-model').addEventListener('click', () => {
                moveSelectedItems(selectedList, availableList);
            });

            [selectedList, availableList].forEach(list => {
                list.addEventListener('click', (e) => {
                    const li = e.target.closest('li');
                    if (li) {
                        li.classList.toggle('selected');
                    }
                });
            });
            
            initializeSortableList('selected-models', () => saveSettings(true));
        }

        function moveSelectedItems(fromList, toList) {
            // 功能: 處理在「已選用」和「可用」模型列表之間移動選項的邏輯。
            fromList.querySelectorAll('li.selected').forEach(item => {
                item.classList.remove('selected');
                toList.appendChild(item);
            });
            saveSettings(true);
        }

        function populateModelLists() {
            // 功能: 根據 settings 中的模型偏好，將模型動態填入兩個列表中。
            const selectedList = document.getElementById('selected-models');
            const availableList = document.getElementById('available-models');
            selectedList.innerHTML = '';
            availableList.innerHTML = '';
            const preferred = settings.models_preference || [];
            const preferredSet = new Set(preferred);

            preferred.forEach(modelId => {
                if (ALL_MODELS[modelId]) {
                    selectedList.appendChild(createModelListItem(modelId));
                }
            });
            Object.keys(ALL_MODELS).forEach(modelId => {
                if (!preferredSet.has(modelId)) {
                    availableList.appendChild(createModelListItem(modelId));
                }
            });
        }

        function createModelListItem(id) {
            // 功能: 創建單個模型選項的 HTML 元素。
            const li = document.createElement('li');
            li.dataset.id = id;
            li.draggable = true;
            li.innerHTML = `<span>${ALL_MODELS[id].name}</span><span class="model-tooltip" title="${ALL_MODELS[id].tip}">?</span>`;
            return li;
        }
        initializeModelSelector();

        // 語言偏好列表的拖曳
        initializeSortableList('preferred-lang-list', () => {
            const list = document.getElementById('preferred-lang-list');
            settings.preferred_langs = [...list.querySelectorAll('li')].map(li => li.dataset.id);
            saveSettings(true);
        });

        // 忽略列表輸入
        document.getElementById('ignored-lang-input').addEventListener('change', (e) => {
            settings.ignored_langs = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
            saveSettings(true);
        });

        // Prompt 管理
        let allCustomPrompts = {};
        const promptSelect = document.getElementById('promptLanguageSelect');
        async function loadCustomPrompts() {
            // 功能: (已修改) 從 chrome.storage.local 獲取已儲存的自訂 Prompts
            // 其他補充: 【關鍵修正點】 v1.1 - 移除 fetch，改用 chrome.storage.local.get
            try {
                const result = await chrome.storage.local.get(['customPrompts']); //
                // 如果 storage 為空，則使用從 backend.py 移植過來的預設值
                allCustomPrompts = result.customPrompts || DEFAULT_CUSTOM_PROMPTS; //
                updatePromptTextarea();
            } catch (e) {
                console.error('無法載入自訂 Prompts:', e);
                promptTextarea.value = '無法從瀏覽器儲存區載入 Prompts。';
                promptTextarea.disabled = true;
                showOptionsToast(`載入 Prompts 失敗：${e.message}`, 5000);
            }
        }
        const updatePromptTextarea = () => {
            // 功能: 根據語言下拉選單的選擇，更新編輯區顯示的 Prompt 內容。
            promptTextarea.value = allCustomPrompts[promptSelect.value] || '';
        };
        promptSelect.addEventListener('change', updatePromptTextarea);
        document.getElementById('savePromptButton').addEventListener('click', async (e) => {
            // 功能: (已修改) 儲存自訂 Prompts 到 chrome.storage.local
            // 其他補充: 【關鍵修正點】 v1.1 - 移除 fetch，改用 chrome.storage.local.set
            const button = e.target;
            button.disabled = true;
            button.textContent = '儲存中...';
            allCustomPrompts[promptSelect.value] = promptTextarea.value;
            try {
                await chrome.storage.local.set({ customPrompts: allCustomPrompts }); //
                showOptionsToast('Prompt 已成功儲存！'); //
            } catch (err) {
                const userFriendlyError = translateToFriendlyError(err.message);
                showOptionsToast(`儲存 Prompt 失敗：${userFriendlyError}`, 5000);
            } finally {
                button.disabled = false;
                button.textContent = '儲存 Prompt';
            }
        });
        document.getElementById('resetPromptButton').addEventListener('click', () => {
            promptTextarea.value = '';
        });
        loadCustomPrompts();
        
        function syncExampleToClipboard() {
            // 功能: 複製 Prompt 範例到使用者的剪貼簿。
            navigator.clipboard.writeText(EXAMPLE_PROMPT_CONTENT).then(() => {
                showOptionsToast('範例格式已複製！請直接在編輯區貼上。');
            }).catch(err => {
                console.error('無法寫入剪貼簿:', err);
                showOptionsToast('複製失敗！', 5000);
            }).finally(() => {
                promptTextarea.focus();
            });
        }
        document.getElementById('syncPromptExample').addEventListener('click', syncExampleToClipboard);
        
        // 進階外觀
        document.getElementById('fontFamilySelect').addEventListener('change', (e) => {
            settings.fontFamily = e.target.value;
            saveSettings(true);
        });

        // 【關鍵修正點】: 根據規格 1.A，新增 API 金鑰管理邏輯
        // 功能: 讀取 userApiKeys 陣列並將其渲染到 UI 列表
        // input: 無 (從 chrome.storage.local 讀取)
        // output: (DOM 操作) 更新 #apiKeyList
        // 其他補充: [規格 1.A] 的核心 UI 渲染函式
        async function loadAndRenderApiKeys() {
            const listElement = document.getElementById('apiKeyList');
            if (!listElement) return;

            try {
                const result = await chrome.storage.local.get(['userApiKeys']);
                const keys = result.userApiKeys || [];

                listElement.innerHTML = ''; // 清空現有列表

                if (keys.length === 0) {
                    listElement.innerHTML = '<li style="color: var(--text-light-color); justify-content: center;">尚無金鑰</li>';
                    return;
                }

                keys.forEach(key => {
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <span class="api-key-name">${key.name || '未命名金鑰'}</span>
                        <button class="delete-key" data-id="${key.id}">刪除</button>
                    `;
                    listElement.appendChild(li);
                });
            } catch (e) {
                console.error('無法載入 API Keys:', e);
                listElement.innerHTML = '<li style="color: var(--danger-color);">載入金鑰失敗</li>';
            }
        }

        // 功能: 綁定金鑰管理區塊 (新增/刪除) 的所有事件監聽器
        // input: 無 (DOM 事件)
        // output: (chrome.storage.local 操作)
        // 其他補充: [規格 1.A] 的核心邏輯函式
        function setupApiKeyListeners() {
            const nameInput = document.getElementById('apiKeyNameInput');
            const keyInput = document.getElementById('apiKeyInput');
            const addButton = document.getElementById('addApiKeyButton');
            const listElement = document.getElementById('apiKeyList');

            if (!nameInput || !keyInput || !addButton || !listElement) return;

            // 1. 新增按鈕的邏輯
            addButton.addEventListener('click', async () => {
                const name = nameInput.value.trim();
                const key = keyInput.value.trim();

                if (!name || !key) {
                    showOptionsToast('金鑰名稱和 API Key 皆不可為空', 4000);
                    return;
                }

                if (!key.startsWith('AIzaSy')) {
                     showOptionsToast('金鑰格式似乎不正確，請再次確認。', 4000);
                     // 不阻擋，僅提示
                }

                try {
                    addButton.disabled = true;
                    addButton.textContent = '新增中...';
                    
                    const result = await chrome.storage.local.get(['userApiKeys']);
                    const keys = result.userApiKeys || [];
                    
                    const newKey = {
                        id: crypto.randomUUID(), //
                        name: name,
                        key: key
                    };

                    keys.push(newKey); //

                    await chrome.storage.local.set({ userApiKeys: keys }); //

                    nameInput.value = '';
                    keyInput.value = '';
                    showOptionsToast(`金鑰 "${name}" 已成功新增！`);
                    await loadAndRenderApiKeys(); //

                } catch (e) {
                    console.error('新增 API Key 失敗:', e);
                    showOptionsToast('新增金鑰時發生錯誤，請檢查控制台日誌。', 5000);
                } finally {
                    addButton.disabled = false;
                    addButton.textContent = '新增';
                }
            });

            // 2. 刪除按鈕的邏輯 (使用事件委派)
            listElement.addEventListener('click', async (e) => {
                if (!e.target.classList.contains('delete-key')) return;

                const button = e.target;
                const keyId = button.dataset.id; //
                if (!keyId) return;
                
                if (!confirm('您確定要刪除此 API Key 嗎？')) {
                    return;
                }

                try {
                    button.disabled = true;
                    button.textContent = '刪除中...';

                    const result = await chrome.storage.local.get(['userApiKeys']);
                    let keys = result.userApiKeys || [];

                    // 使用 filter 過濾掉要刪除的金鑰
                    keys = keys.filter(key => key.id !== keyId); 

                    await chrome.storage.local.set({ userApiKeys: keys }); //

                    showOptionsToast('金鑰已成功刪除。');
                    await loadAndRenderApiKeys(); //

                } catch (e) {
                    console.error('刪除 API Key 失敗:', e);
                    showOptionsToast('刪除金鑰時發生錯誤，請檢查控制台日誌。', 5000);
                    button.disabled = false;
                    button.textContent = '刪除';
                }
            });
        }

        // --- 立即執行 API 金鑰管理 ---
        loadAndRenderApiKeys();
        setupApiKeyListeners();
        // 【關鍵修正點】: 以上為新增區塊

        // 診斷與日誌
        document.getElementById('clearCacheButton').addEventListener('click', async () => {
            const res = await sendMessage({ action: 'clearAllCache' });
            showOptionsToast(`成功清除了 ${res.count} 個影片的暫存！`);
        });
        // 【關鍵修正點】: v1.1 - 遷移金鑰診斷邏輯
        document.getElementById('diagnoseKeysButton').addEventListener('click', async (e) => {
            // 功能: (已修改) 呼叫 background.js 診斷所有儲存的金鑰
            // 其他補充: 移除 fetch，改用 sendMessage
            e.target.disabled = true;
            e.target.textContent = '診斷中...';
            const resultsContainer = document.getElementById('diagnose-results');
            resultsContainer.innerHTML = '';
            
            try {
                 // 【關鍵修正點】: 呼叫 background.js 的 'diagnoseAllKeys' 動作
                 const results = await sendMessage({ action: 'diagnoseAllKeys' }); //

                 if (!results) {
                     throw new Error('背景服務未回傳診斷結果。');
                 }

                 resultsContainer.innerHTML = ''; 
                 if (results.length === 0) {
                     // 此處的判斷邏輯保持不變
                     resultsContainer.innerHTML = `<div class="diag-result status-invalid">未在瀏覽器儲存區找到可診斷的 API Key。</div>`;
                 } else {
                     // 重用舊的 UI 渲染邏輯，因為回傳格式相同
                     results.forEach(res => {
                        const resultEl = document.createElement('div');
                        resultEl.className = `diag-result status-${res.status}`;
                        resultEl.innerHTML = `<strong>${res.name}:</strong> ${res.status === 'valid' ? '有效' : '無效'}`; //
                        if(res.error) {
                            resultEl.title = res.error; //
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
                e.target.textContent = '開始診斷所有金鑰'; //
            }
        });
        async function loadErrorLogs() {
            // 功能: (已修改) 從 background.js 獲取錯誤日誌並顯示在診斷頁面。
            // input from: (自動執行)
            // output to: (DOM 操作) #error-log-container
            // 其他補充: 【關鍵修正點】 v1.1 - 重寫以渲染豐富的 LogEntry 物件
            const logContainer = document.getElementById('error-log-container');
            if (!logContainer) return;

            const response = await sendMessage({ action: 'getErrorLogs' }); //

            if (response.success && response.data && response.data.length > 0) {
                logContainer.innerHTML = ''; // 清空 placeholder
                response.data.forEach(log => {
                    const entryEl = document.createElement('div');
                    entryEl.className = `log-entry log-level-${log.level.toLowerCase()}`; //

                    // 處理詳細資訊
                    let detailsHtml = '';
                    if (log.context) { //
                        detailsHtml += `<div><strong>[原始錯誤]</strong> ${log.context}</div>`;
                    }
                    if (log.solution) { //
                        detailsHtml += `<div><strong>[建議]</strong> ${log.solution}</div>`;
                    }

                    // 組合 HTML
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
                 logContainer.innerHTML = '<p class="log-placeholder">目前沒有持續性錯誤紀錄。</p>'; //
            }
        }
        loadErrorLogs();

    } else {
        // --- Popup Page 專屬邏輯 ---
        const toggleButton = document.getElementById('toggleButton');
        const statusText = document.getElementById('status');
        
        async function updatePopupStatus() {
            // 功能: 更新 popup 主視窗的 UI 狀態（例如「啟用/停用」按鈕的文字）。
            const tab = await getActiveTab();
            if (tab?.url?.includes("youtube.com")) {
                toggleButton.disabled = false;
                
                // 【關鍵修正點】: 使用選用串連 (?. ) 來安全讀取 response 及其 isEnabled 屬性。
                const response = await sendMessage({ action: 'getGlobalState' });
                const isEnabled = response?.isEnabled ?? false; // 如果 response 或 isEnabled 是 undefined，則視為 false (未啟用)

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
            // 【關鍵修正點】: 使用選用串連 (?. ) 來安全讀取 response 及其 isEnabled 屬性。
            const response = await sendMessage({ action: 'toggleGlobalState' });
            const isEnabled = response?.isEnabled ?? false; // 如果 response 或 isEnabled 是 undefined，則視為 false (未啟用)

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
        // 【關鍵修正點】: 只有在 overrideSelect 元件存在時，才為它綁定事件
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
            // 功能: 從 background.js 獲取當前影片可用的字幕語言，並動態生成到「自訂來源語言」的下拉選單中。
            const response = await sendMessage({ action: 'getAvailableLangs' });
            
            // 【關鍵修正點】: 預先準備選項，確保「自動」永遠是第一個選項。
            overrideSelect.innerHTML = '<option value="auto">自動 (推薦)</option>';
            
            // 【關鍵修正點】: 修正傳回資料的判斷，確保 data 是一個陣列且有內容。
            if (response.success && response.data && Array.isArray(response.data) && response.data.length > 0) {
                response.data.forEach(lang => {
                    const option = document.createElement('option');
                    option.value = lang;
                    option.textContent = LANG_CODE_MAP[lang] ? `${LANG_CODE_MAP[lang]} (${lang})` : lang;
                    overrideSelect.appendChild(option);
                });
                overrideSelect.disabled = false; // 確保在有語言時啟用選擇器
            } else {
                // 如果沒有語言，則只顯示「自動 (推薦)」和「無可用語言」的提示。
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

    function initializeSortableList(listId, onSortEndCallback) {
        // 功能: 為一個列表 (ul) 賦予拖曳排序的功能。
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
        // 功能: 拖曳排序的輔助函式，用於計算拖曳項目應該插入的位置。
        const draggable = [...container.querySelectorAll('li:not(.dragging)')];
        return draggable.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    function updateListUI(listId, items) {
        // 功能: 根據一個字串陣列，動態更新一個列表 (ul) 的內容。
        const list = document.getElementById(listId);
        if (!list) return;
        list.innerHTML = '';
        if (!items) return;
        items.forEach(item => {
            const li = document.createElement('li');
            li.dataset.id = item;
            li.draggable = true;
            
            if (listId === 'preferred-lang-list' && LANG_CODE_MAP[item]) {
                li.textContent = `${LANG_CODE_MAP[item]} (${item})`;
            } else {
                li.textContent = item;
            }
            
            list.appendChild(li);
        });
    }

    let toastTimeout = null;
    function showOptionsToast(message, duration = 3000) {
        // 功能: 在 options.html 頁面頂部顯示一個短暫的提示訊息（例如「儲存成功」）。
        const toast = document.getElementById('options-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
    }
});