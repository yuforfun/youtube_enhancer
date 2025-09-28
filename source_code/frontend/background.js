/**
 * @file background.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 1.5.2
 */
'use strict';

const sessionData = {
    availableLangs: {}, // { tabId: ['ja', 'en', ...] }
    errorLogs: {}       // { tabId: [{ timestamp: ..., message: ... }] }
};

const defaultSettings = {
    isEnabled: true,
    fontSize: 22,
    fontFamily: 'Microsoft JhengHei, sans-serif',
    models_preference: [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.5-pro"
    ],
    showOriginal: true,
    showTranslated: true,
    preferred_langs: ['ja', 'ko', 'en'],
    ignored_langs: ['zh-Hant', 'zh-Hans', 'zh-CN', 'zh-TW']
};

chrome.tabs.onRemoved.addListener((tabId) => {
    delete sessionData.availableLangs[tabId];
    delete sessionData.errorLogs[tabId];
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    let isAsync = false;

    switch (request.action) {
        // --- 全域狀態管理 ---
        case 'getGlobalState':
            isAsync = true;
            chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings }, (result) => {
                sendResponse({ isEnabled: result.ytEnhancerSettings.isEnabled });
            });
            break;

        case 'toggleGlobalState':
            isAsync = true;
            chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings }, (result) => {
                const newSettings = result.ytEnhancerSettings;
                newSettings.isEnabled = !newSettings.isEnabled;
                chrome.storage.local.set({ 'ytEnhancerSettings': newSettings }, () => {
                    sendResponse({ isEnabled: newSettings.isEnabled });
                    chrome.tabs.query({ url: "*://www.youtube.com/*" }, (tabs) => {
                        for (const tab of tabs) {
                            chrome.tabs.sendMessage(tab.id, { action: 'stateChanged', isEnabled: newSettings.isEnabled }).catch(() => {});
                        }
                    });
                });
            });
            break;
        
        // 【關鍵修正點】: 新增處理 'openOptionsPage' 的 case
        case 'openOptionsPage':
            chrome.runtime.openOptionsPage();
            sendResponse({ success: true });
            break;

        // --- 設定讀寫 (持久化) ---
        case 'getSettings':
            isAsync = true;
            chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings })
                .then(result => sendResponse({ success: true, data: result.ytEnhancerSettings }));
            break;

        case 'setSettings':
            isAsync = true;
            chrome.storage.local.set({ 'ytEnhancerSettings': request.data })
                .then(() => sendResponse({ success: true }));
            break;

        // --- 暫存管理 (持久化) ---
        case 'getCache':
            isAsync = true;
            chrome.storage.local.get(request.key).then(result => sendResponse({ data: result[request.key] }));
            break;

        case 'setCache':
            isAsync = true;
            chrome.storage.local.set({ [request.key]: request.data }).then(() => sendResponse({ success: true }));
            break;
        
        case 'removeCache':
            isAsync = true;
            chrome.storage.local.remove(request.key).then(() => sendResponse({ success: true }));
            break;

        case 'clearAllCache':
            isAsync = true;
            chrome.storage.local.get(null, (items) => {
                const keysToRemove = Object.keys(items).filter(key => key.startsWith('ytEnhancerCache_'));
                if (keysToRemove.length > 0) {
                    chrome.storage.local.remove(keysToRemove, () => sendResponse({ success: true, count: keysToRemove.length }));
                } else {
                    sendResponse({ success: true, count: 0 });
                }
            });
            break;

        // --- Session 數據管理 (非持久化) ---
        case 'storeAvailableLangs':
            if (tabId) {
                sessionData.availableLangs[tabId] = request.langs;
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'Invalid tabId' });
            }
            break;
            
        case 'getAvailableLangs':
             if (tabId) {
                sendResponse({ success: true, data: sessionData.availableLangs[tabId] || [] });
            } else {
                isAsync = true;
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0] && tabs[0].id) {
                        sendResponse({ success: true, data: sessionData.availableLangs[tabs[0].id] || [] });
                    } else {
                        sendResponse({ success: false, data: [] });
                    }
                });
            }
            break;

        case 'logError':
            if (tabId) {
                if (!sessionData.errorLogs[tabId]) {
                    sessionData.errorLogs[tabId] = [];
                }
                sessionData.errorLogs[tabId].push({
                    timestamp: new Date().toISOString(),
                    message: request.message
                });
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'Invalid tabId' });
            }
            break;

        // 【關鍵修正點】: 優化日誌讀取邏輯，使其能主動尋找 YouTube 影片分頁
        case 'getErrorLogs':
            isAsync = true;
            // 優先尋找最後一個處於焦點的、正在播放影片的 YouTube 分頁
            chrome.tabs.query({ url: "*://www.youtube.com/watch?v=*", lastFocusedWindow: true }, (tabs) => {
                if (tabs.length > 0) {
                    // 即使有多個影片分頁，也優先用最後一個活動的
                    const lastActiveYtTab = tabs.sort((a, b) => b.id - a.id)[0];
                    sendResponse({ success: true, data: sessionData.errorLogs[lastActiveYtTab.id] || [] });
                } else {
                    // 如果找不到任何影片分頁，則回退到舊的邏輯
                    chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
                        if (activeTabs[0] && activeTabs[0].id) {
                            sendResponse({ success: true, data: sessionData.errorLogs[activeTabs[0].id] || [] });
                        } else {
                            sendResponse({ success: false, data: [] });
                        }
                    });
                }
            });
            break;
    }
    return isAsync;
});