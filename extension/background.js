/**
 * @file background.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 4.0.2
 */
'use strict';

// 【關鍵修正點】: v1.1 - 從 backend.py 遷移常數
// 區塊: DEFAULT_CORE_PROMPT_TEMPLATE
const DEFAULT_CORE_PROMPT_TEMPLATE = `你是一位頂尖的繁體中文譯者與{source_lang}校對專家，專為台灣的使用者翻譯 YouTube 影片的自動字幕。
你收到的{source_lang}原文雖然大多正確，但仍可能包含 ASR 造成的錯字或專有名詞錯誤。

你的核心任務:
發揮你的推理能力參考上下文的內容，理解原文的真實意圖，直接翻譯當前句子為完整、自然、口語化的繁體中文，不需要辨識是誰講的話。

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
// 【關鍵修正點】 v1.2: 還原 backend.py 中的金鑰冷卻時間
const API_KEY_COOLDOWN_SECONDS = 60; // 金鑰因配額失敗後的冷卻時間（秒）
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
    "ko": `**風格指南:**
- 翻譯需符合台灣人的說話習慣，並保留說話者(偶像)的情感語氣。

**人名/專有名詞對照表 (優先級最高):**
無論上下文如何，只要看到左側的原文或讀音，就必須嚴格地翻譯為右側的詞彙。
`,
    "en": `**風格指南:**
- 翻譯需符合台灣人的說話習慣，並保留說話者的情感語氣。

