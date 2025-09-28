/**
 * @file popup.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 1.5.6
 *
 * Handles logic for both popup.html (Remote Control) and options.html (Admin Panel).
 */

document.addEventListener('DOMContentLoaded', () => {
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
- しそん じゅん -> 志尊 淳
- さとう たける -> 佐藤 健
- まちだ けいた -> 町田 啟太
`;

    // --- 通用函數 ---
    const sendMessage = (message) => chrome.runtime.sendMessage(message);
    const getActiveTab = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    };
    
    function translateToFriendlyError(errorMessage) {
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

    // 以下是從 loadSettings() 開始的完整內容。
    async function loadSettings() {
        const response = await sendMessage({ action: 'getSettings' });

        // 【關鍵修正點】: 提供最低限度的預設結構，以防止 updateUI 讀取不存在的屬性時崩潰
        const minimumDefaults = {
            fontSize: 22,
            showOriginal: true,
            showTranslated: true,
            // 其他設置如果未用於 Popup UI 則可省略，但為求完整性，最好與 defaultSettings 一致
        };

        if (response?.success) {
            // 如果成功，則合併（避免 settings 僅有部分內容）
            settings = { ...minimumDefaults, ...response.data };
            updateUI();
        } else {
            // 如果失敗，則使用最低限度預設值
            settings = minimumDefaults;
            updateUI();
        }
    }

    async function saveSettings(showToast = false) {
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

    // 以下是從 updateUI() 開始的完整內容。
    function updateUI() {
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

        // Tab切換
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
        
        // 模型選擇器邏輯
        function initializeModelSelector() {
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
            fromList.querySelectorAll('li.selected').forEach(item => {
                item.classList.remove('selected');
                toList.appendChild(item);
            });
            saveSettings(true);
        }

        function populateModelLists() {
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
            try {
                const response = await fetch('http://127.0.0.1:5001/api/prompts/custom');
                if (!response.ok) {
                    throw new Error(response.statusText || '後端連線失敗');
                }
                allCustomPrompts = await response.json();
                updatePromptTextarea();
            } catch (e) {
                promptTextarea.value = '無法載入 Prompt，請確認後端伺服器是否已啟動。';
                promptTextarea.disabled = true;
                const userFriendlyError = translateToFriendlyError(e.message);
                showOptionsToast(userFriendlyError, 5000);
            }
        }
        const updatePromptTextarea = () => {
            promptTextarea.value = allCustomPrompts[promptSelect.value] || '';
        };
        promptSelect.addEventListener('change', updatePromptTextarea);
        document.getElementById('savePromptButton').addEventListener('click', async (e) => {
            const button = e.target;
            button.disabled = true;
            button.textContent = '儲存中...';
            allCustomPrompts[promptSelect.value] = promptTextarea.value;
            try {
                const response = await fetch('http://127.0.0.1:5001/api/prompts/custom', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(allCustomPrompts)
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `HTTP 錯誤: ${response.status}`);
                }
                showOptionsToast('Prompt 已成功儲存！');
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

        // 診斷與日誌
        document.getElementById('clearCacheButton').addEventListener('click', async () => {
            const res = await sendMessage({ action: 'clearAllCache' });
            showOptionsToast(`成功清除了 ${res.count} 個影片的暫存！`);
        });
        document.getElementById('diagnoseKeysButton').addEventListener('click', async (e) => {
            e.target.disabled = true;
            e.target.textContent = '診斷中...';
            const resultsContainer = document.getElementById('diagnose-results');
            resultsContainer.innerHTML = '';
            
            try {
                 const response = await fetch('http://127.0.0.1:5001/api/keys/diagnose', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (!response.ok) {
                    throw new Error(response.statusText || "請求診斷 API 失敗");
                }
                const results = await response.json();
                resultsContainer.innerHTML = ''; 
                if (results.length === 0) {
                    resultsContainer.innerHTML = `<div class="diag-result status-invalid">未在後端找到可診斷的 API Key。</div>`;
                } else {
                    results.forEach(res => {
                        const resultEl = document.createElement('div');
                        resultEl.className = `diag-result status-${res.status}`;
                        resultEl.innerHTML = `<strong>${res.name}:</strong> ${res.status === 'valid' ? '有效' : '無效或已達配額'}`;
                        if(res.error) resultEl.title = res.error;
                        resultsContainer.appendChild(resultEl);
                    });
                }
            } catch(err) {
                 const userFriendlyError = translateToFriendlyError(err.message);
                 resultsContainer.innerHTML = `<div class="diag-result status-invalid">診斷失敗：${userFriendlyError}</div>`;
            } finally {
                e.target.disabled = false;
                e.target.textContent = '開始診斷';
            }
        });
        async function loadErrorLogs() {
            const logContainer = document.getElementById('error-log-container');
            const response = await sendMessage({ action: 'getErrorLogs' });
            if (response.success && response.data.length > 0) {
                logContainer.innerHTML = response.data.map(log => 
                    `<div class="log-entry">
                        <span class="log-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
                        <span class="log-message">${log.message}</span>
                    </div>`
                ).join('');
            } else {
                 logContainer.innerHTML = '<p class="log-placeholder">目前沒有持續性錯誤紀錄。</p>';
            }
        }
        loadErrorLogs();

    } else {
        // --- Popup Page 專屬邏輯 ---
        const toggleButton = document.getElementById('toggleButton');
        const statusText = document.getElementById('status');
        
        async function updatePopupStatus() {
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
        overrideSelect.addEventListener('change', async (e) => {
            if (e.target.value === 'auto') return;
            const tab = await getActiveTab();
            if (tab) {
                chrome.tabs.sendMessage(tab.id, { action: 'translateWithOverride', language: e.target.value });
            }
            statusText.textContent = '語言覆蓋指令已發送...';
            setTimeout(() => window.close(), 800);
        });
        
        async function loadAvailableLangs() {
            // 呼叫新的 getAvailableLangs 邏輯 (background.js 已新增)
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

    function updateListUI(listId, items) {
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
        const toast = document.getElementById('options-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
    }
});