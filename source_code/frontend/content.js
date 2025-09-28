/**
 * @file content.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 1.7.0 (Final Stability Patch)
 */

class YouTubeSubtitleEnhancer {
    constructor() {
        this.log("YT 字幕增強器 v1.7.0 已注入");
        this.settings = {};
        this.currentVideoId = null; 
        this.state = {
            isEnabled: false,
            isProcessing: false,
            hasActivated: false,
            videoElement: null,
            statusOrb: null,
            subtitleContainer: null,
            translatedTrack: null,
            sourceLang: null, 
            isOverride: false,
            abortController: null,
            tempErrorCount: 0,
            persistentError: null,
            translationProgress: { done: 0, total: 0 },
        };
        this.onNavigateFinish = this.onNavigateFinish.bind(this);
        this.handleWindowMessage = this.handleWindowMessage.bind(this);
        this.handleBackgroundMessage = this.handleBackgroundMessage.bind(this);
        this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
    }

    log(message, ...args) { console.log("[YT Enhancer]", message, ...args); }
    error(message, ...args) { console.error("[YT Enhancer]", message, ...args); }

    translateToFriendlyError(errorMessage) {
        const msg = String(errorMessage);
        if (msg.includes('Failed to fetch')) {
            return "無法連線至後端翻譯伺服器。請確認後端程式是否已啟動。";
        }
        if (msg.includes('[ACCOUNT_ISSUE]') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('billing')) {
            const match = msg.match(/'([^']+)'/);
            const keyName = match ? match[1] : "某個金鑰";
            return `API Key '${keyName}' 已達用量上限或帳戶計費無效。請更換金鑰或檢查 Google Cloud 帳戶。`;
        }
        if (msg.toLowerCase().includes('api key not valid')) {
            return "API Key 無效。請檢查 api_keys.txt 中的金鑰是否正確。";
        }
        if (msg.toLowerCase().includes('permission denied')) {
            return "後端權限不足，無法寫入設定檔 (例如 custom_prompts.json)。";
        }
        if (msg.includes('所有模型與 API Key 均嘗試失敗')) {
            return "翻譯執行失敗：所有模型均無法回傳有效結果，可能觸發了內容安全策略或遇到暫時性問題。";
        }
        return errorMessage;
    }

    async sendMessageToBackground(message) {
        try {
            return await chrome.runtime.sendMessage(message);
        } catch (e) {
            if (!e.message.includes("Receiving end does not exist")) {
                this.error('與背景服務通訊失敗:', e);
            }
            return null;
        }
    }

    async initialize() {
        const response = await this.sendMessageToBackground({ action: 'getSettings' });
        this.settings = response?.data;
        this.state.isEnabled = this.settings.isEnabled;

        window.addEventListener('message', this.handleWindowMessage);
        chrome.runtime.onMessage.addListener(this.handleBackgroundMessage);
        document.addEventListener('yt-navigate-finish', this.onNavigateFinish);
        
        this.run();
    }
    
    onNavigateFinish() {
        const newVideoId = new URLSearchParams(window.location.search).get('v');
        if (this.state.hasActivated && newVideoId === this.currentVideoId) {
            this.log("偵測到偽導航事件，已忽略。");
            return;
        }
        
        this.log("偵測到新的頁面導航，準備重設。");
        this.cleanup();
        setTimeout(() => this.run(), 500);
    }

    run() {
        this.currentVideoId = new URLSearchParams(window.location.search).get('v');
        if (this.state.isEnabled && this.currentVideoId) {
            this.log("符合執行條件，注入 injector.js。");
            this.injectInterceptor();
        } else {
            this.log("執行條件不符 (未啟用或非觀看頁面)。");
        }
    }

    cleanup() {
        this.state.abortController?.abort();

        if (this.state.videoElement) {
            this.state.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
        }
        document.getElementById('enhancer-status-orb')?.remove();
        document.getElementById('enhancer-subtitle-container')?.remove();

        this.state = {
            ...this.state,
            isProcessing: false,
            hasActivated: false,
            videoElement: null,
            statusOrb: null,
            subtitleContainer: null,
            translatedTrack: null,
            sourceLang: null,
            isOverride: false,
            abortController: null,
            tempErrorCount: 0,
            persistentError: null,
            translationProgress: { done: 0, total: 0 },
        };
        this.toggleNativeSubtitles(false);
    }
    
    async prepareForTranslation(captionsData) {
        if (this.state.sourceLang) {
            this.log("語言已匹配，等待字幕攔截。");
            return;
        }
        
        if (!captionsData) {
            this.log("injector 未能取回字幕數據。");
            return;
        }
        this.log("成功接收到 injector 傳來的初始字幕數據。");

        const availableLangs = this.getAvailableLanguagesFromData(captionsData);
        if (!availableLangs || availableLangs.length === 0) {
            this.log("等待中：可用語言列表為空。");
            return;
        }
        this.log("偵測到可用語言:", availableLangs);
        await this.sendMessageToBackground({ action: 'storeAvailableLangs', langs: availableLangs });

        const { preferred_langs, ignored_langs } = this.settings;
        const matchedLang = preferred_langs.find(pLang => 
            availableLangs.includes(pLang) && !ignored_langs.includes(pLang)
        );

        if (!matchedLang) {
            this.log("等待中：無可用字幕匹配您的偏好設定。");
            return;
        }

        this.state.sourceLang = matchedLang;
        this.log(`智慧匹配成功！選定 "${matchedLang}" 作為翻譯源，等待使用者開啟字幕...`);
    }

    async activate(isOverride, lang, initialPayload = null) {
        if (this.state.hasActivated) return;
        this.state.hasActivated = true;
        this.state.isOverride = isOverride;
        this.state.sourceLang = lang;

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

        const videoId = this.currentVideoId;
        const cacheKey = `ytEnhancerCache_${videoId}_${this.state.sourceLang}`;
        
        this.setOrbState('translating');

        if (isOverride) {
            this.log("手動覆蓋或重譯模式，清除舊暫存。");
            await this.sendMessageToBackground({ action: 'removeCache', key: cacheKey });
            if (initialPayload) {
                this.parseAndTranslate(initialPayload, false);
            }
            return;
        }
        
        const cachedData = await this.sendMessageToBackground({ action: 'getCache', key: cacheKey });
        if (cachedData?.translatedTrack) {
            this.log("成功從暫存載入翻譯。");
            this.state.translatedTrack = cachedData.translatedTrack;
            const isComplete = !this.state.translatedTrack.some(sub => !sub.translatedText);
            if (isComplete) {
                this.setOrbState('cached');
                this.beginDisplay();
            } else {
                this.log("從暫存恢復未完成的翻譯。");
                this.parseAndTranslate(null, true);
            }
            return;
        }
        
        if (initialPayload) {
             this.parseAndTranslate(initialPayload, false);
        } else {
            this.log("未找到暫存，將等待 injector 攔截字幕。");
        }
    }
    
    getAvailableLanguagesFromData(captionsData) {
        try {
            const tracks = captionsData?.playerCaptionsTracklistRenderer?.captionTracks;
            if (tracks && tracks.length > 0) {
                return tracks.map(track => track.languageCode);
            }
        } catch (e) {
            this.error("解析字幕數據失敗:", e);
        }
        return [];
    }
    
    handleWindowMessage(event) {
        if (event.source !== window || !event.data || !event.data.type) return;

        if (event.data.type === 'YT_ENHANCER_PLAYER_RESPONSE') {
            this.prepareForTranslation(event.data.payload);
            return;
        }

        if (event.data.type === 'FROM_YT_ENHANCER_INTERCEPTOR') {
            const { status, payload, lang } = event.data;
            if (status !== 'SUCCESS' || !lang) return;
            if (lang === this.state.sourceLang && !this.state.hasActivated) {
                this.log(`攔截到目標語言 "${lang}"，正式啟用 UI 並開始翻譯。`);
                this.activate(this.state.isOverride, lang, payload);
            }
        }
    }
    
    async parseAndTranslate(payload, isResuming = false) {
        if (this.state.isProcessing) return;
        this.state.isProcessing = true;

        if (!isResuming) {
            this.state.translatedTrack = this.parseRawSubtitles(payload);
        }
        
        this.state.translationProgress.done = this.state.translatedTrack.filter(t => t.translatedText).length;
        this.state.translationProgress.total = this.state.translatedTrack.length;
        
        await this.processNextBatch();

        this.state.isProcessing = false;
    }

    async processNextBatch() {
        const batchSize = 30;
        const segmentsToTranslate = [];
        const indicesToUpdate = [];

        for (let i = 0; i < this.state.translatedTrack.length; i++) {
            const segment = this.state.translatedTrack[i];
            if (!segment.translatedText && segment.text.trim() !== '') {
                segmentsToTranslate.push(segment.text);
                indicesToUpdate.push(i);
                if (segmentsToTranslate.length >= batchSize) break;
            }
        }

        if (segmentsToTranslate.length === 0) {
            this.log("所有批次翻譯完成。");
            this.setOrbState('success');
            return;
        }

        this.state.translationProgress.done = this.state.translatedTrack.filter(t => t.translatedText).length;
        this.setOrbState('translating');
        
        this.abortController = new AbortController();

        try {
            if (this.state.videoElement && !this.state.videoElement.ontimeupdate) {
                this.beginDisplay();
            }
            const translatedTexts = await this.sendBatchForTranslation(segmentsToTranslate, this.abortController.signal);
            if (translatedTexts.length !== segmentsToTranslate.length) {
                throw new Error("翻譯回傳的句數與批次不符。");
            }
            translatedTexts.forEach((text, i) => {
                const trackIndex = indicesToUpdate[i];
                this.state.translatedTrack[trackIndex].translatedText = text;
            });
            const cacheKey = `ytEnhancerCache_${this.currentVideoId}_${this.state.sourceLang}`;
            await this.sendMessageToBackground({ action: 'setCache', key: cacheKey, data: { translatedTrack: this.state.translatedTrack } });
            this.log(`批次完成，已儲存進度 (${this.state.translatedTrack.filter(t => t.translatedText).length}/${this.state.translationProgress.total})。`);
            this.state.tempErrorCount = 0;
            await this.processNextBatch();
        } catch (e) {
            const userFriendlyError = this.translateToFriendlyError(e.message);
            if (e.name === 'AbortError') {
                this.log("翻譯請求已中止。");
            } else {
                this.error("翻譯批次失敗:", e);
                this.handleTranslationError(userFriendlyError);
            }
        } finally {
            this.abortController = null;
        }
    }

    async sendBatchForTranslation(texts, signal) {
        const response = await fetch('http://127.0.0.1:5001/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                texts: texts,
                source_lang: this.state.sourceLang,
                models_preference: this.settings.models_preference
            }),
            signal
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `伺服器錯誤 ${response.status}`);
        }
        return await response.json();
    }
    
    handleTranslationError(errorMessage) {
        this.state.tempErrorCount++;
        if (this.state.tempErrorCount >= 2) {
            this.setPersistentError(errorMessage);
        } else {
            this.showTemporaryError(errorMessage);
        }
    }

    setPersistentError(message) {
        this.state.persistentError = message;
        
        if (!this.state.statusOrb || !document.body.contains(this.state.statusOrb)) {
            const playerContainer = document.getElementById('movie_player');
            if (playerContainer) this.createStatusOrb(playerContainer);
        }
        this.setOrbState('error', message);
        this.sendMessageToBackground({ action: 'logError', message: message });
    }

    showTemporaryError(message) {
        if (!this.state.subtitleContainer || !this.state.videoElement) return;
        const currentTime = this.state.videoElement.currentTime * 1000;
        const currentSub = this.state.translatedTrack.find(sub => currentTime >= sub.start && currentTime < sub.end);
        let html = '';
        if (this.settings.showOriginal && currentSub) {
            html += `<div class="enhancer-line enhancer-original-line">${currentSub.text}</div>`;
        }
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
        if (!this.state.videoElement || !this.state.translatedTrack) return;
        this.state.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
        this.state.videoElement.addEventListener('timeupdate', this.handleTimeUpdate);
        this.handleTimeUpdate();
    }

    handleTimeUpdate() {
        const { videoElement, translatedTrack, subtitleContainer } = this.state;
        if (!videoElement || !translatedTrack || !subtitleContainer) return;
        const currentTime = videoElement.currentTime * 1000;
        const currentSub = translatedTrack.find(sub => currentTime >= sub.start && currentTime < sub.end);
        if (currentSub) {
            this.updateSubtitleDisplay(currentSub.text, currentSub.translatedText);
        } else {
            subtitleContainer.innerHTML = '';
        }
    }

    updateSubtitleDisplay(originalText, translatedText) {
        if (!this.state.subtitleContainer) return;
        
        const { showOriginal, showTranslated } = this.settings;
        let html = '';
        if (showOriginal && originalText) {
            html += `<div class="enhancer-line enhancer-original-line">${originalText}</div>`;
        }
        if (showTranslated) {
            const displayText = translatedText || '...';
            const placeholderClass = translatedText ? '' : 'enhancer-placeholder';
            html += `<div class="enhancer-line enhancer-translated-line ${placeholderClass}">${displayText}</div>`;
        }
        
        this.state.subtitleContainer.innerHTML = html;
    }

    handleBackgroundMessage(request, sender, sendResponse) {
        if (request.action === 'stateChanged') {
            this.state.isEnabled = request.isEnabled;
            this.cleanup();
            this.run();
        } else if (request.action === 'settingsChanged') {
            this.settings = request.settings;
            this.log("設定已更新:", this.settings);
            this.applySettingsToUI();
            if (this.state.isEnabled !== this.settings.isEnabled) {
                this.state.isEnabled = this.settings.isEnabled;
                this.cleanup();
                this.run();
            }
        } else if (request.action === 'forceRerun' || request.action === 'translateWithOverride') {
            const lang = request.action === 'translateWithOverride' ? request.language : this.state.sourceLang;
            if (!lang) {
                this.log("無法重譯/覆蓋：缺少目標語言。");
                return;
            }
            this.log(`收到指令: ${request.action}, 語言: ${lang}`);
            this.cleanup();
            this.run();
            // 在這種情況下，我們需要一種方法來觸發 override
            // 最好的方法是讓 run() 之後的流程重新匹配，或者我們直接 activate
            // 為了確保 injector 重新發送初始數據，重跑 run() 是最乾淨的
            // 但我們需要一個方法告訴下一次的 prepareForTranslation 這是 override
            this.state.isOverride = true;
            this.state.sourceLang = lang; // 預先設定
        }
        sendResponse({ success: true });
        return true;
    }
    
    createStatusOrb(container) {
        if (this.state.statusOrb && document.body.contains(this.state.statusOrb)) return;
        this.state.statusOrb = document.createElement('div');
        this.state.statusOrb.id = 'enhancer-status-orb';
        container.appendChild(this.state.statusOrb);
        this.state.statusOrb.addEventListener('click', () => {
            if (this.state.persistentError) {
                chrome.runtime.sendMessage({ action: 'openOptionsPage' });
            }
        });
    }

    getFriendlyLangName(langCode) {
        const langMap = { ja: '日文', ko: '韓文', en: '英文' };
        return langMap[langCode] || langCode;
    }

    setOrbState(state, errorMsg = '') {
        const orb = this.state.statusOrb;
        if (!orb) return;
        
        orb.classList.remove('fade-out', 'state-translating', 'state-success', 'state-cached', 'state-error', 'progress');
        orb.classList.add(`state-${state}`);

        const { translationProgress: progress, isOverride, sourceLang } = this.state;
        const langName = this.getFriendlyLangName(sourceLang);
        const prefix = isOverride ? '手動選擇' : '自動選擇';

        switch (state) {
            case 'translating':
                if (progress && progress.total > 0) {
                    orb.classList.add('progress');
                    const percent = Math.round((progress.done / progress.total) * 100);
                    orb.innerHTML = `<div>${percent}%</div>`;
                    orb.title = `${prefix}: [${langName}] | 翻譯中: ${progress.done} / ${progress.total}`;
                } else {
                    orb.innerHTML = '<div>%</div>';
                    orb.title = `${prefix}: [${langName}]`;
                }
                break;
            case 'success': 
                orb.innerHTML = '<div>✓</div>';
                orb.title = '翻譯成功';
                setTimeout(() => orb.classList.add('fade-out'), 1500); 
                break;
            case 'cached': 
                orb.innerHTML = '<div>✓</div>';
                orb.title = '已從暫存載入';
                setTimeout(() => orb.classList.add('fade-out'), 1500); 
                break;
            case 'error': 
                orb.innerHTML = '<div>!</div>';
                orb.title = `發生錯誤: ${errorMsg}`;
                break;
        }
    }

    createSubtitleContainer(container) {
        if (this.state.subtitleContainer && document.body.contains(this.state.subtitleContainer)) return;
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
            nativeContainer.style.display = hide ? 'none' : '';
        }
    }

    parseRawSubtitles(payload) {
        if (!payload.events) return [];
        const subtitles = payload.events
            .map(event => ({
                start: event.tStartMs,
                end: event.tStartMs + (event.dDurationMs || 5000),
                text: event.segs ? event.segs.map(seg => seg.utf8).join('') : '',
                translatedText: null
            }))
            .filter(sub => sub.text.trim() !== '');
        for (let i = 0; i < subtitles.length - 1; i++) {
            subtitles[i].end = subtitles[i + 1].start;
        }
        return subtitles;
    }

    injectInterceptor() {
        try {
            if (document.getElementById('yt-enhancer-injector')) return;
            const script = document.createElement('script');
            script.id = 'yt-enhancer-injector';
            script.src = chrome.runtime.getURL('injector.js');
            (document.head || document.documentElement).appendChild(script);
            script.onload = () => script.remove();
        } catch(e) {
            const userFriendlyError = this.translateToFriendlyError(e.message);
            this.error(`注入 injector.js 失敗: ${e.message}`);
            this.setPersistentError(userFriendlyError);
        }
    }
}

new YouTubeSubtitleEnhancer().initialize();