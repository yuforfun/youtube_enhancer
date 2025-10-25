// 請用以下完整內容，替換您現有的整個 content.js 檔案。
/**
 * @file content.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 2.1.0 (Debug Build 8.0)
 */

// 【關鍵修正點】: 新增偵錯模式開關和計時器
const DEBUG_MODE = true;
const scriptStartTime = performance.now();

class YouTubeSubtitleEnhancer {
    constructor() {
        // 功能: 初始化 class 實例。
        // 【關鍵修正點】: 建立一個詳細的日誌記錄器
        this._log = (message, ...args) => {
            if (DEBUG_MODE) {
                const timestamp = (performance.now() - scriptStartTime).toFixed(2).padStart(7, ' ');
                console.log(`%c[指揮中心@${timestamp}ms]`, 'color: #059669; font-weight: bold;', message, ...args);
            }
        };
        this.currentVideoId = null;
        this.settings = {};
        this.requestIntervalId = null;
        this.resetState();
        this.onMessageFromInjector = this.onMessageFromInjector.bind(this);
        this.onMessageFromBackground = this.onMessageFromBackground.bind(this);
        this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
        this.processNextBatch = this.processNextBatch.bind(this);
    }

    async initialSetup() {
        // 功能: (偵錯版) 腳本總入口，主動向 injector.js 請求資料，包含詳細日誌。
        this._log('v8.0 (偵錯模式) 已啟動。');
        const response = await this.sendMessageToBackground({ action: 'getSettings' });
        this.settings = response?.data || {};
        this._log('初始設定讀取完畢:', this.settings);
        window.addEventListener('message', this.onMessageFromInjector);
        chrome.runtime.onMessage.addListener(this.onMessageFromBackground);
        this.requestPlayerResponse();
    }

    requestPlayerResponse() {
        // 功能: (偵錯版) 主動、重複地向 injector.js 請求資料，直到成功，包含詳細日誌。
        let attempts = 0;
        const MAX_ATTEMPTS = 25; // 最多嘗試5秒 (25 * 200ms)
        this._log('🤝 [握手] 開始向現場特工輪詢請求核心資料...');

        const sendRequest = () => {
            if (this.state.isInitialized) {
                this._log('🤝 [握手] 資料已收到，停止輪詢請求。');
                clearInterval(this.requestIntervalId);
                return;
            }
            if (attempts >= MAX_ATTEMPTS) {
                this._log('❌ [握手] 輪詢超時(5秒)，仍未收到現場特工的回應，停止請求。');
                clearInterval(this.requestIntervalId);
                return;
            }
            // 【關鍵修正點】: 每次請求都打印日誌
            this._log(`🤝 [握手] 發送第 ${attempts + 1} 次 REQUEST_PLAYER_RESPONSE 信號...`);
            window.postMessage({ from: 'YtEnhancerContent', type: 'REQUEST_PLAYER_RESPONSE' }, '*');
            attempts++;
        };
        sendRequest();
        this.requestIntervalId = setInterval(sendRequest, 200);
    }

    // 功能: (vssId 驗證版) 主流程入口，在發出指令前鎖定目標 vssId。
    // 【關鍵修正點】: v2.0 - 完全重寫為 Tier 1/2/3 決策引擎
    async start() {
        this._log(`[決策 v2.0] --- 主流程 Start ---`);
        if (!this.currentVideoId || !this.state.playerResponse) {
            this._log(`❌ [決策] 啟動失敗，缺少 VideoID 或 playerResponse。`);
            return;
        }

        const availableTracks = this.getAvailableLanguagesFromData(this.state.playerResponse, true);
        const availableLangs = availableTracks.map(t => t.languageCode);
        this._log(`[決策] 可用語言: [${availableLangs.join(', ')}]`);

        // 【關鍵修正點】 v2.0 - 讀取新的 Tier 1/2 設定
        const { native_langs = [], auto_translate_priority_list = [] } = this.settings;
        this._log(`[決策] Tier 1 (原文): [${native_langs.join(', ')}]`);
        this._log(`[決策] Tier 2 (自動): [${auto_translate_priority_list.map(t => t.langCode).join(', ')}]`);

        // --- TIER 1 檢查：原文顯示 (零成本) ---
        const nativeMatch = availableLangs.find(lang => native_langs.includes(lang));
        if (nativeMatch) {
            this._log(`[決策] -> Tier 1 命中：匹配到原文顯示語言 (${nativeMatch})。`);
            const trackToEnable = availableTracks.find(t => t.languageCode === nativeMatch); // 【關鍵修正點】 確保傳遞完整軌道
            if (trackToEnable) this.runTier1_NativeView(trackToEnable);
            return; // 流程結束
        }

        // --- TIER 2 檢查：自動翻譯 (高品質) ---
        let tier2Match = null;
        for (const priorityItem of auto_translate_priority_list) {
            if (availableLangs.includes(priorityItem.langCode)) {
                tier2Match = availableTracks.find(t => t.languageCode === priorityItem.langCode);
                break; // 找到第一個匹配的，停止搜尋
            }
        }
        
        if (tier2Match) {
            this._log(`[決策] -> Tier 2 命中：匹配到自動翻譯語言 (${tier2Match.languageCode})。`);
            
            // (重用舊的 activate 邏輯)
            this.state.sourceLang = tier2Match.languageCode;
            this._log('[意圖鎖定] 已將期望語言 sourceLang 設為:', this.state.sourceLang);
            
            const cacheKey = `yt-enhancer-cache-${this.currentVideoId}`;
            const cachedData = await this.getCache(cacheKey);
            
            if (cachedData && cachedData.translatedTrack) {
                this._log('[決策] 發現有效暫存，直接載入。');
                this.state.translatedTrack = cachedData.translatedTrack;
                this.activate(cachedData.rawPayload); // 觸發翻譯
            } else {
                this._log(`[決策] 無暫存，命令特工啟用軌道 [${tier2Match.languageCode}]...`);
                this.state.targetVssId = tier2Match.vssId;
                this._log(`[鎖定] 已鎖定目標 vssId: ${this.state.targetVssId}`);
                this.state.activationWatchdog = setTimeout(() => this.handleActivationFailure(), 3000);
                window.postMessage({ from: 'YtEnhancerContent', type: 'FORCE_ENABLE_TRACK', payload: tier2Match }, '*');
            }
            return; // 流程結束
        }

        // --- TIER 3 檢查：按需翻譯 (Fallback) ---
        // 【關鍵修正點】 v2.0 - 優先選擇非 'a.' (自動) 的軌道
        const nonAutoTrack = availableTracks.find(t => !t.vssId.startsWith('a.'));
        const fallbackTrack = nonAutoTrack || availableTracks[0];

        if (fallbackTrack) {
            this._log(`[決策] -> Tier 3 觸發：進入按需翻譯模式 (${fallbackTrack.languageCode})。`);
            this.runTier3_OnDemand(fallbackTrack);
        } else {
            this._log(`[決策] -> 無任何可用字幕，停止。`);
        }
    }

