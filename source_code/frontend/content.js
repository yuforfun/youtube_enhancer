/**
 * @file content.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 *
 * This script runs in the content process and interacts with the page DOM
 * to find the video, create the subtitle container, and communicate with
 * the background script (service worker).
 *
 * v1.5.0 Final Content Script:
 * 1. Implemented '強制重新翻譯' (Clear Cache & Rerun) function.
 * 2. Fixed sourceLanguage and models_preference passing in API calls.
 * 3. Robustified start/run sequence.
 */

const SERVER_URL = 'http://127.0.0.1:5001/api/translate';
const TOAST_DURATION = 3000;

class YouTubeSubtitleEnhancer {
    constructor() {
        console.log("YT 字幕增強器 v1.5.0 已注入 (穩定版)");
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
        // 【新增修正點】：用於標記是否強制重譯
        this.isForceRerun = false; 
        //--- 綁定 this ---
        this.handleWindowMessage = this.handleWindowMessage.bind(this);
        this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
        this.handleStateChange = this.handleStateChange.bind(this);
        this.handleSettingsChange = this.handleSettingsChange.bind(this);
        this.handleRetryClick = this.handleRetryClick.bind(this);
        // 【新增修正點】：綁定新的重譯事件處理方法
        this.handleRerunClick = this.handleRerunClick.bind(this);
        this.run = this.run.bind(this);
    }

    async sendMessageToBackground(message) {
        try {
            return await chrome.runtime.sendMessage(message);
        } catch (e) {
            console.error('與背景服務通訊失敗:', e);
            // 由於服務可能在重新載入，這裡不做太多處理
            return null;
        }
    }

    async getCache(key) {
        return (await this.sendMessageToBackground({ action: 'getCache', key: key }))?.data;
    }

    async setCache(key, data) {
        return await this.sendMessageToBackground({ action: 'setCache', key: key, data: data });
    }

