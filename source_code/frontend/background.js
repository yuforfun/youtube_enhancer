/**
 * @file background.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * You can find a copy of the license in the LICENSE file that should be
 * distributed with this software.
 *
 * This is the service worker. It manages the global state of the
 * extension (enabled/disabled) and acts as a proxy for chrome.storage.
 */

'use strict';
let isEnabled = false;

// 【核心修改】更新預設的模型偏好設定
const defaultSettings = {
    fontSize: 22,
    fontFamily: 'Microsoft JhengHei, sans-serif',
    models_preference: [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.5-pro"
    ], 
    showOriginal: true,
    showTranslated: true,
    sourceLanguage: 'ja'
};

// --- 以下為既有程式碼，不需更動 ---
chrome.storage.local.get('ytEnhancerEnabled', (data) => {
    isEnabled = !!data.ytEnhancerEnabled;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    let isAsync = false;
    switch (request.action) {
        case 'toggle':
            isEnabled = !isEnabled;
            chrome.storage.local.set({ 'ytEnhancerEnabled': isEnabled });
            chrome.tabs.query({ url: "*://www.youtube.com/*" }, (tabs) => {
                for (const tab of tabs) {
                    chrome.tabs.sendMessage(tab.id, { action: 'stateChanged', enabled: isEnabled }).catch(() => {});
                }
            });
            sendResponse({ isEnabled });
            break;
        case 'checkStatus':
            sendResponse({ isEnabled });
            break;
        case 'getSettings':
            isAsync = true;
            chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings })
                .then(result => sendResponse({ data: result.ytEnhancerSettings }));
            break;
        case 'setSettings':
            isAsync = true;
            chrome.storage.local.set({ 'ytEnhancerSettings': request.data })
                .then(() => sendResponse({ success: true }));
            break;
        case 'clearCache':
            isAsync = true;
            chrome.storage.local.get(null, (items) => {
                const keysToRemove = Object.keys(items).filter(key => key.startsWith('ytEnhancerCache_'));
                if (keysToRemove.length > 0) {
                    chrome.storage.local.remove(keysToRemove, () => sendResponse({ success: true }));
                } else {
                    sendResponse({ success: true });
                }
            });
            break;
        case 'getCache':
            isAsync = true;
            chrome.storage.local.get(request.key).then(result => {
                sendResponse({ data: result[request.key] });
            });
            break;
        case 'setCache':
            isAsync = true;
            chrome.storage.local.set({ [request.key]: request.data }).then(() => {
                sendResponse({ success: true });
            });
            break;
        // 【新增】清除單一快取
        case 'removeCache':
            isAsync = true;
            chrome.storage.local.remove(request.key).then(() => {
                sendResponse({ success: true });
            });
            break;
    }
    return isAsync;
});