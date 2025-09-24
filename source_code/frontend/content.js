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

(() => {
    // 防止重複注入
    if (window.ytEnhancer) {
        window.ytEnhancer.destroy();
    }

    const SERVER_URL = "http://127.0.0.1:5001/api/translate";
    const BATCH_SIZE = 30;

    class YouTubeSubtitleEnhancer {
        constructor() {
            // ... (constructor 內容不變)
			console.log("YT 字幕增強器 v13.2-super-debug");
            this.isEnabled = false;
            this.isProcessing = false;
            this.settings = {};
            this.videoElement = null;
            this.subtitleContainer = null;
            this.translatedTrack = null;
            this.currentSubtitleIndex = -1;
            this.toastTimeout = null;
            this.abortController = null;
            this.initRetryCount = 0; // 【新增】用於重試的計數器

            this.handleWindowMessage = this.handleWindowMessage.bind(this);
            this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
            this.handleStateChange = this.handleStateChange.bind(this);
            this.handleSettingsChange = this.handleSettingsChange.bind(this);
            this.run = this.run.bind(this);
        }

        async initialize() {
            // ... (initialize 內容不變)
            const settingsResponse = await this.sendMessageToBackground({ action: 'getSettings' });
            this.settings = settingsResponse?.data || {};
            const statusResponse = await this.sendMessageToBackground({ action: 'checkStatus' });
            this.isEnabled = statusResponse?.isEnabled || false;

            window.addEventListener('message', this.handleWindowMessage);
            chrome.runtime.onMessage.addListener(this.handleStateChange);
            chrome.runtime.onMessage.addListener(this.handleSettingsChange);
            document.addEventListener('yt-navigate-finish', () => setTimeout(this.run, 500));
            
            this.run();
        }

        run() {
            this.initRetryCount = 0; // 每次執行 run 都重置計數器
            if (this.isEnabled && window.location.pathname.startsWith('/watch')) {
                this.start();
            } else {
                this.stop();
            }
        }
        
        // 【核心修改】start 函式
		async start() {
			this.stop();

			this.videoElement = document.querySelector('video');
			const playerContainer = document.getElementById('movie_player');

			if (!this.videoElement || !playerContainer) {
				if (this.initRetryCount < 10) {
					this.initRetryCount++;
					console.warn(`[Enhancer] 未找到播放器元素，將在 1 秒後重試 (${this.initRetryCount}/10)...`);
					setTimeout(() => this.start(), 1000);
				} else {
					console.error("[Enhancer] 多次重試後仍未找到播放器，腳本終止。");
				}
				return;
			}
			
			console.log("[Enhancer] 成功找到播放器元素，開始執行主要邏輯。");

			this.createSubtitleContainer(playerContainer);
			this.applySettings();

			const videoId = this.getVideoId();
			console.log(`[Enhancer] 嘗試獲取 Video ID，結果為:`, videoId);

			if (!videoId) {
				console.error("[Enhancer] 錯誤：無法從當前 URL 中獲取 Video ID。腳本終止。");
				return;
			}

			const cacheKey = `ytEnhancerCache_${videoId}`;

			// 【新增偵錯日誌】
			console.log(`[Enhancer] 準備向 background 發送 getCache 請求，key 為: ${cacheKey}`);
			
			const cachedData = await this.getCache(cacheKey);

			// 【新增偵錯日誌】
			console.log(`[Enhancer] 已收到 background 的 getCache 回應，資料為:`, cachedData);

			if (cachedData && cachedData.translatedTrack) {
				this.translatedTrack = cachedData.translatedTrack;
				const needsResume = this.translatedTrack.some(sub => this.isTranslationIncomplete(sub));
				
				if (needsResume && cachedData.rawPayload) {
					console.log('[Enhancer] 偵測到不完整暫存，將啟動自動重試。');
					this.showToast("偵測到未完成的翻譯，正在自動重試...", 4000);
					setTimeout(() => this.parseAndTranslate(cachedData.rawPayload), 100);
					return;
				}

				if (!needsResume) {
					this.showToast("翻譯完成 (來自暫存)");
				}
				
				this.beginDisplay();
				return;
			}

			this.showToast("攔截器已部署，請手動開啟CC字幕以觸發...");
			this.injectInterceptor();
		}

        stop() {
            if (this.abortController) {
                this.abortController.abort();
            }
            if (this.videoElement) this.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
            if (this.subtitleContainer) this.subtitleContainer.remove();
            
            const toast = document.getElementById('enhancer-toast');
            if(toast) toast.classList.remove('show');
            
            const originalContainer = document.querySelector('.ytp-caption-window-container');
            if (originalContainer) originalContainer.style.display = '';
            
            this.videoElement = null;
            this.subtitleContainer = null;
            this.translatedTrack = null;
            this.currentSubtitleIndex = -1;
            this.isProcessing = false;
        }

        destroy() {
            this.stop();
            window.removeEventListener('message', this.handleWindowMessage);
            console.log("YT 字幕增強器實例已銷毀。");
        }

        handleWindowMessage(event) {
            if (event.source !== window || !event.data || event.data.type !== 'FROM_YT_ENHANCER_INTERCEPTOR') return;
            if (this.isProcessing) return;

            if (event.data.status === 'SUCCESS') {
                this.isProcessing = true;
                this.parseAndTranslate(event.data.payload);
            } else {
                this.showToast(`[錯誤] ${event.data.reason || '未知錯誤'}`);
            }
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

        async parseAndTranslate(payload) {
            try {
                this.showToast(`成功攔截字幕，正在解析...`);
                const videoId = this.getVideoId();
                const cacheKey = `ytEnhancerCache_${videoId}`;

                let originalSubtitles = this.parseRawSubtitles(payload);
                if (originalSubtitles.length === 0) throw new Error("解析後發現字幕檔為空。");

                this.initializeOrMergeTrack(originalSubtitles);
                this.beginDisplay();

                const totalBatches = Math.ceil(this.translatedTrack.length / BATCH_SIZE);
                this.showToast(`解析完成，共 ${originalSubtitles.length} 句。開始分批翻譯 (共 ${totalBatches} 批)...`);

                this.abortController = new AbortController();

                for (let i = 0; i < this.translatedTrack.length; i += BATCH_SIZE) {
                    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
                    if (!this.isTranslationIncomplete(this.translatedTrack[i])) continue;

                    const batch = this.translatedTrack.slice(i, i + BATCH_SIZE);
                    await this.translateBatch(batch, batchNum, totalBatches, cacheKey, payload);
                }
                this.showToast("所有批次翻譯已完成！", 5000);

            } catch (e) {
                if (e.name !== 'AbortError') {
                    this.showToast(`[錯誤] ${e.message}`, 6000);
                }
            } finally {
                this.isProcessing = false;
                this.abortController = null;
            }
        }
        
        async translateBatch(batch, batchNum, totalBatches, cacheKey, rawPayload) {
            const batchTexts = batch.map(sub => sub.text);
            try {
                this.showToast(`正在翻譯第 ${batchNum}/${totalBatches} 批...`);
                const translatedBatch = await this.sendBatchForTranslation(batchTexts, this.abortController.signal);
                
                if (translatedBatch && translatedBatch.length === batch.length) {
                    batch.forEach((sub, index) => { sub.translatedText = translatedBatch[index]; });
                } else {
                    throw new Error("回傳數量不符");
                }
            } catch (error) {
                 if (error.name === 'AbortError') {
                    console.log(`批次 ${batchNum} 的翻譯請求被主動中斷。`);
                    throw error;
                }
                this.showToast(`第 ${batchNum}/${totalBatches} 批翻譯失敗！`, 5000);
                batch.forEach(sub => { sub.translatedText = "[此批翻譯失敗]"; });
            } finally {
                if (!this.abortController.signal.aborted) {
                    await this.setCache(cacheKey, { translatedTrack: this.translatedTrack, rawPayload: rawPayload });
                }
            }
        }
        
        async retryFailedBatch(batchIndex) {
            if (!this.translatedTrack || this.isProcessing) return;
            
            const videoId = this.getVideoId();
            const cacheKey = `ytEnhancerCache_${videoId}`;
            const cachedData = await this.getCache(cacheKey);
            const rawPayload = cachedData?.rawPayload;

            if (!rawPayload) {
                this.showToast("錯誤：找不到原始字幕資料，無法重試。", 5000);
                return;
            }

            const batchStart = batchIndex * BATCH_SIZE;
            const batchEnd = batchStart + BATCH_SIZE;
            const batch = this.translatedTrack.slice(batchStart, batchEnd);
            if (!batch.length) return;

            this.isProcessing = true;
            this.abortController = new AbortController();
            
            this.showToast(`正在重試第 ${batchIndex + 1} 批...`);
            batch.forEach(sub => sub.translatedText = '...');
            
            try {
                await this.translateBatch(batch, batchIndex + 1, Math.ceil(this.translatedTrack.length / BATCH_SIZE), cacheKey, rawPayload);
                this.showToast(`第 ${batchIndex + 1} 批重試成功！`);
            } catch(e) {
                 if (e.name !== 'AbortError') {
                    this.showToast(`第 ${batchIndex + 1} 批重試失敗。`);
                 }
            } finally {
                this.isProcessing = false;
                this.abortController = null;
                // 更新當前顯示
                this.handleTimeUpdate();
            }
        }

        createSubtitleContainer(playerContainer) {
            if (document.getElementById('enhancer-subtitle-container')) return;
            this.subtitleContainer = document.createElement('div');
            this.subtitleContainer.id = 'enhancer-subtitle-container';
            this.subtitleContainer.addEventListener('click', (event) => {
                if (event.target && event.target.classList.contains('enhancer-retry-link')) {
                    const index = parseInt(event.target.dataset.index, 10);
                    if (!isNaN(index)) {
                        const batchIndex = Math.floor(index / BATCH_SIZE);
                        this.retryFailedBatch(batchIndex);
                    }
                }
            });
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
                if (translatedText === '[此批翻譯失敗]') {
                    zhLine = `<div class="enhancer-line enhancer-zh-line"><span class="enhancer-retry-link" data-index="${index}">[此批翻譯失敗 - 點此重試]</span></div>`;
                } else {
                    zhLine = `<div class="enhancer-line enhancer-zh-line">${this.escapeHTML(translatedText)}</div>`;
                }
            }
            this.subtitleContainer.innerHTML = jaLine + zhLine;
        }

        applySettings() {
            if (!this.subtitleContainer) return;
            this.subtitleContainer.style.fontSize = `${this.settings.fontSize}px`;
            this.subtitleContainer.style.fontFamily = this.settings.fontFamily;
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
                let fullText = event.segs.map(seg => seg.utf8).join('').replace(/\s+/g, ' ').trim();
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
            try {
                return await chrome.runtime.sendMessage(message);
            } catch (e) {
                console.warn(`[Enhancer] 無法連接到背景服務: ${e.message}`);
                return null;
            }
        }

        async getCache(key) {
            const response = await this.sendMessageToBackground({ action: 'getCache', key });
            if (response && response.data) {
                if (Array.isArray(response.data)) {
                    return { translatedTrack: response.data, rawPayload: null };
                }
                return response.data;
            }
            return null;
        }

        async setCache(key, data) {
            return await this.sendMessageToBackground({ action: 'setCache', key, data });
        }
        
        async sendBatchForTranslation(texts, signal) {
            const response = await fetch(SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texts }),
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