/**
 * @file content.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 6.1.0 (Stable Refactor)
 */
class YouTubeSubtitleEnhancer {
    constructor() {
        // 功能: 初始化 class 實例，設定日誌格式、初始狀態，並手動綁定所有需要作為事件處理器的方法。
        // input: 無
        // output: (YouTubeSubtitleEnhancer 物件)
        // 其他補充: 手動綁定是為了確保在非同步或事件回呼中，'this' 的指向永遠正確，避免 '... is not a function' 的錯誤。
        this.log = (message, ...args) => { console.log(`%c[現場經理]`, 'color: #007bff; font-weight: bold;', message, ...args); };
        this.error = (message, ...args) => { console.error(`%c[現場經理]`, 'color: #dc2626; font-weight: bold;', message, ...args); };

        this.currentVideoId = null;
        this.settings = {};
        this.resetState();
        
        // # 【關鍵修正點】: 顯式手動綁定所有需要作為事件監聽器或非同步回呼的函式。
        // # 這是為了解決 '... is not a function' 的致命錯誤。
        this.onNavigation = this.onNavigation.bind(this);
        this.onMessageFromInjector = this.onMessageFromInjector.bind(this);
        this.onMessageFromBackground = this.onMessageFromBackground.bind(this);
        this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
        this.findPlayerAndCommand = this.findPlayerAndCommand.bind(this);
    }

    async initialSetup() {
        // 功能: 整個 content.js 腳本的啟動入口，在 DOM 載入後執行一次。
        // input: 無
        // output: 無
        // 其他補充: 負責獲取初始設定、註冊所有頂層的事件監聽器。
        this.log('v6.1 (Stable Refactor) 已啟動，開始準備環境。');
        
        const response = await this.sendMessageToBackground({ action: 'getSettings' });
        this.settings = response?.data || {};
        this.log('初始設定讀取完畢，目前總開關狀態:', this.settings.isEnabled ? '開啟' : '關閉');
        
        window.addEventListener('message', this.onMessageFromInjector);
        chrome.runtime.onMessage.addListener(this.onMessageFromBackground);
        document.addEventListener('yt-navigate-finish', this.onNavigation);
        
        await this.onNavigation();
        this.log('環境準備完成，已開始監聽頁面活動。');
    }

    async onNavigation() {
        // 功能: 處理 YouTube 的 'yt-navigate-finish' 事件，當使用者在站內切換影片時觸發。
        // input: (事件物件)
        // output: 無
        // 其他補充: 核心任務是呼叫 cleanup() 來重置所有狀態，為新頁面做準備。在新架構下，它不再主動觸發任何流程。
        const newVideoId = new URLSearchParams(window.location.search).get('v');
        if (this.currentVideoId === newVideoId && newVideoId !== null) return;
        
        this.log(`偵測到頁面切換 (影片 ID: ${newVideoId || '非影片頁面'})，正在重設所有狀態...`);
        await this.cleanup();
        this.currentVideoId = newVideoId;
    }
    
    async onMessageFromInjector(event) {
        // 功能: 監聽來自 injector.js 的所有訊息，是新架構下的核心觸發點和訊息中樞。
        // input from: injector.js (透過 window.postMessage)
        // output to: startActivationProcess() 或 processTimedTextData() 或 switchToManualMode()
        // 其他補充: 根據訊息類型的不同，分發到不同的處理函式。也負責扮演 injector 和 background 之間的通訊橋樑。
        if (event.source !== window || !event.data || event.data.from !== 'YtEnhancerInjector') return;

        const { type, payload } = event.data;

        switch (type) {
            case 'GET_SETTINGS_FROM_INJECTOR':
                // 作為橋樑，幫助 injector 獲取設定
                this.log('收到信使的請求，正在向總調度獲取設定...');
                const response = await this.sendMessageToBackground({ action: 'getSettings' });
                if (response?.success) {
                    window.postMessage({ type: 'SETTINGS_RESPONSE_FROM_CONTENT', payload: response.data }, '*');
                }
                break;

            case 'TIMEDTEXT_DATA':
                // 收到最終字幕內容，啟動翻譯
                this.log(`收到信使送來的「${payload.lang}」字幕文字，準備翻譯...`);
                this.processTimedTextData(payload);
                break;
                
            case 'AUTOMATION_FAILED':
                // 收到自動化失敗的通知，切換到手動模式
                this.log('收到信使的自動化失敗通知，切換至手動模式。');
                if (payload.playerResponse) {
                    this.switchToManualMode(payload.playerResponse);
                } else {
                    this.error('自動化失敗，且無法獲取字幕清單以提供手動提示。');
                }
                break;
        }
    }
    
