// 請用以下完整內容，替換您現有的整個 content.js 檔案。
/**
 * @file content.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 1.7.2 (整合所有修正的最終版)
 */
class YouTubeSubtitleEnhancer {
    constructor() {
        // 功能: 初始化 class 實例。
        // input: 無
        // output: YouTubeSubtitleEnhancer 物件實例。
        // 其他補充: 綁定 'this' 確保所有非同步函式和事件監聽器能正確存取 class 實例。
        this.log = (message, ...args) => { console.log(`%c[指揮中心]`, 'color: #007bff; font-weight: bold;', message, ...args); };
        this.error = (message, ...args) => { console.error(`%c[指揮中心]`, 'color: #dc2626; font-weight: bold;', message, ...args); };
        this.currentVideoId = null;
        this.settings = {};
        this.resetState();
        this.onMessageFromInjector = this.onMessageFromInjector.bind(this);
        this.onMessageFromBackground = this.onMessageFromBackground.bind(this);
        this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
        this.processNextBatch = this.processNextBatch.bind(this);
    }

    async initialSetup() {
        // 功能: 整個 content.js 腳本的啟動入口。
        // input: 無
        // output: 無 (設定監聽器並被動等待 injector 的啟動信號)。
        // 其他補充: 負責獲取初始設定並建立通訊渠道。
        this.log('v1.7.2 (指揮中心) 已啟動，等待現場特工回報關鍵數據...');
        const response = await this.sendMessageToBackground({ action: 'getSettings' });
        this.settings = response?.data || {};
        this.log('初始設定讀取完畢。');
        window.addEventListener('message', this.onMessageFromInjector);
        chrome.runtime.onMessage.addListener(this.onMessageFromBackground);
    }

    async start() {
        // 功能: (最終版) 主流程入口，新增了對「等候區」的檢查。
        if (!this.currentVideoId || !this.state.playerResponse) return;
        const availableTracks = this.getAvailableLanguagesFromData(this.state.playerResponse, true);
        const availableLangs = availableTracks.map(t => t.languageCode);
        const { preferred_langs = [], ignored_langs = [] } = this.settings;

        console.log('%c--- 語言匹配檢查 ---', 'color: green; font-weight: bold;');
        this.log('當前使用的「偏好順序」:', preferred_langs);
        this.log('此影片偵測到的「可用語言」:', availableLangs);
        const matchedLang = preferred_langs.find(pLang => availableLangs.includes(pLang));
        this.log('根據以上設定，匹配到的「最終結果」是:', matchedLang || '無匹配');
        console.log('%c--- 檢查完畢 ---', 'color: green; font-weight: bold;');
        if (!matchedLang || ignored_langs.includes(matchedLang)) {
            const reason = !matchedLang ? "未匹配到任何偏好語言" : `匹配到的語言 [${matchedLang}] 在忽略列表中`;
            this.log(`啟動中止: ${reason}。`);
            this.toggleNativeSubtitles(false);
            return;
        }
        this.state.sourceLang = matchedLang;
        const cacheKey = `yt-enhancer-cache-${this.currentVideoId}`;
        const cachedData = await this.getCache(cacheKey);
        if (cachedData && cachedData.translatedTrack) {
            this.log('發現有效暫存，直接載入。');
            this.state.translatedTrack = cachedData.translatedTrack;
            this.activate(cachedData.rawPayload);
        } else {
            this.log(`無暫存，匹配語言 [${matchedLang}]，命令特工啟用軌道...`);
            const trackToEnable = availableTracks.find(t => t.languageCode === matchedLang);
            if (trackToEnable) {
                window.postMessage({ from: 'YtEnhancerContent', type: 'FORCE_ENABLE_TRACK', payload: trackToEnable }, '*');
                
                // 【關鍵修正點】: 在下達指令後，檢查「等候區」是否有我們需要的資料
                if (this.state.pendingTimedText && this.state.pendingTimedText.lang === matchedLang) {
                    this.log('✅ 在「等候區」發現匹配的字幕資料，立即使用！');
                    if (this.state.hasActivated) return;
                    this.log(`成功捕獲 [${this.getFriendlyLangName(matchedLang)}] 字幕，啟動翻譯。`);
                    this.state.hasActivated = true;
                    this.activate(this.state.pendingTimedText.payload);
                    this.state.pendingTimedText = null; // 用完後清空
                }
            }
        }
    }

