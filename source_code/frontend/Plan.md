# 評估報告：Figma UI/UX 優化開發藍圖 (v2.2.0) - 修正版

本報告已根據您的最新反饋（包含 API 金鑰管理的新流程圖片）進行修正。

**總體可行性評估：100% 可行。**

所有變更均集中在前端 UI (`popup.html`, `options.html`, `popup.css`) 與 DOM 互動邏輯 (`popup.js`)。既有後端 (`background.js`)、核心邏輯 (`content.js`) 與資料庫結構 (`userApiKeys`, `ytEnhancerSettings`) 均無需變更。

---

## 1. 執行規劃 (Phased Execution Plan) - 已修正優先級

根據您的要求，我們將執行順序調整如下：

* **Phase 1：API 金鑰管理 UI 重構 (最高優先級)**
    * **目標：** 實作 Figma 圖片 (`image_1f670c.png` 至 `image_1f6769.png`) 所示的動態增刪流程。
    * **影響範圍：** `options.html`, `popup.js`, `popup.css`。

* **Phase 2：模型優先設定 UI 重構**
    * **目標：** 將「雙列表」模式改為「選用列表 + 可添加標籤」模式。
    * **影響範圍：** `options.html`, `popup.js`, `popup.css`。

* **Phase 3：即時設定 (Popup) 樣式重構 (最低優先級)**
    * **目標：** 將 `popup.html` 的樣式更新為 Figma 設計（Toggle/新 Slider）。
    * **影響範圍：** `popup.html`, `popup.css`。

---

## 2. 系統實作細節 (System Implementation Details)

### Phase 1：API 金鑰管理 UI 重構 (修正版)

**Figma 設計：** `image_1f670c.png`, `image_1f6729.png`, `image_1f674a.png`, `image_1f6769.png`
**既有架構：** `options.html`, `popup.js`, `popup.css`

#### 變更 1：HTML 佈局變更 (`options.html`)

* **移除** `h3` "新增金鑰"。
* **移除** 整個 `div.api-key-form` (包含 `#apiKeyNameInput`, `#apiKeyInput`, `#addApiKeyButton`)。
* **修改** `h3` "已儲存的金鑰" 為 "金鑰列表 (輸入、儲存)"。
* **保留** `ul#apiKeyList`。
* **新增** 一個 `li` 元素 *在 `ul#apiKeyList` 內部*，作為「新增金鑰」按鈕的容器（為了使其總是在列表底部）。
    ```html
    <li class="add-key-row">
        <button id="addNewKeyRowButton" class="button-secondary add-lang-button" style="width: 100%;">+ 新增金鑰</button>
    </li>
    ```

#### 變更 2：JS 邏輯重構 (`popup.js`) - 核心修正

* **重構 `loadAndRenderApiKeys()` 函式：**
    1.  讀取 `keys` (從 `chrome.storage.local.get(['userApiKeys'])`)。
    2.  `listElement.innerHTML = '';` (清空列表)。
    3.  **渲染已儲存的金鑰：** 遍歷 `keys` 陣列。
        * 為每個 `key` 創建 `li` 元素。
        * `li` 內部包含 (如 `image_1f674a.png` 所示)：
            * `<input type="text" class="key-name-input" value="${key.name}" data-id="${key.id}">`
            * `<input type="password" class="key-value-input" value="${key.key}" data-id="${key.id}">`
            * `<button class="delete-key" data-id="${key.id}">刪除</button>`
    4.  **渲染「新增」按鈕：** 在所有 `keys` 渲染完畢後，*最後*才 append 上述的 `li.add-key-row` (包含 `#addNewKeyRowButton`)。

