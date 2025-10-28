// 建議檔名: lab.js

// 功能: [v4.1.2] 驅動 lab.html (Prompt 實驗室) 的所有前端邏輯。
// input: DOM 事件 (來自 lab.html)
// output: 呼叫 background.js API 並將結果渲染到 DOM
// 其他補充: 新增「一鍵複製」 功能。

// 【關鍵修正點】: 嚴格遵守護欄 2，所有邏輯包裹在 DOMContentLoaded 內
document.addEventListener('DOMContentLoaded', () => {
    
    // DOM 元素獲取
    const inputJsonEl = document.getElementById('lab-input-json');
    const customAEl = document.getElementById('lab-custom-a');
    const universalAEl = document.getElementById('lab-universal-a');
    const customBEl = document.getElementById('lab-custom-b');
    const universalBEl = document.getElementById('lab-universal-b');
    const runButtonEl = document.getElementById('lab-run-button');
    const outputAreaEl = document.getElementById('lab-output-area');
    // 【關鍵修正點】: v4.1.2 - 獲取複製按鈕
    const copyButtonEl = document.getElementById('lab-copy-button');

    // 【關鍵修正點】: v4.1.2 - 用於儲存最後一次成功結果
    let lastResults = null;

    if (!runButtonEl || !customAEl || !copyButtonEl) { // [v4.1.2] 新增 copyButtonEl 檢查
        console.error("Lab UI 關鍵元素未找到。");
        outputAreaEl.innerHTML = `<p class="status-error">錯誤：lab.html 檔案結構不完整。</p>`;
        return;
    }

    // 綁定主執行按鈕
    runButtonEl.addEventListener('click', runComparison);
    // 【關鍵修正點】: v4.1.2 - 綁定複製按鈕
    copyButtonEl.addEventListener('click', handleCopyResults);


    /**
     * @function loadInitialPrompts
     * 功能: [v4.1.1] 頁面載入時，呼叫 API 獲取並填入預設 Prompts
     */
    async function loadInitialPrompts() {
        setLoadingState('正在載入您儲存的預設 Prompts...');
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getDebugPrompts' });
            
            if (response && response.success) {
                customAEl.value = response.savedCustomPrompt || '';
                customBEl.value = response.savedCustomPrompt || '';
                universalAEl.value = response.universalPrompt || '';
                universalBEl.value = response.universalPrompt || '';
                
                setInfoState(`預設 Prompts 已載入。請點擊「執行比較翻譯」開始測試...`);
            } else {
                throw new Error(response?.error || '無法從 background.js 獲取 Prompts。');
            }
        } catch (e) {
            setErrorState(`載入預設 Prompts 失敗: ${e.message}`);
        } finally {
            runButtonEl.disabled = false;
            runButtonEl.textContent = '執行比較翻譯';
        }
    }

    /**
     * @function runComparison
     * 功能: [v4.1.1-UX] (循序執行版) 執行 Prompt A/B 測試
     */
    async function runComparison() {
        console.log('[Lab] 開始執行循序比較...');
        runButtonEl.disabled = true; 
        
        let originalTexts;
        try {
            setInfoState('步驟 1/5: 正在驗證 ASR JSON 輸入...'); 
            originalTexts = JSON.parse(inputJsonEl.value.trim());
            if (!Array.isArray(originalTexts) || !originalTexts.every(item => typeof item === 'string')) {
                throw new Error("輸入內容必須是有效的 JSON 字串陣列 (e.g., [\"a\", \"b\"])。");
            }
        } catch (e) {
            setErrorState(`ASR JSON 輸入無效: ${e.message}`);
            return;
        }

        setInfoState('步驟 2/5: 正在驗證 Prompt 結構...'); 
        const customA = customAEl.value;
        const universalA = universalAEl.value;
        const customB = customBEl.value;
        const universalB = universalBEl.value;

        const fullPrompt_A = `${customA}\n\n${universalA}`;
        const fullPrompt_B = `${customB}\n\n${universalB}`;

        const placeholder = '{json_input_text}';
        if (!fullPrompt_A.includes(placeholder) || !fullPrompt_B.includes(placeholder)) {
            setErrorState(`Prompt 驗證失敗: Prompt A 和 Prompt B (通用部分) 都必須包含 \`${placeholder}\` 預留位置。`);
            return;
        }
        
        setInfoState('步驟 3/5: 正在讀取模型偏好設定...'); 
        let models_preference = [];
        try {
            const result = await chrome.storage.local.get(['ytEnhancerSettings']);
            models_preference = result.ytEnhancerSettings?.models_preference || [
                "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"
            ];
        } catch (e) {
            console.warn('[Lab] 讀取模型設定失敗，將使用預設值。', e);
        }

        let translationsA = null;
        let translationsB = null;

        try {
            setLoadingState(`步驟 4/5: 正在翻譯 Prompt A... (共 ${originalTexts.length} 句)`); 
            const resultA = await sendApiRequest(originalTexts, models_preference, fullPrompt_A);
            if (resultA.error) {
                throw new Error(`[Prompt A] ${resultA.error}: ${resultA.message || 'API 請求失敗'}`);
            }
            translationsA = resultA.data;
            setSuccessState('Prompt A: 翻譯成功！'); 
        } catch (e) {
            console.error('[Lab] Prompt A 執行失敗:', e);
            setErrorState(`Prompt A 翻譯失敗: ${e.message}`);
            return; 
        }

        try {
            setLoadingState(`步驟 5/5: 正在翻譯 Prompt B... (共 ${originalTexts.length} 句)`); 
            const resultB = await sendApiRequest(originalTexts, models_preference, fullPrompt_B);
            if (resultB.error) {
                throw new Error(`[Prompt B] ${resultB.error}: ${resultB.message || 'API 請求失敗'}`);
            }
            translationsB = resultB.data;
            setSuccessState('Prompt B: 翻譯成功！'); 
        } catch (e) {
            console.error('[Lab] Prompt B 執行失敗:', e);
            setErrorState(`Prompt B 翻譯失敗: ${e.message}`);
            return;
        }

        setInfoState('A/B 比較完成，正在渲染表格...');
        // 【關鍵修正點】: v4.1.2 - 儲存結果並顯示複製按鈕
        lastResults = { originals: originalTexts, translationsA, translationsB }; // 儲存結果
        renderResults(originalTexts, translationsA, translationsB);
        copyButtonEl.style.display = 'inline-block'; // 顯示按鈕
        
        runButtonEl.disabled = false;
        runButtonEl.textContent = '重新執行比較翻譯';
    }

    /**
     * @function sendApiRequest
     * 功能: [v4.1.1] 封裝單一的 translateBatch API 呼叫 (同 v4.1.1)
     */
    function sendApiRequest(texts, models_preference, overridePrompt) {
        return chrome.runtime.sendMessage({
            action: 'translateBatch',
            texts: texts,
            source_lang: 'ja',
            models_preference: models_preference,
            overridePrompt: overridePrompt 
        });
    }

    /**
     * @function renderResults
     * 功能: [v4.1.1] 將對比結果渲染為 HTML 表格 (同 v4.1.1)
     */
    function renderResults(originals, translationsA, translationsB) {
        let tableHtml = `
            <table>
                <thead>
                    <tr>
                        <th>原文 (ASR)</th>
                        <th>譯文 A (基準)</th>
                        <th>譯文 B (實驗)</th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (let i = 0; i < originals.length; i++) {
            tableHtml += `
                <tr>
                    <td>${escapeHTML(originals[i])}</td>
                    <td>${escapeHTML(translationsA[i])}</td>
                    <td>${escapeHTML(translationsB[i])}</td>
                </tr>
            `;
        }

        tableHtml += `</tbody></table>`;
        outputAreaEl.innerHTML = tableHtml;
    }

    // --- 【關鍵修正點】: v4.1.2 - 新增複製處理函式 ---
    /**
     * @function handleCopyResults
     * 功能: [v4.1.2] 格式化 最後的結果並複製到剪貼簿
     * input: (來自 DOM 的點擊事件)
     * output: (寫入 navigator.clipboard)
     */
    async function handleCopyResults() {
        if (!lastResults) {
            alert('沒有可複製的結果。');
            return;
        }

        const { originals, translationsA, translationsB } = lastResults;
        let formattedText = '';

        // 【關鍵修正點】: 依照規格書 要求的格式 進行拼接
        for (let i = 0; i < originals.length; i++) {
            formattedText += `${originals[i]}\n`;
            formattedText += `譯文 A: ${translationsA[i]}\n`;
            formattedText += `譯文 B: ${translationsB[i]}\n\n`;
        }

        try {
            await navigator.clipboard.writeText(formattedText.trim());
            
            // UI 反饋
            const originalText = copyButtonEl.textContent;
            copyButtonEl.textContent = '已複製！';
            copyButtonEl.disabled = true;
            setTimeout(() => {
                copyButtonEl.textContent = originalText;
                copyButtonEl.disabled = false;
            }, 2000);

        } catch (e) {
            console.error('複製失敗:', e);
            alert('複製失敗，請檢查主控台權限。');
        }
    }


    // --- v4.1.2 - UI 輔助函式 (已更新) ---

    // 清除狀態並設定按鈕
    function resetUI(message) {
        outputAreaEl.innerHTML = ''; 
        runButtonEl.disabled = true;
        runButtonEl.textContent = message;
        // 【關鍵修正點】: v4.1.2 - 隱藏複製按鈕並清除暫存
        copyButtonEl.style.display = 'none';
        lastResults = null;
    }

    // 用於顯示「執行中」
    function setLoadingState(message) {
        resetUI(message);
        outputAreaEl.innerHTML = `<p class="status-loading">${escapeHTML(message)}</p>`;
    }

    // 用於顯示「資訊」 (例如：載入完成)
    function setInfoState(message) {
        resetUI(message);
        outputAreaEl.innerHTML = `<p class="status-info">${escapeHTML(message)}</p>`;
    }

    // (注意: 成功時不重設按鈕，因為流程尚未結束)
    function setSuccessState(message) {
        outputAreaEl.innerHTML += `<p class="status-success">${escapeHTML(message)}</p>`;
    }

    // 用於顯示「永久失敗」 (流程結束)
    function setErrorState(message) {
        resetUI(message); 
        outputAreaEl.innerHTML = `<p class="status-error">${escapeHTML(message)}</p>`;
        runButtonEl.disabled = false; 
        runButtonEl.textContent = '執行比較翻譯';
    }
    
    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
    }
    
    // 啟動時呼叫 API 載入預設 Prompts
    loadInitialPrompts();
});