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

// 預設設定
const defaultSettings = {
    fontSize: 22,
    fontFamily: '"YouTube Noto", Roboto, "Arial Unicode Ms", Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif',
    showOriginal: true,
    showTranslated: true
};

// 在 Service Worker 啟動時，立即從儲存中讀取狀態
chrome.storage.local.get('ytEnhancerEnabled', (data) => {
    isEnabled = !!data.ytEnhancerEnabled;
    console.log('[Background] Initial state restored:', isEnabled);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    let isAsync = false;

    if (request.action === 'toggle') {
        isEnabled = !isEnabled;
        chrome.storage.local.set({ 'ytEnhancerEnabled': isEnabled });
        
        // 【優化】在通知所有分頁時，為 sendMessage 加上錯誤處理日誌
        chrome.tabs.query({ url: "*://www.youtube.com/*" }, (tabs) => {
            for (const tab of tabs) {
                chrome.tabs.sendMessage(tab.id, { action: 'stateChanged', enabled: isEnabled })
                    .catch(error => {
                        // 某些情況下（如分頁未就緒）會發送失敗，這是正常的
                        if (!error.message.includes("Could not establish connection") && !error.message.includes("Receiving end does not exist")) {
                            console.warn(`[Background] Failed to send stateChanged to tab ${tab.id}:`, error.message);
                        }
                    });
            }
        });
        sendResponse({ isEnabled });
        return; 
    }

    switch (request.action) {
        case 'checkStatus':
            sendResponse({ isEnabled });
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

        case 'clearCache':
            isAsync = true;
            chrome.storage.local.get(null, (items) => {
                const keysToRemove = Object.keys(items).filter(key => key.startsWith('ytEnhancerCache_'));
                if (keysToRemove.length > 0) {
                    chrome.storage.local.remove(keysToRemove, () => {
                        console.log(`[Background] 已清除 ${keysToRemove.length} 筆字幕暫存。`);
                        sendResponse({ success: true });
                    });
                } else {
                    sendResponse({ success: true });
                }
            });
            break;
        
        case 'getSettings':
            isAsync = true;
            chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings })
                .then(result => {
                    sendResponse({ data: result.ytEnhancerSettings });
                });
            break;

        case 'setSettings':
            isAsync = true;
            chrome.storage.local.set({ 'ytEnhancerSettings': request.data })
                .then(() => {
                    sendResponse({ success: true });
                });
            break;
    }

    return isAsync;
});

console.log('[Background] Service Worker started and listeners are active.');