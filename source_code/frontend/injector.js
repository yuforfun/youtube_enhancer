/**
 * @file injector.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 1.6.0 目前版本使用自動擷取字幕可以順利進行
 * 待處理問題 暫存 UI 字幕列表 log區
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
                console.log(`%c[現場特工 @ ${time}ms]`, 'color: #f0f;', message, ...args);
            };
            this.error = (message, ...args) => {
                const time = (performance.now() - this.startTime).toFixed(2);
                console.error(`%c[現場特工 @ ${time}ms]`, 'color: #f0f;', message, ...args);
            };

            this.state = {
                player: null,
                // 【關鍵修正點】: 移除 playerResponse，injector 不再保管此狀態
                settings: null,
                isDataSent: false,
                isCaptureSignalSent: false // 【關鍵修正點】: 更改旗標名稱以更準確描述其用途
            };

            Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(prop => {
                if (typeof this[prop] === 'function' && prop !== 'constructor') {
                    this[prop] = this[prop].bind(this);
                }
            });
        }

        
        init() {
            // 功能: 整個 injector 腳本的啟動入口，只負責註冊所有監聽器。
            // input: 無
            // output: 無
            // 其他補充: 在 v6.2 架構中，此函式不再主動執行 main 流程，而是等待 content.js 的指令。
            this.log('v6.2 (現場特工) 已就位，等待指揮中心指令。');
            // 【關鍵修正點】: 不再主動呼叫 this.main()，改為被動監聽。
            this.setupInterceptors();
            this.setupVariableListener();
            document.addEventListener('yt-navigate-finish', this.handleNavigation);
            window.addEventListener('message', this.handleContentMessage);
        }

        main(retryCount = 0) {
            // 功能: 自動化流程的核心，現在只專注於尋找「播放器物件」。
            // input: retryCount (整數) - 目前的重試次數。
            // output to: 成功時 -> getSettingsFromBackground()
            //            失敗時 -> sendMessageToContent('AUTOMATION_FAILED')
            const MAX_RETRIES = 10;
            const RETRY_INTERVAL = 1000;

            try {
                if (!this.state.player) this.state.player = this.getPlayerInstance();

                // 【關鍵修正點】: 成功條件簡化為只檢查播放器是否存在。
                if (this.state.player) {
                    this.log(`成功獲取播放器物件 (嘗試 ${retryCount + 1} 次)。正在請求設定...`);
                    this.getSettingsFromBackground();
                    return;
                }

                if (retryCount < MAX_RETRIES) {
                    this.log(`播放器物件尚未就緒，將在 ${RETRY_INTERVAL}ms 後重試 (${retryCount + 1}/${MAX_RETRIES})...`);
                    setTimeout(() => this.main(retryCount + 1), RETRY_INTERVAL);
                } else {
                    this.error(`重試 ${MAX_RETRIES} 次後仍無法獲取播放器物件，自動模式失敗。`);
                    // 【關鍵修正點】: 發送失敗信號時，不再附帶任何 payload。
                    this.sendMessageToContent('AUTOMATION_FAILED');
                }
            } catch (error) {
                this.handleError(error, 'main');
            }
        }

        // 【關鍵修正點】: 新增統一的錯誤捕捉器。
        handleError(error, sourceFunction) {
            // 功能: 統一的錯誤捕捉與回報函式。
            // input: error (Error 物件) - 捕獲到的錯誤。
            //        sourceFunction (字串) - 發生錯誤的函式名稱。
            // output to: content.js (透過 postMessage 發送 INJECTOR_ERROR)
            this.error(`在函式 [${sourceFunction}] 中發生嚴重錯誤:`, error);
            this.sendMessageToContent('INJECTOR_ERROR', {
                message: error.message,
                source: sourceFunction,
                stack: error.stack
            });
        }

        getPlayerInstance() {
            // 功能: 獲取 YouTube 播放器的 API 物件實例。
            // input: 無 (讀取頁面 DOM)
            // output: (物件) 播放器 API 物件，若找不到則回傳 null。
            // 其他補充: 嘗試多種方法來獲取播放器物件，以提高成功率。
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
            // 功能: 向 content.js 發送請求，要求它作為橋樑去獲取使用者設定。
            // input: 無
            // output to: content.js (透過 postMessage 發送 GET_SETTINGS_FROM_INJECTOR)
            this.sendMessageToContent('GET_SETTINGS_FROM_INJECTOR');
        }

        handleContentMessage(event) {
            // 功能: 處理來自 content.js 的指令，並在收到輕量化組合包時印出其內容。
            // input: event (MessageEvent)
            // output: 無
            if (event.source !== window || !event.data || event.data.from !== 'YtEnhancerContent') return;

            const { type, payload } = event.data;

            switch (type) {
                case 'START_AUTO_ACTIVATION':
                    this.log('收到指揮中心的「開始自動化」指令。');
                    this.main();
                    break;
                case 'RERUN_INJECTOR_MAIN':
                    this.log('收到指揮中心的「強制重跑」指令。');
                    this.handleNavigation();
                    break;
                case 'SETTINGS_RESPONSE_FROM_CONTENT':
                    this.log('收到來自指揮中心的輕量化資料組合包。');

                    this.log('【除錯追蹤 - 4/4】最終接收點：injector 收到的 payload 如下：');
                    console.log(payload);

                    // 【關鍵修正點】: 分別處理 payload 中的 settings 和 captionTracks。
                    this.state.settings = payload.settings;
                    this.activateBySettings(payload.captionTracks);
                    break;
            }
        }
        
        activateBySettings(captionTracks) {
            // 功能: 在獲取到所有必要資訊後，執行的最終自動化決策與動作。
            // input: captionTracks (陣列) - 從 content.js 傳來的輕量化字幕軌道陣列。
            // output: (播放器 API 呼叫) player.setOption(...)
            // 其他補充: 這是 Plan A 的最後一步。
            // 【關鍵修正點】: 檢查傳入的 captionTracks 參數。
            if (!this.state.settings || !captionTracks) {
                this.error('缺少設定或字幕軌道資訊，無法執行自動化決策。');
                return;
            }

            // 【關鍵修正點】: 直接使用傳入的 captionTracks 參數。
            const tracks = captionTracks;
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
                this.log('未匹配到偏好語言，自動模式結束，等待使用者手動操作。');
            }
        }


        handleNavigation() {
            // 功能: 處理 YouTube 的 'yt-navigate-finish' 事件（軟導航）。
            // input: (事件物件)
            // output: 無
            // 其他補充: 在軟導航後，重置狀態，並主動讀取 playerResponse 來發送啟動信號。
            this.log('偵測到 YouTube 頁面切換完成 (軟導航)，重設所有狀態。');
            this.state = {
                player: null,
                settings: null,
                isDataSent: false,
                isCaptureSignalSent: false
            };

            // 【關鍵修正點】: 在軟導航後，主動讀取 window 變數並發送信號。
            const playerResponse = window.ytInitialPlayerResponse;
            if (playerResponse && !this.state.isCaptureSignalSent) {
                this.log('【除錯追蹤 - 1.5/4】軟導航觸發：已捕獲 ytInitialPlayerResponse，內容如下：');
                console.log(playerResponse);

                this.sendMessageToContent('PLAYER_RESPONSE_CAPTURED', playerResponse);
                this.state.isCaptureSignalSent = true;
            }
        }

        setupVariableListener() {
            // 功能: 劫持 ytInitialPlayerResponse（硬載入），印出源頭資料，並立即轉發給 content.js。
            // input: 無
            // output: 無
            // 其他補充: 這是應對首次載入、F5 重新整理等硬載入情境的主要機制。
            let actualPlayerResponse = null;
            Object.defineProperty(window, 'ytInitialPlayerResponse', {
                configurable: true, enumerable: true,
                get: () => actualPlayerResponse,
                set: (value) => {
                    actualPlayerResponse = value;
                    if (value && !this.state.isCaptureSignalSent) {
                        // 【關鍵修正點】: 加入日誌追蹤第一站 (硬載入)
                        this.log('【除錯追蹤 - 1/4】硬載入觸發：已捕獲 ytInitialPlayerResponse，內容如下：');
                        console.log(value); // 直接印出原始物件以供深入檢查

                        this.sendMessageToContent('PLAYER_RESPONSE_CAPTURED', value);
                        this.state.isCaptureSignalSent = true;
                    }
                }
            });
        }
        
        setupInterceptors() {
            // 功能: 覆寫瀏覽器原生的 Fetch 和 XMLHttpRequest，以攔截網路請求。
            // input: 無
            // output: 無
            // 其他補充: 這是攔截「字幕內容」(timedtext) 的核心機制。
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
                        try {
                            if (!this.responseText) return;
                            const data = JSON.parse(this.responseText);
                            if (!window.ytEnhancerInjector.state.isDataSent) {
                                window.ytEnhancerInjector.state.isDataSent = true;
                                window.ytEnhancerInjector.sendMessageToContent('TIMEDTEXT_DATA', { payload: data, lang });
                            }
                        } catch (e) {
                            window.ytEnhancerInjector.handleError(e, 'XHR Interceptor');
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
            // output to: content.js (透過 postMessage 發送 TIMEDTEXT_DATA)
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
                    }).catch(err => this.handleError(err, 'Fetch Interceptor'));
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