    async onMessageFromInjector(event) {
        // 功能: (偵錯模式) 監聽來自 injector.js 的所有訊息，並在最開始打印日誌。
        // input: event (MessageEvent)
        // output: 無
        // 其他補充: 這是檢查訊息是否成功被監聽到的關鍵。

        // 【關鍵偵錯點】: 在進行任何過濾之前，先打印所有收到的 message 事件，確認「監聽」功能正常。
        console.log(`%c[Content <- Injector] 監聽到 message 事件:`, 'color: purple;', event.data?.from, event.data?.type);
        
        if (event.source !== window || !event.data || event.data.from !== 'YtEnhancerInjector') return;
        const { type, payload } = event.data;
        switch (type) {
            case 'PLAYER_RESPONSE_CAPTURED':
                this.log('✅ 收到 PLAYER_RESPONSE_CAPTURED 信號。');
                console.log('%c[LOG-DATA-1.5] content.js 收到的 playerResponse:', 'color: blue; font-weight: bold;', payload);
                await this.cleanup();
                this.state.playerResponse = payload;
                this.currentVideoId = payload.videoDetails.videoId;
                this.log(`新影片 ID: ${this.currentVideoId}`);
                this.state.isInitialized = true;
                if (this.settings.isEnabled && this.currentVideoId) {
                    this.start();
                }
                break;
            case 'TIMEDTEXT_DATA':
                if (!this.state.isInitialized) {
                    this.log('主流程未就緒，暫存 timedtext 數據至「等候區」。');
                    this.state.pendingTimedText = payload;
                    return;
                }
                if (this.state.hasActivated || (payload.lang !== this.state.sourceLang && !this.state.isOverride)) return;
                this.log(`成功捕獲 [${this.getFriendlyLangName(this.state.sourceLang)}] 字幕，啟動翻譯。`);
                this.state.hasActivated = true;
                this.activate(payload.payload);
                break;
        }
    }

