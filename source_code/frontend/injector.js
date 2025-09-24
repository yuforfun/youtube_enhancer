/**
 * @file injector.js
 * @author [yuforfun]
 * @copyright 2025 [yuforfun]
 * @license MIT
 *
 * This program is free software distributed under the MIT License.
 * You can find a copy of the license in the LICENSE file that should be
 * distributed with this software.
 *
 * This script is injected into the main page world to intercept
 * `fetch` and `XMLHttpRequest` for YouTube's subtitle data.
 */

(function() {
    'use strict';

    const postSuccess = (data) => {
        window.postMessage({
            type: 'FROM_YT_ENHANCER_INTERCEPTOR',
            status: 'SUCCESS',
            payload: data
        }, '*');
    };

    const postFail = (reason) => {
        window.postMessage({
            type: 'FROM_YT_ENHANCER_INTERCEPTOR',
            status: 'FAIL',
            reason: reason
        }, '*');
    };

    // --- 1. Fetch Interceptor ---
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const url = args[0] instanceof Request ? args[0].url : args[0];

        if (typeof url === 'string' && url.includes('/api/timedtext')) {
            return new Promise((resolve, reject) => {
                originalFetch(...args)
                    .then(response => {
                        const clonedResponse = response.clone();
                        clonedResponse.json().then(postSuccess).catch(err => postFail(`Fetch JSON parse error: ${err.message}`));
                        resolve(response);
                    })
                    .catch(err => {
                        postFail(`Fetch request failed: ${err.message}`);
                        reject(err);
                    });
            });
        }
        return originalFetch(...args);
    };

    // --- 2. XMLHttpRequest Interceptor ---
    const originalXhrOpen = window.XMLHttpRequest.prototype.open;
    const originalXhrSend = window.XMLHttpRequest.prototype.send;

    window.XMLHttpRequest.prototype.open = function(...args) {
        // 在 open 時儲存 URL，因為 send 時可能沒有
        this._interceptorRequestUrl = args[1];
        return originalXhrOpen.apply(this, args);
    };

    window.XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', () => {
            // 監聽 load 事件，代表請求已成功完成
            if (this._interceptorRequestUrl && this._interceptorRequestUrl.includes('/api/timedtext')) {
                try {
                    // responseText 包含了回應的文字內容
                    const data = JSON.parse(this.responseText);
                    postSuccess(data);
                } catch (e) {
                    postFail(`XHR JSON parse error: ${e.message}`);
                }
            }
        });
         // 也監聽 error 事件
        this.addEventListener('error', () => {
             if (this._interceptorRequestUrl && this._interceptorRequestUrl.includes('/api/timedtext')) {
                 postFail('XHR request failed');
             }
        });
        return originalXhrSend.apply(this, args);
    };

    console.log('YT Enhancer Universal Interceptor (v7.1) deployed.');

})();