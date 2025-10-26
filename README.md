# YouTube 字幕增強器 (YT Subtitle Enhancer) v4.0.1

一個專為 YouTube 外語影片開發的字幕工具，透過 Gemini AI 實現即時、可客製化的雙語字幕翻譯。

本專案 (v4.0.1) 採用 **Manifest V3 (MV3) Serverless 架構**。所有翻譯請求均由擴充功能本身 (Service Worker) 直接安全地發送到 Google AI，**無需**依賴任何本地 Python 伺服器。

---

### ✨ 主要功能 (v4.0.1)

* **Serverless AI 翻譯**：採用 MV3 架構，由 `background.js` Service Worker 直接呼叫 Gemini API 進行翻譯。API Key 安全儲存在 `chrome.storage.local`。
* **[v2.0] 三層語言決策 (Tier 1-2-3)**：
    * **Tier 1 (原文顯示)**：匹配您設定的母語，零成本顯示原文。
    * **Tier 2 (自動翻譯)**：匹配自動翻譯列表，載入高品質自訂 Prompt。
    * **Tier 3 (按需翻譯)**：顯示原文並提供「翻譯」按鈕，讓您自行決定是否翻譯。
* **[v2.2.0] 動態金鑰管理**：在管理後台提供動態新增/刪除/編輯 API 金鑰，並在輸入框 `blur` 時自動儲存。
* **[v2.2.0] 模型偏好設定**：支援拖曳排序的模型偏好列表，以及從「可添加」標籤中選取模型。
* **[v3.1.x] 智慧錯誤處理**：內建 API 配額 (Quota) 偵測、金鑰冷卻、自動重試 (`TEMPORARY_FAILURE`) 與批次失敗 (`BATCH_FAILURE`) 處理機制。
* **[v4.0] 穩定握手架構**：採用「播放器優先」架構，由 `injector.js` 確保 `playerResponse` 載入完成後，才回應 `content.js` 的資料請求，解決時序競爭問題。
* **永久快取**：已翻譯的影片會被儲存在瀏覽器本地 (`chrome.storage.local`)，加速二次載入。

---

### 📚 完整使用說明 (附圖)

**>> [點此前往 GitHub Wiki 查看完整安裝與使用教學](https://github.com/yuforfun/youtube_enhancer/wiki) <<**

我已將所有詳細的安裝步驟、功能介紹、常見問題與疑難排解，都整理在專案的 Wiki 頁面中。第一次使用的朋友，請務必點擊上方連結查看。

---

### 🚀 開發者快速開始 (Developer Quick Start)

本專案 (v4.0.1) 為單一 MV3 擴充功能，已不需後端伺服器。

1.  打開 Chrome/Edge 瀏覽器，進入 `chrome://extensions`。
2.  開啟「開發人員模式」。
3.  點擊「載入未封裝項目」。
4.  選擇包含 `manifest.json` 的**專案根目錄**（即包含 `popup.js`, `background.js` 等檔案的資料夾）。
5.  (重要) 進入擴充功能的「選項」(Options) 頁面，在「Google API 金鑰管理」卡片中 新增您自己的 Google Gemini API Key。

---

### ⚠️ 免責聲明

此工具僅供個人學習與技術研究使用。所有 API 請求均由使用者自己的金鑰發起，請注意您的用量與費用。

---
### 🙏 致謝

感謝 [**Shison Jun**](https://www.instagram.com/jun_shison0305/p/DOoHP49E-__/) 讓我用愛發電。