    async onMessageFromBackground(request, sender, sendResponse) {
        // 功能: 監聽來自 background.js 的訊息，主要用於接收設定變更或來自 popup 的指令。
        // input from: background.js (透過 chrome.runtime.sendMessage)
        // output: 無
        if (request.action === 'settingsChanged') {
            this.log('收到設定變更通知，正在更新...');
            const oldIsEnabled = this.settings.isEnabled;
            this.settings = request.settings;
            this.applySettingsToUI();
            
            if (oldIsEnabled !== this.settings.isEnabled) {
                if (this.settings.isEnabled) {
                    await this.onNavigation();
                } else {
                    await this.cleanup(); 
                }
            }
        }
        if (request.action === 'forceRerun') {
            this.log('收到強制重跑指令，將通知信使重新執行主流程。');
            await this.cleanup();
            window.postMessage({ type: 'RERUN_INJECTOR_MAIN' }, '*');
        }
        sendResponse({ success: true });
        return true;
    }

    startActivationProcess(playerData) {
        // 功能: 在收到 PLAYER_DATA 後，作為自動化流程 (Plan A) 的啟動器。
        // input from: onMessageFromInjector
        // output to: findPlayerAndCommand()
        // 其他補充: 負責匹配語言，如果匹配成功，則呼叫帶有重試機制的 findPlayerAndCommand 來接手後續。
        if (!this.settings.isEnabled || this.state.sourceLang || this.state.hasActivated) return;

        this.log('開始分析字幕清單，匹配您的偏好語言...');
        const captionData = playerData?.playerCaptionsTracklistRenderer;
        const availableTracks = captionData?.captionTracks || [];
        const availableLangs = availableTracks.map(track => track.languageCode);
        
        this.sendMessageToBackground({ 
            action: 'STORE_AVAILABLE_LANGS', 
            payload: availableLangs 
        }).catch(e => this.error('無法儲存可用語言列表至 Background Service:', e));

        if (availableLangs.length === 0) {
            this.log('此影片沒有提供任何機器或人工字幕。');
            return;
        }

        const { preferred_langs = [], ignored_langs = [] } = this.settings;
        const matchedLang = preferred_langs.find(pLang =>
            availableLangs.includes(pLang) && !ignored_langs.includes(pLang)
        );

        if (matchedLang) {
            this.state.sourceLang = matchedLang;
            this.log(`語言匹配成功！已鎖定「${this.getFriendlyLangName(matchedLang)}」。現在開始嘗試自動啟用...`);
            const trackToEnable = availableTracks.find(t => t.languageCode === matchedLang);
            this.findPlayerAndCommand(trackToEnable, playerData);
        } else {
            this.log('影片提供的字幕語言與您的偏好設定不符。');
        }
    }