**人名/專有名詞對照表 (優先級最高):**
無論上下文如何，只要看到左側的原文或讀音，就必須嚴格地翻譯為右側的詞彙。
`,
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



// 功能: 定義擴充功能的預設設定值。
// input: 無 (靜態物件)
// output: 在使用者首次安裝或清除儲存資料時，作為基礎設定寫入 chrome.storage。
// 其他補充: v4.1.3 - 新增 hqsEnabledForJa: false
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
    native_langs: ['zh-Hant'],
    auto_translate_priority_list: [
        {
            langCode: 'ja',
            name: '日文',
            customPrompt: DEFAULT_CUSTOM_PROMPTS.ja
        },
        {
            langCode: 'ko',
            name: '韓文',
            customPrompt: DEFAULT_CUSTOM_PROMPTS.ko
        },
        {
            langCode: 'en',
            name: '英文',
            customPrompt: DEFAULT_CUSTOM_PROMPTS.en
        }
    ],
    // 【關鍵修正點】: v4.1.3 - 新增 HQS 引擎啟用開關 (預設關閉)
    hqsEnabledForJa: false
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
// 其他補充: 【關鍵修正點】 v4.1.1 - 修改 'translateBatch' 並新增 'getDebugPrompts'。
    let isAsync = false;

    // 取得 tabId，popup 頁面發送時可能沒有 sender.tab。
    const tabId = sender.tab ? sender.tab.id : null;

    switch (request.action) {
        
        // 【關鍵修正點】: v4.1.1 - 'translateBatch' API 邏輯修改
        case 'translateBatch':
            // 功能: (v4.1.1) 接收、翻譯批次文字，並回傳結構化的成功或失敗回應。
            // input: request.texts (字串陣列), request.source_lang (字串), 
            //        request.models_preference (字串陣列), 
            //        request.overridePrompt (可選, 字串) - [v4.1.1 修改]
            // output: (成功) { data: [...] }
            //         (失敗) { error: 'TEMPORARY_FAILURE', retryDelay: X }
            //         (失敗) { error: 'PERMANENT_FAILURE', message: '...' }
            //         (失敗) { error: 'BATCH_FAILURE', message: '...' }
            // 其他補充: 實作金鑰/模型迴圈、冷卻機制，以及智慧錯誤分類。
            // 其他補充: 支援 overridePrompt 的「完整 Prompt 覆蓋」模式。
            isAsync = true; 
            
            (async () => {
                let errorStats = { temporary: 0, permanent: 0, batch: 0, totalAttempts: 0 };
                let keysInCooldown = 0;
                let shortestRetryDelay = API_KEY_COOLDOWN_SECONDS + 1; 

                const now = Date.now();
                const cooldownResult = await chrome.storage.session.get({ 'apiKeyCooldowns': {} });
                const cooldowns = cooldownResult.apiKeyCooldowns;
                let cooldownsUpdated = false; 

                // 【關鍵修正點】: v4.1.1 - 接收 overridePrompt 參數
                const { texts, source_lang, models_preference, overridePrompt } = request; 
                if (!texts || texts.length === 0) {
                    sendResponse({ data: [] });
                    return;
                }

                // 1. 獲取金鑰 (同 v4.0.1)
                const keyResult = await chrome.storage.local.get(['userApiKeys']);
                const apiKeys = keyResult.userApiKeys || []; 

                if (apiKeys.length === 0) { 
                    await writeToLog('ERROR', '翻譯失敗：未設定 API Key', null, '請至「診斷與日誌」分頁新增您的 API Key。'); 
                    sendResponse({ error: 'PERMANENT_FAILURE', message: '翻譯失敗：未設定 API Key。' }); 
                    return;
                }

                // 2. 組合 Prompt (v4.1.1 決策引擎更新)
                // 【關鍵修正點】開始: v4.1.1 - Prompt 選擇邏輯 (完整覆蓋)
                let fullPrompt;
                if (overridePrompt) {
                    // 情境 1: 請求來自 lab.js (開發者測試)
                    // overridePrompt 已是 "完整" Prompt，我們只需替換 JSON
                    const jsonInputText = JSON.stringify(texts);
                    // 確保替換 {json_input_text}
                    fullPrompt = overridePrompt.replace('{json_input_text}', jsonInputText);
                } else {
                    // 情境 2: 請求來自 content.js (正式翻譯)
                    // 100% 執行 v4.0.1 的舊邏輯
                    const sourceLangName = LANG_MAP[source_lang] || '原文'; 
                    const corePrompt = DEFAULT_CORE_PROMPT_TEMPLATE.replace(/{source_lang}/g, sourceLangName); 
                    
                    const settingsResult = await chrome.storage.local.get(['ytEnhancerSettings']);
                    const settings = settingsResult.ytEnhancerSettings || {};
                    const tier2List = settings.auto_translate_priority_list || [];
                    const langConfig = tier2List.find(item => item.langCode === source_lang);
                    const customPromptPart = langConfig ? langConfig.customPrompt : "";
                    
                    const jsonInputText = JSON.stringify(texts);
                    // 執行 v4.0.1 的拼接
                    fullPrompt = `${customPromptPart}\n\n${corePrompt.replace('{json_input_text}', jsonInputText)}`;
                }
                // 【關鍵修正點】結束
                
                const requestBody = {
                "contents": [
                    { "parts": [ { "text": fullPrompt } ] } // 【關鍵修正點】: 使用新的 fullPrompt 變數
                ],
                "generationConfig": {
                    "responseMimeType": "application/json"
                },
                "safetySettings": SAFETY_SETTINGS
                };

                // 3. 執行「金鑰-模型」雙重迴圈 (v4.0.1 邏輯不變)
                for (const keyInfo of apiKeys) { 
                    
                    const keyId = keyInfo.id;
                    const keyName = keyInfo.name || '未命名金鑰';
                    const currentKey = keyInfo.key;
                    const cooldownTimestamp = cooldowns[keyId];

                    if (cooldownTimestamp && now < cooldownTimestamp + (API_KEY_COOLDOWN_SECONDS * 1000)) {
                        keysInCooldown++;
                        const remainingTime = Math.ceil((cooldownTimestamp + (API_KEY_COOLDOWN_SECONDS * 1000) - now) / 1000);
                        if (remainingTime < shortestRetryDelay) {
                            shortestRetryDelay = remainingTime; 
                        }
                        
                        await writeToLog('INFO', `金鑰 '${keyName}' 仍在冷卻中 (剩餘 ${remainingTime}秒)，已跳過。`);
                        continue; 
                    } else if (cooldownTimestamp) {
                        delete cooldowns[keyId];
                        cooldownsUpdated = true; 
                    }

                    for (const modelName of models_preference) { 
                        
                        try {
                            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, { 
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
                            
                            const translatedList = JSON.parse(responseData.candidates[0].content.parts[0].text);
                            
                            if (Array.isArray(translatedList) && translatedList.length === texts.length && translatedList.every(item => typeof item === 'string')) {
                                sendResponse({ data: translatedList });
                                return; 
                            } else {
                                throw new Error('模型回傳格式錯誤 (陣列長度或型別不符)');
                            }

                        } catch (e) {

                            const errorStr = String(e.message).toLowerCase();
                            errorStats.totalAttempts++; 

                            if (errorStr.includes('quota') || errorStr.includes('429') || errorStr.includes('503') || errorStr.includes('overloaded')) {
                                errorStats.temporary++;
                                await writeToLog('WARN', `金鑰 '${keyName}' 遭遇暫時性錯誤 (Quota/Overload)，將冷卻 ${API_KEY_COOLDOWN_SECONDS} 秒。`, e.message, '系統將自動嘗試下一個金鑰。');
                                
                                cooldowns[keyId] = Date.now(); 
                                await chrome.storage.session.set({ apiKeyCooldowns: cooldowns }); 
                                
                                break; 
                            } else if (errorStr.includes('billing') || errorStr.includes('api key not valid')) {
                                errorStats.permanent++;
                                await writeToLog('ERROR', `金鑰 '${keyName}' 驗證失敗 (Billing/Invalid)，將永久跳過此金鑰。`, e.message, '請更換金鑰。');
                                break; 
                            } else {
                                errorStats.batch++;
                                await writeToLog('WARN', `金鑰 '${keyName}' 呼叫模型 '${modelName}' 失敗 (可能為格式/內容錯誤)。`, e.message, '系統將自動嘗試下一個模型。'); 
                                continue; 
                            }
                        }
                    } 
                } 

                // 5. 根據錯誤統計，回傳結構化錯誤 (v4.0.1 邏輯不變)
                if (cooldownsUpdated) {
                    await chrome.storage.session.set({ apiKeyCooldowns: cooldowns });
                }
                
                if (keysInCooldown > 0 && keysInCooldown === apiKeys.length) {
                    const retryDelay = shortestRetryDelay < 1 ? 1 : shortestRetryDelay; 
                    await writeToLog('WARN', `所有金鑰均在冷卻中，將於 ${retryDelay} 秒後重試。`);
                    sendResponse({ error: 'TEMPORARY_FAILURE', retryDelay: retryDelay });
                    return; 
                }

                if (errorStats.temporary > 0) {
                    const result = await chrome.storage.session.get({ 'errorLogs': [] });
                    const lastTemporaryError = result.errorLogs[0]; 
                    let retryDelay = 10; 
                    
                    if (lastTemporaryError && lastTemporaryError.context) {
                        const match = lastTemporaryError.context.match(/retryDelay": "(\d+)/);
                        if (match && match[1]) {
                            retryDelay = parseInt(match[1], 10);
                        }
                    }
                    await writeToLog('WARN', `所有金鑰/模型均暫時不可用，將於 ${retryDelay} 秒後重試。`);
                    sendResponse({ error: 'TEMPORARY_FAILURE', retryDelay: retryDelay });

                } else if (errorStats.permanent > 0 && errorStats.permanent === errorStats.totalAttempts) {
                    await writeToLog('ERROR', '所有 API Key 均失效 (Billing/Invalid)。', '翻譯流程已停止。', '請檢查並更換您的 API Key。');
                    sendResponse({ error: 'PERMANENT_FAILURE', message: '所有 API Key 均失效 (Billing/Invalid)。' });

                } else if (errorStats.batch > 0) {
                    await writeToLog('WARN', '模型無法處理此批次內容。', '可能為格式或內容錯誤。', '前端將標記此批次為可點擊重試。');
                    sendResponse({ error: 'BATCH_FAILURE', message: '模型無法處理此批次內容。' });
                    
                } else {
                    await writeToLog('ERROR', '所有 API Key 與模型均嘗試失敗 (未知原因)。', '請檢查日誌。', '請確認金鑰有效性、用量配額與網路連線。');
                    sendResponse({ error: '所有模型與 API Key 均嘗試失敗。' });
                }

            })(); // 立即執行 async 函式
            break;
        
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
        
        // 【關鍵修正點】: v4.1.1 - 新增 getDebugPrompts 動作
        case 'getDebugPrompts':
            // 功能: [v4.1.1] 獲取實驗室所需的預設 Prompt 內容
            // input from: lab.js
            // output: { universalPrompt, savedCustomPrompt }
            // 其他補充: 會從 storage 讀取 "真實" 的自訂 Prompt
            isAsync = true;
            (async () => {
                try {
                    // 使用 defaultSettings 作為 B 計畫
                    const result = await chrome.storage.local.get({ 'ytEnhancerSettings': defaultSettings });
                    const settings = result.ytEnhancerSettings;
                    
                    // 1. 獲取 "真實儲存的自訂 Prompt"
                    const tier2List = settings.auto_translate_priority_list || [];
                    const langConfig = tier2List.find(item => item.langCode === 'ja'); // 預設 'ja'
                    
                    let savedCustomPrompt;
                    if (langConfig && langConfig.customPrompt) {
                        // 情況 A: 找到使用者儲存的 'ja' Prompt
                        savedCustomPrompt = langConfig.customPrompt;
                    } else {
                        // 情況 B: Fallback (B 計畫)，使用硬編碼的預設 'ja' Prompt
                        savedCustomPrompt = DEFAULT_CUSTOM_PROMPTS['ja'];
                    }
                    
                    // 2. 獲取 "通用 Prompt"
                    const universalPrompt = DEFAULT_CORE_PROMPT_TEMPLATE;
                    
                    sendResponse({ success: true, universalPrompt, savedCustomPrompt });
                    
                } catch (e) {
                    console.error('[Background] getDebugPrompts 失敗:', e);
                    sendResponse({ success: false, error: e.message });
                }
            })();
            break;

        case 'diagnoseAllKeys':
            isAsync = true;
            
            (async () => {
                const results = []; 
                const keyResult = await chrome.storage.local.get(['userApiKeys']);
                const apiKeys = keyResult.userApiKeys || []; 

                if (apiKeys.length === 0) {
                    await writeToLog('WARN', '診斷失敗：未設定 API Key', null, '請至「診斷與日誌」分頁新增您的 API Key。'); 
                    sendResponse([]); 
                    return;
                }

                const testBody = {
                  "contents": [
                    { "parts": [ { "text": "test" } ] } 
                  ],
                  "generationConfig": {
                    "responseMimeType": "text/plain" 
                  }
                };

                for (const keyInfo of apiKeys) { 
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
                        
                        await writeToLog('INFO', `金鑰 '${keyName}' 診斷有效。`, null, null); 
                        results.push({ name: keyName, status: 'valid' }); 

                    } catch (e) {
                        await writeToLog('ERROR', `金鑰 '${keyName}' 診斷無效。`, e.message, '請確認金鑰是否複製正確、是否已啟用或已達用量上限。'); 
                        results.push({ name: keyName, status: 'invalid', error: e.message }); 
                    }
                }

                sendResponse(results); 
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