    /**
     * 功能: 處理來自 injector.js 的所有訊息，包含修復後的語言切換邏輯。
     * input: event (MessageEvent) - 來自 injector.js 的訊息事件。
     * output: 根據訊息類型觸發對應的核心流程。
     * 其他補充: 這是擴充功能邏輯的核心中樞，處理導航、資料接收和字幕處理。
     */
    async onMessageFromInjector(event) {
        if (event.source !== window || !event.data || event.data.from !== 'YtEnhancerInjector') return;

        const { type, payload } = event.data;

        switch (type) {
            case 'YT_NAVIGATED':
                this._log(`📢 [導航通知] 收到來自特工的換頁通知 (新影片ID: ${payload.videoId})，準備徹底重置...`);
                await this.cleanup();
                this.requestPlayerResponse();
                break;

            case 'PLAYER_RESPONSE_CAPTURED':
                this._log('🤝 [握手] 成功收到 PLAYER_RESPONSE_CAPTURED 信號！');
                if (this.state.isInitialized) {
                    this._log('警告：在已初始化的狀態下再次收到 PLAYER_RESPONSE，忽略。');
                    return;
                }
                
                this.state.playerResponse = payload;
                this.currentVideoId = payload.videoDetails.videoId;
                
                this._log(`設定新影片 ID: ${this.currentVideoId}`);
                this.state.isInitialized = true;
                this._log(`狀態更新: isInitialized -> true`);
                if (this.settings.isEnabled && this.currentVideoId) {
                    this.start();
                }
                break;

            // 【關鍵修正點】開始: 重構整個 TIMEDTEXT_DATA 處理邏輯，以正確處理語言切換
            case 'TIMEDTEXT_DATA':
                const { payload: timedTextPayload, lang, vssId } = payload;
                this._log(`收到 [${lang}] (vssId: ${vssId || 'N/A'}) 的 TIMEDTEXT_DATA。`);

                // 【關鍵修正點】開始: 新增全域開關防護機制
                if (!this.settings.isEnabled && !this.state.isOverride) {
                    this._log('擴充功能目前為停用狀態，已忽略收到的 timedtext 數據。');
                    if (this.state.hasActivated) {
                        this._log('偵測到狀態殘留，執行溫和重置以關閉字幕。');
                        this.state.abortController?.abort();
                        this.state.translatedTrack = null;
                        this.state.isProcessing = false;
                        this.state.hasActivated = false;
                        if(this.state.subtitleContainer) this.state.subtitleContainer.innerHTML = '';
                    }
                    return; // 關鍵：在此處停止
                }
                // 【關鍵修正點】結束

                // 步驟 1: 處理與看門狗相關的初始啟用驗證
                if (this.state.activationWatchdog) {
                    const isVssIdMatch = this.state.targetVssId && vssId === this.state.targetVssId;
                    const isLangMatchWithoutVssId = !vssId && lang === this.state.sourceLang;

                    if (!isVssIdMatch && !isLangMatchWithoutVssId) {
                        this._log(`[驗證失敗] 忽略了非目標字幕。目標 vssId: [${this.state.targetVssId}], 目標 lang: [${this.state.sourceLang}] | 收到 vssId: [${vssId || 'N/A'}], lang: [${lang}]`);
                        return;
                    }
                    this._log(`[驗證成功] 收到的字幕符合預期 (vssId 匹配或 lang 匹配)。`);
                    clearTimeout(this.state.activationWatchdog);
                    this.state.activationWatchdog = null;
                    this._log('[看門狗] 成功收到目標字幕，看門狗已解除。');
                }
                // 清除 targetVssId，避免影響後續的手動切換操作
                this.state.targetVssId = null;

                // 步驟 2: 判斷是「首次激活」、「語言切換」還是「重複數據」
                if (this.state.hasActivated) {
                    // 如果已激活，判斷語言是否變化
                    if (lang !== this.state.sourceLang) {
                        // 語言發生變化，執行「溫和重置」
                        this._log(`[語言切換] 偵測到語言從 [${this.state.sourceLang}] -> [${lang}]。執行溫和重置...`);
                        this.state.abortController?.abort();
                        this.state.translatedTrack = null;
                        this.state.isProcessing = false;
                        this.state.hasActivated = false; // 重置激活狀態，這是讓後續流程能繼續的關鍵
                        
                        // 【關鍵修正點】 v2.0 - 重置 Tier 1/3 旗標
                        this.state.isNativeView = false; 
                        
                        if(this.state.subtitleContainer) this.state.subtitleContainer.innerHTML = '';
                        this._log('溫和重置完成。');
                    } else {
                        // 語言未變，是重複數據，直接忽略
                        this._log('語言相同，忽略重複的 timedtext 數據。');
                        return;
                    }
                }

                // 步驟 3: 執行激活流程 (適用於首次激活或語言切換後的再激活)
                if (!this.state.hasActivated) { // 再次檢查，確保只有在未激活狀態下才執行
                    this.state.sourceLang = lang;
                    this.state.hasActivated = true;
                    this._log(`狀態更新: hasActivated -> true`);

                    // 【關鍵修正點】 v2.0 - 根據 isNativeView 旗標決定啟動哪個流程
                    if (this.state.isNativeView) {
                        this._log(`[Tier 1/3] 啟動 activateNativeView (僅原文) 流程。`);
                        this.activateNativeView(timedTextPayload);
                    } else {
                        this._log(`[Tier 2] 啟動 activate (完整翻譯) 流程。`);
                        this.activate(timedTextPayload);
                    }
                }
                break;
            // 【關鍵修正點】結束
        }
    }


