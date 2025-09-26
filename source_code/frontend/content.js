/**
 * @file content.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * You can find a copy of the license in the LICENSE file that should be
 * distributed with this software.
 *
 * This is the core content script. It handles subtitle interception,
 * translation flow, DOM manipulation, and communication with other parts
 * of the extension.
 */
/**
 * @file content.js
 * @version 1.3.0
 */
(() => {
    if (window.ytEnhancer) {
        window.ytEnhancer.destroy();
    }

    const SERVER_URL = "http://127.0.0.1:5001/api/translate";
    const BATCH_SIZE = 30;

    class YouTubeSubtitleEnhancer {
        constructor() {
            console.log("YT 字幕增強器 v1.3.2 已注入 (增強偵錯訊息)");
            this.isEnabled = false;
            this.isProcessing = false;
            this.settings = {};
            this.videoElement = null;
            this.subtitleContainer = null;
            this.translatedTrack = null;
            this.rawPayload = null;
            this.translationQueue = [];
            this.currentSubtitleIndex = -1;
            this.toastTimeout = null;
            this.abortController = null;
            this.initRetryCount = 0;
            //--- 綁定 this ---
            this.handleWindowMessage = this.handleWindowMessage.bind(this);
            this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
            this.handleStateChange = this.handleStateChange.bind(this);
            this.handleSettingsChange = this.handleSettingsChange.bind(this);
            this.handleRetryClick = this.handleRetryClick.bind(this);
            this.run = this.run.bind(this);
        }

        async initialize() {
            const statusResponse = await this.sendMessageToBackground({ action: 'checkStatus' });
            this.isEnabled = statusResponse?.isEnabled || false;
            const settingsResponse = await this.sendMessageToBackground({ action: 'getSettings' });
            this.settings = settingsResponse?.data || {};

            window.addEventListener('message', this.handleWindowMessage);
            chrome.runtime.onMessage.addListener(this.handleStateChange);
            chrome.runtime.onMessage.addListener(this.handleSettingsChange);
            document.addEventListener('yt-navigate-finish', () => setTimeout(this.run, 500));
            this.run();
        }

        run() {
            this.initRetryCount = 0;
            if (this.isEnabled && window.location.pathname.startsWith('/watch')) {
                this.start();
            } else {
                this.stop();
            }
        }

        async start() {
            this.stop();
            this.videoElement = document.querySelector('video');
            const playerContainer = document.getElementById('movie_player');
            if (!this.videoElement || !playerContainer) {
                if (this.initRetryCount < 10) {
                    this.initRetryCount++;
                    setTimeout(() => this.start(), 1000);
                }
                return;
            }
            this.createSubtitleContainer(playerContainer);
            this.applySettings();
            const videoId = this.getVideoId();
            if (!videoId) return;
            const cacheKey = `ytEnhancerCache_${videoId}`;
            const cachedData = await this.getCache(cacheKey);
            if (cachedData && cachedData.translatedTrack) {
                this.translatedTrack = cachedData.translatedTrack;
                this.rawPayload = cachedData.rawPayload;
                const needsResume = this.translatedTrack.some(sub => this.isTranslationIncomplete(sub));
                if (needsResume && this.rawPayload) {
                    this.showToast("偵測到未完成的翻譯，正在自動繼續...", 4000);
                    setTimeout(() => this.parseAndTranslate(this.rawPayload, true), 100);
                    return;
                }
                if (!needsResume) {
                    this.showToast("翻譯完成 (來自暫存)");
                }
                this.beginDisplay();
                return;
            }
            this.showToast("攔截器已部署，等待字幕觸發...");
            this.injectInterceptor();
        }

        stop() {
            if (this.abortController) { this.abortController.abort(); }
            this.translationQueue = [];
            if (this.videoElement) this.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
            if (this.subtitleContainer) {
                this.subtitleContainer.removeEventListener('click', this.handleRetryClick);
                this.subtitleContainer.remove();
                this.subtitleContainer = null;
            }
            const toast = document.getElementById('enhancer-toast');
            if (toast) toast.classList.remove('show');
            const originalContainer = document.querySelector('.ytp-caption-window-container');
            if (originalContainer) originalContainer.style.display = '';
            this.videoElement = null;
            this.translatedTrack = null;
            this.rawPayload = null;
            this.currentSubtitleIndex = -1;
            this.isProcessing = false;
        }

        destroy() {
            this.stop();
            window.removeEventListener('message', this.handleWindowMessage);
        }

        handleWindowMessage(event) {
            if (event.source !== window || !event.data || event.data.type !== 'FROM_YT_ENHANCER_INTERCEPTOR') return;
            if (this.isProcessing || this.translationQueue.length > 0) return;
            if (event.data.status === 'SUCCESS') {
                this.parseAndTranslate(event.data.payload);
            } else {
                this.showToast(`攔截器錯誤: ${event.data.reason || '未知錯誤'}`, 6000);
            }
        }

        async parseAndTranslate(payload, isResume = false) {
            this.rawPayload = payload;
            try {
                const settingsResponse = await this.sendMessageToBackground({ action: 'getSettings' });
                this.settings = settingsResponse?.data || {};

                this.showToast(`成功攔截字幕，正在準備翻譯任務...`);
                let originalSubtitles = this.parseRawSubtitles(payload);
                if (originalSubtitles.length === 0) {
                    this.showToast("解析後無有效字幕內容，已停止。");
                    return;
                }
                this.initializeOrMergeTrack(originalSubtitles);
                this.beginDisplay();
                
                for (let i = 0; i < this.translatedTrack.length; i += BATCH_SIZE) {
                    if(isResume && !this.isTranslationIncomplete(this.translatedTrack[i])) {
                        continue;
                    }
                    this.translationQueue.push({ startIndex: i });
                }

                this.showToast(`準備完成，佇列中共有 ${this.translationQueue.length} 個批次待翻譯。`);
                this.startQueueProcessor();

            } catch (e) {
                this.showToast(`[嚴重錯誤] ${e.message}`, 6000);
            }
        }
        
        startQueueProcessor() {
            if (this.isProcessing) return;
            this.processTranslationQueue();
        }
        
        async processTranslationQueue() {
            if (this.isProcessing) return;

            if (this.translationQueue.length === 0) {
                this.showToast("所有批次翻譯已完成！", 5000);
                this.isProcessing = false;
                return;
            }
            
            this.isProcessing = true;
            this.abortController = new AbortController();

            const job = this.translationQueue.shift();
            const { startIndex, isRetry } = job;
            
            const videoId = this.getVideoId();
            const cacheKey = `ytEnhancerCache_${videoId}`;
            const batch = this.translatedTrack.slice(startIndex, startIndex + BATCH_SIZE);
            const batchNum = Math.floor(startIndex / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(this.translatedTrack.length / BATCH_SIZE);

            if(isRetry) {
                this.showToast(`優先處理第 ${batchNum} 批次的重試請求...`);
            }

            await this.translateBatch(batch, batchNum, totalBatches, cacheKey, this.rawPayload);
            
            this.isProcessing = false;
            setTimeout(() => this.processTranslationQueue(), 100);
        }

        async translateBatch(batch, batchNum, totalBatches, cacheKey, rawPayload) {
            const batchTexts = batch.map(sub => sub.text);
            try {
                this.showToast(`正在翻譯第 ${batchNum}/${totalBatches} 批...`);
                const translatedBatch = await this.sendBatchForTranslation(batchTexts, this.abortController.signal);
                if (translatedBatch && Array.isArray(translatedBatch) && translatedBatch.length === batch.length) {
                    batch.forEach((sub, index) => { sub.translatedText = translatedBatch[index]; });
                } else {
                    throw new Error("後端回應格式或數量不符");
                }
            } catch (error) {
                if (error.name === 'AbortError') { 
                    this.showToast("任務已中止");
                    throw error;
                 }
                // 【優化】在 Toast 中顯示詳細的錯誤訊息
                this.showToast(`第 ${batchNum}/${totalBatches} 批翻譯失敗: ${error.message}`, 8000);
                batch.forEach(sub => { sub.translatedText = "[此批翻譯失敗]"; });
            } finally {
                if (this.abortController && !this.abortController.signal.aborted) {
                    await this.setCache(cacheKey, { translatedTrack: this.translatedTrack, rawPayload: rawPayload });
                }
            }
        }
        
        handleRetryClick(event) {
            const target = event.target;
            if (target && target.classList.contains('enhancer-retry-link')) {
                if (!this.rawPayload) {
                    this.showToast("缺少原始字幕資料，無法重試。", 3000);
                    return;
                }
                const failedIndex = parseInt(target.dataset.retryIndex, 10);
                if (!isNaN(failedIndex)) {
                    const startIndex = Math.floor(failedIndex / BATCH_SIZE) * BATCH_SIZE;
                    
                    const batch = this.translatedTrack.slice(startIndex, startIndex + BATCH_SIZE);
                    batch.forEach(sub => sub.translatedText = "...");
                    this.updateSubtitleDisplay(null, "...", failedIndex);

                    this.translationQueue.unshift({ startIndex: startIndex, isRetry: true });
                    
                    this.startQueueProcessor();
                }
            }
        }
        
        // 【優化】增強 sendBatchForTranslation 的錯誤處理
        async sendBatchForTranslation(texts, signal) {
            const response = await fetch(SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    texts: texts,
                    models_preference: this.settings.models_preference
                }),
                signal
            });
            if (!response.ok) {
                let errorMsg = `HTTP 狀態碼: ${response.status}`;
                try {
                    // 嘗試解析後端回傳的 JSON 錯誤訊息
                    const errorData = await response.json();
                    errorMsg = errorData.error || `伺服器未提供詳細錯誤訊息。`;
                } catch (e) {
                    // 如果後端回傳的不是 JSON (例如 HTML 錯誤頁面)
                    errorMsg = `無法解析伺服器回應。狀態碼: ${response.status}`;
                }
                throw new Error(errorMsg);
            }
            return await response.json();
        }

        // ----- 以下為輔助函式，大部分未變動 -----

        createSubtitleContainer(playerContainer) {
            if (document.getElementById('enhancer-subtitle-container')) return;
            this.subtitleContainer = document.createElement('div');
            this.subtitleContainer.id = 'enhancer-subtitle-container';
            this.subtitleContainer.addEventListener('click', this.handleRetryClick);
            playerContainer.appendChild(this.subtitleContainer);
        }

        updateSubtitleDisplay(originalText, translatedText, index) {
            if (!this.subtitleContainer) return;
            let jaLine = "";
            let zhLine = "";

            if (this.settings.showOriginal && originalText) {
                jaLine = `<div class="enhancer-line enhancer-ja-line">${this.escapeHTML(originalText)}</div>`;
            }
            if (this.settings.showTranslated && translatedText) {
                if (translatedText === "[此批翻譯失敗]") {
                    zhLine = `<div class.="enhancer-line enhancer-zh-line">[此批翻譯失敗] <span class="enhancer-retry-link" data-retry-index="${index}">點此重試</span></div>`;
                } else {
                    zhLine = `<div class="enhancer-line enhancer-zh-line">${this.escapeHTML(translatedText)}</div>`;
                }
            }
            this.subtitleContainer.innerHTML = jaLine + zhLine;
        }

        handleTimeUpdate() {
            if (!this.translatedTrack || !this.videoElement) return;
            const currentTime = this.videoElement.currentTime;
            let foundIndex = -1;
            const startSearchIndex = this.currentSubtitleIndex > 0 ? this.currentSubtitleIndex - 1 : 0;
            for (let i = startSearchIndex; i < this.translatedTrack.length; i++) {
                const sub = this.translatedTrack[i];
                if (currentTime >= sub.start && currentTime < sub.end) {
                    foundIndex = i;
                    break;
                }
            }
            if (foundIndex !== -1) {
                if (this.currentSubtitleIndex !== foundIndex) {
                    const sub = this.translatedTrack[foundIndex];
                    this.updateSubtitleDisplay(sub.text, sub.translatedText, foundIndex);
                    this.currentSubtitleIndex = foundIndex;
                }
            } else if (this.currentSubtitleIndex !== -1) {
                this.updateSubtitleDisplay(null, null, -1);
                this.currentSubtitleIndex = -1;
            }
        }

        handleStateChange(request) {
            if (request.action === 'stateChanged') {
                this.isEnabled = request.enabled;
                this.run();
            }
        }

        handleSettingsChange(request) {
            if (request.action === 'settingsChanged') {
                this.settings = request.settings;
                this.applySettings();
                if (this.translatedTrack && this.currentSubtitleIndex !== -1) {
                    const sub = this.translatedTrack[this.currentSubtitleIndex];
                    this.updateSubtitleDisplay(sub.text, sub.translatedText, this.currentSubtitleIndex);
                }
            }
        }

        applySettings() {
            if (!this.subtitleContainer) return;
            const rawFontFamily = this.settings.fontFamily || 'sans-serif';
            const processedFontFamily = rawFontFamily.split(',')
                .map(font => {
                    let trimmedFont = font.trim();
                    if (trimmedFont.includes(' ') && !['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy'].includes(trimmedFont.toLowerCase())) {
                        if (!/^['"].*['"]$/.test(trimmedFont)) {
                            return `"${trimmedFont}"`;
                        }
                    }
                    return trimmedFont;
                })
                .join(', ');
            this.subtitleContainer.style.fontSize = `${this.settings.fontSize}px`;
            this.subtitleContainer.style.fontFamily = processedFontFamily;
        }

        showToast(message, duration = 4000) {
            let toast = document.getElementById('enhancer-toast');
            const player = document.getElementById('movie_player');
            if (!player) return;
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'enhancer-toast';
                player.appendChild(toast);
            }
            toast.textContent = message;
            toast.classList.add('show');
            if (this.toastTimeout) clearTimeout(this.toastTimeout);
            this.toastTimeout = setTimeout(() => { toast.classList.remove('show'); }, duration);
        }

        beginDisplay() {
            const originalContainer = document.querySelector('.ytp-caption-window-container');
            if (originalContainer) originalContainer.style.display = 'none';
            if (this.videoElement) this.videoElement.addEventListener('timeupdate', this.handleTimeUpdate);
        }

        initializeOrMergeTrack(newSubs) {
            if (!this.translatedTrack || this.translatedTrack.length !== newSubs.length) {
                this.translatedTrack = newSubs.map(sub => ({ ...sub, translatedText: '...' }));
            } else {
                newSubs.forEach((newSub, index) => {
                    if (this.isTranslationIncomplete(this.translatedTrack[index])) {
                        this.translatedTrack[index].text = newSub.text;
                    }
                });
            }
        }
        
        parseRawSubtitles(payload) {
            const events = payload?.events || [];
            if (events.length === 0) return [];
            const subtitles = [];
            for (const event of events) {
                if (!event.segs) continue;
                const start = (event.tStartMs || 0) / 1000;
                let fullText = event.segs.map(seg => seg.utf8).join('')
                    .replace(/\[.*?\]/g, '')
                    .replace(/\(.*?\)/g, '')
                    .replace(/\s+/g, ' ').trim();
                if (fullText) {
                    subtitles.push({ start, end: start + 5, text: fullText });
                }
            }
            for (let i = 0; i < subtitles.length - 1; i++) {
                subtitles[i].end = subtitles[i + 1].start;
            }
            return subtitles;
        }

        async sendMessageToBackground(message) {
            try { return await chrome.runtime.sendMessage(message); } 
            catch (e) { return null; }
        }

        async getCache(key) {
            const response = await this.sendMessageToBackground({ action: 'getCache', key });
            return response?.data || null;
        }



        async setCache(key, data) {
            return await this.sendMessageToBackground({ action: 'setCache', key, data });
        }
        
        async sendBatchForTranslation(texts, signal) {
            const response = await fetch(SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    texts: texts,
                    models_preference: this.settings.models_preference
                }),
                signal
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`伺服器錯誤 ${response.status}: ${errorData.error || '未知錯誤'}`);
            }
            return await response.json();
        }

        getVideoId() { return new URLSearchParams(window.location.search).get('v'); }
        isTranslationIncomplete(sub) { return !sub.translatedText || sub.translatedText === '...' || sub.translatedText === '[此批翻譯失敗]'; }
        escapeHTML(str) { return str.replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
        
        injectInterceptor() {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('injector.js');
            (document.head || document.documentElement).appendChild(script);
            script.onload = () => script.remove();
        }
    }

    window.ytEnhancer = new YouTubeSubtitleEnhancer();
    window.ytEnhancer.initialize();

})();