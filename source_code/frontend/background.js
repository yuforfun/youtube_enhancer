// 【關鍵修正點】: 版本號更新為 5.0，以符合新架構。
/**
 * @file background.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 5.0.0 (Stable & Transparent)
 */
'use strict';

// 【關鍵修正點】: 這是 sessionData 的完整內容
// lastPlayerData 作為跨頁面「信箱」的核心功能被保留。
const sessionData = {
    lastPlayerData: {},
    availableLangs: {} // 【關鍵修正點】: 新增用於儲存每個 Tab 可用語言的結構
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

// 【關鍵修正點】: 這是 v5.0 架構的核心，確保信使 (injector.js) 總是最先被注入。
chrome.runtime.onInstalled.addListener(async () => {
    // 【關鍵修正點】: 使用 try...catch 包裹註銷操作，使其失敗時不會中斷整個流程。
    try {
        // 嘗試註銷舊的腳本，為新的註冊做準備。
        await chrome.scripting.unregisterContentScripts({ ids: ["injector-script"] });
    } catch (error) {
        // 如果在註銷時發生錯誤（例如首次安裝時找不到腳本），
        // 我們可以在控制台記錄下來除錯，但不會因此停止執行。
        if (error.message.includes("Nonexistent script ID")) {
            console.log("[Background] 無需註銷舊的 injector 腳本，直接進行安裝。");
        } else {
            console.error("[Background] 註銷舊的 injector 腳本時發生非預期錯誤:", error);
        }
    }

    // 【關鍵修正點】: 無論註銷是否成功，都必定會執行這裡的註冊新腳本的步驟。
    try {
        await chrome.scripting.registerContentScripts([{
            id: "injector-script",
            js: ["injector.js"],
            matches: ["*://www.youtube.com/*"],
            runAt: "document_start",
            world: "MAIN",
        }]);
        console.log("[Background] 新的 injector 腳本已成功註冊。");
    } catch (error) {
        console.error("[Background] 註冊新的 injector 腳本時發生嚴重錯誤:", error);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    // 當分頁關閉時，清理信箱，防止記憶體洩漏。
    delete sessionData.lastPlayerData[tabId];
});

// 請用以下內容完整替換您現有的 chrome.runtime.onMessage.addListener 整個函式區塊：

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    let isAsync = false;

    // 取得 tabId，popup 頁面發送時可能沒有 sender.tab。
    const tabId = sender.tab ? sender.tab.id : null;

    switch (request.action) {
        case 'STORE_ERROR_LOG': // 接收來自 content.js 的錯誤日誌並存入
            isAsync = true;
            chrome.storage.local.get({ 'errorLogs': [] }, (result) => {
                const logs = result.errorLogs;
                logs.push(request.payload);
                if (logs.length > 20) logs.shift(); 
                
                chrome.storage.local.set({ 'errorLogs': logs }, () => {
                    sendResponse({ success: true });
                });
            });
            break;
        case 'getErrorLogs': // 來自 Options Page：取得持久性錯誤日誌
            isAsync = true;
            chrome.storage.local.get({ 'errorLogs': [] }, (result) => {
                sendResponse({ success: true, data: result.errorLogs });
            });
            break;
            
        case 'clearAllCache': // 來自 Options Page：清除所有資料
            isAsync = true;
            sessionData.lastPlayerData = {};
            sessionData.availableLangs = {};
            chrome.storage.local.set({ 'errorLogs': [] }, () => {
                 sendResponse({ success: true, count: 0 });
            });
            break;

        case 'getSettings':
            isAsync = true;
            chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings }, (result) => {
                // # 【關鍵修正點】: 回傳兼容格式，同時滿足 content.js (需要 settings) 和 popup.js (需要 success, data)
                sendResponse({ 
                    success: true, 
                    data: result.ytEnhancerSettings,
                    settings: result.ytEnhancerSettings 
                });
            });
            break;

        case 'getGlobalState':
            isAsync = true;
            chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings }, (result) => {
                // # 【關鍵修正點】: 同樣增加 success 旗標以標準化回應格式，這對 popup.js 兼容
                sendResponse({ 
                    success: true, 
                    isEnabled: result.ytEnhancerSettings.isEnabled 
                });
            });
            break;

        case 'STORE_PLAYER_DATA': // 來自 content.js：儲存單個分頁的 Player Data
            if (tabId && request.payload) {
                sessionData.lastPlayerData[tabId] = request.payload;
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false });
            }
            break;

        case 'GET_STORED_PLAYER_DATA': // 來自 content.js：啟動時取件
            isAsync = true;
            const data = tabId ? sessionData.lastPlayerData[tabId] : null;
            if (tabId) delete sessionData.lastPlayerData[tabId];
            sendResponse({ success: true, payload: data || null });
            break;

        case 'STORE_AVAILABLE_LANGS': // 接收來自 content.js 的可用語言清單並存入
            if (tabId && request.payload) { 
                sessionData.availableLangs[tabId] = request.payload;
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false });
            }
            break;
            
        case 'getAvailableLangs': // 來自 popup.js：取得語言清單
            isAsync = true;
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTabId = tabs[0] ? tabs[0].id : null;
                const langs = activeTabId ? sessionData.availableLangs[activeTabId] || [] : [];
                sendResponse({ success: true, data: langs });
            });
            break;

        case 'updateSettings':
            isAsync = true;
            chrome.storage.local.set({ 'ytEnhancerSettings': request.data })
                .then(() => {
                    sendResponse({ success: true });
                    chrome.tabs.query({ url: "*://www.youtube.com/*" }, (tabs) => {
                        for (const tab of tabs) {
                            chrome.tabs.sendMessage(tab.id, { action: 'settingsChanged', settings: request.data }).catch(() => {});
                        }
                    });
                })
                .catch(() => sendResponse({ success: false }));
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
                            chrome.tabs.sendMessage(tab.id, { action: 'settingsChanged', settings: newSettings }).catch(() => {});
                        }
                    });
                });
            });
            break;
            
        default:
            // 忽略其他未知的同步訊息
            break;
    }
    return isAsync;
});