    async initialize() {
        // 【關鍵修正點】：確保先從背景服務獲取最新的啟用狀態和所有設定
        const statusResponse = await this.sendMessageToBackground({ action: 'checkStatus' });
        this.isEnabled = statusResponse?.isEnabled || false;
        
        // 獲取所有設定，包括 sourceLanguage
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
        if (this.isEnabled && document.URL.includes("youtube.com/watch")) {
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
        // 【關鍵修正點】：按鈕創建必須在找到 playerContainer 後立即執行
        this.createControls(playerContainer);
        this.applySettings();
        const videoId = this.getVideoId();
        if (!videoId) return;
        const cacheKey = `ytEnhancerCache_${videoId}`;
        
        // 新增判斷，如果用戶點擊了強制重譯，則跳過快取
        if (this.isForceRerun) {
            this.isForceRerun = false; // 重設標記
            this.showToast("強制重譯已啟動，跳過暫存...");
            this.injectInterceptor();
            return;
        }

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
        if (this.subtitleContainer) {
            this.subtitleContainer.remove();
            this.subtitleContainer = null;
        }
    }
    
    // 【新增方法】建立控制按鈕 (合併功能為單一按鈕)
    createControls(playerContainer) {
        if (document.getElementById('enhancer-controls')) return;
        
        const controls = document.createElement('div');
        controls.id = 'enhancer-controls';
        controls.innerHTML = `
            <button id="enhancer-rerun-btn" class="enhancer-control-btn" title="清除暫存並強制重新翻譯">🔄 強制重新翻譯</button>
        `;
        playerContainer.appendChild(controls);
        
        document.getElementById('enhancer-rerun-btn').addEventListener('click', this.handleRerunClick);
    }
    
    // 【新增方法】處理強制重譯點擊事件 (清除快取並重啟)
    async handleRerunClick() {
        const videoId = this.getVideoId();
        if (!videoId) return;

        if (confirm("確定要清除當前影片的所有翻譯暫存，並強制重新開始翻譯嗎？")) {
            const cacheKey = `ytEnhancerCache_${videoId}`;
            // 步驟 1: 清除暫存
            await this.sendMessageToBackground({ action: 'removeCache', key: cacheKey });
            
            // 步驟 2: 設定標記並重新啟動 run()
            this.isForceRerun = true; 
            this.run(); 
        }
    }

    handleWindowMessage(event) {
        if (event.source !== window || event.data.type !== 'FROM_YT_ENHANCER_INTERCEPTOR') {
            return;
        }
        if (this.isProcessing) return; 

        if (event.data.status === 'SUCCESS') {
            this.showToast("字幕數據已成功攔截，正在處理...");
            this.parseAndTranslate(event.data.payload);
        } else {
            this.showToast(`字幕攔截失敗: ${event.data.reason}`, 5000);
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
            // 【關鍵修正點】：確保將完整的 settings 物件賦予 this.settings
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
        const s = this.settings;
        this.subtitleContainer.style.fontSize = `${s.fontSize}px`;
        this.subtitleContainer.style.fontFamily = s.fontFamily;
        
        // 處理顯示模式
        const jaLines = this.subtitleContainer.querySelectorAll('.enhancer-ja-line');
        const zhLines = this.subtitleContainer.querySelectorAll('.enhancer-zh-line');

        jaLines.forEach(el => el.style.display = s.showOriginal ? 'block' : 'none');
        zhLines.forEach(el => el.style.display = s.showTranslated ? 'block' : 'none');
    }
    
    getVideoId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('v');
    }

    parseRawSubtitles(payload) {
        if (!payload.events || payload.events.length === 0) return [];

        const subtitles = payload.events.map(event => {
            const fullText = event.segs ? event.segs.map(seg => seg.utf8).join('') : '';
            const start = event.tStartMs;
            const dur = event.dDurationMs || 5000;
            const end = start + dur;

            return {
                start: start,
                end: end,
                text: fullText,
                translatedText: null
            };
        }).filter(sub => sub.text.trim() !== '');

        // 修正結束時間: 下一句的開始時間
        for (let i = 0; i < subtitles.length - 1; i++) {
            subtitles[i].end = subtitles[i + 1].start;
        }
        return subtitles;
    }

    isTranslationIncomplete(sub) {
        return !sub.translatedText && sub.text.trim().length > 0;
    }

    async parseAndTranslate(payload, isResuming = false) {
        this.isProcessing = true;
        
        // 只有在非續傳模式下才重新解析整個字幕軌
        if (!isResuming) {
            this.translatedTrack = this.parseRawSubtitles(payload);
            this.rawPayload = payload;
        }

        const segmentsToTranslate = [];
        let startIndex = -1;

        // 找到第一個需要翻譯的片段
        for (let i = 0; i < this.translatedTrack.length; i++) {
            if (this.isTranslationIncomplete(this.translatedTrack[i])) {
                if (startIndex === -1) startIndex = i;
                segmentsToTranslate.push(this.translatedTrack[i].text);
            } else if (startIndex !== -1 && segmentsToTranslate.length > 0) {
                // 如果已經在翻譯中，遇到已翻譯的，就發送當前累積的批次
                break;
            }
            // 每次最多翻譯 30 句，避免 API 請求過大
            if (segmentsToTranslate.length >= 30) break; 
        }

        if (segmentsToTranslate.length === 0) {
            this.isProcessing = false;
            this.showToast("翻譯已完成！");
            this.setCache(`ytEnhancerCache_${this.getVideoId()}`, {
                translatedTrack: this.translatedTrack,
                rawPayload: this.rawPayload
            });
            return;
        }

        this.showToast(`正在翻譯 ${segmentsToTranslate.length} 句字幕...`, 0);
        this.abortController = new AbortController();

        try {
            const translatedTexts = await this.sendBatchForTranslation(segmentsToTranslate, this.abortController.signal);
            
            for (let i = 0; i < translatedTexts.length; i++) {
                this.translatedTrack[startIndex + i].translatedText = translatedTexts[i];
            }

            this.setCache(`ytEnhancerCache_${this.getVideoId()}`, {
                translatedTrack: this.translatedTrack,
                rawPayload: this.rawPayload
            });

            this.showToast(`完成翻譯 ${translatedTexts.length} 句！`);
            this.beginDisplay();
            
            // 檢查是否還有未完成的，如果是，遞歸調用繼續翻譯
            const remaining = this.translatedTrack.slice(startIndex + translatedTexts.length).some(sub => this.isTranslationIncomplete(sub));
            if (remaining) {
                this.parseAndTranslate(this.rawPayload, true); // 繼續翻譯下一批
            }

        } catch (e) {
            if (e.name === 'AbortError') {
                this.showToast("翻譯已取消 (影片切換或停止)。");
            } else {
                this.showToast(`翻譯失敗: ${e.message}`, 8000);
                console.error("翻譯批次失敗:", e);
                // 顯示重試連結
                this.showRetryLink(startIndex, segmentsToTranslate.length);
            }
        } finally {
            this.isProcessing = false;
            this.abortController = null;
        }
    }

    async sendBatchForTranslation(texts, signal) {
        const response = await fetch(SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                texts: texts,
                // 【關鍵修正點】：新增 source_lang 參數，從設定中讀取
                source_lang: this.settings.sourceLanguage, 
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

    handleRetryClick(startIndex, count) {
        if (this.isProcessing) return;
        this.showToast(`正在重試翻譯 ${count} 句字幕...`, 0);

        // 將這些句子的 translatedText 設為 null，以便 parseAndTranslate 再次處理
        for (let i = 0; i < count; i++) {
            this.translatedTrack[startIndex + i].translatedText = null;
        }

        // 重新開始處理未完成的片段
        this.parseAndTranslate(this.rawPayload, true);
    }

    createSubtitleContainer(playerContainer) {
        if (this.subtitleContainer) return;

        this.subtitleContainer = document.createElement('div');
        this.subtitleContainer.id = 'enhancer-subtitle-container';
        playerContainer.appendChild(this.subtitleContainer);

        // 創建 Toast 容器
        this.toastContainer = document.createElement('div');
        this.toastContainer.id = 'enhancer-toast';
        playerContainer.appendChild(this.toastContainer);

        // 初始套用設定
        this.applySettings();
    }

    updateSubtitleDisplay(originalText, translatedText, index) {
        if (!this.subtitleContainer) return;
        this.subtitleContainer.innerHTML = ''; // 清空舊字幕

        const s = this.settings;
        let originalLineHTML = '';
        let translatedLineHTML = '';

        // 檢查並創建原文 HTML
        if (originalText && s.showOriginal) {
            // 這裡修正了 style 屬性的邏輯，使其更簡潔
            originalLineHTML = `<div class="enhancer-line enhancer-ja-line">${originalText}</div>`;
        }

        // 檢查並創建翻譯 HTML
        if (translatedText && s.showTranslated) {
            // 這裡修正了 style 屬性的邏輯，使其更簡潔
            translatedLineHTML = `<div class="enhancer-line enhancer-zh-line">${translatedText}</div>`;
        }
        
        // 只有當至少有一個內容存在時才更新容器
        if (originalLineHTML || translatedLineHTML) {
            this.subtitleContainer.innerHTML = originalLineHTML + translatedLineHTML;
            // 【關鍵檢查點】：套用 settings 樣式，確保顯示/隱藏的邏輯正確
            this.applySettings();
        } else if (this.currentSubtitleIndex !== -1) {
            // 如果當前有字幕，但內容是空的，則清空容器
            this.subtitleContainer.innerHTML = '';
        }
    }
    
    showRetryLink(startIndex, count) {
        if (!this.subtitleContainer) return;
        const retryLink = document.createElement('a');
        retryLink.href = '#';
        retryLink.className = 'enhancer-retry-link';
        retryLink.textContent = `點擊重試 ${count} 句`;
        retryLink.onclick = (e) => {
            e.preventDefault();
            this.handleRetryClick(startIndex, count);
        };
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'enhancer-line enhancer-error-line';
        errorDiv.textContent = '翻譯失敗！ ';
        errorDiv.appendChild(retryLink);

        this.subtitleContainer.innerHTML = '';
        this.subtitleContainer.appendChild(errorDiv);
    }

    beginDisplay() {
        if (!this.videoElement || !this.translatedTrack) return;

        this.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
        this.videoElement.addEventListener('timeupdate', this.handleTimeUpdate);

        // 第一次呼叫，確保字幕容器存在
        if (this.translatedTrack.length > 0) {
            this.handleTimeUpdate(); 
        }
    }

    handleTimeUpdate() {
        const currentTime = this.videoElement.currentTime * 1000;
        const s = this.translatedTrack;

        // 搜尋當前時間點的字幕
        let newIndex = -1;
        for (let i = 0; i < s.length; i++) {
            if (currentTime >= s[i].start && currentTime < s[i].end) {
                newIndex = i;
                break;
            }
        }

        if (newIndex !== -1 && newIndex !== this.currentSubtitleIndex) {
            this.currentSubtitleIndex = newIndex;
            const sub = s[newIndex];
            this.updateSubtitleDisplay(sub.text, sub.translatedText, newIndex);
        } else if (newIndex === -1 && this.currentSubtitleIndex !== -1) {
            // 時間點不在任何字幕區間內，隱藏字幕
            this.currentSubtitleIndex = -1;
            if (this.subtitleContainer) {
                this.subtitleContainer.innerHTML = '';
            }
        }
    }

    showToast(message, duration = TOAST_DURATION) {
        if (!this.toastContainer) return;
        
        // 清除舊的計時器
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
        }

        this.toastContainer.textContent = message;
        this.toastContainer.classList.add('show');
        
        if (duration > 0) {
            this.toastTimeout = setTimeout(() => {
                this.toastContainer.classList.remove('show');
            }, duration);
        }
    }

    injectInterceptor() {
        if (!chrome.runtime) return; // 檢查上下文是否有效

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('injector.js');
        (document.head || document.documentElement).appendChild(script);
        script.onload = () => script.remove();
    }
}

new YouTubeSubtitleEnhancer().initialize();