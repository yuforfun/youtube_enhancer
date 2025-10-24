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

// 【關鍵修正點】: v1.1 - 從 backend.py 遷移常數
// 區塊: DEFAULT_CORE_PROMPT_TEMPLATE
const DEFAULT_CORE_PROMPT_TEMPLATE = `你是一位頂尖的繁體中文譯者與{source_lang}校對專家，專為台灣的使用者翻譯 YouTube 影片的自動字幕。
你收到的{source_lang}原文雖然大多正確，但仍可能包含 ASR 造成的錯字或專有名詞錯誤。

你的核心任務:
發揮你的推理能力，理解原文的真實意圖，並直接翻譯成最自然、口語化的繁體中文。

範例:
- 輸入: ["こんにちは世界", "お元気ですか？"]
- 你的輸出應為: ["哈囉世界", "你好嗎？"]

執行指令:
請嚴格遵循以上所有指南與對照表，**「逐句翻譯」**以下 JSON 陣列中的每一句{source_lang}，並將翻譯結果以**相同順序、相同數量的 JSON 陣列格式**回傳。

{json_input_text}`;

// 區塊: lang_map
const LANG_MAP = {'ja': '日文', 'ko': '韓文', 'en': '英文'};

// 區塊: safety_settings
const SAFETY_SETTINGS = [
    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}
];
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
// 其他補充: 【關鍵修正點】 v1.1 - 新增 'translateBatch' 核心邏輯。
    let isAsync = false;

    // 取得 tabId，popup 頁面發送時可能沒有 sender.tab。
    const tabId = sender.tab ? sender.tab.id : null;

    switch (request.action) {
        
        // 【關鍵修正點】: v1.1 - 更新 'translateBatch' 以載入自訂 Prompts
        case 'translateBatch':
            isAsync = true; 
            
            (async () => {
                const { texts, source_lang, models_preference } = request; 
                if (!texts || texts.length === 0) {
                    sendResponse({ data: [] });
                    return;
                }

                // 1. 獲取金鑰 (同 階段 2)
                const keyResult = await chrome.storage.local.get(['userApiKeys']);
                const apiKeys = keyResult.userApiKeys || []; 

                if (apiKeys.length === 0) { 
                    await writeToLog('ERROR', '翻譯失敗：未設定 API Key', null, '請至「診斷與日誌」分頁新增您的 API Key。'); 
                    sendResponse({ error: '翻譯失敗：未設定 API Key。' }); 
                    return;
                }

                // 2. 組合 Prompt (階段 3 實作)
                const sourceLangName = LANG_MAP[source_lang] || '原文'; 
                const corePrompt = DEFAULT_CORE_PROMPT_TEMPLATE.replace(/{source_lang}/g, sourceLangName); 
                
                const promptResult = await chrome.storage.local.get(['customPrompts']); 
                const storedPrompts = promptResult.customPrompts || DEFAULT_CUSTOM_PROMPTS; 
                const customPromptPart = storedPrompts[source_lang] || ""; 
                
                const jsonInputText = JSON.stringify(texts);
                const fullPrompt = `${customPromptPart}\n\n${corePrompt.replace('{json_input_text}', jsonInputText)}`;
                
                const requestBody = {
                  "contents": [
                    { "parts": [ { "text": fullPrompt } ] }
                  ],
                  "generationConfig": {
                    "responseMimeType": "application/json"
                  },
                  "safetySettings": SAFETY_SETTINGS
                };

                // 3. 執行「金鑰-模型」雙重迴圈
                for (const keyInfo of apiKeys) { 
                    const keyName = keyInfo.name || '未命名金鑰';
                    const currentKey = keyInfo.key;

                    for (const modelName of models_preference) { 
                        
                        try {
                            // 【關鍵修正點】: 修正 "generativelace" 為 "generativelanguage"
                            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, { //
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'x-goog-api-key': currentKey 
                                },
                                body: JSON.stringify(requestBody)
                            });

                            if (!response.ok) {
                                let errorText = await response.text();
                                throw new Error(`HTTP ${response.status}: ${errorText}`);
                            }

                            const responseData = await response.json();
                            
                            // 4. 解析回應
                            const translatedList = JSON.parse(responseData.candidates[0].content.parts[0].text);
                            
                            if (Array.isArray(translatedList) && translatedList.length === texts.length && translatedList.every(item => typeof item === 'string')) {
                                sendResponse({ data: translatedList });
                                return; 
                            } else {
                                throw new Error('模型回傳格式錯誤 (陣列長度或型別不符)');
                            }

                        } catch (e) {
                            const errorStr = String(e.message).toLowerCase();
                            if (errorStr.includes('quota') || errorStr.includes('billing')) { 
                                await writeToLog('WARN', `金鑰 '${keyName}' 已達用量上限或帳戶無效。`, e.message, '系統將自動嘗試下一個金鑰。'); 
                                break; 
                            } else {
                                await writeToLog('WARN', `金鑰 '${keyName}' 呼叫模型 '${modelName}' 失敗。`, e.message, '系統將自動嘗試下一個模型。'); 
                                continue; 
                            }
                        }
                    } // (結束 模型 迴圈)
                } // (結束 金鑰 迴圈)

                // 5. 所有嘗試均失敗
                await writeToLog('ERROR', '所有 API Key 與模型均嘗試失敗。', '請檢查日誌中的詳細錯誤。', '請確認金鑰有效性、用量配額與網路連線。'); 
                sendResponse({ error: '所有模型與 API Key 均嘗試失敗。' }); 

            })(); // 立即執行 async 函式
            break;
        
        // --- (以下為 階段 1.B 已修改的程式碼) ---
        case 'STORE_ERROR_LOG':
            // 功能: (已修改) 接收來自 content.js 的錯誤日誌並存入 chrome.storage.session。
            // input from: content.js -> setPersistentError 函式
            // output to: content.js (透過 sendResponse 確認收到)
            // 其他補充: 【關鍵修正點】 v1.1 - 將舊格式錯誤轉換為新 LogEntry 格式
            isAsync = true;
            writeToLog('ERROR', request.payload.message)
                .then(() => sendResponse({ success: true }))
                .catch(() => sendResponse({ success: false }));
            break;
            
        case 'getErrorLogs': 
            // 功能: (已修改) 從 chrome.storage.session 讀取所有已儲存的錯誤日誌。
            // input from: popup.js (options.html) -> loadErrorLogs 函式
            // output to: popup.js (透過 sendResponse 回傳日誌陣列)
            isAsync = true;
            chrome.storage.session.get({ 'errorLogs': [] }, (result) => {
                sendResponse({ success: true, data: result.errorLogs });
            });
            break;
            
        case 'clearAllCache':
            // 功能: 清除所有與此擴充功能相關的暫存和日誌資料。
            // input from: popup.js (options.html) -> clearCacheButton 的點擊事件
            // output to: popup.js (透過 sendResponse 確認完成)
            // 其他補充: 【關鍵修正點】 v1.1 - 現在會同時清除 local (影片暫存) 和 session (日誌)
            isAsync = true;
            let clearedCount = 0;
            chrome.storage.local.get(null, (items) => {
                const cacheKeysToRemove = Object.keys(items).filter(key => key.startsWith('yt-enhancer-cache-'));
                clearedCount = cacheKeysToRemove.length;
                const localClearPromise = new Promise((resolve) => {
                    if (cacheKeysToRemove.length > 0) {
                        chrome.storage.local.remove(cacheKeysToRemove, resolve);
                    } else {
                        resolve();
                    }
                });
                const sessionClearPromise = chrome.storage.session.remove('errorLogs');
                sessionData.lastPlayerData = {};
                sessionData.availableLangs = {};
                sessionData.sessionCache = {}; 
                Promise.all([localClearPromise, sessionClearPromise])
                    .then(() => {
                        console.log(`[Background] 成功清除了 ${clearedCount} 個影片的暫存與所有日誌。`);
                        sendResponse({ success: true, count: clearedCount });
                    })
                    .catch((e) => {
                         console.error('[Background] 清除快取或日誌時發生錯誤:', e);
                         sendResponse({ success: false });
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
                    chrome.storage.local.remove(cacheKeySet, () => {
                        sendResponse({ success: true });
                    });
                } else {
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
            
        // 【關鍵修正點】: v1.1 - 新增 'diagnoseAllKeys' 核心功能
        case 'diagnoseAllKeys':
            isAsync = true;
            
            (async () => {
                const results = []; //
                const keyResult = await chrome.storage.local.get(['userApiKeys']);
                const apiKeys = keyResult.userApiKeys || []; //

                if (apiKeys.length === 0) {
                    await writeToLog('WARN', '診斷失敗：未設定 API Key', null, '請至「診斷與日誌」分頁新增您的 API Key。'); //
                    sendResponse([]); //
                    return;
                }

                const testBody = {
                  "contents": [
                    { "parts": [ { "text": "test" } ] } //
                  ],
                  "generationConfig": {
                    "responseMimeType": "text/plain" //
                  }
                };

                for (const keyInfo of apiKeys) { //
                    const keyName = keyInfo.name || '未命名金鑰';
                    try {
                        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-goog-api-key': keyInfo.key
                            },
                            body: JSON.stringify(testBody)
                        });

                        if (!response.ok) {
                            let errorText = await response.text();
                            throw new Error(`HTTP ${response.status}: ${errorText}`);
                        }
                        
                        // 測試成功
                        await writeToLog('INFO', `金鑰 '${keyName}' 診斷有效。`, null, null); //
                        results.push({ name: keyName, status: 'valid' }); //

                    } catch (e) {
                        // 測試失敗
                        await writeToLog('ERROR', `金鑰 '${keyName}' 診斷無效。`, e.message, '請確認金鑰是否複製正確、是否已啟用或已達用量上限。'); //
                        results.push({ name: keyName, status: 'invalid', error: e.message }); //
                    }
                }

                sendResponse(results); //
            })();
            
            break;
            
        default:
            // 忽略其他未知的同步訊息
            break;
    }
    return isAsync;
});

// 【關鍵修正點】: 根據規格 1.B，新增標準化日誌函式
// 功能: 將標準化的日誌條目寫入 chrome.storage.session
// input: level ('ERROR' | 'WARN' | 'INFO')
//        message (string) - 白話說明
//        context (string | null) - 原始錯誤資訊
//        solution (string | null) - 解決方法
// output: (Promise) 寫入 storage
// 其他補充: 這是 v1.1 藍圖中的核心日誌公用函式
async function writeToLog(level, message, context = null, solution = null) {
    try {
        const newEntry = {
            timestamp: Date.now(), //
            level: level,
            message: message,
            context: context,
            solution: solution
        };

        const result = await chrome.storage.session.get({ 'errorLogs': [] }); //
        const logs = result.errorLogs;
        
        logs.unshift(newEntry); // (最新在前)

        if (logs.length > 20) { //
            logs.length = 20; // 維持最大長度
        }

        await chrome.storage.session.set({ 'errorLogs': logs }); //
    } catch (e) {
        console.error('[Background] writeToLog 函式執行失敗:', e);
    }
}