    async onMessageFromBackground(request, sender, sendResponse) {
        // 功能: 監聽來自 background.js 和 popup.js 的訊息。
        if (request.action === 'getAvailableLangsFromContent') {
            const availableLangs = this.state.playerResponse ?
                this.getAvailableLanguagesFromData(this.state.playerResponse) :
                [];
            sendResponse({ success: true, data: availableLangs });
            return true;
        }
        if (request.action === 'settingsChanged') {
            this._log('收到設定變更通知，正在更新...');
            const oldIsEnabled = this.settings.isEnabled;
            this.settings = request.settings;
            this.applySettingsToUI();
            if (oldIsEnabled !== this.settings.isEnabled) {
                if (this.settings.isEnabled) {
                    this._log('擴充功能已重新啟用，正在啟動翻譯流程...');
                    await this.start();
                } else {
                    this._log('擴充功能已停用，正在清理畫面...');
                    await this.cleanup();
                }
            }
        }
        if (request.action === 'forceRerun') {
            this._log('收到強制重跑指令，將清除暫存並重新執行主流程。');
            if (this.currentVideoId) {
                const cacheKey = `yt-enhancer-cache-${this.currentVideoId}`;
                await this.setCache(cacheKey, null);
            }
            await this.start();
        }
        if (request.action === 'translateWithOverride') {
            this._log(`收到語言覆蓋指令，目標語言: ${request.language}`);
            if (!this.state.playerResponse) {
                this.handleCriticalFailure('override', `缺少字幕清單 (playerResponse)，無法執行語言覆蓋。`);
                sendResponse({ success: false });
                return true;
            }
            this.state.abortController?.abort();
            document.getElementById('enhancer-status-orb')?.remove();
            document.getElementById('enhancer-subtitle-container')?.remove();
            this.toggleNativeSubtitles(false);
            this.state.hasActivated = false;
            this.state.isProcessing = false;
            this.state.translatedTrack = null;
            this.state.sourceLang = request.language;
            this.state.isOverride = true;
            const availableTracks = this.getAvailableLanguagesFromData(this.state.playerResponse, true);
            const trackToEnable = availableTracks.find(t => t.languageCode === request.language);
            if (trackToEnable) {
                window.postMessage({ from: 'YtEnhancerContent', type: 'FORCE_ENABLE_TRACK', payload: trackToEnable }, '*');
            } else {
                this.handleCriticalFailure('override', `在字幕清單中未找到語言「${request.language}」。`);
            }
        }
        if (sendResponse) sendResponse({ success: true });
        return true;
    }

    getAvailableLanguagesFromData(playerData, returnFullObjects = false) {
        // 功能: 解析可用語言，包含正確的資料路徑和無效軌道過濾器。
        try {
            const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            const validTracks = tracks.filter(track =>
                track.vssId && (track.vssId.startsWith('.') || track.vssId.startsWith('a.'))
            );
            if (returnFullObjects) {
                return validTracks;
            }
            return validTracks.map(t => t.languageCode);
        } catch (e) {
            this._log("❌ 解析字幕數據失敗:", e);
            return [];
        }
    }

    // 功能: (v3.1.2 修改) 重置狀態，增加目標 vssId 鎖定與重試監聽旗標。
    // 【關鍵修正點】: v2.0 - 新增 isNativeView 和 onDemandButton 旗標
    resetState() {
        this._log('[狀態] resetState() 執行，所有狀態還原為初始值。');
        this.state = {
            isProcessing: false, hasActivated: false, videoElement: null, statusOrb: null,
            subtitleContainer: null, translatedTrack: null, sourceLang: null,
            abortController: null, playerResponse: null, isOverride: false,
            isInitialized: false,
            pendingTimedText: null,
            activationWatchdog: null,
            targetVssId: null, // 【關鍵修正點】: 新增目標 vssId 鎖定
            hasRetryListener: false, // 【關鍵修正點】: v3.1.0 - 新增批次重試監聽旗標
            isNativeView: false, // 【關鍵修正點】 v2.0 - Tier 1/3 旗標
            onDemandButton: null // 【關鍵修正點】 v2.0 - Tier 3 按鈕 DOM 參照
        };
    }

    async getCache(key) {
        // 功能: 從 background.js 獲取指定 key 的暫存資料。
        try {
            const response = await this.sendMessageToBackground({ action: 'getCache', key });
            return response?.data;
        } catch (e) {
            this._log('❌ 讀取暫存失敗:', e);
            return null;
        }
    }

    async setCache(key, data) {
        // 功能: 將資料透過 background.js 存入指定 key 的暫存。
        try {
            await this.sendMessageToBackground({ action: 'setCache', key, data });
        } catch (e) {
            this._log('❌ 寫入暫存失敗:', e);
        }
    }

    // 功能: (v3.1.2 修改) 清理所有UI與狀態，確保停止看門狗並移除重試監聽。
    // 【關鍵修正點】: v2.0 - 新增移除 onDemandButton 邏輯
    async cleanup() {
        this._log('--- 🧹 cleanup() 開始 ---');
        this.state.abortController?.abort();

        // 【關鍵修正點】: 在清理時，一併清除尚未觸發的看門狗計時器
        if (this.state.activationWatchdog) {
            clearTimeout(this.state.activationWatchdog);
            this._log('[看門狗] 已清除看門狗計時器。');
        }

        if (this.requestIntervalId) {
            this._log('停止請求輪詢的計時器。');
            clearInterval(this.requestIntervalId);
            this.requestIntervalId = null;
        }
        
        // 【關鍵修正點】: v3.1.0 - 移除批次重試點擊監聽器
        if (this.state.subtitleContainer && this.state.hasRetryListener) {
            this.state.subtitleContainer.removeEventListener('click', this.handleRetryBatchClick);
            this._log('已移除批次重試點擊監聽器。');
            this.state.hasRetryListener = false;
        }
        
        document.getElementById('enhancer-status-orb')?.remove();
        document.getElementById('enhancer-subtitle-container')?.remove();
        document.getElementById('enhancer-manual-prompt')?.remove();
        
        // 【關鍵修正點】 v2.0 - 移除 Tier 3 按鈕
        document.getElementById('enhancer-ondemand-button')?.remove();
        
        this._log('已移除所有 UI DOM 元素。');
        
        if (this.state.videoElement) {
            this.state.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
            this._log('已移除 timeupdate 事件監聽器。');
        }
        
        this.toggleNativeSubtitles(false); 
        this.resetState();
        this._log('--- ✅ cleanup() 完成 ---');
    }

