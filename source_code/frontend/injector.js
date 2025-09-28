/**
 * @file injector.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * Version: 1.7.0 (Final Stability Patch)
 */

(function() {
    'use strict';
    if (window.ytEnhancerInjectorAttached) {
        return;
    }
    window.ytEnhancerInjectorAttached = true;
    
    // 【關鍵修正點】: 任務一：不再立即執行，而是輪詢等待關鍵物件出現
    const findInitialData = () => {
        let attempts = 0;
        const maxAttempts = 20; // 20 * 250ms = 5 秒
        const interval = setInterval(() => {
            if (window.ytInitialPlayerResponse) {
                clearInterval(interval);
                try {
                    const captionsData = window.ytInitialPlayerResponse.captions;
                    window.postMessage({ type: 'YT_ENHANCER_PLAYER_RESPONSE', payload: captionsData || null }, '*');
                } catch (e) {
                    window.postMessage({ type: 'YT_ENHANCER_PLAYER_RESPONSE', payload: null }, '*');
                }
            } else {
                attempts++;
                if (attempts >= maxAttempts) {
                    clearInterval(interval);
                    // 逾時後，嘗試用您提供的 HTML 解析法做最後的努力
                    try {
                        const scripts = document.querySelectorAll('script');
                        let playerResponse = null;
                        for (const script of scripts) {
                            const scriptContent = script.textContent;
                            if (scriptContent && scriptContent.includes('var ytInitialPlayerResponse = ')) {
                                const jsonStr = scriptContent.substring(
                                    scriptContent.indexOf('{'),
                                    scriptContent.lastIndexOf('}') + 1
                                );
                                playerResponse = JSON.parse(jsonStr);
                                break;
                            }
                        }
                        window.postMessage({ type: 'YT_ENHANCER_PLAYER_RESPONSE', payload: playerResponse ? playerResponse.captions : null }, '*');
                    } catch(e) {
                        window.postMessage({ type: 'YT_ENHANCER_PLAYER_RESPONSE', payload: null }, '*');
                    }
                }
            }
        }, 250);
    };
    findInitialData();


    // --- 任務二：設定網路攔截器，攔截後續的字幕內容 ---
    const postSubtitleMessage = (status, payload, lang = null, reason = '') => {
        window.postMessage({
            type: 'FROM_YT_ENHANCER_INTERCEPTOR',
            status: status,
            payload: payload,
            lang: lang,
            reason: reason
        }, '*');
    };
    
    const getLangFromUrl = (url) => {
        try {
            const urlParams = new URLSearchParams(url.split('?')[1]);
            return urlParams.get('lang') || null;
        } catch (e) {
            return null;
        }
    };

    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const url = args[0] instanceof Request ? args[0].url : args[0];

        if (typeof url === 'string' && url.includes('/api/timedtext')) {
            const lang = getLangFromUrl(url);
            return new Promise((resolve, reject) => {
                originalFetch.apply(this, args)
                    .then(response => {
                        const clonedResponse = response.clone();
                        clonedResponse.json()
                            .then(data => postSubtitleMessage('SUCCESS', data, lang))
                            .catch(err => postSubtitleMessage('FAIL', null, lang, `Fetch JSON parse error: ${err.message}`));
                        resolve(response);
                    })
                    .catch(err => {
                        postSubtitleMessage('FAIL', null, lang, `Fetch request failed: ${err.message}`);
                        reject(err);
                    });
            });
        }
        return originalFetch.apply(this, args);
    };

    const originalXhrOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(...args) {
        this._interceptorRequestUrl = args[1];
        return originalXhrOpen.apply(this, args);
    };

    const originalXhrSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', () => {
            if (this._interceptorRequestUrl && this._interceptorRequestUrl.includes('/api/timedtext')) {
                const lang = getLangFromUrl(this._interceptorRequestUrl);
                try {
                    const data = JSON.parse(this.responseText);
                    postSubtitleMessage('SUCCESS', data, lang);
                } catch (e) {
                    postSubtitleMessage('FAIL', null, lang, `XHR JSON parse error: ${e.message}`);
                }
            }
        });
        this.addEventListener('error', () => {
             if (this._interceptorRequestUrl && this._interceptorRequestUrl.includes('/api/timedtext')) {
                 const lang = getLangFromUrl(this._interceptorRequestUrl);
                 postSubtitleMessage('FAIL', null, lang, 'XHR request failed');
             }
        });
        return originalXhrSend.apply(this, args);
    };

})();