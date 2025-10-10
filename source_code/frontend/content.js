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
    async start() {
        this._log(`[決策] --- 主流程 Start ---`);
        if (!this.currentVideoId || !this.state.playerResponse) {
            this._log(`❌ [決策] 啟動失敗，缺少 VideoID 或 playerResponse。`);
            return;
        }

        const availableTracks = this.getAvailableLanguagesFromData(this.state.playerResponse, true);
        const availableLangs = availableTracks.map(t => t.languageCode);
        this._log(`[決策] 當前影片可用語言: [${availableLangs.join(', ')}]`);
        
        const { preferred_langs = [], ignored_langs = [] } = this.settings;
        this._log(`[決策] 使用者偏好: [${preferred_langs.join(', ')}] | 忽略: [${ignored_langs.join(', ')}]`);

        const matchedLang = preferred_langs.find(pLang => availableLangs.includes(pLang));
        this._log(`[決策] 匹配結果: ${matchedLang || '無'}`);

        if (matchedLang && !ignored_langs.includes(matchedLang)) {
            this._log(`[決策] -> 路徑一: 匹配成功 (${matchedLang})，啟動自動翻譯。`);
            this.state.sourceLang = matchedLang;
            
            const cacheKey = `yt-enhancer-cache-${this.currentVideoId}`;
            const cachedData = await this.getCache(cacheKey);

            this.state.sourceLang = matchedLang;
            this._log('[意圖鎖定] 已將期望語言 sourceLang 設為:', this.state.sourceLang);

            if (cachedData && cachedData.translatedTrack) {
                this._log('[決策] 發現有效暫存，直接載入。');
                this.state.translatedTrack = cachedData.translatedTrack;
                this.activate(cachedData.rawPayload);
            } else {
                this._log(`[決策] 無暫存，命令特工啟用軌道 [${matchedLang}]...`);
                const trackToEnable = availableTracks.find(t => t.languageCode === matchedLang);
                if (trackToEnable) {
                    this.state.targetVssId = trackToEnable.vssId;
                    this._log(`[鎖定] 已鎖定目標 vssId: ${this.state.targetVssId}`);
                    
                    this._log('[看門狗] 啟動 3 秒計時器，等待字幕資料...');
                    this.state.activationWatchdog = setTimeout(() => {
                        this.handleActivationFailure();
                    }, 3000);

                    window.postMessage({ from: 'YtEnhancerContent', type: 'FORCE_ENABLE_TRACK', payload: trackToEnable }, '*');
                }
            }
        } else {
            if (matchedLang) {
                this._log(`[決策] -> 路徑四: 匹配到偏好語言 (${matchedLang})，但其在忽略清單中，進入手動模式。`);
            } else {
                this._log(`[決策] -> 路徑二: 未匹配到任何偏好語言，進入手動模式。`);
            }
            this.showManualActivationPrompt();
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
                        if(this.state.subtitleContainer) this.state.subtitleContainer.innerHTML = '';
                        this._log('溫和重置完成。');
                        // 注意：這裡不 return，讓程式碼繼續往下執行，以激活新的語言
                    } else {
                        // 語言未變，是重複數據，直接忽略
                        this._log('語言相同，忽略重複的 timedtext 數據。');
                        return;
                    }
                }

                // 步驟 3: 執行激活流程 (適用於首次激活或語言切換後的再激活)
                if (!this.state.hasActivated) { // 再次檢查，確保只有在未激活狀態下才執行
                    this.state.sourceLang = lang;
                    this._log(`成功捕獲 [${this.getFriendlyLangName(this.state.sourceLang)}] 字幕，啟動翻譯流程。`);
                    this.state.hasActivated = true;
                    this._log(`狀態更新: hasActivated -> true`);
                    this.activate(timedTextPayload);
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

    // 功能: (vssId 驗證版) 重置狀態，增加目標 vssId 鎖定。
    resetState() {
        this._log('[狀態] resetState() 執行，所有狀態還原為初始值。');
        this.state = {
            isProcessing: false, hasActivated: false, videoElement: null, statusOrb: null,
            subtitleContainer: null, translatedTrack: null, sourceLang: null,
            abortController: null, playerResponse: null, isOverride: false,
            isInitialized: false,
            pendingTimedText: null,
            activationWatchdog: null,
            targetVssId: null // 【關鍵修正點】: 新增目標 vssId 鎖定
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

    // 功能: (最終偵錯版) 清理所有UI與狀態，確保停止看門狗計時器。
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
        // ... (後續清理DOM的程式碼保持不變) ...
        document.getElementById('enhancer-status-orb')?.remove();
        document.getElementById('enhancer-subtitle-container')?.remove();
        document.getElementById('enhancer-manual-prompt')?.remove();
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
        // 功能: 解析字幕並啟動分批翻譯的總流程。
        if (this.state.isProcessing) return;
        this.state.isProcessing = true;
        if (!this.state.translatedTrack) {
            this.state.translatedTrack = this.parseRawSubtitles(payload);
        }
        if (!this.state.translatedTrack.length) {
            this._log("解析後無有效字幕句段，停止翻譯。");
            this.setOrbState('error', '無有效字幕內容');
            this.state.isProcessing = false;
            return;
        }
        this.state.translationProgress = {
            done: this.state.translatedTrack.filter(t => t.translatedText).length,
            total: this.state.translatedTrack.length
        };
        this.beginDisplay();
        await this.processNextBatch();
        this.state.isProcessing = false;
    }

    async processNextBatch() {
        // 功能: 處理下一個批次的翻譯，直到所有句子都翻譯完成。
        const BATCH_SIZE = 30;
        const segmentsToTranslate = [];
        const indicesToUpdate = [];
        for (let i = 0; i < this.state.translatedTrack.length; i++) {
            if (!this.state.translatedTrack[i].translatedText) {
                segmentsToTranslate.push(this.state.translatedTrack[i].text);
                indicesToUpdate.push(i);
                if (segmentsToTranslate.length >= BATCH_SIZE) break;
            }
        }
        if (segmentsToTranslate.length === 0) {
            this._log("所有翻譯批次處理完成！");
            this.setOrbState('success');
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
        } catch (e) {
            if (e.name !== 'AbortError') {
                this._log("❌ 翻譯批次失敗:", e);
                this.handleTranslationError(e.message);
            }
        }
    }

    handleCriticalFailure(source, message, data = {}) {
        // 功能: 統一的嚴重錯誤處理中心。
        this._log(`❌ [嚴重錯誤 | 來源: ${source}] ${message}`, data);
        this.setPersistentError(`[${source}] ${message}`);
    }

    async sendBatchForTranslation(texts, signal) {
        // 功能: 將一個批次的文字發送到本地後端進行翻譯。
        const response = await fetch('http://127.0.0.1:5001/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts, source_lang: this.state.sourceLang, models_preference: this.settings.models_preference }),
            signal
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `伺服器錯誤 ${response.status}`);
        }
        return await response.json();
    }

    handleTranslationError(errorMessage) {
        // 功能: 處理翻譯過程中的錯誤。
        this.state.tempErrorCount = (this.state.tempErrorCount || 0) + 1;
        if (this.state.tempErrorCount >= 2) this.setPersistentError(errorMessage);
        else this.showTemporaryError(errorMessage);
    }

    setPersistentError(message) {
        // 功能: 顯示一個永久性的錯誤圖示，並將錯誤記錄到 background。
        this.state.persistentError = message;
        this.sendMessageToBackground({
            action: 'STORE_ERROR_LOG',
            payload: { message, timestamp: Date.now() }
        }).catch(e => this._log('❌ 無法儲存錯誤日誌:', e));
        if (!this.state.statusOrb || !document.body.contains(this.state.statusOrb)) {
            const playerContainer = document.getElementById('movie_player');
            if (playerContainer) this.createStatusOrb(playerContainer);
        }
        this.setOrbState('error', message);
    }

    showTemporaryError(message) {
        // 功能: 在字幕區域顯示一個帶有重試按鈕的臨時錯誤訊息。
        if (!this.state.subtitleContainer || !this.state.videoElement) return;
        const currentTime = this.state.videoElement.currentTime * 1000;
        const currentSub = this.state.translatedTrack?.find(sub => currentTime >= sub.start && currentTime < sub.end);
        let html = '';
        if (this.settings.showOriginal && currentSub) html += `<div class="enhancer-line enhancer-original-line">${currentSub.text}</div>`;
        html += `<div class="enhancer-line enhancer-error-line">${message} <a href="#" id="enhancer-retry-link">點此重試</a></div>`;
        this.state.subtitleContainer.innerHTML = html;
        document.getElementById('enhancer-retry-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._log("點擊重試...");
            this.state.subtitleContainer.innerHTML = '';
            this.setOrbState('translating');
            this.processNextBatch();
        });
    }

    beginDisplay() {
        // 功能: 開始字幕的顯示流程。
        if (!this.state.videoElement || !this.state.translatedTrack) return;
        this.state.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
        this.state.videoElement.addEventListener('timeupdate', this.handleTimeUpdate);
        this.handleTimeUpdate();
    }

    handleTimeUpdate() {
        // 功能: 根據影片當前播放時間，更新字幕畫面。
        const { videoElement, translatedTrack, subtitleContainer } = this.state;
        if (!videoElement || !translatedTrack || !subtitleContainer) return;
        const currentTime = videoElement.currentTime * 1000;
        const currentSub = translatedTrack.find(sub => currentTime >= sub.start && currentTime < sub.end);
        this.updateSubtitleDisplay(currentSub?.text, currentSub?.translatedText);
    }

    updateSubtitleDisplay(originalText, translatedText) {
        // 功能: 將原文和譯文渲染到自訂的字幕容器中。
        if (!this.state.subtitleContainer) return;
        const { showOriginal, showTranslated } = this.settings;
        let html = '';
        if (showOriginal && originalText) html += `<div class="enhancer-line enhancer-original-line">${originalText}</div>`;
        if (showTranslated) {
            const displayText = translatedText || '...';
            const placeholderClass = translatedText ? '' : 'enhancer-placeholder';
            html += `<div class="enhancer-line enhancer-translated-line ${placeholderClass}">${displayText}</div>`;
        }
        this.state.subtitleContainer.innerHTML = html;
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
        // 功能: 控制右上角狀態圓環的顯示狀態。
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