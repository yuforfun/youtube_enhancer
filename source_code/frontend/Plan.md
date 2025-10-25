# 系統架構藍圖 (v3.1.3) - 修正「停用」狀態的邏輯缺陷

## 1. 執行規劃 (Phased Plan)

您提出的問題非常關鍵，這確實是一個「狀態不同步」的邏輯缺陷。

問題的核心在於 `content.js` (指揮中心) 處理字幕資料的邏輯不夠嚴謹，導致「手動觸發」的流程繞過了「全域開關」的檢查。

我們需要修正 `content.js` 的核心訊息處理中樞 (`onMessageFromInjector`)，確保它在執行*任何*翻譯流程之前，都會優先檢查 `settings.isEnabled` 的狀態。

1.  **階段一：分析啟動路徑**
    * **路徑 A (自動)：** `content.js` 載入 -> 讀取設定 `isEnabled: true` -> `start()` 函式 -> 匹配偏好語言 -> `FORCE_ENABLE_TRACK`。
        * *狀態：* 此路徑正確地在 `PLAYER_RESPONSE_CAPTURED` 事件中檢查了 `this.settings.isEnabled`。
    * **路徑 B (手動)：** `content.js` 載入 -> 讀取設定 `isEnabled: false` -> (使用者手動點擊 CC 按鈕) -> `injector.js` 攔截到 `timedtext` -> `content.js` 收到 `TIMEDTEXT_DATA` 訊息。
        * *缺陷：* `TIMEDTEXT_DATA` 的處理邏輯**沒有**檢查 `this.settings.isEnabled`，它只檢查了 `!this.state.hasActivated`，導致它錯誤地啟動了翻譯流程 (`this.activate()`)。

2.  **階段二：修補缺陷**
    * 在 `content.js` 的 `TIMEDTEXT_DATA` 事件處理常式中，加入一個「防護機制 (Guard Clause)」。
    * 此防護機制必須是該事件中的**第一個檢查**，確保在「停用」狀態下，所有後續邏輯（包括看門狗檢查、語言切換檢查）都不會被執行。
    * 此檢查必須排除 `isOverride` 狀態，以確保「手動覆蓋語言」功能 (`translateWithOverride`) 依然可用。

## 2. 系統實作細節 (Implementation Details)

---

### 修正 `content.js` 區塊 A: `onMessageFromInjector` (修正手動觸發繞過開關的缺陷)

**修正原因：**
當前 `onMessageFromInjector` 在處理 `TIMEDTEXT_DATA` 事件時，未檢查 `this.settings.isEnabled`。這導致即使擴充功能在 Popup 中被設為「停用」，使用者手動點擊 [CC] 按鈕觸發的 `TIMEDTEXT_DATA` 訊息依然會錯誤地啟動翻譯流程。

**替換/新增指示：**
在 `content.js` 的 `onMessageFromInjector` 函式中，針對 `case 'TIMEDTEXT_DATA':` 區塊，在最頂部 (第 187 行 `const { payload: ...` 之後) 插入新的防護機制邏輯。