    // 功能: (vssId 驗證版) 處理自動啟用字幕超時，確保清除鎖定。
    handleActivationFailure() {
        this._log('❌ [看門狗] 自動啟用字幕超時！');
        this.state.activationWatchdog = null;
        // 【關鍵修正點】: 失敗時也要清除鎖定，以便後續手動操作能正常運作
        this.state.targetVssId = null; 
        
        if (!this.state.subtitleContainer) {
            const playerContainer = document.getElementById('movie_player');
            if(playerContainer) this.createSubtitleContainer(playerContainer);
        }
        if(this.state.subtitleContainer) {
            this.state.subtitleContainer.innerHTML = `<div class="enhancer-line enhancer-error-line">自動啟用字幕失敗，請手動選擇字幕</div>`;
        }
    }

    // 【關鍵修正點】 v2.0 - 新增 Tier 1 啟動函式
    runTier1_NativeView(trackToEnable) {
        // 功能: 僅顯示原文，不翻譯 (Tier 1)。
        this._log(`[Tier 1] 執行 runTier1_NativeView，語言: ${trackToEnable.languageCode}`);
        
        // 1. (重要) 設置旗標，告訴 TIMEDTEXT_DATA 處理器應進入原文模式
        this.state.isNativeView = true;
        this.state.sourceLang = trackToEnable.languageCode; // 記錄當前語言
        
        // 2. 確保清除舊狀態 (例如 Tier 3 按鈕)
        this.cleanup(); 
        this.state.isNativeView = true; // cleanup 會重置，需再次設定
        this.state.sourceLang = trackToEnable.languageCode;

        // 3. 請求 injector.js 啟用軌道
        this._log(`[Tier 1] 命令特工啟用軌道 [${trackToEnable.languageCode}]...`);
        this.state.targetVssId = trackToEnable.vssId;
        this.state.activationWatchdog = setTimeout(() => this.handleActivationFailure(), 3000);
        window.postMessage({ from: 'YtEnhancerContent', type: 'FORCE_ENABLE_TRACK', payload: trackToEnable }, '*');
    }

    // 【關鍵修正點】 v2.0 - 新增 Tier 3 啟動函式
    runTier3_OnDemand(trackToEnable) {
        // 功能: 顯示原文 + 右上角 Hover 按鈕 (Tier 3)。
        this._log(`[Tier 3] 執行 runTier3_OnDemand，語言: ${trackToEnable.languageCode}`);
        
        // 1. 設置旗標，進入原文模式
        this.state.isNativeView = true;
        this.state.sourceLang = trackToEnable.languageCode;
        
        // 2. 確保清除舊狀態
        this.cleanup();
        this.state.isNativeView = true; // cleanup 會重置，需再次設定
        this.state.sourceLang = trackToEnable.languageCode;
        
        // 3. 建立按鈕
        const playerContainer = document.getElementById('movie_player');
        if (!playerContainer) return;
        
        const btn = document.createElement('div');
        btn.id = 'enhancer-ondemand-button';
        btn.innerHTML = '翻譯'; // 使用 CSS 來設定樣式
        btn.title = `將 ${this.getFriendlyLangName(trackToEnable.languageCode)} 翻譯為中文`;
        
        // 綁定點擊事件
        this.handleOnDemandTranslateClick = this.handleOnDemandTranslateClick.bind(this);
        btn.addEventListener('click', () => this.handleOnDemandTranslateClick(trackToEnable));
        
        playerContainer.appendChild(btn);
        this.state.onDemandButton = btn; // 儲存參照
        
        // 4. 請求 injector.js 啟用軌道 (以顯示原文)
        this._log(`[Tier 3] 命令特工啟用軌道 [${trackToEnable.languageCode}] (僅原文)...`);
        this.state.targetVssId = trackToEnable.vssId;
        this.state.activationWatchdog = setTimeout(() => this.handleActivationFailure(), 3000);
        window.postMessage({ from: 'YtEnhancerContent', type: 'FORCE_ENABLE_TRACK', payload: trackToEnable }, '*');
    }

    // 【關鍵修正點】 v2.0 - 新增 Tier 3 點擊處理函式
    async handleOnDemandTranslateClick(trackToEnable) {
        // 功能: Tier 3 按鈕的點擊事件處理。
        this._log(`[Tier 3] 按鈕被點擊，開始翻譯 ${trackToEnable.languageCode}`);
        
        // 1. 移除按鈕
        this.state.onDemandButton?.remove();
        this.state.onDemandButton = null;

        // 2. (重要) 解除原文模式旗標
        this.state.isNativeView = false;
        
        // 3. 執行「溫和重置」以準備進入 Tier 2 流程
        this.state.abortController?.abort();
        this.state.translatedTrack = null;
        this.state.isProcessing = false;
        this.state.hasActivated = false;
        if(this.state.subtitleContainer) this.state.subtitleContainer.innerHTML = '';
        
        // 4. (同 Tier 2) 檢查快取或觸發 activate() 流程
        this.state.sourceLang = trackToEnable.languageCode;
        this._log('[意圖鎖定] 已將期望語言 sourceLang 設為:', this.state.sourceLang);

        const cacheKey = `yt-enhancer-cache-${this.currentVideoId}`;
        const cachedData = await this.getCache(cacheKey);

        if (cachedData && cachedData.translatedTrack) {
            this._log('[Tier 3->2] 發現快取，直接載入。');
            this.state.translatedTrack = cachedData.translatedTrack;
            this.activate(cachedData.rawPayload); // 觸發完整翻譯
        } else {
            this._log(`[Tier 3->2] 無快取，命令特工重新獲取軌道...`);
            // 注意：此時軌道應已在原文模式下載入，
            // 我們需要觸發 TIMEDTEXT_DATA 再次傳來，
            // 但由於 isNativeView = false，這次它將觸發 activate()。
            // 為保險起見，再次發送啟用命令。
            this.state.targetVssId = trackToEnable.vssId;
            this.state.activationWatchdog = setTimeout(() => this.handleActivationFailure(), 3000);
            window.postMessage({ from: 'YtEnhancerContent', type: 'FORCE_ENABLE_TRACK', payload: trackToEnable }, '*');
        }
    }