* **重構 `setupApiKeyListeners()` 函式：**
    1.  **移除** `#addApiKeyButton` 的監聽器。
    2.  **保留「更新」邏輯：**
        * 在 `listElement` 上監聽 `change` 事件 (適用於 `blur` 觸發)。
        * `if (e.target.classList.contains('key-name-input') || e.target.classList.contains('key-value-input'))`：
        * **邏輯：** 獲取 `input.dataset.id` -> 找出 `userApiKeys` 陣列中對應的 object -> 更新其 `name` 或 `key` 屬性 -> 呼叫 `chrome.storage.local.set({ userApiKeys: keys })` -> 顯示 `showOptionsToast('金鑰已更新')`。
    3.  **保留「刪除已儲存金鑰」邏輯：**
        * 在 `listElement` 上監聽 `click` 事件。
        * `if (e.target.classList.contains('delete-key'))`：
        * **邏輯：** 保持不變 (confirm -> 讀取 `keys` -> filter 掉 `keyId` -> set `keys` -> `await loadAndRenderApiKeys()`)。
    4.  **新增「點擊 + 新增金鑰」邏輯：**
        * 在 `listElement` 上監聽 `click` 事件。
        * `if (e.target.id === 'addNewKeyRowButton')`：
        * **邏輯：**
            * 創建一個新的 `li` 元素 (如 `image_1f6729.png` 所示)：
                ```javascript
                const newLi = document.createElement('li');
                newLi.className = 'api-key-item-new'; // 新增的暫時 class
                newLi.innerHTML = `
                    <input type="text" class="new-key-name-input" placeholder="金鑰名稱">
                    <input type="text" class="new-key-value-input" placeholder="請在此貼上您的 Google API">
                    <button class="delete-temp-row-button">刪除</button> 
                `;
                // (注意: 按鈕 class 不同)
                ```
            * `listElement.insertBefore(newLi, e.target.closest('li.add-key-row'))` (插在「新增」按鈕 *之前*)。
            * 為 `newLi` 內的兩個 `input` 綁定 `blur` 事件 (自動儲存邏輯)。
    5.  **新增「自動儲存 (on blur)」邏輯：** (在 `setupApiKeyListeners` 內)
        * 在 `listElement` 上監聽 `blur` 事件 (使用 `capture: true` 或直接綁定到 `newLi` 的 input 上)。
        * `if (e.target.classList.contains('new-key-name-input') || e.target.classList.contains('new-key-value-input'))`：
        * **邏輯：**
            * `const li = e.target.closest('li');`
            * `const nameInput = li.querySelector('.new-key-name-input');`
            * `const keyInput = li.querySelector('.new-key-value-input');`
            * `if (nameInput.value.trim() && keyInput.value.trim()) {` ( **關鍵：** 兩者都必須有值才儲存)
                * `// (執行儲存)`
                * `const newKey = { id: crypto.randomUUID(), name: nameInput.value, key: keyInput.value };`
                * `const result = await chrome.storage.local.get(['userApiKeys']);`
                * `const keys = result.userApiKeys || [];`
                * `keys.push(newKey);`
                * `await chrome.storage.local.set({ userApiKeys: keys });`
                * `await loadAndRenderApiKeys();` ( **關鍵：** 儲存後立即重新渲染整個列表)
            * `}`
    6.  **新增「刪除暫時列」邏輯：**
        * 在 `listElement` 的 `click` 監聽器中新增：
        * `if (e.target.classList.contains('delete-temp-row-button'))`：
        * **邏輯：** `e.target.closest('li').remove();` (不操作 storage)。

---

### Phase 2：模型優先設定 UI 重構 (已澄清)

**Figma 設計：** `image_1f574c.png`
**既有架構：** `options.html`, `popup.js`, `popup.css`

* **前端 UI (`options.html`)：**
    * 移除「雙列表」佈局及「箭頭按鈕」。
    * 改為一個 `ul#selected-models` (已選用) 和一個 `div#available-model-pills` (可添加)。
* **前端邏輯 (`popup.js`)：**
    * **澄清：** `populateModelLists()` 函式 將被重構。
    * 「可添加模型」(`div#available-model-pills`) 的內容將**動態生成**。
    * **邏輯：** 遍歷 `ALL_MODELS` 常數，並剔除所有已存在於 `settings.models_preference` 陣列中的模型，然後將剩餘的模型渲染為可點擊的 `+` 標籤。
    * (例如：Figma 中的 `+ GPT-4o Mini` 僅為範例，實際將顯示 `+ gemini-2.5-pro` 等 `ALL_MODELS` 中定義的真實模型)。
    * **互動：**
        1.  點擊 `div#available-model-pills` 中的 `+` 標籤，會將該 `modelId` `push` 到 `settings.models_preference` 陣列末尾，儲存並重繪 UI。
        2.  `ul#selected-models` **保留拖曳排序功能**。
        3.  `ul#selected-models` 中的每一項會**新增「移除」按鈕**。
        4.  點擊「移除」按鈕，會將該 `modelId` 從 `settings.models_preference` 陣列中移除，儲存並重繪 UI。

