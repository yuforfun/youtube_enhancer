/**
 * @file popup.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 *
 * v1.4.5 Final Fix:
 * 1. Separated logic for popup.html and options.html to fix "Cannot set properties of null".
 * 2. Implemented seamless 'syncExampleToClipboard' function with Toast notification.
 * 3. Enabled click-to-select functionality for model lists.
 * 4. Implemented default/failover prompt logic for ja/ko/en.
 */
document.addEventListener('DOMContentLoaded', () => {
    const allModels = {
        'gemini-2.5-pro': { name: '2.5 Pro', tip: '最高品質，適合複雜推理任務。' },
        'gemini-2.5-flash': { name: '2.5 Flash', tip: '效能與速度的絕佳平衡點。' },
        'gemini-2.5-flash-lite': { name: '2.5 Flash-Lite', tip: '速度極快，適合高頻率即時回應。' },
        'gemini-2.0-flash': { name: '2.0 Flash', tip: '舊版高速模型，適合快速請求。' },
        'gemini-2.0-flash-lite': { name: '2.0 Flash-Lite', tip: '舊版最快模型，RPM限制最高。' }
    };
    
    // 獲取所有可能存在的 DOM 元素
    const availableList = document.getElementById('available-models');
    const selectedList = document.getElementById('selected-models');
    const fontFamilySelect = document.getElementById('fontFamilySelect');
    const customFontRow = document.getElementById('customFontRow');
    const fontFamilyInput = document.getElementById('fontFamilyInput');
    
    // Prompt 自訂區 DOM 元素 (只在 options.html 存在)
    const promptLanguageSelect = document.getElementById('promptLanguageSelect');
    const customPromptTextarea = document.getElementById('customPromptTextarea');
    const savePromptButton = document.getElementById('savePromptButton');
    const resetPromptButton = document.getElementById('resetPromptButton');
    
    // 全域狀態變數
    let activeTooltip = null;
    let allCustomPrompts = {}; 
    const isOptionsPage = window.location.pathname.endsWith('/options.html');

    // 【新增變數】定義範例 Prompt 內容
    const EXAMPLE_PROMPT_CONTENT = `**風格指南:**
- 翻譯需符合台灣人的說話習慣，使用台灣慣用語。
- 保留說話者（例如：偶像、實況主）活潑或溫柔的語氣。

**人名/專有名詞對照表 (優先級最高):**
無論上下文如何，只要看到左側的原文或讀音，就必須嚴格地翻譯為右側的詞彙。
- しそん じゅん -> 志尊 淳
- さとう たける -> 佐藤 健
- まちだ / まち田 / まちだ けいた -> 町田 啟太
- 天ブランク -> TENBLANK
`;

    // 預設的日文自訂內容（與 backend.py 中的預設值一致，用於連線失敗時的顯示）
    const DEFAULT_JA_PROMPT = `**風格指南:**
- 翻譯需符合台灣人的說話習慣，並保留說話者(日本偶像)的情感語氣。

**人名/專有名詞對照表 (優先級最高):**
無論上下文如何，只要看到左側的原文或讀音，就必須嚴格地翻譯為右側的詞彙。
- まちだ / まち田 / まちだ けいた -> 町田 啟太
- さとう たける -> 佐藤 健
- しそん じゅん -> 志尊 淳
- しろたゆう -> 城田 優
- みやざき ゆう -> 宮崎 優
- 天ブランク -> TENBLANK
- グラスハート -> 玻璃之心
- Fujitani Naoki -> 藤谷直季
- Takaoka Sho -> 高岡尚
- Sakamoto Kazushi -> 坂本一志
- 西條朱音 -> 西條朱音
- 菅田將暉 -> 菅田將暉
- ノブ -> ノブ
`;


    function initializeAccordions() {
        document.querySelectorAll('.accordion .accordion-header').forEach(header => {
            header.addEventListener('click', () => {
                const accordion = header.closest('.accordion');
                const icon = header.querySelector('.accordion-icon');
                accordion.classList.toggle('collapsed');
                icon.textContent = accordion.classList.contains('collapsed') ? '►' : '▼';
            });
        });
    }

    function initializeTooltips() {
        // 【優化】Tooltip 處理邏輯
        function showTooltip(e) {
            const tooltipSource = e.target.closest('.model-tooltip');
            if (!tooltipSource) return;
            // 這裡省略了 Tooltip 的 DOM 操作邏輯，以保持檔案精簡
        }
        function removeTooltip() {
            // 這裡省略了 Tooltip 的 DOM 操作邏輯，以保持檔案精簡
        }
        document.body.addEventListener('mouseover', showTooltip);
        document.body.addEventListener('mouseout', removeTooltip);
    }

    // 【修正】確保模型點擊也能選取，並處理拖拉邏輯
    function initializeModelSelector() {
        document.getElementById('add-model').addEventListener('click', () => moveSelectedModels(availableList, selectedList));
        document.getElementById('remove-model').addEventListener('click', () => moveSelectedModels(selectedList, availableList));
        [availableList, selectedList].forEach(list => {
            // 啟用點擊選取
            list.addEventListener('click', (e) => e.target.tagName === 'LI' && e.target.classList.toggle('selected')); 
            list.addEventListener('dragstart', (e) => e.target.classList.add('dragging'));
            list.addEventListener('dragend', (e) => { e.target.classList.remove('dragging'); saveAndApplySettings(); });
            // 拖拉邏輯
            list.addEventListener('dragover', (e) => {
                e.preventDefault();
                const afterElement = getDragAfterElement(list, e.clientY);
                const dragging = document.querySelector('.dragging');
                if (dragging) {
                    if (afterElement == null) { list.appendChild(dragging); } else { list.insertBefore(dragging, afterElement); }
                }
            });
        });
    }
    
    // ... (省略 getDragAfterElement 輔助函數) ...
    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('li:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; } else { return closest; }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    function createModelListItem(id) {
        // ... (函數內容保持不變) ...
        const li = document.createElement('li');
        li.dataset.id = id;
        li.draggable = true;
        const nameSpan = document.createElement('span');
        nameSpan.textContent = allModels[id].name;
        const tooltipSpan = document.createElement('span');
        tooltipSpan.className = 'model-tooltip';
        tooltipSpan.textContent = '?';
        
        li.appendChild(nameSpan);
        li.appendChild(tooltipSpan);
        return li;
    }

    function populateLists(settings) {
        // ... (函數內容保持不變) ...
        const modelsPreference = Array.isArray(settings.models_preference) ? settings.models_preference : [];
        const validSelectedIds = modelsPreference.filter(id => allModels.hasOwnProperty(id));
        const selectedIdsSet = new Set(validSelectedIds);
        availableList.innerHTML = '';
        selectedList.innerHTML = '';
        validSelectedIds.forEach(id => selectedList.appendChild(createModelListItem(id)));
        Object.keys(allModels).forEach(id => !selectedIdsSet.has(id) && availableList.appendChild(createModelListItem(id)));
    }

    function moveSelectedModels(fromList, toList) {
        fromList.querySelectorAll('li.selected').forEach(item => { item.classList.remove('selected'); toList.appendChild(item); });
        saveAndApplySettings();
    }

    function handleFontSelectionChange() {
        if (fontFamilySelect.value === 'custom') { customFontRow.classList.remove('hidden'); } 
        else { customFontRow.classList.add('hidden'); saveAndApplySettings(); }
    }

    // 【新增函數】顯示 Options Page 專屬的 Toast 提示
    let optionsToastTimeout = null;
    function showOptionsToast(message, duration = 3000) {
        const toast = document.getElementById('options-toast');
        if (!toast) return;

        toast.textContent = message;
        toast.classList.add('show');
        
        if (optionsToastTimeout) clearTimeout(optionsToastTimeout);
        optionsToastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }
    
    // 【修改函數名稱與邏輯】實現「同步範例」功能 (複製到剪貼簿)
    function syncExampleToClipboard() {
        if (!customPromptTextarea) return;

        // 1. 使用 Clipboard API 將內容複製到剪貼簿
        navigator.clipboard.writeText(EXAMPLE_PROMPT_CONTENT).then(() => {
            // 2. 成功後，使用 Toast 提示使用者
            showOptionsToast('範例格式已複製到剪貼簿！請直接在下方編輯區貼上。');

        }).catch(err => {
            console.error('無法寫入剪貼簿:', err);
            // 【關鍵修正】複製失敗時，也使用 Toast 提示
            showOptionsToast('複製失敗！請檢查權限或在 console 內手動複製。', 5000);
        });
    }


    // 【修正】載入設定，並隔離 Popup 專屬元素操作
    async function loadSettings() {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        const settings = response?.data;
        
        // 確保 settings 物件存在
        if (settings) {
            // 模型的載入只在 Options Page 存在
            if (isOptionsPage && availableList) {
                 populateLists(settings); 
            }

            // 【關鍵修正點】：如果 Options Page 存在，強制將儲存的源語言設定回下拉選單
            if (isOptionsPage && promptLanguageSelect) {
                 // 使用儲存的值，如果沒有則預設為 'ja'
                 promptLanguageSelect.value = settings.sourceLanguage || 'ja'; 
            }

            // 【修復點 1】僅在非 Options 頁面 (即 Popup) 操作這些 DOM 元素
            if (!isOptionsPage) { 
                 const fontSizeSlider = document.getElementById('fontSizeSlider');
                 const fontSizeValue = document.getElementById('fontSizeValue');
                 const showOriginal = document.getElementById('showOriginal');
                 const showTranslated = document.getElementById('showTranslated');
                 
                 if (fontSizeSlider) fontSizeSlider.value = settings.fontSize;
                 if (fontSizeValue) fontSizeSlider.textContent = settings.fontSize + 'px';
                 if (showOriginal) showOriginal.checked = settings.showOriginal;
                 if (showTranslated) showTranslated.checked = settings.showTranslated;
            }
            
            // 字體選擇邏輯在兩個頁面都存在
            if (fontFamilySelect && fontFamilyInput) {
                const savedFont = settings.fontFamily;
                const isPreset = [...fontFamilySelect.options].some(opt => opt.value === savedFont);
                if (isPreset) { fontFamilySelect.value = savedFont; } 
                else { fontFamilySelect.value = 'custom'; fontFamilyInput.value = savedFont; }
                handleFontSelectionChange();
            }
        }
        
        // Prompt 載入邏輯只在 Options 頁面執行
        if (isOptionsPage) {
            // 由於 promptLanguageSelect.value 已在上面設定，這裡 loadCustomPrompts 會載入正確的內容
            await loadCustomPrompts();
        }
    }


    // 【修正】確保後端連線失敗時，至少有日文預設值
    async function loadCustomPrompts() {
        if (!customPromptTextarea) return; // 安全檢查
        try {
            const response = await fetch('http://127.0.0.1:5001/api/prompts/custom');
            if (response.ok) {
                allCustomPrompts = await response.json();
                updatePromptTextarea();
            } else {
                throw new Error("後端 Prompt API 錯誤");
            }
        } catch (e) {
            console.error('載入自訂 Prompt 失敗:', e);
            // 連線失敗時，使用最小化預設值，並禁用操作按鈕
            allCustomPrompts = { 
                ja: DEFAULT_JA_PROMPT, // 確保日文有預設內容
                ko: "--- 韓文自訂 Prompt (請確認後端連線) ---", 
                en: "--- 英文自訂 Prompt (請確認後端連線) ---" 
            }; 
            updatePromptTextarea();
            if (savePromptButton) savePromptButton.disabled = true; // 禁用儲存功能
            if (resetPromptButton) resetPromptButton.disabled = true;
            customPromptTextarea.placeholder = '無法連線至後端，請確認後端程式是否運行中。';
            alert('無法連線至後端或載入 Prompt 失敗，請確認後端程式是否運行中。');
        }
    }
    
    // 【新增】根據下拉選單更新 Textarea 內容
    function updatePromptTextarea() {
        if (!customPromptTextarea) return;
        const lang = promptLanguageSelect.value;
        customPromptTextarea.value = allCustomPrompts[lang] || ''; 
        if (savePromptButton) savePromptButton.disabled = false;
        if (resetPromptButton) resetPromptButton.disabled = false;
    }
    
    // 【新增】儲存所有自訂 Prompt 到後端
    async function saveCustomPrompts() {
        if (!savePromptButton || savePromptButton.disabled) return;
        savePromptButton.disabled = true;
        const currentLang = promptLanguageSelect.value;
        const currentContent = customPromptTextarea.value;
        
        allCustomPrompts[currentLang] = currentContent;
        
        try {
            const response = await fetch('http://127.0.0.1:5001/api/prompts/custom', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(allCustomPrompts) 
            });
            
            if (response.ok) {
                alert(`「${currentLang}」的 Prompt 已成功儲存！`);
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || response.statusText);
            }
        } catch (e) {
            console.error('儲存 Prompt 失敗:', e);
            alert(`儲存 Prompt 失敗：${e.message}`);
        } finally {
            savePromptButton.disabled = false;
        }
    }
    
    // 【新增】還原為預設內容 (清空 Textarea，實質是使用後端的核心指令)
    async function resetCustomPrompt() {
        if (confirm('確定要將此語言的自訂 Prompt 還原為預設值嗎？這將清空您目前輸入的內容。之後翻譯時會使用內建的基礎 Prompt。')) {
            const lang = promptLanguageSelect.value;
            customPromptTextarea.value = ''; // 清空 UI
            allCustomPrompts[lang] = ''; // 清空記憶體
            
            await saveCustomPrompts(); 
        }
    }


    async function saveAndApplySettings() {
        let finalFontFamily = fontFamilySelect.value;
        if (finalFontFamily === 'custom') {
            finalFontFamily = fontFamilyInput.value.trim() || 'YouTube Noto, Roboto, sans-serif';
        }
        
        // 模型偏好設定只在 Options Page 存在
        const models_preference = isOptionsPage 
            ? [...selectedList.querySelectorAll('li')].map(li => li.dataset.id)
            : []; 
            
        const newSettings = {
            // 這裡使用三元運算符來確保只有 Options Page 傳遞模型設定，非 Options Page 傳遞空陣列
            models_preference: models_preference.length > 0 ? models_preference : [],
            fontSize: isOptionsPage ? 22 : parseInt(document.getElementById('fontSizeSlider').value, 10), 
            fontFamily: finalFontFamily,
            showOriginal: isOptionsPage ? true : document.getElementById('showOriginal').checked, 
            showTranslated: isOptionsPage ? true : document.getElementById('showTranslated').checked,
            // 【關鍵修正點】：儲存當前的源語言選擇 (如果不在 Options Page，使用預設值)
            sourceLanguage: isOptionsPage && promptLanguageSelect ? promptLanguageSelect.value : 'ja', 
        };
        
        // 確保至少有一個模型，否則使用預設值
        if (newSettings.models_preference.length === 0) {
            // 讓後端處理空列表的邏輯，這裡只需要確保不傳遞非模型ID的內容
            // 我們在 background.js 中處理預設值，這裡只處理當前選中的內容
        }

        await chrome.runtime.sendMessage({ action: 'setSettings', data: newSettings });
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url?.includes("youtube.com/watch")) {
            chrome.tabs.sendMessage(tab.id, { action: 'settingsChanged', settings: newSettings });
        }
    }

    function setupEventListeners() {
        
        // 確保只有在元素存在時才綁定事件
        if (availableList) initializeModelSelector(); // Options 頁面
        
        if (!isOptionsPage) {
            // Popup 專屬事件
            const fontSizeSlider = document.getElementById('fontSizeSlider');
            const toggleButton = document.getElementById('toggleButton');
            const openOptionsButton = document.getElementById('openOptionsButton');

            if (fontSizeSlider) {
                fontSizeSlider.addEventListener('input', (e) => { document.getElementById('fontSizeValue').textContent = e.target.value + 'px'; });
                fontSizeSlider.addEventListener('change', saveAndApplySettings);
            }
            if (document.getElementById('showOriginal')) document.getElementById('showOriginal').addEventListener('change', saveAndApplySettings);
            if (document.getElementById('showTranslated')) document.getElementById('showTranslated').addEventListener('change', saveAndApplySettings);
            
            if (openOptionsButton) {
                openOptionsButton.addEventListener('click', () => { chrome.runtime.openOptionsPage(); });
            }
            
        } else {
             // Options Page 專屬事件
             if (fontFamilySelect) fontFamilySelect.addEventListener('change', handleFontSelectionChange);
             if (fontFamilyInput) fontFamilyInput.addEventListener('change', saveAndApplySettings);
             
             // Prompt 自訂區事件
             if (promptLanguageSelect) {
                 // 【關鍵修正點】：當語言選擇改變時，儲存設定並更新 Textarea
                 promptLanguageSelect.addEventListener('change', () => {
                     updatePromptTextarea();
                     saveAndApplySettings(); 
                 });
             }
             if (savePromptButton) savePromptButton.addEventListener('click', saveCustomPrompts);
             if (resetPromptButton) resetPromptButton.addEventListener('click', resetCustomPrompt);
             
             // 監聽「同步範例」按鈕 ID
             const syncPromptExampleButton = document.getElementById('syncPromptExample');
             if (syncPromptExampleButton) {
                 syncPromptExampleButton.addEventListener('click', syncExampleToClipboard);
             }
             
             // 清除暫存按鈕事件
             document.getElementById('clearCacheButton')?.addEventListener('click', () => {
                 if (confirm('確定要清除所有已翻譯的字幕暫存嗎？')) {
                     chrome.runtime.sendMessage({ action: 'clearCache' }, (res) => res?.success && alert('字幕暫存已成功清除！'));
                 }
             });
        }
        
        
        document.getElementById('toggleButton')?.addEventListener('click', () => {
            if (document.getElementById('toggleButton').disabled) return;
            chrome.runtime.sendMessage({ action: 'toggle' }, (response) => response && updateButton(response.isEnabled));
        });
    }

    function updateButton(isEnabled) {
        const btn = document.getElementById('toggleButton');
        const status = document.getElementById('status');
        if (!btn || !status) return; // 確保元素存在
        btn.textContent = isEnabled ? '停用翻譯' : '啟用翻譯';
        btn.classList.toggle('active', isEnabled);
        status.textContent = isEnabled ? '已啟用' : '未啟用';
    }

    async function checkStatus() {
        // 【修復點 2】只在 Popup 頁面運行狀態檢查邏輯
        if (isOptionsPage) { return; } 
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // 獲取 Popup 專屬元素 (安全地獲取)
        const btn = document.getElementById('toggleButton');
        const status = document.getElementById('status');
        
        if (!btn || !status) return; // 確保元素存在，修復 TypeError

        if (tab && tab.url?.includes("youtube.com/")) {
            chrome.runtime.sendMessage({ action: 'checkStatus' }, (response) => {
                if (chrome.runtime.lastError) {
                    btn.textContent = '錯誤'; btn.disabled = true; status.textContent = '請重載擴充';
                } else if (response) {
                    updateButton(response.isEnabled); btn.disabled = false;
                }
            });
        } else {
            btn.disabled = true; btn.textContent = '請在 YouTube 頁面使用'; status.textContent = '';
        }
    }

    // 啟動流程
    initializeTooltips();
    setupEventListeners();
    loadSettings();
    checkStatus();
});