    // 【關鍵修正點】 v2.0 - 新增 Tier 1/3 的啟動函式 (activate 簡化版)
    activateNativeView(initialPayload) {
        // 功能: 啟動原文顯示流程 (不翻譯)。
        this.removeGuidancePrompt();
        this.state.rawPayload = initialPayload;
        this.state.videoElement = document.querySelector('video');
        const playerContainer = document.getElementById('movie_player');
        if (!this.state.videoElement || !playerContainer) {
            this.handleCriticalFailure('activateNativeView', "找不到播放器元件，啟動失敗。");
            return;
        }
        
        // (不建立狀態圓環 Orb)
        this.createSubtitleContainer(playerContainer);
        this.applySettingsToUI();
        this.toggleNativeSubtitles(true); // 隱藏原生字幕
        
        // (不呼叫 parseAndTranslate)
        if (!this.state.translatedTrack) {
            this.state.translatedTrack = this.parseRawSubtitles(initialPayload);
        }
        if (!this.state.translatedTrack.length) {
            this._log("解析後無有效字幕句段。");
            return;
        }
        
        this.beginDisplay(); // 直接開始顯示
        this._log(`[Tier 1/3] 原文模式 (activateNativeView) 啟動完畢。`);
    }

    async activate(initialPayload) {
        // 功能: 翻譯流程的正式啟動函式。
        this.removeGuidancePrompt();
        this.state.rawPayload = initialPayload;
        this.state.videoElement = document.querySelector('video');
        const playerContainer = document.getElementById('movie_player');
        if (!this.state.videoElement || !playerContainer) {
            this.handleCriticalFailure('activate', "找不到播放器元件，啟動失敗。");
            return;
        }
        this.createStatusOrb(playerContainer);
        this.createSubtitleContainer(playerContainer);
        this.applySettingsToUI();
        this.toggleNativeSubtitles(true);
        this.setOrbState('translating');
        await this.parseAndTranslate(initialPayload);
    }

    parseRawSubtitles(payload) {
        // 功能: 將原始 timedtext JSON 格式化為內部使用的標準化字幕物件陣列。
        if (!payload?.events) return [];
        const subtitles = payload.events
            .map(event => ({
                start: event.tStartMs,
                end: event.tStartMs + (event.dDurationMs || 5000),
                text: event.segs?.map(seg => seg.utf8).join('') || '',
            }))
            .filter(sub => sub.text.trim());
        for (let i = 0; i < subtitles.length - 1; i++) {
            subtitles[i].end = subtitles[i + 1].start;
        }
        return subtitles.map(sub => ({ ...sub, translatedText: null }));
    }

    async parseAndTranslate(payload) {
        // 功能: (v3.1.1 補丁) 解析字幕並啟動分批翻譯的總流程。
        // input: payload (timedtext 物件)
        // output: 無 (啟動 processNextBatch 遞迴)
        // 其他補充: 【關鍵修正點】 移除了函式結尾的 this.state.isProcessing = false;
        if (this.state.isProcessing) return;
        this.state.isProcessing = true;
        if (!this.state.translatedTrack) {
            this.state.translatedTrack = this.parseRawSubtitles(payload);
        }
        if (!this.state.translatedTrack.length) {
            this._log("解析後無有效字幕句段，停止翻譯。");
            this.setOrbState('error', '無有效字幕內容');
            this.state.isProcessing = false; // (此處為 '無字幕' 的出口，是正確的)
            return;
        }
        this.state.translationProgress = {
            done: this.state.translatedTrack.filter(t => t.translatedText).length,
            total: this.state.translatedTrack.length
        };
        this.beginDisplay();
        await this.processNextBatch();
        
        // 【關鍵修正點】: (v3.1.1 補丁)
        // 移除: this.state.isProcessing = false;
        // 說明: isProcessing 旗標的關閉，將交由 processNextBatch 內部
        //       在「真正成功」或「永久失敗」時自行處理，以確保 setTimeout 得以正常運作。
    }