    async findPlayerAndCommand(trackToEnable, playerData, retryCount = 0) {
        // 功能: Plan A 的核心執行者，以重試機制穩定地尋找播放器物件並下達啟用字幕的命令。
        // input: trackToEnable (物件) - 要啟用的字幕軌道資訊。
        //        playerData (物件) - 完整的字幕清單，用於 Plan B fallback。
        //        retryCount (整數) - 當前重試次數。
        // output to: 成功時 -> YouTube 播放器 API
        //            失敗時 -> switchToManualMode()
        const MAX_RETRIES = 10;
        const RETRY_INTERVAL = 1000;

        const player = this.getPlayerInstance();
        if (player) {
            this.log(`成功獲取播放器實例 (嘗試 ${retryCount + 1} 次)。正在命令播放器啟用字幕...`);
            this.startFallbackListener();
            this.log(`正在命令播放器啟用字幕軌道:`, trackToEnable);
            player.setOption('captions', 'track', {
                languageCode: trackToEnable.languageCode,
                ...(trackToEnable.vssId && { "vssId": trackToEnable.vssId }) 
            });
        } else {
            if (retryCount < MAX_RETRIES) {
                this.log(`未找到播放器API，將在 ${RETRY_INTERVAL}ms 後重試 (${retryCount + 1}/${MAX_RETRIES})...`);
                setTimeout(() => this.findPlayerAndCommand(trackToEnable, playerData, retryCount + 1), RETRY_INTERVAL);
            } else {
                this.error(`重試 ${MAX_RETRIES} 次後仍無法獲取播放器API，自動模式失敗。`);
                this.switchToManualMode(playerData);
            }
        }
    }

    processTimedTextData({ payload, lang }) {
        // 功能: 處理從 injector.js 收到的最終字幕內容 (TIMEDTEXT_DATA)。
        // input from: onMessageFromInjector
        // output to: activate()
        // 其他補充: 無論是自動還是手動模式，這都是觸發翻譯前的最後一站。它會做最後的語言檢查，然後啟動 activate。
        if (this.state.hasActivated) return;

        if (!this.state.sourceLang) {
            const { preferred_langs = [] } = this.settings;
            if (preferred_langs.includes(lang)) {
                this.log(`手動模式觸發：已確認「${this.getFriendlyLangName(lang)}」為偏好語言。`);
                this.state.sourceLang = lang;
            } else {
                return;
            }
        }
        
        if (lang !== this.state.sourceLang) return;

        this.log(`成功捕獲到已鎖定的「${this.getFriendlyLangName(lang)}」字幕文字，翻譯流程正式啟動！`);
        this.state.isProcessing = false;
        this.stopFallbackListener();
        this.state.hasActivated = true;
        this.activate(payload);
    }
    
    // --- 以下為輔助函數與UI操作 ---

    resetState() {
        // 功能: 將 class 的 state 物件重置為初始狀態。
        this.state = {
            isProcessing: false, hasActivated: false,
            videoElement: null, statusOrb: null, subtitleContainer: null,
            translatedTrack: null, sourceLang: null,
            abortController: null,
            fallbackObserver: null,
            fallbackListenerActive: false,
        };
    }

    async cleanup() {
        // 功能: 清理所有由擴充功能產生的 UI 元件、事件監聽器，並重置狀態。
        this.log("正在清理舊的狀態與畫面元件...");
        this.stopFallbackListener();
        this.state.abortController?.abort();
        if (this.state.videoElement) {
            this.state.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
        }
        document.getElementById('enhancer-status-orb')?.remove();
        document.getElementById('enhancer-subtitle-container')?.remove();
        this.removeGuidancePrompt();
        this.toggleNativeSubtitles(false); 
        this.resetState();
    }
    
    async activate(initialPayload) {
        // 功能: 翻譯流程的正式啟動函式。負責建立所有 UI 容器、隱藏原生字幕，並呼叫 parseAndTranslate。
        this.removeGuidancePrompt();
        
        this.state.videoElement = document.querySelector('video');
        const playerContainer = document.getElementById('movie_player');
        if (!this.state.videoElement || !playerContainer) {
            this.error("找不到播放器元件，啟動失敗。");
            return;
        }
        this.createStatusOrb(playerContainer);
        this.createSubtitleContainer(playerContainer);
        this.applySettingsToUI();
        this.toggleNativeSubtitles(true);
        
        this.setOrbState('translating');
        await this.parseAndTranslate(initialPayload);
    }

