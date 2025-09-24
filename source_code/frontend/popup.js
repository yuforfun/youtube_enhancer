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

document.addEventListener('DOMContentLoaded', () => {
    // 獲取所有 UI 元素
    const toggleButton = document.getElementById('toggleButton');
    const statusDiv = document.getElementById('status');
    const clearCacheButton = document.getElementById('clearCacheButton');
    
    const fontSizeSlider = document.getElementById('fontSizeSlider');
    const fontSizeValue = document.getElementById('fontSizeValue');
    const fontFamilySelect = document.getElementById('fontFamilySelect');
    const showOriginalCheckbox = document.getElementById('showOriginal');
    const showTranslatedCheckbox = document.getElementById('showTranslated');

    // 從背景讀取設定並更新 UI
    async function loadSettings() {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        if (response && response.data) {
            const settings = response.data;
            fontSizeSlider.value = settings.fontSize;
            fontSizeValue.textContent = settings.fontSize;
            fontFamilySelect.value = settings.fontFamily;
            showOriginalCheckbox.checked = settings.showOriginal;
            showTranslatedCheckbox.checked = settings.showTranslated;
        }
    }

    // 收集目前 UI 上的設定值，儲存並通知 content.js
    async function saveAndApplySettings() {
        const newSettings = {
            fontSize: parseInt(fontSizeSlider.value, 10),
            fontFamily: fontFamilySelect.value,
            showOriginal: showOriginalCheckbox.checked,
            showTranslated: showTranslatedCheckbox.checked,
        };
        // 儲存到背景
        await chrome.runtime.sendMessage({ action: 'setSettings', data: newSettings });

        // 通知當前分頁的 content.js 更新樣式
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && tab.url.includes("youtube.com/watch")) {
            chrome.tabs.sendMessage(tab.id, {
                action: 'settingsChanged',
                settings: newSettings
            });
        }
    }
    
    // 為所有設定控制項加上事件監聽器
    fontSizeSlider.addEventListener('input', () => {
        fontSizeValue.textContent = fontSizeSlider.value;
    });
    fontSizeSlider.addEventListener('change', saveAndApplySettings);
    fontFamilySelect.addEventListener('change', saveAndApplySettings);
    showOriginalCheckbox.addEventListener('change', saveAndApplySettings);
    showTranslatedCheckbox.addEventListener('change', saveAndApplySettings);

    // --- 以下為舊的邏輯 ---
    async function checkStatus() { /* ... 與之前版本相同 ... */ }
    toggleButton.addEventListener('click', () => { /* ... 與之前版本相同 ... */ });
    clearCacheButton.addEventListener('click', () => { /* ... 與之前版本相同 ... */ });
    function updateButton(isEnabled) { /* ... 與之前版本相同 ... */ }

    // 載入設定
    loadSettings();
    // 檢查啟用狀態
    checkStatus();

    // 為了完整性，貼上舊的邏輯
    async function checkStatus() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && tab.url.includes("youtube.com/")) {
            chrome.runtime.sendMessage({ action: 'checkStatus' }, (response) => {
                if (chrome.runtime.lastError) { console.error("無法連接到背景服務:", chrome.runtime.lastError.message); toggleButton.textContent = '錯誤：背景服務未執行'; toggleButton.disabled = true; statusDiv.textContent = '請重新載入擴充功能'; } else if (response) { updateButton(response.isEnabled); toggleButton.disabled = false; }
            });
        } else { toggleButton.disabled = true; toggleButton.textContent = '請在 YouTube 頁面使用'; statusDiv.textContent = ''; }
    }
    toggleButton.addEventListener('click', () => { if(toggleButton.disabled) return; chrome.runtime.sendMessage({ action: 'toggle' }, (response) => { if (response) { updateButton(response.isEnabled); }}); });
    clearCacheButton.addEventListener('click', () => { if (confirm('確定要清除所有已翻譯的字幕暫存嗎？')) { chrome.runtime.sendMessage({ action: 'clearCache' }, (response) => { if (response && response.success) { alert('字幕暫存已成功清除！'); }}); } });
    function updateButton(isEnabled) {
    if (isEnabled) {
        toggleButton.textContent = '停用翻譯';
        toggleButton.classList.add('active');
        // 【核心修改】移除 "狀態：" 前綴
        statusDiv.textContent = '已啟用'; 
    } else {
        toggleButton.textContent = '啟用翻譯';
        toggleButton.classList.remove('active');
        // 【核心修改】移除 "狀態：" 前綴
        statusDiv.textContent = '未啟用';
    }
}
});