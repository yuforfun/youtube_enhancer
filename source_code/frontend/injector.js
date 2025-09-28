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
        
        // 【新增職責】: 初始化所有監聽器和主流程
        init() {
            this.log('v6.0 (信使驅動自動化) 已就位，開始執行。');
            
            this.setupInterceptors();
            this.setupVariableListener();
            document.addEventListener('yt-navigate-finish', this.handleNavigation);
            window.addEventListener('message', this.handleContentMessage);

            this.main();
        }

        // 【新增職責】: 主流程，帶有重試機制
        main(retryCount = 0) {
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
        
        // 【新增職責】: 獲取播放器實例 (從 content.js 移植過來)
        getPlayerInstance() {
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

        // 【新增職責】: 透過 content.js 作為橋樑，從 background 獲取設定
        getSettingsFromBackground() {
            this.sendMessageToContent('GET_SETTINGS_FROM_INJECTOR');
        }

        // 【新增職責】: 處理來自 content.js 的訊息 (主要是設定的回應)
        handleContentMessage(event) {
            if (event.source !== window || !event.data || event.data.type !== 'SETTINGS_RESPONSE_FROM_CONTENT') return;
            
            this.log('收到來自 content.js 的設定回應。');
            this.state.settings = event.data.payload;
            
            // 拿到設定後，執行最終的自動化決策
            this.activateBySettings();
        }
        
        // 【新增職責】: 根據設定，匹配語言並命令播放器
        activateBySettings() {
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

        // 頁面切換時的處理
        handleNavigation() {
            this.log('偵測到 YouTube 頁面切換完成，重新初始化所有狀態和流程。');
            // 重置所有狀態並重新開始主流程
            this.state = { player: null, playerResponse: null, settings: null, isDataSent: false };
            this.main();
        }

        // 設置變數監聽器 (用於 playerResponse)
        setupVariableListener() {
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
        
        // 設置網路攔截器 (Fetch 和 XHR)
        // 設置網路攔截器 (Fetch 和 XHR)
        setupInterceptors() {
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

        // 統一處理 timedtext 請求
        handleTimedTextRequest(fetcher, args) {
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
        
        // 向 content.js 發送訊息
        sendMessageToContent(type, payload = {}) {
            window.postMessage({ from: 'YtEnhancerInjector', type, payload }, '*');
        }
    }

    window.ytEnhancerInjector = new YtEnhancerInjector();
    window.ytEnhancerInjector.init();

})();