    async processNextBatch() {
        // 功能: (v3.1.1 補丁) 處理翻譯批次，並在正確的出口管理 isProcessing 旗標。
        // input: 無 (從 this.state.translatedTrack 讀取)
        // output: (遞迴呼叫) 或 (觸發錯誤 UI)
        // 其他補充: 【關鍵修正點】 在 3 個流程終點新增 this.state.isProcessing = false;
        const BATCH_SIZE = 30;
        const segmentsToTranslate = [];
        const indicesToUpdate = [];
        for (let i = 0; i < this.state.translatedTrack.length; i++) {
            if (!this.state.translatedTrack[i].translatedText && !this.state.translatedTrack[i].tempFailed) { // 確保不重試 tempFailed
                segmentsToTranslate.push(this.state.translatedTrack[i].text);
                indicesToUpdate.push(i);
                if (segmentsToTranslate.length >= BATCH_SIZE) break;
            }
        }
        if (segmentsToTranslate.length === 0) {
            this._log("所有翻譯批次處理完成！");
            this.setOrbState('success');
            this.state.isProcessing = false; // 【關鍵修正點】: (補丁) 1. 成功出口
            return;
        }
        const alreadyDone = this.state.translatedTrack.filter(t => t.translatedText).length;
        this.state.translationProgress.done = alreadyDone;
        this.setOrbState('translating');
        this.state.abortController = new AbortController();
        try {
            const translatedTexts = await this.sendBatchForTranslation(segmentsToTranslate, this.state.abortController.signal);
            if (translatedTexts.length !== segmentsToTranslate.length) {
                throw new Error("翻譯回傳的句數與請求不符。");
            }
            translatedTexts.forEach((text, i) => {
                if (this.state.translatedTrack[indicesToUpdate[i]]) {
                    this.state.translatedTrack[indicesToUpdate[i]].translatedText = text;
                }
            });
            if (this.currentVideoId) {
                const cacheKey = `yt-enhancer-cache-${this.currentVideoId}`;
                const currentDoneCount = this.state.translatedTrack.filter(t => t.translatedText).length;
                await this.setCache(cacheKey, {
                    translatedTrack: this.state.translatedTrack,
                    rawPayload: this.state.rawPayload
                });
                this._log(`批次完成 (${currentDoneCount}/${this.state.translationProgress.total})，進度已暫存。`);
            }
            await this.processNextBatch();

        // 【關鍵修正點】: v3.1.0 - 重構 catch 區塊以響應智慧錯誤
        } catch (e) {
            const errorMsg = String(e.message);

            // 1. (v1.2 Bug 修正) 處理 AbortError
            if (errorMsg.includes('AbortError')) {
                this._log("翻譯任務已中止 (AbortError)，此為正常操作。");
                // (注意: AbortError 也算 'isProcessing = false'，但通常由 cleanup 觸發)
                this.state.isProcessing = false;
                return; // 結束，不重試
            }

            this._log("❌ 翻譯批次失敗:", e);

            // 2. 響應 v3.1.0 智慧錯誤
            if (errorMsg.includes('TEMPORARY_FAILURE')) {
                // 情境一：暫時性錯誤 (429/503)
                // (流程仍在繼續，*不*設定 isProcessing = false)
                const retryDelayMatch = errorMsg.match(/retryDelay: (\d+)/);
                const retryDelay = (retryDelayMatch && retryDelayMatch[1]) ? parseInt(retryDelayMatch[1], 10) : 10;
                const retryDelayMs = (retryDelay + 1) * 1000;
                
                this._log(`偵測到模型暫時性過載，${retryDelay} 秒後重試...`);
                this.setOrbState('retrying'); // 顯示黃色狀態 (階段 3 會優化 UI)
                
                setTimeout(() => {
                    // 檢查狀態，如果使用者已導航離開，則不重試
                    // (v3.1.1 補丁: 移除 isProcessing 檢查，因為它會被 parseAndTranslate 錯誤地關閉)
                    // (v3.1.2 補丁: 恢復 isProcessing 檢查，因為 parseAndTranslate 已修復)
                    if (this.state.isProcessing && this.state.abortController) { 
                         this.processNextBatch();
                    }
                }, retryDelayMs); // 使用 API 建議的延遲 + 1s 緩衝

            } else if (errorMsg.includes('PERMANENT_FAILURE')) {
                // 情境二：永久性金鑰錯誤
                this.state.isProcessing = false; // 【關鍵修正點】: (補丁) 2. 永久失敗出口
                this.handleTranslationError("所有 API Key 均失效或帳單錯誤，翻譯已停止。");
            
            } else if (errorMsg.includes('BATCH_FAILURE')) {
                // 情境三：模型無法處理此批次
                // (流程仍在繼續，*不*設定 isProcessing = false)
                this._log("此批次翻譯失敗，標記為可重試。");
                indicesToUpdate.forEach(index => {
                    if (this.state.translatedTrack[index]) {
                        // 標記為臨時失敗，但不儲存 translatedText: null
                        this.state.translatedTrack[index].tempFailed = true; 
                    }
                });
                // 關鍵：繼續執行下一批次，以推進進度條
                await this.processNextBatch(); 

            } else {
                // 兜底：處理其他永久性錯誤 (例如 "未設定金鑰" 或舊的錯誤)
                this.state.isProcessing = false; // 【關鍵修正點】: (補丁) 3. 兜底失敗出口
                this.handleTranslationError(e.message);
            }
        }
        // 【關鍵修正點】: 結束
    }

    handleCriticalFailure(source, message, data = {}) {
        // 功能: 統一的嚴重錯誤處理中心。
        this._log(`❌ [嚴重錯誤 | 來源: ${source}] ${message}`, data);
        this.setPersistentError(`[${source}] ${message}`);
    }

    async sendBatchForTranslation(texts, signal) {
        // 功能: (v3.1.0 修改) 將批次文字發送到 background.js，並拋出結構化的錯誤。
        // input: texts (字串陣列), signal (AbortSignal)
        // output: (Promise) 翻譯後的字串陣列
        // 其他補充: 【關鍵修正點】 v1.1 - 移除 fetch 127.0.0.1
        try {
            const response = await this.sendMessageToBackground({
                action: 'translateBatch', //
                texts: texts,
                source_lang: this.state.sourceLang,
                models_preference: this.settings.models_preference
            });

            if (signal.aborted) {
                throw new Error('AbortError'); // 模擬 AbortError
            }

            // 【關鍵修正點】: v3.1.0 - 組合並拋出結構化錯誤
            if (response?.error) {
                // 如果 background.js 處理失敗 (例如 TEMPORARY_FAILURE)
                // 將包含 retryDelay 的完整錯誤訊息拋出
                let structuredError = response.error;
                if (response.retryDelay) {
                    structuredError += ` (retryDelay: ${response.retryDelay})`;
                }
                throw new Error(structuredError); // 拋出 "TEMPORARY_FAILURE (retryDelay: 22)"
            }

            if (response?.data && Array.isArray(response.data)) {
                return response.data;
            }

            // 未知的成功回應格式
            throw new Error('來自背景服務的回應格式不正確。');
            
        } catch (e) {
            // 捕獲 sendMessage 本身的錯誤 或 background.js 回傳的錯誤
            if (e.message.includes("Receiving end does not exist")) {
                 throw new Error('無法連線至擴充功能背景服務。');
            }
            throw e; // 將錯誤 (例如 "TEMPORARY_FAILURE (retryDelay: 22)") 拋給 processNextBatch
        }
    }

    handleTranslationError(errorMessage) {
        // 功能: 處理翻譯過程中的錯誤。
        // 其他補充: 【關鍵修正點】 v1.1 - 移除 tempErrorCount 邏輯。
        // 【關鍵修正點】 v1.2 (討論): 將 logThisError 設為 false，
        //           因為 background.js (日誌 1) 已經記錄了這個錯誤的根本原因。
        this.setPersistentError(errorMessage, false);
    }

    setPersistentError(message, logThisError = true) {
        // 功能: 顯示一個永久性的錯誤圖示，並將錯誤記錄到 background。
        this.state.persistentError = message;

        // 【關鍵修正點】 v1.2 (討論): 增加 logThisError 參數，避免 background.js 和 content.js 重複記錄日誌 (日誌 2)
        if (logThisError) {
            this.sendMessageToBackground({
                action: 'STORE_ERROR_LOG',
                payload: { message, timestamp: Date.now() }
            }).catch(e => this._log('❌ 無法儲存錯誤日誌:', e));
        }
        
        if (!this.state.statusOrb || !document.body.contains(this.state.statusOrb)) {
            const playerContainer = document.getElementById('movie_player');
            if (playerContainer) this.createStatusOrb(playerContainer);
        }
        this.setOrbState('error', message);
    }

