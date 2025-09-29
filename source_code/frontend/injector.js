/**
 * @file injector.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 6.0.0 (Injector-Driven Automation)
 */
(function() {
    'use strict';
    // 防止重複注入
    if (window.ytEnhancerInjector) return;

    class YtEnhancerInjector {
        constructor() {
        // 功能: 初始化 class 實例，設定日誌格式、初始狀態，並綁定所有方法的 'this' 指向。
        // input: 無
        // output: (YtEnhancerInjector 物件)
        // 其他補充: 綁定 'this' 是為了確保在事件監聽器或非同步回呼中，class 方法能正確存取實例的屬性 (如 this.state)。
            this.startTime = performance.now();
            this.log = (message, ...args) => {
                const time = (performance.now() - this.startTime).toFixed(2);
                console.log(`%c[信使 @ ${time}ms]`, 'color: #f0f;', message, ...args);
            };
            this.error = (message, ...args) => {
                const time = (performance.now() - this.startTime).toFixed(2);
                console.error(`%c[信使 @ ${time}ms]`, 'color: #f0f;', message, ...args);
            };

            this.state = {
                player: null,
                playerResponse: null,
                settings: null,
                isDataSent: false, // 用於確保 timedtext 只被發送一次
            };

            // 【關鍵修正點】: 綁定所有 class 方法的 'this'
            Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(prop => {
                if (typeof this[prop] === 'function' && prop !== 'constructor') {
                    this[prop] = this[prop].bind(this);
                }
            });
        }
        
        init() {
        // 功能: 整個 injector 腳本的啟動入口。
        // input: 無
        // output: 無
        // 其他補充: 負責註冊所有必要的監聽器 (網路請求、頁面導航、訊息)，並呼叫主流程 main()。
            this.log('v6.0 (信使驅動自動化) 已就位，開始執行。');
            
            this.setupInterceptors();
            this.setupVariableListener();
            document.addEventListener('yt-navigate-finish', this.handleNavigation);
            window.addEventListener('message', this.handleContentMessage);

            this.main();
        }

        main(retryCount = 0) {
        // 功能: 自動化流程的核心，採用重試機制來穩定地獲取頁面上的關鍵物件。
        // input: retryCount (整數) - 目前的重試次數，由遞迴呼叫傳入。
        // output to: 成功時 -> getSettingsFromBackground()
        //            失敗時 -> sendMessageToContent('AUTOMATION_FAILED', ...) -> content.js
        // 其他補充: 這是 Plan A 的核心。它會持續嘗試，直到同時拿到「播放器物件」和「字幕清單」後，才會繼續下一步。若10次後仍失敗，則宣告 Plan A 失敗。
            const MAX_RETRIES = 10;
            const RETRY_INTERVAL = 1000;

            if (!this.state.player) this.state.player = this.getPlayerInstance();
            if (!this.state.playerResponse) this.state.playerResponse = window.ytInitialPlayerResponse;

            if (this.state.player && this.state.playerResponse) {
                this.log(`成功獲取播放器與字幕清單 (嘗試 ${retryCount + 1} 次)。正在向 background 請求設定...`);
                this.getSettingsFromBackground();
                return;
            }

            if (retryCount < MAX_RETRIES) {
                this.log(`播放器或字幕清單尚未就緒，將在 ${RETRY_INTERVAL}ms 後重試 (${retryCount + 1}/${MAX_RETRIES})...`);
                setTimeout(() => this.main(retryCount + 1), RETRY_INTERVAL);
            } else {
                // # 【關鍵修正點】: 增加更詳細的失敗原因日誌
                let failReason = '';
                if (!this.state.player && !this.state.playerResponse) {
                    failReason = '播放器和字幕清單都未找到';
                } else if (!this.state.player) {
                    failReason = '字幕清單已找到，但播放器未找到';
                } else {
                    failReason = '播放器已找到，但字幕清單未找到';
                }
                this.error(`重試 ${MAX_RETRIES} 次後仍無法獲取關鍵物件 (${failReason})，自動模式失敗。`);
                
                this.sendMessageToContent('AUTOMATION_FAILED', {
                    playerResponse: this.state.playerResponse
                });
            }
        }
        
        getPlayerInstance() {
        // 功能: 獲取 YouTube 播放器的 API 物件實例。
        // input: 無 (讀取頁面 DOM)
        // output: (物件) 播放器 API 物件，若找不到則回傳 null。
        // 其他補充: 嘗試了多種 YouTube 可能使用的方法來獲取播放器物件，以提高成功率。
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

        getSettingsFromBackground() {
        // 功能: 向 content.js 發送一個請求，要求它作為橋樑，去向 background.js 獲取使用者設定。
        // input: 無
        // output to: sendMessageToContent('GET_SETTINGS_FROM_INJECTOR') -> content.js
        // 其他補充: 這是 injector.js (MAIN world) 與 background.js (Service Worker) 之間通訊的唯一途徑。
            this.sendMessageToContent('GET_SETTINGS_FROM_INJECTOR');
        }

        handleContentMessage(event) {
        // 功能: 處理來自 content.js 的訊息，主要是 getSettingsFromBackground 的回應。
        // input from: content.js (透過 window.postMessage)
        // output to: activateBySettings()
            if (event.source !== window || !event.data || event.data.type !== 'SETTINGS_RESPONSE_FROM_CONTENT') return;
            
            this.log('收到來自 content.js 的設定回應。');
            this.state.settings = event.data.payload;
            
            // 拿到設定後，執行最終的自動化決策
            this.activateBySettings();
        }
        
        activateBySettings() {
        // 功能: 在獲取到所有必要資訊（播放器、字幕清單、使用者設定）後，執行的最終自動化決策與動作。
        // input: 無 (讀取 this.state 中的 player, playerResponse, settings)
        // output: (播放器 API 呼叫) player.setOption(...)
        // 其他補充: 這是 Plan A 的最後一步，如果匹配到偏好語言，它會直接命令播放器載入字幕，從而觸發 timedtext 網路請求。
            if (!this.state.settings || !this.state.playerResponse) {
                this.error('缺少設定或字幕清單，無法執行自動化決策。');
                return;
            }

            const tracks = this.state.playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            const availableLangs = tracks.map(t => t.languageCode);
            const { preferred_langs = [], ignored_langs = [] } = this.state.settings;

            const matchedLang = preferred_langs.find(pLang =>
                availableLangs.includes(pLang) && !ignored_langs.includes(pLang)
            );
            
            if (matchedLang && this.state.player) {
                const trackToEnable = tracks.find(t => t.languageCode === matchedLang);
                if (trackToEnable) {
                    this.log(`語言匹配成功！[${matchedLang}]，正在命令播放器啟用該字幕...`);
                    this.state.player.setOption('captions', 'track', {
                        languageCode: trackToEnable.languageCode,
                        ...(trackToEnable.vssId && { "vssId": trackToEnable.vssId })
                    });
                }
            } else {
                this.log('未匹配到偏好語言，自動模式結束。');
            }
        }

        handleNavigation() {
        // 功能: 處理 YouTube 的 'yt-navigate-finish' 事件，代表頁面已切換。
        // input: (事件物件)
        // output: 無
        // 其他補充: 重置所有狀態並重新啟動主流程 main()。
            this.log('偵測到 YouTube 頁面切換完成，重新初始化所有狀態和流程。');
            // 重置所有狀態並重新開始主流程
            this.state = { player: null, playerResponse: null, settings: null, isDataSent: false };
            this.main();
        }

        setupVariableListener() {
        // 功能: 透過 Object.defineProperty 劫持 ytInitialPlayerResponse 這個全域變數。
        // input: 無
        // output: 無
        // 其他補充: 這是獲取「字幕清單」最穩定可靠的方法。一旦 YouTube 的腳本為這個變數賦值，我們就能立刻捕捉到。
            let actualPlayerResponse = null;
            Object.defineProperty(window, 'ytInitialPlayerResponse', {
                configurable: true, enumerable: true,
                get: () => actualPlayerResponse,
                set: (value) => {
                    actualPlayerResponse = value;
                    this.state.playerResponse = value; // 更新 state
                }
            });
        }
        
        setupInterceptors() {
        // 功能: 覆寫瀏覽器原生的 Fetch 和 XMLHttpRequest，以攔截網路請求。
        // input: 無
        // output: 無
        // 其他補充: 這是攔截「字幕內容」的核心機制。
            const originalFetch = window.fetch;
            window.fetch = (...args) => {
                const url = args[0] instanceof Request ? args[0].url : args[0];
                if (typeof url === 'string' && url.includes('/api/timedtext')) {
                    return this.handleTimedTextRequest(originalFetch, args);
                }
                return originalFetch(...args);
            };

            const originalXhrOpen = window.XMLHttpRequest.prototype.open;
            const originalXhrSend = window.XMLHttpRequest.prototype.send;
            window.XMLHttpRequest.prototype.open = function(...args) {
                this._interceptorRequestUrl = args[1];
                return originalXhrOpen.apply(this, args);
            };
            window.XMLHttpRequest.prototype.send = function(...args) {
                this.addEventListener('load', () => {
                    if (this._interceptorRequestUrl && this._interceptorRequestUrl.includes('/api/timedtext')) {
                        const lang = new URLSearchParams(this._interceptorRequestUrl.split('?')[1]).get('lang');
                        // # 【關鍵修正點】: 增加 try...catch 和對空回應的判斷，防止解析錯誤
                        try {
                            if (!this.responseText) {
                                // 忽略空的響應，這可能是預載入請求
                                return;
                            }
                            const data = JSON.parse(this.responseText);
                            if (!window.ytEnhancerInjector.state.isDataSent) {
                                window.ytEnhancerInjector.state.isDataSent = true;
                                window.ytEnhancerInjector.sendMessageToContent('TIMEDTEXT_DATA', { payload: data, lang });
                            }
                        } catch (e) {
                            window.ytEnhancerInjector.error(`[XHR] 解析 timedtext JSON 失敗: ${e.message}`);
                        }
                    }
                });
                return originalXhrSend.apply(this, args);
            };
            this.log('Fetch 和 XHR 攔截器已啟動。');
        }

        handleTimedTextRequest(fetcher, args) {
        // 功能: 統一處理被 Fetch 攔截到的 timedtext 請求。
        // input: fetcher (函式) - 原生的 fetch 函式。
        //        args (列表) - fetch 的參數。
        // output to: sendMessageToContent('TIMEDTEXT_DATA', ...) -> content.js
            const url = args[0] instanceof Request ? args[0].url : args[0];
            const lang = new URLSearchParams(url.split('?')[1]).get('lang');
            return new Promise((resolve, reject) => {
                fetcher(...args).then(response => {
                    const clonedResponse = response.clone();
                    clonedResponse.json().then(data => {
                        if (!this.state.isDataSent) {
                            this.state.isDataSent = true;
                            this.sendMessageToContent('TIMEDTEXT_DATA', { payload: data, lang });
                        }
                    }).catch(err => this.error('[Fetch] 解析 timedtext JSON 失敗', err));
                    resolve(response);
                }).catch(err => reject(err));
            });
        }
        
        sendMessageToContent(type, payload = {}) {
        // 功能: 向 content.js 發送訊息的標準化輔助函式。
        // input: type (字串) - 訊息類型。
        //        payload (物件) - 訊息內容。
        // output: (window.postMessage)
            window.postMessage({ from: 'YtEnhancerInjector', type, payload }, '*');
        }
    }

    window.ytEnhancerInjector = new YtEnhancerInjector();
    window.ytEnhancerInjector.init();

})();