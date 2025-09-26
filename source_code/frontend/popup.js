/**
 * @file popup.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * You can find a copy of the license in the LICENSE file that should be
 * distributed with this software.
 *
 * This script handles the logic for the extension's popup UI, including
 * user settings and button actions.
 */
/**
 * @file popup.js
 * @version 1.3.0
 */
document.addEventListener('DOMContentLoaded', () => {
    const allModels = {
        'gemini-2.5-pro': { name: '2.5 Pro', tip: '最高品質，適合複雜推理任務。' },
        'gemini-2.5-flash': { name: '2.5 Flash', tip: '效能與速度的絕佳平衡點。' },
        'gemini-2.5-flash-lite': { name: '2.5 Flash-Lite', tip: '速度極快，適合高頻率即時回應。' },
        'gemini-2.0-flash': { name: '2.0 Flash', tip: '舊版高速模型，適合快速請求。' },
        'gemini-2.0-flash-lite': { name: '2.0 Flash-Lite', tip: '舊版最快模型，RPM限制最高。' }
    };
    
    const availableList = document.getElementById('available-models');
    const selectedList = document.getElementById('selected-models');
    const fontFamilySelect = document.getElementById('fontFamilySelect');
    const customFontRow = document.getElementById('customFontRow');
    const fontFamilyInput = document.getElementById('fontFamilyInput');
    let activeTooltip = null;

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

    // 【UI 優化】Tooltip 處理邏輯
    function initializeTooltips() {
        function showTooltip(e) {
            const tooltipSource = e.target.closest('.model-tooltip');
            if (!tooltipSource) return;

            removeTooltip(); // 確保先移除舊的

            const modelId = tooltipSource.closest('li').dataset.id;
            const tipText = allModels[modelId]?.tip;
            if (!tipText) return;

            activeTooltip = document.createElement('div');
            activeTooltip.id = 'global-tooltip';
            activeTooltip.textContent = tipText;
            document.body.appendChild(activeTooltip);

            const sourceRect = tooltipSource.getBoundingClientRect();
            const tooltipRect = activeTooltip.getBoundingClientRect();
            
            let top = sourceRect.top - tooltipRect.height - 8; // 8px gap
            let left = sourceRect.left + (sourceRect.width / 2) - (tooltipRect.width / 2);

            // 邊界檢查
            if (top < 0) { top = sourceRect.bottom + 8; }
            if (left < 0) { left = 5; }
            if (left + tooltipRect.width > window.innerWidth) { left = window.innerWidth - tooltipRect.width - 5; }

            activeTooltip.style.top = `${top}px`;
            activeTooltip.style.left = `${left}px`;
            activeTooltip.style.opacity = '1';
        }

        function removeTooltip() {
            if (activeTooltip) {
                activeTooltip.remove();
                activeTooltip = null;
            }
        }
        
        // 使用事件委派
        document.body.addEventListener('mouseover', showTooltip);
        document.body.addEventListener('mouseout', removeTooltip);
    }

    function initializeModelSelector() {
        document.getElementById('add-model').addEventListener('click', () => moveSelectedModels(availableList, selectedList));
        document.getElementById('remove-model').addEventListener('click', () => moveSelectedModels(selectedList, availableList));
        [availableList, selectedList].forEach(list => {
            list.addEventListener('click', (e) => e.target.tagName === 'li' && e.target.classList.toggle('selected'));
            list.addEventListener('dragstart', (e) => e.target.classList.add('dragging'));
            list.addEventListener('dragend', (e) => { e.target.classList.remove('dragging'); saveAndApplySettings(); });
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

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('li:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; } else { return closest; }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    function createModelListItem(id) {
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

    async function loadSettings() {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        const settings = response?.data;
        if (settings) {
            populateLists(settings);
            document.getElementById('fontSizeSlider').value = settings.fontSize;
            document.getElementById('fontSizeValue').textContent = settings.fontSize + 'px';
            const savedFont = settings.fontFamily;
            const isPreset = [...fontFamilySelect.options].some(opt => opt.value === savedFont);
            if (isPreset) { fontFamilySelect.value = savedFont; } 
            else { fontFamilySelect.value = 'custom'; fontFamilyInput.value = savedFont; }
            handleFontSelectionChange();
            document.getElementById('showOriginal').checked = settings.showOriginal;
            document.getElementById('showTranslated').checked = settings.showTranslated;
        }
    }

    async function saveAndApplySettings() {
        let finalFontFamily = fontFamilySelect.value;
        if (finalFontFamily === 'custom') {
            finalFontFamily = fontFamilyInput.value.trim() || 'YouTube Noto, Roboto, sans-serif';
        }
        const newSettings = {
            models_preference: [...selectedList.querySelectorAll('li')].map(li => li.dataset.id),
            fontSize: parseInt(document.getElementById('fontSizeSlider').value, 10),
            fontFamily: finalFontFamily,
            showOriginal: document.getElementById('showOriginal').checked,
            showTranslated: document.getElementById('showTranslated').checked,
        };
        await chrome.runtime.sendMessage({ action: 'setSettings', data: newSettings });
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url?.includes("youtube.com/watch")) {
            chrome.tabs.sendMessage(tab.id, { action: 'settingsChanged', settings: newSettings });
        }
    }

    function setupEventListeners() {
        initializeModelSelector();
        const fontSizeSlider = document.getElementById('fontSizeSlider');
        fontSizeSlider.addEventListener('input', (e) => { document.getElementById('fontSizeValue').textContent = e.target.value + 'px'; });
        fontSizeSlider.addEventListener('change', saveAndApplySettings);
        fontFamilySelect.addEventListener('change', handleFontSelectionChange);
        fontFamilyInput.addEventListener('change', saveAndApplySettings);
        document.getElementById('showOriginal').addEventListener('change', saveAndApplySettings);
        document.getElementById('showTranslated').addEventListener('change', saveAndApplySettings);
        document.getElementById('toggleButton').addEventListener('click', () => {
            if (document.getElementById('toggleButton').disabled) return;
            chrome.runtime.sendMessage({ action: 'toggle' }, (response) => response && updateButton(response.isEnabled));
        });
        document.getElementById('clearCacheButton').addEventListener('click', () => {
            if (confirm('確定要清除所有已翻譯的字幕暫存嗎？')) {
                chrome.runtime.sendMessage({ action: 'clearCache' }, (res) => res?.success && alert('字幕暫存已成功清除！'));
            }
        });
    }

    function updateButton(isEnabled) {
        const btn = document.getElementById('toggleButton');
        const status = document.getElementById('status');
        btn.textContent = isEnabled ? '停用翻譯' : '啟用翻譯';
        btn.classList.toggle('active', isEnabled);
        status.textContent = isEnabled ? '已啟用' : '未啟用';
    }

    async function checkStatus() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const btn = document.getElementById('toggleButton');
        const status = document.getElementById('status');
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

    initializeAccordions();
    initializeTooltips(); // 啟用新的 Tooltip 邏輯
    setupEventListeners();
    loadSettings();
    checkStatus();
});