---

### Phase 3：即時設定 (Popup) 樣式重構 (最低優先級)

**Figma 設計：** `image_1f53aa.png` (右側)
**既有架構：** `popup.html`, `popup.css`

* **前端樣式 (`popup.css`)：**
    * 修改 `:root` 中的 `--accent-color` 變數，從藍色系改為 Figma 的黑色系。
    * 新增 `input[type="range"]` 的 `::-webkit-slider-thumb` 和 `::-webkit-slider-runnable-track` 樣式，以匹配 Figma 滑塊。
* **前端 UI (`popup.html`)：**
    * 修改 `div.checkbox-group`，使用新的 HTML 結構（例如 `label.toggle-switch`）來實現 Toggle 開關。
* **前端邏輯 (`popup.js`)：**
    * **無需變更。** `popup.js` 仍可透過 `document.getElementById('showOriginal').checked` 來讀取 Toggle 開關的狀態，因為底層元素仍是 `<input type="checkbox">`。

---

## 3. 系統實作細節：修改完成後的預期結果

### Phase 1：API 金鑰管理
* **使用者視角：**
    * 列表初始為空，只有一個「+ 新增金鑰」按鈕。
    * 我點擊「+ 新增金鑰」，一個空白的輸入列出現在按鈕上方。
    * 此空白列右側有一個「刪除」按鈕。
    * 如果我在空白列未填寫完時點擊「刪除」，該列會直接消失（不儲存）。
    * 我填寫了「金鑰名稱」(123) 和「金鑰」(***)。
    * 當我點擊頁面其他地方（輸入框 `blur`），此列會自動儲存，並刷新列表。
    * 我現在看到一個已儲存的列，我可以隨時修改 `input` 內容，`blur` 時會自動更新。
    * 我再次點擊「+ 新增金鑰」，會出現第二個空白列。
* **系統行為：**
    * `popup.js` 中新增了 `click #addNewKeyRowButton` 監聽器，用於動態插入 `li.api-key-item-new`。
    * 新增了 `blur` 監聽器，用於在 `li.api-key-item-new` 的兩個 `input` 均有值時觸發儲存 (push new key) 並呼叫 `loadAndRenderApiKeys()`。
    * 新增了 `click .delete-temp-row-button` 監聽器，用於移除 `li.api-key-item-new`。
    * 保留了 `change` (for blur) 監聽器，用於更新*已儲存*金鑰 (`.key-name-input`)。
    * 保留了 `click .delete-key` 監聽器，用於刪除*已儲存*金鑰。

### Phase 2：模型優先設定
* **使用者視角：**
    * 「雙列表」和「箭頭」消失。
    * 我看到一個「已選用模型」列表和一個「可添加模型」區域。
    * 「可添加模型」區域顯示的是 `+ gemini-2.5-flash-lite` 等按鈕（來自 `ALL_MODELS`，而非 Figma 範例）。
    * 我點擊 `+ gemini-2.5-flash-lite`，它從「可添加」區消失，並出現在「已選用」列表的底部。
    * 我可以在「已選用」列表中拖曳它到頂部。
    * 我也可以點擊它旁邊的「移除」，它會從「已選用」列表消失，並重新出現在「可添加」區域。
* **系統行為：**
    * `popup.js` 重構了 `populateModelLists` 和 `initializeModelSelector`，移除了 `moveSelectedItems`。
    * 每次「添加」或「移除」都會更新 `settings.models_preference` 並呼叫 `saveSettings(true)`。

### Phase 3：即時設定 (Popup)
* **使用者視角：**
    * `popup.html` 彈窗中的藍色高亮元素變為黑色。
    * 「顯示模式」的選項變為 Toggle 開關。
    * 「字體大小」的滑塊樣式變為 Figma 設計稿的樣式。
* **系統行為：**
    * `popup.css` 中的 CSS 變數和 `input[type=range]` 樣式被修改。
    * `popup.html` 的 HTML 結構更新。
    * `popup.js` 的事件監聽邏輯**完全不變**。