// 請用以下完整內容，替換您現有的整個 injector.js 檔案。
/**
 * @file injector.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 7.3 (播放器優先 + 影片ID防重機制)
 */
(function() {
    'use strict';
    if (window.ytEnhancerInjector) return;

    class YtEnhancerInjector {
        constructor() {
            // 功能: 初始化 class 實例。
            this.startTime = performance.now();
            this.log = (message, ...args) => console.log(`%c[現場特工 @ ${(performance.now() - this.startTime).toFixed(2)}ms]`, 'color: #f0f;', message, ...args);
            this.error = (message, ...args) => console.error(`%c[現場特工 @ ${(performance.now() - this.startTime).toFixed(2)}ms]`, 'color: #f0f;', message, ...args);
            this.state = { 
                player: null, 
                lastProcessedVideoId: null,
                isPolling: false,
                isDataSent: false // 【關鍵修正點】: 還原 isDataSent 狀態旗標
            };
            Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(prop => {
                if (typeof this[prop] === 'function' && prop !== 'constructor') {
                    this[prop] = this[prop].bind(this);
                }
            });
        }

        init() {
            // 功能: 腳本總入口。
            this.log('v7.4 (現場特工) 已就位，採用「播放器優先 + 雙攔截器」架構。');
            document.addEventListener('yt-navigate-finish', this.onNavigate);
            this.setupInterceptors(); // 【關鍵修正點】: 呼叫新的、包含雙攔截器的函式
            window.addEventListener('message', this.handleContentMessage);
            this.onNavigate(); 
        }

        onNavigate() {
            // 功能: (最終版) 導航事件的統一處理入口，內含雙重防禦機制。
            // input: 無 (從 window.location 讀取 URL)。
            // output: 條件滿足時呼叫 this.main()。
            // 其他補充: 這是防止所有重複啟動問題的最終守門員。
            setTimeout(() => {
                // 【關鍵修正點】: 第一層防禦 - 如果已有流程在執行，則忽略後續的所有事件。
                if (this.state.isPolling) {
                    this.log('偵測到導航事件，但輪詢已在進行中，忽略。');
                    return;
                }

                const videoId = new URLSearchParams(window.location.search).get('v');

                // 【關鍵修正點】: 第二層防禦 - 只有當影片 ID 是新的，才繼續執行。
                if (videoId && this.state.lastProcessedVideoId === videoId) {
                    this.log(`偵測到導航事件，但影片 ID [${videoId}] 已處理過，忽略。`);
                    return;
                }
                
                if (videoId) {
                    this.log(`偵測到新影片導航 [${videoId}]，啟動主流程...`);
                    this.main(videoId);
                } else if (this.state.lastProcessedVideoId) {
                    // 從影片頁面導航到非影片頁面時，清除記錄
                    this.log('導航至非影片頁面，重置 ID 記錄。');
                    this.state.lastProcessedVideoId = null;
                }
            }, 100);
        }

        main(videoId, retryCount = 0) {
            // 功能: (最終結構修正版) 核心啟動函式，使用清晰的 if/else 控制流程。
            // input: videoId (字串), retryCount (內部遞迴計數)。
            // output: 發送 PLAYER_RESPONSE_CAPTURED 訊息給 content.js。
            
            this.state.isPolling = true;

            const MAX_RETRIES = 50; 
            const RETRY_INTERVAL = 100;
            try {
                const player = this.getPlayerInstance();
                let isSuccess = false;

                if (player && typeof player.getPlayerResponse === 'function') {
                    const playerResponse = player.getPlayerResponse();
                    if (playerResponse && playerResponse.videoDetails && playerResponse.captions) {
                        // 【關鍵修正點】: 這是唯一的「成功」路徑
                        isSuccess = true;
                        this.log(`✅ 成功獲取播放器實例並取得權威資料 (嘗試 ${retryCount + 1} 次)。`);
                        console.log('%c[LOG-DATA-1] 捕獲到的 playerResponse 物件:', 'color: blue; font-weight: bold;', playerResponse);
                        
                        this.state.lastProcessedVideoId = videoId;
                        // 【關鍵修正點】: 刪除此行。我們不能在這裡過早地重置鎖。
                        // this.state.isDataSent = false; 
                        this.state.player = player;
                        
                        setTimeout(() => {
                            this.sendMessageToContent('PLAYER_RESPONSE_CAPTURED', playerResponse);
                        }, 0);

                        this.state.isPolling = false;
                        return; // 成功後，務必 return，終止所有後續操作
                    }
                }

                // 【關鍵修正點】: 將「重試」或「逾時」的邏輯，明確地放在 else 區塊或成功路徑之外
                if (!isSuccess) {
                    if (retryCount < MAX_RETRIES) {
                        setTimeout(() => this.main(videoId, retryCount + 1), RETRY_INTERVAL);
                    } else {
                        this.error(`在 5 秒後仍無法獲取有效的播放器或資料。`);
                        this.state.isPolling = false;
                    }
                }
            } catch (e) {
                this.error('在 main 函式中發生錯誤:', e);
                this.state.isPolling = false;
            }
        }

        setupInterceptors() {
            // 功能: (最終完整版) 覆寫 fetch 和 XMLHttpRequest，並確保 URL 被正確傳遞。
            const self = this;

            // 攔截 Fetch API
            const originalFetch = window.fetch;
            window.fetch = function(...args) {
                const url = args[0] instanceof Request ? args[0].url : String(args[0]);
                if (url.includes('/api/timedtext')) {
                    self.log('透過 Fetch 攔截到 timedtext 請求...');
                    // fetch 的 response 物件自身就包含 url，所以可以直接傳遞
                    return self.handleTimedTextRequest(originalFetch.apply(this, args));
                }
                return originalFetch.apply(this, args);
            };

            // 攔截 XMLHttpRequest API
            const originalXHROpen = window.XMLHttpRequest.prototype.open;
            window.XMLHttpRequest.prototype.open = function(method, url) {
                if (typeof url === 'string' && url.includes('/api/timedtext')) {
                    this._isTimedTextRequest = true;
                    this._timedTextUrl = url; // 【關鍵修正點】: 在 open 階段就將 URL 儲存到 XHR 物件實例上
                }
                originalXHROpen.apply(this, arguments);
            };

            const originalXHRSend = window.XMLHttpRequest.prototype.send;
            window.XMLHttpRequest.prototype.send = function() {
                if (this._isTimedTextRequest) {
                    self.log('透過 XHR 攔截到 timedtext 請求...');
                    this.addEventListener('load', function() {
                        if (this.status === 200) {
                            const responsePromise = Promise.resolve(new Response(this.responseText));
                            // 【關鍵修正點】: 將儲存的 URL 作為第二個參數，手動傳遞給處理函式
                            self.handleTimedTextRequest(responsePromise, this._timedTextUrl);
                        }
                    });
                }
                originalXHRSend.apply(this, arguments);
            };
            this.log('Fetch 和 XHR 雙攔截器已啟動。');
        }

        handleTimedTextRequest(responsePromise, requestUrl = null) {
            // 功能: (最終版) 統一處理 timedtext 回應，能接收手動傳入的 URL。
            // input: responsePromise (Promise), requestUrl (可選的字串)。
            // output: 發送 TIMEDTEXT_DATA 訊息給 content.js。
            // 其他補充: 這是確保字幕資料能被 content.js 正確識別的關鍵。
            responsePromise.then(response => {
                if (!response.ok) return;

                // 【關鍵修正點】: 優先使用手動傳入的 requestUrl (來自XHR)，如果沒有，再用 response.url (來自fetch)
                const urlString = requestUrl || response.url;
                if (!urlString) {
                    this.error('無法獲取 timedtext 的請求 URL。');
                    return;
                }

                const url = new URL(urlString);
                let lang = url.searchParams.get('lang');
                if (!lang) {
                    const vssId = url.searchParams.get('vssId');
                    if (vssId && vssId.includes('.')) {
                        lang = vssId.substring(vssId.indexOf('.') + 1);
                        this.log(`從 vssId [${vssId}] 中備用解析到語言: [${lang}]`);
                    }
                }
                lang = lang || 'unknown';

                const clonedResponse = response.clone();
                clonedResponse.json().then(data => {
                    if (!this.state.isDataSent) {
                        this.state.isDataSent = true;
                        this.log(`攔截到語言 [${lang}] 的字幕內容(timedtext)`);
                        console.log('%c[LOG-DATA-4] 攔截到的 timedtext 物件:', 'color: blue; font-weight: bold;', data);
                        this.sendMessageToContent('TIMEDTEXT_DATA', { payload: data, lang });
                    }
                }).catch(err => this.error('解析 timedtext 時出錯:', err));
            });
            return responsePromise;
        }
        
        handleContentMessage(event) {
            // 功能: 作為一個訊息中樞，監聽並處理所有來自 content.js (指揮中心) 的指令。
            // input: event (從 window.postMessage 傳來的 MessageEvent 物件)。
            // output: 根據指令類型 (type)，分發給不同的內部函式處理。
            // 其他補充: 新架構下，只接收明確的執行指令。
            if (event.source !== window || !event.data || event.data.from !== 'YtEnhancerContent') return;
            const { type, payload } = event.data;
            switch (type) {
                case 'FORCE_ENABLE_TRACK':
                    this.log('收到指揮中心的「強制啟用軌道」指令。');
                    console.log('%c[LOG-DATA-3] 收到的 FORCE_ENABLE_TRACK 指令 payload:', 'color: blue; font-weight: bold;', payload);
                    if (this.state.player && payload) {
                        this.log(`正在命令播放器啟用指定軌道...`);

                        // 【關鍵修正點】: 在命令播放器前，重置 timedtext 的發送鎖。
                        // 這確保了接下來因 setOption 而觸發的 timedtext 請求能被捕獲。
                        this.state.isDataSent = false;

                        this.state.player.setOption('captions', 'track', {
                            languageCode: payload.languageCode,
                            ...(payload.vssId && { "vssId": payload.vssId })
                        });
                    } else {
                        this.error('無法執行強制啟用，缺少播放器實例或軌道資料。');
                    }
                    break;
            }
        }
        
        getPlayerInstance() {
            // 功能: 獲取 YouTube 頁面 DOM 中的播放器元素 (#movie_player)。
            // input: 無。
            // output: 如果播放器元素存在且包含必要的 API 函式，則返回該元素；否則返回 null。
            // 其他補充: 這是確保我們與一個已完全初始化的播放器互動的關鍵。
            const playerElement = document.getElementById('movie_player');
            return (playerElement && typeof playerElement.getPlayerResponse === 'function') ? playerElement : null;
        }

        sendMessageToContent(type, payload = {}) {
            // 功能: (偵錯模式) 向 content.js 發送訊息，並在發送後立即打印日誌。
            // input: type (訊息類型字串), payload (資料物件)。
            // output: 透過 window.postMessage 發送訊息。
            // 其他補充: 這是檢查訊息是否成功發出的關鍵。
            const message = { from: 'YtEnhancerInjector', type, payload };
            window.postMessage(message, '*');
            // 【關鍵偵錯點】: 在 postMessage 執行後，立刻打印一條日誌，確認「發送」動作已執行。
            console.log(`%c[Injector -> Content] 已發送訊息:`, 'color: orange;', type, message);
        }
    }

    window.ytEnhancerInjector = new YtEnhancerInjector();
    window.ytEnhancerInjector.init();

})();