    showTemporaryError(message) {
        // 功能: (已修改) 在字幕區域顯示一個帶有重試按鈕的臨時錯誤訊息。
        // 其他補充: 【關鍵修正點】 v1.1 - 此功能已廢除。
        //           所有錯誤現在都由 setPersistentError 處理，
        //           並顯示在右上角的狀態圓環 (orb) 中，
        //           不再於字幕區域 顯示錯誤訊息。
        
        // (原函式內容 已被清空)
    }

    beginDisplay() {
        // 功能: 開始字幕的顯示流程。
        if (!this.state.videoElement || !this.state.translatedTrack) return;
        this.state.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
        this.state.videoElement.addEventListener('timeupdate', this.handleTimeUpdate);
        this.handleTimeUpdate();
    }

    handleTimeUpdate() {
        // 功能: (v3.1.0 修改) 根據影片當前播放時間，更新字幕畫面。
        // input: 無 (從 this.state 讀取)
        // output: 呼叫 updateSubtitleDisplay
        // 其他補充: 移除傳遞參數，因為 updateSubtitleDisplay 已被修改為自行處理。
        const { videoElement, translatedTrack, subtitleContainer } = this.state;
        if (!videoElement || !translatedTrack || !subtitleContainer) return;
        
        // 【關鍵修正點】: v3.1.0 - 不再傳遞參數
        this.updateSubtitleDisplay();
    }

    updateSubtitleDisplay() {
        // 功能: (v3.1.0 修改) 將原文/譯文/批次失敗UI 渲染到自訂的字幕容器中。
        // 【關鍵修正點】: v2.0 - 新增 isNativeView 邏輯
        // input: 無 (自行從 this.state 獲取)
        // output: (DOM 操作)
        if (!this.state.subtitleContainer || !this.state.videoElement || !this.state.translatedTrack) return;

        const currentTime = this.state.videoElement.currentTime * 1000;
        const currentSub = this.state.translatedTrack.find(sub => currentTime >= sub.start && currentTime < sub.end);

        // 【關鍵修正點】: v3.1.0 - 新增情境三 (批次失敗) UI 邏輯
        if (currentSub && currentSub.tempFailed) {
            // 1. 渲染批次失敗 UI
            const html = `<div class="enhancer-line enhancer-error-line" data-start-ms="${currentSub.start}">此批次翻譯失敗，<a class="retry-link" role="button" tabindex="0">點擊重試</a></div>`;
            if (this.state.subtitleContainer.innerHTML !== html) {
                this.state.subtitleContainer.innerHTML = html;
            }
            this.addRetryClickListener(); // 確保監聽器已綁定
            return; // 結束此函式
        }
        
        const originalText = currentSub?.text;
        const translatedText = currentSub?.translatedText;
        
        // 【關鍵修正點】 v2.0 - Tier 1/3 原文模式邏輯
        if (this.state.isNativeView) {
            let html = '';
            if (originalText) {
                // 在原文模式下，使用 "translated-line" 的樣式 (較大、較粗) 來顯示原文
                html += `<div class="enhancer-line enhancer-translated-line">${originalText}</div>`;
            }
            if (this.state.subtitleContainer.innerHTML !== html) {
                this.state.subtitleContainer.innerHTML = html;
            }
            return; // 結束此函式
        }

        // 2. 渲染正常翻譯 UI (Tier 2 邏輯)
        const { showOriginal, showTranslated } = this.settings;
        let html = '';
        if (showOriginal && originalText) html += `<div class="enhancer-line enhancer-original-line">${originalText}</div>`;
        if (showTranslated) {
            const displayText = translatedText || '...';
            const placeholderClass = translatedText ? '' : 'enhancer-placeholder';
            html += `<div class="enhancer-line enhancer-translated-line ${placeholderClass}">${displayText}</div>`;
        }
        
        if (this.state.subtitleContainer.innerHTML !== html) {
            this.state.subtitleContainer.innerHTML = html;
        }
    }

    addRetryClickListener() {
        // 功能: 為字幕容器綁定「點擊重試」的事件監聽器。
        // input: 無
        // output: (DOM 事件綁定)
        // 其他補充: 使用 hasRetryListener 旗標確保只綁定一次。
        if (this.state.hasRetryListener || !this.state.subtitleContainer) return;
        
        // 綁定 'handleRetryBatchClick'，並確保 this 上下文正確
        this.handleRetryBatchClick = this.handleRetryBatchClick.bind(this);
        
        this.state.subtitleContainer.addEventListener('click', this.handleRetryBatchClick);
        this.state.hasRetryListener = true;
        this._log('[重試] 批次重試監聽器已綁定。');
    }

    // 【關鍵修正點】: v3.1.0 - 新增函式
    async handleRetryBatchClick(e) {
        // 功能: 處理「點擊重試」事件，執行插隊翻譯。
        // input: e (ClickEvent)
        // output: (API 呼叫)
        // 其他補充: 找出所有 tempFailed 的句子並發送一次性翻譯請求。
        if (!e.target.classList.contains('retry-link')) return;

        e.preventDefault();
        e.stopPropagation();

        const line = e.target.closest('.enhancer-error-line');
        if (!line) return;

        this._log(`[插隊重試] 收到點擊，重試所有 'tempFailed' 批次...`);

        // 1. 找出所有標記為 tempFailed 的句子
        const segmentsToRetry = [];
        const indicesToUpdate = [];
        this.state.translatedTrack.forEach((sub, i) => {
            if (sub.tempFailed) {
                segmentsToRetry.push(sub.text);
                indicesToUpdate.push(i);
            }
        });

        if (segmentsToRetry.length === 0) {
            this._log('[插隊重試] 未找到標記為失敗的句子。');
            return;
        }

        e.target.textContent = '翻譯中...';
        e.target.style.pointerEvents = 'none'; // 防止重複點擊

        // 2. 執行一次性的翻譯請求
        try {
            const translatedTexts = await this.sendBatchForTranslation(
                segmentsToRetry, 
                new AbortController().signal // 使用一個新 signal
            );

            if (translatedTexts.length !== segmentsToRetry.length) {
                throw new Error("翻譯回傳的句數與請求不符。");
            }

            // 3. 更新數據
            translatedTexts.forEach((text, i) => {
                const trackIndex = indicesToUpdate[i];
                if (this.state.translatedTrack[trackIndex]) {
                    this.state.translatedTrack[trackIndex].translatedText = text;
                    this.state.translatedTrack[trackIndex].tempFailed = false; // 清除旗標
                }
            });

            // 4. 儲存快取並立即刷新 UI
            await this.setCache(`yt-enhancer-cache-${this.currentVideoId}`, {
                translatedTrack: this.state.translatedTrack,
                rawPayload: this.state.rawPayload
            });
            this.handleTimeUpdate(); // 立即刷新當前字幕
            this._log('[插隊重試] 成功，快取已更新。');

        } catch (error) {
            this._log('❌ [插隊重試] 失敗:', error);
            if (e.target) {
                e.target.textContent = '重試失敗!';
                e.target.style.pointerEvents = 'auto';
            }
            // 讓使用者可以再次嘗試
        }
    }
    createStatusOrb(container) {
        // 功能: 建立右上角的狀態圓環 UI 元件。
        if (document.getElementById('enhancer-status-orb')) return;
        this.state.statusOrb = document.createElement('div');
        this.state.statusOrb.id = 'enhancer-status-orb';
        container.appendChild(this.state.statusOrb);
    }