    async onMessageFromBackground(request, sender, sendResponse) {
        // 功能: 監聽來自 background.js 和 popup.js 的訊息。
        // input: request (物件), sender (物件), sendResponse (函式)。
        // output: 透過 sendResponse 回傳結果。
        // 其他補充: 處理設定變更、強制重跑等來自 UI 的指令。
        if (request.action === 'getAvailableLangsFromContent') {
            const availableLangs = this.state.playerResponse 
                ? this.getAvailableLanguagesFromData(this.state.playerResponse) 
                : [];
            sendResponse({ success: true, data: availableLangs });
            return true;
        }
        if (request.action === 'settingsChanged') {
            this.log('收到設定變更通知，正在更新...');
            const oldIsEnabled = this.settings.isEnabled;
            this.settings = request.settings;
            this.applySettingsToUI();
            if (oldIsEnabled !== this.settings.isEnabled) {
                if (this.settings.isEnabled) {
                    this.log('擴充功能已重新啟用，正在啟動翻譯流程...');
                    await this.start();
                } else {
                    this.log('擴充功能已停用，正在清理畫面...');
                    await this.cleanup(); 
                }
            }
        }
        if (request.action === 'forceRerun') {
            this.log('收到強制重跑指令，將清除暫存並重新執行主流程。');
            if (this.currentVideoId) {
                const cacheKey = `yt-enhancer-cache-${this.currentVideoId}`;
                await this.setCache(cacheKey, null);
            }
            await this.start();
        }
        if (request.action === 'translateWithOverride') {
             this.log(`收到語言覆蓋指令，目標語言: ${request.language}`);
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
                 console.log('%c[LOG-DATA-2] 準備發送 FORCE_ENABLE_TRACK 指令 (覆蓋), payload:', 'color: blue; font-weight: bold;', trackToEnable);
                 window.postMessage({ from: 'YtEnhancerContent', type: 'FORCE_ENABLE_TRACK', payload: trackToEnable }, '*');
             } else {
                 this.handleCriticalFailure('override', `在字幕清單中未找到語言「${request.language}」。`);
             }
        }
        if (sendResponse) sendResponse({ success: true });
        return true;
    }

    getAvailableLanguagesFromData(playerData, returnFullObjects = false) {
        // 功能: (最終修正版) 解析可用語言，包含正確的資料路徑和無效軌道過濾器。
        // input: playerData (物件), returnFullObjects (布林值)。
        // output: 字幕軌道陣列。
        // 其他補充: 這是確保我們只處理真實、有效字幕軌道的關鍵函式。
        try {
            const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            const validTracks = tracks.filter(track => 
                track.vssId && (track.vssId.startsWith('.') || track.vssId.startsWith('a.'))
            );
            console.log('%c[LOG-DATA-1.6] getAvailableLanguagesFromData 的解析結果:', 'color: green; font-weight: bold;', { 原始數量: tracks.length, 過濾後數量: validTracks.length, 結果: validTracks });
            if (returnFullObjects) {
                return validTracks;
            }
            return validTracks.map(t => t.languageCode);
        } catch (e) { 
            this.error("解析字幕數據失敗:", e); 
            return []; 
        }
    }

    resetState() {
        // 功能: (最終版) 重置狀態，新增 pendingTimedText 等候區。
        this.state = {
            isProcessing: false, hasActivated: false, videoElement: null, statusOrb: null,
            subtitleContainer: null, translatedTrack: null, sourceLang: null,
            abortController: null, playerResponse: null, isOverride: false,
            isInitialized: false,
            pendingTimedText: null // 【關鍵修正點】: 新增一個「等候區」來暫存過早到達的字幕
        };
    }

    async getCache(key) {
        // 功能: 從 background.js 獲取指定 key 的暫存資料。
        // input: key (字串)。
        // output: (物件 | null) 暫存資料或 null。
        try {
            const response = await this.sendMessageToBackground({ action: 'getCache', key });
            return response?.data;
        } catch (e) {
            this.error('讀取暫存失敗:', e);
            return null;
        }
    }

    async setCache(key, data) {
        // 功能: 將資料透過 background.js 存入指定 key 的暫存。
        // input: key (字串), data (物件)。
        // output: 無。
        try {
            await this.sendMessageToBackground({ action: 'setCache', key, data });
        } catch (e) {
            this.error('寫入暫存失敗:', e);
        }
    }

    async cleanup() {
        // 功能: 清理所有由擴充功能產生的 UI 元件、事件監聽器，並重置狀態。
        // input: 無。
        // output: 無。
        // 其他補充: 這是確保新舊影片狀態不互相干擾的關鍵函式。
        this.log("正在執行徹底清理...");
        this.state.abortController?.abort();
        document.getElementById('enhancer-status-orb')?.remove();
        document.getElementById('enhancer-subtitle-container')?.remove();
        this.removeGuidancePrompt();
        if (this.state.videoElement) {
            this.state.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
        }
        this.toggleNativeSubtitles(false); 
        this.resetState();
    }
    
    async activate(initialPayload) {
        // 功能: 翻譯流程的正式啟動函式。負責建立所有 UI 容器、隱藏原生字幕，並呼叫 parseAndTranslate。
        // input: initialPayload (物件) - 原始 timedtext JSON。
        // output: 無。
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
        // 功能: 將從 injector.js 傳來的原始 timedtext JSON 格式化為我們內部使用的標準化字幕物件陣列。
        // input: payload (物件)。
        // output: 標準化的字幕物件陣列。
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
        // input: payload (物件) - 原始 timedtext JSON。
        // output: 無。
        if (this.state.isProcessing) return;
        this.state.isProcessing = true;
        if (!this.state.translatedTrack) {
            this.state.translatedTrack = this.parseRawSubtitles(payload);
        }
        if (!this.state.translatedTrack.length) {
            this.log("解析後無有效字幕句段，停止翻譯。");
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
        // 功能: 處理下一個批次的翻譯，直到所有句子都翻譯完成。這是一個遞迴函式。
        // input: 無。
        // output: 無。
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
            this.log("所有翻譯批次處理完成！");
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
                if(this.state.translatedTrack[indicesToUpdate[i]]) {
                    this.state.translatedTrack[indicesToUpdate[i]].translatedText = text; 
                }
            });
            if (this.currentVideoId) {
                const cacheKey = `yt-enhancer-cache-${this.currentVideoId}`;
                const currentDoneCount = this.state.translatedTrack.filter(t=>t.translatedText).length;
                await this.setCache(cacheKey, {
                    translatedTrack: this.state.translatedTrack,
                    rawPayload: this.state.rawPayload
                });
                this.log(`批次完成 (${currentDoneCount}/${this.state.translationProgress.total})，進度已暫存。`);
            }
            await this.processNextBatch();
        } catch (e) {
            if (e.name !== 'AbortError') {
                this.error("翻譯批次失敗:", e);
                this.handleTranslationError(e.message);
            }
        }
    }

    handleCriticalFailure(source, message, data = {}) {
        // 功能: 統一的嚴重錯誤處理中心。
        // input: source (字串), message (字串), data (物件)。
        // output: 無 (呼叫 setPersistentError 顯示 UI)。
        this.error(`[嚴重錯誤 | 來源: ${source}] ${message}`, data);
        this.setPersistentError(`[${source}] ${message}`);
    }

    async sendBatchForTranslation(texts, signal) {
        // 功能: 將一個批次的文字發送到本地後端進行翻譯。
        // input: texts (字串陣列), signal (AbortSignal)。
        // output: (Promise<字串陣列>) 翻譯結果。
        const response = await fetch('http://127.0.0.1:5001/api/translate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
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
        // 功能: 處理翻譯過程中的錯誤，並決定顯示臨時還是永久性錯誤。
        // input: errorMessage (字串)。
        // output: 無。
        this.state.tempErrorCount = (this.state.tempErrorCount || 0) + 1;
        if (this.state.tempErrorCount >= 2) this.setPersistentError(errorMessage);
        else this.showTemporaryError(errorMessage);
    }

    setPersistentError(message) {
        // 功能: 顯示一個永久性的錯誤圖示，並將錯誤記錄到 background。
        // input: message (字串)。
        // output: 無。
        this.state.persistentError = message;
        this.sendMessageToBackground({ 
            action: 'STORE_ERROR_LOG', 
            payload: { message, timestamp: Date.now() } 
        }).catch(e => this.error('無法儲存錯誤日誌:', e));
        if (!this.state.statusOrb || !document.body.contains(this.state.statusOrb)) {
            const playerContainer = document.getElementById('movie_player');
            if (playerContainer) this.createStatusOrb(playerContainer);
        }
        this.setOrbState('error', message);
    }

    showTemporaryError(message) {
        // 功能: 在字幕區域顯示一個帶有重試按鈕的臨時錯誤訊息。
        // input: message (字串)。
        // output: 無。
        if (!this.state.subtitleContainer || !this.state.videoElement) return;
        const currentTime = this.state.videoElement.currentTime * 1000;
        const currentSub = this.state.translatedTrack?.find(sub => currentTime >= sub.start && currentTime < sub.end);
        let html = '';
        if (this.settings.showOriginal && currentSub) html += `<div class="enhancer-line enhancer-original-line">${currentSub.text}</div>`;
        html += `<div class="enhancer-line enhancer-error-line">${message} <a href="#" id="enhancer-retry-link">點此重試</a></div>`;
        this.state.subtitleContainer.innerHTML = html;
        document.getElementById('enhancer-retry-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.log("點擊重試...");
            this.state.subtitleContainer.innerHTML = '';
            this.setOrbState('translating');
            this.processNextBatch();
        });
    }

    beginDisplay() {
        // 功能: 開始字幕的顯示流程，註冊 videoElement 的 'timeupdate' 事件監聽。
        // input: 無。
        // output: 無。
        if (!this.state.videoElement || !this.state.translatedTrack) return;
        this.state.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
        this.state.videoElement.addEventListener('timeupdate', this.handleTimeUpdate);
        this.handleTimeUpdate();
    }

    handleTimeUpdate() {
        // 功能: 根據影片當前播放時間，尋找對應的字幕並呼叫 updateSubtitleDisplay 來更新畫面。
        // input: 無。
        // output: 無。
        const { videoElement, translatedTrack, subtitleContainer } = this.state;
        if (!videoElement || !translatedTrack || !subtitleContainer) return;
        const currentTime = videoElement.currentTime * 1000;
        const currentSub = translatedTrack.find(sub => currentTime >= sub.start && currentTime < sub.end);
        this.updateSubtitleDisplay(currentSub?.text, currentSub?.translatedText);
    }

    updateSubtitleDisplay(originalText, translatedText) {
        // 功能: 將原文和譯文渲染到我們自訂的字幕容器中。
        // input: originalText (字串), translatedText (字串)。
        // output: 無 (操作 DOM)。
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
        // input: container (DOM 元素)。
        // output: 無。
        if (document.getElementById('enhancer-status-orb')) return;
        this.state.statusOrb = document.createElement('div');
        this.state.statusOrb.id = 'enhancer-status-orb';
        container.appendChild(this.state.statusOrb);
    }
    
    removeGuidancePrompt() {
        // 功能: 移除手動模式下的引導提示框。
        // input: 無。
        // output: 無。
        document.getElementById('enhancer-prompt-guide')?.remove();
    }

    getFriendlyLangName(langCode) {
        // 功能: 將語言代碼轉換為友善的顯示名稱。
        // input: langCode (字串)。
        // output: (字串) 友善名稱。
        const langMap = { ja: '日文', ko: '韓文', en: '英文' };
        return langMap[langCode] || langCode;
    }

    setOrbState(state, errorMsg = '') {
        // 功能: 控制右上角狀態圓環的顯示狀態 (顏色、文字、百分比)。
        // input: state (字串), errorMsg (字串)。
        // output: 無 (操作 DOM)。
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
        // input: container (DOM 元素)。
        // output: 無。
        if (document.getElementById('enhancer-subtitle-container')) return;
        this.state.subtitleContainer = document.createElement('div');
        this.state.subtitleContainer.id = 'enhancer-subtitle-container';
        container.appendChild(this.state.subtitleContainer);
    }

    applySettingsToUI() {
        // 功能: 將使用者的外觀設定 (字體大小、字型) 應用到字幕容器上。
        // input: 無 (從 this.settings 讀取)。
        // output: 無 (操作 DOM)。
        if (this.state.subtitleContainer) {
            this.state.subtitleContainer.style.fontSize = `${this.settings.fontSize}px`;
            this.state.subtitleContainer.style.fontFamily = this.settings.fontFamily;
        }
    }

    toggleNativeSubtitles(hide) {
        // 功能: (最終版) 透過為播放器容器增刪 class 的方式，來控制原生字幕的顯隱。
        // input: hide (布林值)。
        // output: 無 (操作 DOM class)。
        // 其他補充: 這是解決樣式競爭問題的核心，將樣式控制權交給 CSS。
        const playerContainer = document.getElementById('movie_player');
        if (playerContainer) {
            this.log(hide ? '隱藏原生字幕 (透過 class)。' : '恢復原生字幕顯示 (透過 class)。');
            // 【關鍵修正點】: 不再直接修改 style，而是增刪一個 class
            playerContainer.classList.toggle('yt-enhancer-active', hide);
        }
    }

    async sendMessageToBackground(message) {
        // 功能: 向 background.js 發送訊息的標準化輔助函式。
        // input: message (物件)。
        // output: (Promise<物件>) background.js 的回傳結果。
        try { return await chrome.runtime.sendMessage(message); }
        catch (e) {
            if (e.message && !e.message.includes("Receiving end does not exist")) { this.error('與背景服務通訊失敗:', e); }
            return null;
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new YouTubeSubtitleEnhancer().initialSetup();
    });
} else {
    new YouTubeSubtitleEnhancer().initialSetup();
}