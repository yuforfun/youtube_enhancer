// 請用以下完整內容，替換您現有的整個 injector.js 檔案。
/**
 * @file injector.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 2.1.0
 */
(function() {
    'use strict';
    if (window.ytEnhancerInjector) return;

    class YtEnhancerInjector {
        constructor() {
            // 功能: 初始化 class 實例。
            // input: 無
            // output: YtEnhancerInjector 物件實例。
            // 其他補充: 新增了反向握手所需的狀態旗標。
            this.startTime = performance.now();
            this.log = (message, ...args) => console.log(`%c[現場特工 @ ${(performance.now() - this.startTime).toFixed(2)}ms]`, 'color: #f0f;', message, ...args);
            this.error = (message, ...args) => console.error(`%c[現場特工 @ ${(performance.now() - this.startTime).toFixed(2)}ms]`, 'color: #f0f;', message, ...args);
            this.state = { 
                player: null, 
                lastProcessedVideoId: null,
                isPolling: false,
                isDataSent: false,
                // 【關鍵修正點】: 新增反向握手所需的狀態
                playerResponse: null,
                isDataReady: false,
                isContentScriptReady: false
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
            // 功能: (最終版) 導航事件的統一處理入口，增加狀態重置。
            // input: 無 (從 window.location 讀取 URL)。
            // output: 條件滿足時呼叫 this.main()。
            // 其他補充: 在啟動前重置所有狀態是確保軟導航成功的關鍵。
            setTimeout(() => {
                // 【關鍵修正點】: 在所有檢查之前，重置與握手相關的狀態
                this.state.playerResponse = null;
                this.state.isDataReady = false;
                this.state.isContentScriptReady = false;

                if (this.state.isPolling) {
                    this.log('偵測到導航事件，但輪詢已在進行中，忽略。');
                    return;
                }
                const videoId = new URLSearchParams(window.location.search).get('v');
                if (videoId && this.state.lastProcessedVideoId === videoId) {
                    this.log(`偵測到導航事件，但影片 ID [${videoId}] 已處理過，忽略。`);
                    return;
                }
                
                if (videoId) {
                    this.log(`偵測到新影片導航 [${videoId}]，啟動主流程...`);
                    this.main(videoId);
                } else if (this.state.lastProcessedVideoId) {
                    this.log('導航至非影片頁面，重置 ID 記錄。');
                    this.state.lastProcessedVideoId = null;
                }
            }, 100);
        }

        main(videoId, retryCount = 0) {
            // 功能: (反向握手版) 核心啟動函式，獲取資料後不再主動發送，而是儲存並等待請求。
            // input: videoId (字串), retryCount (內部遞迴計數)。
            // output: 更新內部狀態，並在條件滿足時發送資料。
            this.state.isPolling = true;

            const MAX_RETRIES = 50; 
            const RETRY_INTERVAL = 100;
            try {
                const player = this.getPlayerInstance();
                if (player && typeof player.getPlayerResponse === 'function') {
                    const playerResponse = player.getPlayerResponse();
                    if (playerResponse && playerResponse.videoDetails && playerResponse.captions) {
                        this.log(`✅ 成功獲取播放器資料 (嘗試 ${retryCount + 1} 次)，資料已儲存。`);
                        
                        this.state.player = player;
                        this.state.lastProcessedVideoId = videoId;
                        this.state.isDataSent = false;
                        
                        // 【關鍵修正點】: 將資料儲存到狀態中，並設定「資料就緒」旗標
                        this.state.playerResponse = playerResponse;
                        this.state.isDataReady = true;

                        this.state.isPolling = false;

                        // 【關鍵修正點】: 檢查 content.js 是否已在等待，如果是，則立即發送資料
                        if (this.state.isContentScriptReady) {
                            this.log('偵測到 content.js 已就緒，立即發送已儲存的資料。');
                            this.sendPlayerResponse();
                        }
                        return;
                    }
                }

                if (retryCount < MAX_RETRIES) {
                    setTimeout(() => this.main(videoId, retryCount + 1), RETRY_INTERVAL);
                } else {
                    this.error(`在 5 秒後仍無法獲取有效的播放器或資料。`);
                    this.state.isPolling = false;
                }
            } catch (e) {
                this.error('在 main 函式中發生錯誤:', e);
                this.state.isPolling = false;
            }
        }

        setupInterceptors() {
            const self = this;
            const originalFetch = window.fetch;
            window.fetch = function(...args) {
                const url = args[0] instanceof Request ? args[0].url : String(args[0]);
                if (url.includes('/api/timedtext')) {
                    self.log('透過 Fetch 攔截到 timedtext 請求...');
                    return self.handleTimedTextRequest(originalFetch.apply(this, args));
                }
                return originalFetch.apply(this, args);
            };
            const originalXHROpen = window.XMLHttpRequest.prototype.open;
            window.XMLHttpRequest.prototype.open = function(method, url) {
                if (typeof url === 'string' && url.includes('/api/timedtext')) {
                    this._isTimedTextRequest = true;
                    this._timedTextUrl = url;
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
            // 功能: (反向握手版) 監聽並處理來自 content.js 的指令。
            // input: event (MessageEvent)。
            // output: 根據指令執行對應操作。
            if (event.source !== window || !event.data || event.data.from !== 'YtEnhancerContent') return;
            const { type, payload } = event.data;
            switch (type) {
                // 【關鍵修正點】: 新增用於反向握手的指令
                case 'REQUEST_PLAYER_RESPONSE':
                    this.log('收到 content.js 的「請求資料」信號。');
                    this.state.isContentScriptReady = true;

                    // 【關鍵修正點】: 檢查資料是否已就緒，如果是，則立即發送
                    if (this.state.isDataReady) {
                        this.log('偵測到資料已就緒，立即回傳。');
                        this.sendPlayerResponse();
                    } else {
                        this.log('資料尚未就緒，已記錄 content.js 的就緒狀態。');
                    }
                    break;

                case 'FORCE_ENABLE_TRACK':
                    this.log('收到指揮中心的「強制啟用軌道」指令。');
                    if (this.state.player && payload) {
                        const command = () => {
                            this.state.player.setOption('captions', 'track', {
                                languageCode: payload.languageCode,
                                ...(payload.vssId && { "vssId": payload.vssId })
                            });
                        };
                        this.log(`[指令保險] 正在進行第一次嘗試...`);
                        this.state.isDataSent = false;
                        command();
                        setTimeout(() => {
                            if (!this.state.isDataSent) {
                                this.log(`[指令保險] 1.5秒後未收到字幕，正在進行第二次嘗試...`);
                                command();
                            }
                        }, 1500);
                    } else {
                        this.error('無法執行強制啟用，缺少播放器實例或軌道資料。');
                    }
                    break;
            }
        }
        
        sendPlayerResponse() {
            // 功能: 統一的 PLAYER_RESPONSE_CAPTURED 訊息發送函式。
            // input: 無 (從 this.state 讀取)
            // output: 發送 postMessage
            // 其他補充: 防止重複發送。
            if (this.state.playerResponse) {
                this.sendMessageToContent('PLAYER_RESPONSE_CAPTURED', this.state.playerResponse);
                // 發送後立即清除，防止因其他競速問題導致重複發送
                this.state.playerResponse = null; 
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