    getPlayerInstance() {
        // 功能: 獲取 YouTube 播放器的 API 物件實例。
        const playerElement = document.getElementById('movie_player');
        if (playerElement) {
            if (typeof playerElement.getPlayer === 'function') {
                const player = playerElement.getPlayer();
                if (player && typeof player.setOption === 'function') return player;
            }
            if (typeof playerElement.getApiInterface === 'function') {
                const api = playerElement.getApiInterface();
                if (api && typeof api.setOption === 'function') return api;
            }
            if (typeof playerElement.setOption === 'function') return playerElement;
        }
        return null;
    }

    switchToManualMode(playerData) {
        // 功能: 當 Plan A 失敗時，建立並顯示手動模式的引導提示 UI。
        this.log('切換至手動模式，將顯示提示 UI。');
        const availableLangs = this.getAvailableLanguagesFromData(playerData);
        const { preferred_langs = [], ignored_langs = [] } = this.settings;
        const matchedLang = preferred_langs.find(pLang =>
            availableLangs.includes(pLang) && !ignored_langs.includes(pLang)
        );

        if (matchedLang) {
            const playerContainer = document.getElementById('movie_player');
            if (playerContainer) {
                this.createStatusOrb(playerContainer);
                this.setOrbState('error', `請手動在 YT 播放器中選擇「${this.getFriendlyLangName(matchedLang)}」語言的字幕`);
                this.state.isProcessing = true;
                const ccButton = document.querySelector('.ytp-subtitles-button');
                if (ccButton) {
                    this.createGuidancePrompt(playerContainer, ccButton, `請手動開啟「${this.getFriendlyLangName(matchedLang)}」字幕`);
                }
            }
        } else {
            this.log('手動模式：依然未在可用字幕中找到您的偏好語言。');
        }
    }
    
    stopFallbackListener() {
        // 功能: 停止並銷毀備援模式的 DOM 監聽器。
        if (this.state.fallbackObserver) {
            this.log('備援監聽器已完成任務，停止監聽原生字幕容器。');
            this.state.fallbackObserver.disconnect();
            this.state.fallbackObserver = null;
            this.state.fallbackListenerActive = false;
        }
    }

