# YouTube 字幕增強器 (YT Subtitle Enhancer)

一個專為 YouTube 外語影片開發的字幕工具，透過 Gemini AI 實現即時、可客製化的雙語字幕翻譯。

這個工具包含兩個部分：一個瀏覽器擴充功能（前端）和一個用來翻譯的本地伺服器（後端）。

---

### ✨ 主要功能

* **即時雙語字幕**：自動抓取 YouTube 字幕，並將其翻譯成繁體中文，與原文對照顯示。
* **高度客製化**：使用者可以透過修改設定檔或在擴充功能介面中，自訂翻譯風格 (Prompt)、模型偏好、顯示模式等。
* **本地化處理**：翻譯請求完全在您的個人電腦與 Google AI 之間進行，確保了 API Key 的私密性與安全性。

---

### 📚 **完整使用說明 (附圖)**

**>> [點此前往 GitHub Wiki 查看完整安裝與使用教學](https://github.com/yuforfun/youtube_enhancer/wiki) <<**

我們已將所有詳細的安裝步驟、功能介紹、常見問題與疑難排解，都整理在專案的 Wiki 頁面中。第一次使用的朋友，請務必點擊上方連結查看。

---

### 🚀 開發者快速開始 (Developer Quick Start)

本專案採前後端分離架構。

**後端 (Backend)**
1.  進入 `source_code/backend` 目錄。
2.  安裝相依套件： `pip install -r requirements.txt`
3.  設定 `api_keys.txt`。
4.  執行 `python backend.py`。

**前端 (Frontend)**
1.  打開 Chrome/Edge 瀏覽器，進入 `chrome://extensions`。
2.  開啟「開發人員模式」。
3.  點擊「載入未封裝項目」，並選擇 `source_code/frontend` 資料夾。

---

### ⚠️ 免責聲明

此工具僅供個人學習與技術研究使用。所有 API 請求均由使用者自己的金鑰發起，請注意您的用量與費用。

---
### 🙏 致謝

感謝 [**Shison Jun**](https://www.instagram.com/jun_shison0305/p/DOoHP49E-__/) 讓我用愛發電。