**建議檔名: `content.js`**
```javascript
    /**
     * 功能: 處理來自 injector.js 的所有訊息，包含修復後的語言切換邏輯。
     * input: event (MessageEvent) - 來自 injector.js 的訊息事件。
     * output: 根據訊息類型觸發對應的核心流程。
     * 其他補充: 這是擴充功能邏輯的核心中樞，處理導航、資料接收和字幕處理。
     */
    async onMessageFromInjector(event) {
        if (event.source !== window || !event.data || event.data.from !== 'YtEnhancerInjector') return;

        const { type, payload } = event.data;

        switch (type) {
            case 'YT_NAVIGATED':
                this._log(`📢 [導航通知] 收到來自特工的換頁通知 (新影片ID: ${payload.videoId})，準備徹底重置...`);
                await this.cleanup();
                this.requestPlayerResponse();
                break;

            case 'PLAYER_RESPONSE_CAPTURED':
                this._log('🤝 [握手] 成功收到 PLAYER_RESPONSE_CAPTURED 信號！');
                if (this.state.isInitialized) {
                    this._log('警告：在已初始化的狀態下再次收到 PLAYER_RESPONSE，忽略。');
                    return;
                }
                
                this.state.playerResponse = payload;
                this.currentVideoId = payload.videoDetails.videoId;
                
                this._log(`設定新影片 ID: ${this.currentVideoId}`);
                this.state.isInitialized = true;
                this._log(`狀態更新: isInitialized -> true`);
                if (this.settings.isEnabled && this.currentVideoId) {
                    this.start();
                }
                break;

            // 【關鍵修正點】開始: 重構整個 TIMEDTEXT_DATA 處理邏輯，以正確處理語言切換
            case 'TIMEDTEXT_DATA':
                const { payload: timedTextPayload, lang, vssId } = payload;
                this._log(`收到 [${lang}] (vssId: ${vssId || 'N/A'}) 的 TIMEDTEXT_DATA。`);

                // 【關鍵修正點】開始: 新增全域開關防護機制
                // 檢查擴充功能是否已在 Popup 中被停用。
                // 僅當 (全局停用) 且 (這不是一次手動語言覆蓋) 時，才忽略此資料。
                if (!this.settings.isEnabled && !this.state.isOverride) {
                    this._log('擴充功能目前為停用狀態，已忽略收到的 timedtext 數據。');
                    
                    // (可選，但建議) 如果字幕已顯示，確保其被清理
                    if (this.state.hasActivated) {
                        this._log('偵測到狀態殘留，執行溫和重置以關閉字幕。');
                        this.state.abortController?.abort();
                        this.state.translatedTrack = null;
                        this.state.isProcessing = false;
                        this.state.hasActivated = false;
                        if(this.state.subtitleContainer) this.state.subtitleContainer.innerHTML = '';
                    }
                    return; // 關鍵：在此處停止
                }
                // 【關鍵修正點】結束

                // 步驟 1: 處理與看門狗相關的初始啟用驗證
                if (this.state.activationWatchdog) {
                    const isVssIdMatch = this.state.targetVssId && vssId === this.state.targetVssId;
                    const isLangMatchWithoutVssId = !vssId && lang === this.state.sourceLang;

                    if (!isVssIdMatch && !isLangMatchWithoutVssId) {
                        this._log(`[驗證失敗] 忽略了非目標字幕。目標 vssId: [${this.state.targetVssId}], 目標 lang: [${this.state.sourceLang}] | 收到 vssId: [${vssId || 'N/A'}], lang: [${lang}]`);
                        return;
                    }
                    this._log(`[驗證成功] 收到的字幕符合預期 (vssId 匹配或 lang 匹配)。`);
                    clearTimeout(this.state.activationWatchdog);
                    this.state.activationWatchdog = null;
                    this._log('[看門狗] 成功收到目標字幕，看門狗已解除。');
                }
                // 清除 targetVssId，避免影響後續的手動切換操作
                this.state.targetVssId = null;

                // 步驟 2: 判斷是「首次激活」、「語言切換」還是「重複數據」
                if (this.state.hasActivated) {
                    // 如果已激活，判斷語言是否變化
                    if (lang !== this.state.sourceLang) {
                        // 語言發生變化，執行「溫和重置」
                        this._log(`[語言切換] 偵測到語言從 [${this.state.sourceLang}] -> [${lang}]。執行溫和重置...`);
                        this.state.abortController?.abort();
                        this.state.translatedTrack = null;
                        this.state.isProcessing = false;
                        this.state.hasActivated = false; // 重置激活狀態，這是讓後續流程能繼續的關鍵
                        if(this.state.subtitleContainer) this.state.subtitleContainer.innerHTML = '';
                        this._log('溫和重置完成。');
                        // 注意：這裡不 return，讓程式碼繼續往下執行，以激活新的語言
                    } else {
                        // 語言未變，是重複數據，直接忽略
                        this._log('語言相同，忽略重複的 timedtext 數據。');
                        return;
                    }
                }

                // 步驟 3: 執行激活流程 (適用於首次激活或語言切換後的再激活)
                if (!this.state.hasActivated) { // 再次檢查，確保只有在未激活狀態下才執行
                    this.state.sourceLang = lang;
                    this._log(`成功捕獲 [${this.getFriendlyLangName(this.state.sourceLang)}] 字幕，啟動翻譯流程。`);
                    this.state.hasActivated = true;
                    this._log(`狀態更新: hasActivated -> true`);
                    this.activate(timedTextPayload);
                }
                break;
            // 【關鍵修正點】結束
        }
    }

### 預期結果 (Expected Outcomes)

* **使用者視角:**
    * 當使用者在 `popup.html` 點擊按鈕，使其顯示為「啟用翻譯」(灰色，代表已停用)。
    * 此時進入 YouTube 影片頁面。
    * 使用者手動點擊播放器右下角的 [CC] 按鈕。
    * **結果：** 只有 YouTube 的**原生字幕**會出現。本擴充功能的「狀態圓環」和「雙語字幕介面」將**不會**被觸發。

* **系統行為:**
    * `injector.js` 仍會攔截到 `timedtext` 請求 (這是正常的，它永遠在待命)。
    * `injector.js` 將 `TIMEDTEXT_DATA` 訊息發送給 `content.js`。
    * `content.js` 收到訊息，進入 `case 'TIMEDTEXT_DATA':`。
    * 觸發**新的防護機制**：`if (!this.settings.isEnabled && !this.state.isOverride)` 判斷為 `true`。
    * 系統印出日誌 (例如：「擴充功能目前為停用狀態...」) 並立即 `return`。
    * 後續的 `this.activate()` 流程被成功阻擋，翻譯流程不會啟動。