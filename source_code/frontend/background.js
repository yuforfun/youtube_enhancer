/**
 * @file background.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 2.1.0
 */
'use strict';

const sessionData = {
// 區塊: sessionData
// 功能: 一個在記憶體中運行的全域變數，用於儲存與特定分頁 (Tab) 相關的臨時資料。
//      它會在瀏覽器關閉時被清除。
// input: 由 content.js 和 injector.js 寫入。
// output: 供 content.js 和 popup.js 讀取。
// 其他補充: lastPlayerData 作為一個「信箱」，解決了 injector.js 和 content.js 之間因載入時序不同而造成的通訊問題。
    lastPlayerData: {},
    availableLangs: {}, // 【關鍵修正點】: 新增用於儲存每個 Tab 可用語言的結構
    sessionCache: {} // 【關鍵修正點】: 新增用於儲存影片翻譯暫存的結構    
};



const defaultSettings = {
// 區塊: defaultSettings
// 功能: 定義擴充功能的預設設定值。
// input: 無 (靜態物件)
// output: 在使用者首次安裝或清除儲存資料時，作為基礎設定寫入 chrome.storage。
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
    ignored_langs: ['zh-Hant']
};


chrome.runtime.onInstalled.addListener(async () => {
// 區塊: chrome.runtime.onInstalled.addListener
// 功能: 在擴充功能首次安裝或更新時執行一次的特殊事件監聽器。
// input: 無
// output: 無 (操作 Chrome Scripting API)
// 其他補充: 核心任務是透過 chrome.scripting.registerContentScripts API，以動態方式注入 injector.js。
//           這確保了 injector.js 能以最高的權限 (MAIN world) 和最早的時機 (document_start) 運行。
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
// 區塊: chrome.tabs.onRemoved.addListener
// 功能: 監聽瀏覽器分頁關閉事件。
// input: tabId (整數) - 被關閉的分頁 ID。
// output: 無 (操作 sessionData)
// 其他補充: 當一個 YouTube 分頁被關閉時，從 sessionData 中清除該分頁的暫存資料，以防止記憶體洩漏。
    delete sessionData.lastPlayerData[tabId];
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
// 功能: 擴充功能內部所有組件 (content, popup) 之間的訊息總中樞。
// input: request (物件) - 包含 action 和 payload 的訊息。
//        sender (物件) - 訊息發送者的資訊，包含 tabId。
//        sendResponse (函式) - 用於非同步回傳結果給發送者。
// output: 透過 sendResponse 回傳處理結果。
// 其他補充: 根據 request.action 的不同，分發到不同的處理邏輯。
    let isAsync = false;

    // 取得 tabId，popup 頁面發送時可能沒有 sender.tab。
    const tabId = sender.tab ? sender.tab.id : null;

    switch (request.action) {
        case 'STORE_ERROR_LOG':
            // 功能: (已修改) 接收來自 content.js 的錯誤日誌並存入 chrome.storage.session。
            // input from: content.js -> setPersistentError 函式
            // output to: content.js (透過 sendResponse 確認收到)
            // 其他補充: 用於在「診斷與日誌」頁面顯示持續性錯誤，最多儲存20筆。
            isAsync = true;
            // 【關鍵修正點】: 改用 chrome.storage.session
            chrome.storage.session.get({ 'errorLogs': [] }, (result) => {
                const logs = result.errorLogs;
                logs.push(request.payload);
                if (logs.length > 20) logs.shift(); 
                
                // 【關鍵修正點】: 改用 chrome.storage.session
                chrome.storage.session.set({ 'errorLogs': logs }, () => {
                    sendResponse({ success: true });
                });
            });
            break;
            
        case 'getErrorLogs': 
            // 功能: (已修改) 從 chrome.storage.session 讀取所有已儲存的錯誤日誌。
            // input from: popup.js (options.html) -> loadErrorLogs 函式
            // output to: popup.js (透過 sendResponse 回傳日誌陣列)
            isAsync = true;
            // 【關鍵修正點】: 改用 chrome.storage.session
            chrome.storage.session.get({ 'errorLogs': [] }, (result) => {
                sendResponse({ success: true, data: result.errorLogs });
            });
            break;
            
        case 'clearAllCache':
            // 功能: 清除所有與此擴充功能相關的暫存和日誌資料。
            // input from: popup.js (options.html) -> clearCacheButton 的點擊事件
            // output to: popup.js (透過 sendResponse 確認完成)
            // 其他補充: 用於重置擴充功能狀態，方便開發和除錯。
            isAsync = true;
            // 【關鍵修正點】: 核心修正 - 清理 chrome.storage.local 中的所有影片暫存
            chrome.storage.local.get(null, (items) => {
                const cacheKeysToRemove = Object.keys(items).filter(key => key.startsWith('yt-enhancer-cache-'));
                
                // 同時也清除錯誤日誌
                cacheKeysToRemove.push('errorLogs');
                
                chrome.storage.local.remove(cacheKeysToRemove, () => {
                    // 清理 session 記憶體中的資料
                    sessionData.lastPlayerData = {};
                    sessionData.availableLangs = {};
                    // sessionData.sessionCache 已不再使用，但為求乾淨一併清除
                    sessionData.sessionCache = {}; 
                    
                    const clearedCount = cacheKeysToRemove.filter(k => k.startsWith('yt-enhancer-cache-')).length;
                    console.log(`[Background] 成功清除了 ${clearedCount} 個影片的暫存與所有日誌。`);
                    sendResponse({ success: true, count: clearedCount });
                });
            });
            break;

        case 'getCache':
            // 功能: (已修改) 從 chrome.storage.local 獲取指定 key 的暫存資料。
            // input: key (字串) - 暫存鍵值。
            // output: (物件 | null) - 暫存的資料或 null。
            isAsync = true;
            const cacheKeyGet = request.key;
            if (tabId && cacheKeyGet) {
                // 【關鍵修正點】: 從 chrome.storage.local 非同步讀取資料
                chrome.storage.local.get([cacheKeyGet], (result) => {
                    sendResponse({ success: true, data: result[cacheKeyGet] || null });
                });
            } else {
                sendResponse({ success: false, data: null });
            }
            break;

        case 'setCache':
            // 功能: (已修改) 將資料透過 chrome.storage.local 存入指定 key 的暫存。
            // input: key (字串) - 暫存鍵值。
            //        data (物件) - 要暫存的資料。
            // output: 無
            isAsync = true; // 【關鍵修正點】: 由於 storage 操作是非同步的，必須設為 true
            const { key: cacheKeySet, data } = request;
            if (tabId && cacheKeySet) {
                if (data === null || data === undefined) {
                    // 【關鍵修正點】: 如果資料為空，則從 storage 中移除該項目
                    chrome.storage.local.remove(cacheKeySet, () => {
                        sendResponse({ success: true });
                    });
                } else {
                    // 【關鍵修正點】: 否則，將資料存入 storage
                    chrome.storage.local.set({ [cacheKeySet]: data }, () => {
                        sendResponse({ success: true });
                    });
                }
            } else {
                sendResponse({ success: false });
            }
            break;


        case 'getSettings':
            // 功能: 從 chrome.storage 讀取使用者設定，若無則回傳預設值。
            // input from: content.js -> initialSetup 函式
            //             popup.js -> loadSettings 函式
            // output to: content.js 和 popup.js (透過 sendResponse 回傳設定物件)
            // 其他補充: 回應採用兼容格式，同時包含 'data' 和 'settings' 兩個鍵，以滿足新舊不同前端的需求。
            isAsync = true;
            chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings }, (result) => {
                sendResponse({ 
                    success: true, 
                    data: result.ytEnhancerSettings,
                    settings: result.ytEnhancerSettings 
                });
            });
            break;

        case 'getGlobalState':
            // 功能: 快速獲取擴充功能的總開關狀態。
            // input from: popup.js -> updatePopupStatus 函式
            // output to: popup.js (透過 sendResponse 回傳 isEnabled 狀態)
            // 其他補充: 專為 popup 主視窗設計的輕量級請求。
            isAsync = true;
            chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings }, (result) => {
                sendResponse({ 
                    success: true, 
                    isEnabled: result.ytEnhancerSettings.isEnabled 
                });
            });
            break;

        case 'STORE_AVAILABLE_LANGS': 
            // 功能: 儲存特定分頁影片所提供的所有可用字幕語言代碼。
            // input from: content.js -> startActivationProcess 函式
            // output to: content.js (透過 sendResponse 確認收到)
            // 其他補充: 這些資料主要由 popup.js 讀取，用於動態生成「自訂來源語言」下拉選單。
            if (tabId && request.payload) { 
                sessionData.availableLangs[tabId] = request.payload;
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false });
            }
            break;
            
        case 'getAvailableLangs':
            // 功能: 獲取當前分頁可用的字幕語言列表。
            // input from: popup.js -> loadAvailableLangs 函式
            // output to: popup.js (透過 sendResponse 回傳語言代碼陣列)
            isAsync = true;
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTabId = tabs[0] ? tabs[0].id : null;
                const langs = activeTabId ? sessionData.availableLangs[activeTabId] || [] : [];
                sendResponse({ success: true, data: langs });
            });
            break;

        case 'updateSettings':
            // 功能: 更新使用者設定，將其儲存到 chrome.storage，並廣播通知所有開啟的 YouTube 分頁。
            // input from: popup.js -> saveSettings 函式
            // output to: popup.js (確認儲存) 和 所有 content.js (廣播 settingsChanged 事件)
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
            // 功能: 切換擴充功能的總開關 (isEnabled)。
            // input from: popup.js -> 主開關按鈕的點擊事件
            // output to: popup.js (回傳新的開關狀態) 和 所有 content.js (廣播 settingsChanged 事件)
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