    startFallbackListener() {
        // 功能: 啟動備援模式，監聽原生字幕容器的 DOM 變化。
        const targetNode = document.querySelector('.ytp-caption-window-container');
        if (!targetNode || this.state.fallbackListenerActive) return;
        
        this.log('備援模式啟動：現在監聽原生字幕容器...');
        const observerConfig = { childList: true, subtree: true };
        const observerCallback = (mutationsList, observer) => {
            if (this.state.hasActivated) {
                this.stopFallbackListener();
                return;
            }
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && targetNode.querySelector('.caption-window')) {
                    this.log('備援監聽器偵測到原生字幕渲染，將通知信使重新檢查。');
                    window.postMessage({ type: 'RERUN_INJECTOR_MAIN' }, '*');
                    this.stopFallbackListener();
                    return;
                }
            }
        };
        this.state.fallbackObserver = new MutationObserver(observerCallback);
        this.state.fallbackObserver.observe(targetNode, observerConfig);
        this.state.fallbackListenerActive = true;
    }
    
    async sendMessageToBackground(message) {
        // 功能: 向 background.js 發送訊息的標準化輔助函式。
        try { return await chrome.runtime.sendMessage(message); }
        catch (e) {
            if (e.message && !e.message.includes("Receiving end does not exist")) { this.error('與背景服務通訊失敗:', e); }
            return null;
        }
    }

    getAvailableLanguagesFromData(playerData) {
        // 功能: 從 PLAYER_DATA 中解析出所有可用的語言代碼列表。
        try {
            return playerData?.playerCaptionsTracklistRenderer?.captionTracks?.map(t => t.languageCode) || [];
        } catch (e) { this.error("解析字幕數據失敗:", e); return []; }
    }

    parseRawSubtitles(payload) {
        // 功能: 將從 injector.js 傳來的原始 timedtext JSON 格式化為我們內部使用的標準化字幕物件陣列。
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
        this.state.translatedTrack = this.parseRawSubtitles(payload);
        if (!this.state.translatedTrack.length) {
            this.log("解析後無有效字幕句段，停止翻譯。");
            this.setOrbState('error', '無有效字幕內容');
            this.state.isProcessing = false;
            return;
        }
        this.state.translationProgress = { done: 0, total: this.state.translatedTrack.length };
        this.beginDisplay();
        await this.processNextBatch();
        this.state.isProcessing = false;
    }

    async processNextBatch() {
        // 功能: 處理下一個批次的翻譯，直到所有句子都翻譯完成。這是一個遞迴函式。
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
        const alreadyDone = this.state.translatedTrack.length - segmentsToTranslate.length;
        this.state.translationProgress.done = alreadyDone;
        this.setOrbState('translating');
        this.state.abortController = new AbortController();
        try {
            const translatedTexts = await this.sendBatchForTranslation(segmentsToTranslate, this.state.abortController.signal);
            if (translatedTexts.length !== segmentsToTranslate.length) throw new Error("翻譯回傳的句數與批次不符。");
            translatedTexts.forEach((text, i) => { this.state.translatedTrack[indicesToUpdate[i]].translatedText = text; });
            this.log(`批次完成 (${this.state.translatedTrack.filter(t=>t.translatedText).length}/${this.state.translationProgress.total})。`);
            await this.processNextBatch();
        } catch (e) {
            if (e.name !== 'AbortError') this.error("翻譯批次失敗:", e);
        }
    }

    async sendBatchForTranslation(texts, signal) {
        // 功能: 將一個批次的文字發送到本地後端進行翻譯。
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
        this.state.tempErrorCount++;
        if (this.state.tempErrorCount >= 2) this.setPersistentError(errorMessage);
        else this.showTemporaryError(errorMessage);
    }
    setPersistentError(message) {
        // 功能: 顯示一個永久性的錯誤圖示，並將錯誤記錄到 background。
        this.state.persistentError = message;
        
        this.sendMessageToBackground({ 
            action: 'STORE_ERROR_LOG', 
            payload: { message, timestamp: Date.now() } 
        }).catch(e => this.error('無法儲存錯誤日誌至 Background Service:', e));

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
            this.log("點擊重試...");
            this.state.subtitleContainer.innerHTML = '';
            this.setOrbState('translating');
            this.processNextBatch();
        });
    }
    beginDisplay() {
        // 功能: 開始字幕的顯示流程，註冊 videoElement 的 'timeupdate' 事件監聽。
        if (!this.state.videoElement || !this.state.translatedTrack) return;
        this.state.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
        this.state.videoElement.addEventListener('timeupdate', this.handleTimeUpdate);
        this.handleTimeUpdate();
    }

    handleTimeUpdate() {
        // 功能: 根據影片當前播放時間，尋找對應的字幕並呼叫 updateSubtitleDisplay 來更新畫面。
        const { videoElement, translatedTrack, subtitleContainer } = this.state;
        if (!videoElement || !translatedTrack || !subtitleContainer) return;
        const currentTime = videoElement.currentTime * 1000;
        const currentSub = translatedTrack.find(sub => currentTime >= sub.start && currentTime < sub.end);
        this.updateSubtitleDisplay(currentSub?.text, currentSub?.translatedText);
    }

    updateSubtitleDisplay(originalText, translatedText) {
        // 功能: 將原文和譯文渲染到我們自訂的字幕容器中。
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
    // ... 其他純 UI 創建/管理函式 ...
    createStatusOrb(container) {
        if (document.getElementById('enhancer-status-orb')) return;
        this.state.statusOrb = document.createElement('div');
        this.state.statusOrb.id = 'enhancer-status-orb';
        container.appendChild(this.state.statusOrb);
    }
    createGuidancePrompt(playerContainer, buttonElement, message) {
        try { 
            if (document.getElementById('enhancer-prompt-guide')) return;

            const guide = document.createElement('div');
            guide.id = 'enhancer-prompt-guide';
            guide.innerHTML = `
                <div class="enhancer-prompt-box">
                    ${message}
                </div>
                <span class="enhancer-prompt-arrow">&#9660;</span>`;
                
            playerContainer.appendChild(guide);

            setTimeout(() => guide.classList.add('show'), 100); 

            const updatePosition = () => {
                const rect = buttonElement.getBoundingClientRect();
                const playerRect = playerContainer.getBoundingClientRect();
                
                const guideX = rect.left + rect.width / 2 - playerRect.left;
                const guideHeight = guide.offsetHeight || 30; 
                const guideY = rect.top - playerRect.top;
                
                guide.style.position = 'absolute'; 
                guide.style.top = `${guideY - guideHeight - 10}px`; 
                guide.style.left = `${guideX}px`;
                guide.style.transform = 'translateX(-50%)';
            };

            window.addEventListener('resize', updatePosition);
            playerContainer.addEventListener('transitionend', updatePosition); 
            setTimeout(updatePosition, 50); 
            this.state.promptPositionUpdate = updatePosition; 

        } catch (e) {
            this.error('創建引導提示框時發生嚴重錯誤，請檢查 CSS/DOM 結構:', e);
        }
    }

    removeGuidancePrompt() {
        const guide = document.getElementById('enhancer-prompt-guide');
        if (guide) {
            guide.classList.remove('show');
            setTimeout(() => guide.remove(), 500);
            
            if (this.state.promptPositionUpdate) {
                window.removeEventListener('resize', this.state.promptPositionUpdate);
                document.getElementById('movie_player')?.removeEventListener('transitionend', this.state.promptPositionUpdate);
                this.state.promptPositionUpdate = null;
            }
        }
    }

    getFriendlyLangName(langCode) {
        const langMap = { ja: '日文', ko: '韓文', en: '英文' };
        return langMap[langCode] || langCode;
    }
    setOrbState(state, errorMsg = '') {
        const orb = this.state.statusOrb;
        if (!orb) return;
        orb.className = 'enhancer-status-orb';
        orb.classList.add(`state-${state}`);

        const { translationProgress: progress, sourceLang } = this.state;
        const langName = this.getFriendlyLangName(sourceLang);
        switch (state) {
            case 'translating':
                if (progress && progress.total > 0) {
                    orb.classList.add('progress'); 
                    const percent = Math.round((progress.done / progress.total) * 100);
                    orb.innerHTML = `<div>${percent}%</div>`;
                    orb.title = `自動選擇: [${langName}] | 翻譯中: ${progress.done} / ${progress.total}`;
                } else {
                    orb.classList.remove('progress');
                    orb.innerHTML = '<div>%</div>';
                    orb.title = `自動選擇: [${langName}] - 等待字幕文字中...`;
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
        if (document.getElementById('enhancer-subtitle-container')) return;
        this.state.subtitleContainer = document.createElement('div');
        this.state.subtitleContainer.id = 'enhancer-subtitle-container';
        container.appendChild(this.state.subtitleContainer);
    }
    applySettingsToUI() {
        if (this.state.subtitleContainer) {
            this.state.subtitleContainer.style.fontSize = `${this.settings.fontSize}px`;
            this.state.subtitleContainer.style.fontFamily = this.settings.fontFamily;
        }
    }
    toggleNativeSubtitles(hide) {
        const nativeContainer = document.querySelector('.ytp-caption-window-container');
        if (nativeContainer) {
            this.log(hide ? '隱藏原生字幕。' : '恢復原生字幕顯示。');
            nativeContainer.style.display = hide ? 'none' : '';
        }
    }
}
// 區塊: if (document.readyState === 'loading') ...
// 功能: 確保在頁面 DOM 結構完全載入後，才建立 YouTubeSubtitleEnhancer 的實例並啟動腳本。
// input: (DOM 事件)
// output: 無
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new YouTubeSubtitleEnhancer().initialSetup();
    });
} else {
    new YouTubeSubtitleEnhancer().initialSetup();
}