    removeGuidancePrompt() {
        // 功能: 移除手動模式下的引導提示框。
        document.getElementById('enhancer-prompt-guide')?.remove();
    }

    showManualActivationPrompt() {
        // 功能: 顯示一個5秒後自動消失的提示，引導使用者手動開啟字幕。
        if (document.getElementById('enhancer-manual-prompt')) return;
        const playerContainer = document.getElementById('movie_player');
        if (!playerContainer) return;

        const promptContainer = document.createElement('div');
        promptContainer.id = 'enhancer-manual-prompt';
        promptContainer.className = 'enhancer-prompt-guide';
        promptContainer.innerHTML = `<div class="enhancer-prompt-box enhancer-manual-box">可以手動開啟字幕進行翻譯</div>`;
        playerContainer.appendChild(promptContainer);

        const ccButton = document.querySelector('.ytp-subtitles-button');
        if (ccButton) {
            const playerRect = playerContainer.getBoundingClientRect();
            const ccRect = ccButton.getBoundingClientRect();
            promptContainer.style.position = 'absolute';
            promptContainer.style.left = `${ccRect.left - playerRect.left + (ccRect.width / 2)}px`;
            promptContainer.style.bottom = `${playerRect.height - (ccRect.top - playerRect.top) + 15}px`;
            promptContainer.style.transform = 'translateX(-50%)';
        }

        setTimeout(() => {
            promptContainer.style.opacity = '0';
            setTimeout(() => promptContainer.remove(), 500);
        }, 5000);

        setTimeout(() => {
            promptContainer.style.opacity = '1';
        }, 50);
    }

    getFriendlyLangName(langCode) {
        // 功能: 將語言代碼轉換為友善的顯示名稱。
        const langMap = { ja: '日文', ko: '韓文', en: '英文' };
        return langMap[langCode] || langCode;
    }

    setOrbState(state, errorMsg = '') {
        // 功能: (v3.1.0 修改) 控制右上角狀態圓環的顯示狀態。
        // input: state (字串), errorMsg (可選字串)
        // output: (DOM 操作)
        // 其他補充: 【關鍵修正點】 v3.1.0 - 修改 'retrying' 狀態的 UI。
        const orb = this.state.statusOrb;
        if (!orb) return;
        orb.className = 'enhancer-status-orb';
        orb.classList.add(`state-${state}`);
        const { translationProgress: progress, sourceLang } = this.state;
        const langName = this.getFriendlyLangName(sourceLang);
        switch (state) {
            case 'translating':
                if (progress && progress.total > 0) {
                    const percent = Math.round((progress.done / progress.total) * 100);
                    orb.innerHTML = `<div>${percent}%</div>`;
                    orb.title = `翻譯中: [${langName}] ${progress.done}/${progress.total}`;
                } else {
                    orb.innerHTML = '<div>%</div>';
                    orb.title = `匹配語言: [${langName}] - 等待字幕文字...`;
                }
                break;
            case 'success':
                orb.innerHTML = '<div>✓</div>';
                orb.title = '翻譯成功';
                setTimeout(() => orb?.classList.add('fade-out'), 1500);
                break;
            
            // 【關鍵修正點】 v3.1.0: 修改 "重試中" 狀態
            case 'retrying':
                if (progress && progress.total > 0) {
                    const percent = Math.round((progress.done / progress.total) * 100);
                    orb.innerHTML = `<div>${percent}%</div>`; // 顯示進度 %
                    orb.title = `模型暫時過載，自動重試中... (${progress.done}/${progress.total})`;
                } else {
                    orb.innerHTML = '<div>%</div>'; // Fallback
                    orb.title = '模型暫時過載，自動重試中...';
                }
                break;
                
            case 'error':
                orb.innerHTML = '<div>!</div>';
                orb.title = `發生錯誤: ${errorMsg}`;
                break;
        }
    }

    createSubtitleContainer(container) {
        // 功能: 建立用於顯示雙語字幕的 UI 容器。
        if (document.getElementById('enhancer-subtitle-container')) return;
        this.state.subtitleContainer = document.createElement('div');
        this.state.subtitleContainer.id = 'enhancer-subtitle-container';
        container.appendChild(this.state.subtitleContainer);
    }

    applySettingsToUI() {
        // 功能: 將使用者的外觀設定應用到字幕容器上。
        if (this.state.subtitleContainer) {
            this.state.subtitleContainer.style.fontSize = `${this.settings.fontSize}px`;
            this.state.subtitleContainer.style.fontFamily = this.settings.fontFamily;
        }
    }

    toggleNativeSubtitles(hide) {
        // 功能: 透過為播放器容器增刪 class 來控制原生字幕的顯隱。
        const playerContainer = document.getElementById('movie_player');
        if (playerContainer) {
            playerContainer.classList.toggle('yt-enhancer-active', hide);
        }
    }

    async sendMessageToBackground(message) {
        // 功能: 向 background.js 發送訊息的標準化輔助函式。
        try {
            return await chrome.runtime.sendMessage(message);
        } catch (e) {
            if (e.message && !e.message.includes("Receiving end does not exist")) {
                this._log('❌ 與背景服務通訊失敗:', e);
            }
            return null;
        }
    }
}

// 確保在 DOM 載入後才執行
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new YouTubeSubtitleEnhancer().initialSetup();
    });
} else {
    new YouTubeSubtitleEnhancer().initialSetup();
}