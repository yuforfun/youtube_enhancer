# ==============================================================================
# YT Subtitle Enhancer - Backend
#
# @file backend.py
# @author [yuforfun]
# @copyright 2025 [yuforfun]
# @license MIT
#
# This program is free software distributed under the MIT License.
# Version: 1.7.0
# ==============================================================================
import sys, os, json, time, threading
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from pystray import MenuItem as item, Icon as icon
from PIL import Image
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
import ctypes # 【關鍵修正點】
from ctypes import wintypes # 【關鍵修正點】

def get_base_path():
    # 功能: 獲取應用程式執行的基礎路徑。
    #      在正常執行 .py 檔案時，回傳腳本所在目錄；
    #      在被 PyInstaller 打包成 .exe 後執行時，回傳 .exe 所在目錄。
    # input: 無 (讀取系統變數)
    # output: (字串) 基礎路徑
    # 其他補充: 這是確保無論開發或部署環境，都能正確找到相依檔案 (如設定檔、圖示) 的關鍵函式。
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    else:
        return os.path.dirname(os.path.abspath(__file__))

def set_hidden_attribute(file_path):
    # 功能: 為指定的檔案路徑在 Windows 系統上設定「隱藏」屬性。
    # input: file_path (字串) - 要設定為隱藏的檔案完整路徑。
    # output: 無 (直接操作檔案系統)
    # 其他補充: 使用 ctypes 直接呼叫 Windows Kernel32 API 來實現，主要用於自動建立的設定檔，使其不干擾使用者。
    try:
        # FILE_ATTRIBUTE_HIDDEN 的值為 0x2
        attribute = 0x2
        ret = ctypes.windll.kernel32.SetFileAttributesW(wintypes.LPWSTR(file_path), attribute)
        if ret:
            print(f"   -> 成功將 '{os.path.basename(file_path)}' 設定為隱藏檔案。", flush=True)
        # 如果檔案本來就是隱藏的，ret 會是 0，但 GetLastError() 會是 183 (ERROR_ALREADY_EXISTS)，這是正常的
        elif ctypes.windll.kernel32.GetLastError() != 183:
            print(f"   -> 警告：無法設定 '{os.path.basename(file_path)}' 的隱藏屬性。", flush=True)
    except Exception as e:
        print(f"   -> 警告：設定隱藏屬性時發生錯誤: {e}", flush=True)

# 區塊: DEFAULT_CORE_PROMPT_TEMPLATE
# 功能: 定義一個給 Gemini AI 的核心指令模板。
#      此模板包含了對 AI 角色的設定、任務描述、輸出格式範例，以及最終的執行指令。
# input: 無 (靜態字串)
# output: (字串) 包含佔位符 ({source_lang}, {json_input_text}) 的 Prompt 模板。
# 其他補充: 這是整個翻譯功能的核心 Prompt，後續會與使用者自訂的 Prompt 結合使用。
DEFAULT_CORE_PROMPT_TEMPLATE = """你是一位頂尖的繁體中文譯者與{source_lang}校對專家，專為台灣的粉絲翻譯 YouTube 影片的自動字幕。
你收到的{source_lang}原文雖然大多正確，但仍可能包含 ASR 造成的錯字或專有名詞錯誤。

你的核心任務:
發揮你的推理能力，理解原文的真實意圖，並直接翻譯成最自然、口語化的繁體中文。

範例:
- 輸入: ["こんにちは世界", "お元気ですか？"]
- 你的輸出應為: ["哈囉世界", "你好嗎？"]

執行指令:
請嚴格遵循以上所有指南與對照表，**「逐句翻譯」**以下 JSON 陣列中的每一句{source_lang}，並將翻譯結果以**相同順序、相同數量的 JSON 陣列格式**回傳。

{json_input_text}"""

# 區塊: custom_prompts
# 功能: 定義一個預設的使用者自訂 Prompt 字典。
#      使用者可以透過編輯 custom_prompts.json 檔案，為不同語言（ja, ko, en）添加特定的風格指南或專有名詞對照表。
# input: 無 (靜態字典)
# output: (字典) 包含各語言預設提示內容的字典。
custom_prompts = {
    "ja": """**風格指南:**
- 翻譯需符合台灣人的說話習慣，並保留說話者(日本偶像)的情感語氣。

**人名/專有名詞對照表 (優先級最高):**
無論上下文如何，只要看到左側的原文或讀音，就必須嚴格地翻譯為右側的詞彙。
- まちだ / まち田 / まちだ けいた -> 町田 啟太
- さとう たける -> 佐藤 健
- しそん じゅん -> 志尊 淳
- しろたゆう -> 城田 優
- みやざき ゆう -> 宮崎 優
- 天ブランク -> TENBLANK
- グラスハート -> 玻璃之心
- Fujitani Naoki -> 藤谷直季
- Takaoka Sho -> 高岡尚
- Sakamoto Kazushi -> 坂本一志
- 西條朱音 -> 西條朱音
- 菅田將暉 -> 菅田將暉
- ノブ -> ノブ
""",
    "ko": "--- 韓文自訂 Prompt (請在此輸入風格與對照表) ---",
    "en": "--- 英文自訂 Prompt (請在此輸入風格與對照表) ---"
}

def load_config():
    # 功能: 載入擴充功能的設定檔案，主要包含 API Keys 和自訂 Prompts。
    # input: 無 (讀取 api_keys_test.txt / api_keys.txt 和 custom_prompts.json 檔案)
    # output: (字典) 包含 'GEMINI_API_KEYS' 和 'KEYS_PATH_USED' 的設定物件。若失敗則回傳 None。
    # 其他補充: 優先讀取 personal.txt，若不存在則讀取公開的範本檔案。如果 custom_prompts.json 不存在，會自動建立一個。
    global custom_prompts
    base_path = get_base_path()
    config = {}
    
    test_keys_path = os.path.join(base_path, 'api_keys_test.txt')
    default_keys_path = os.path.join(base_path, 'api_keys.txt')
    keys_path_to_use = None

    if os.path.exists(test_keys_path):
        keys_path_to_use = test_keys_path
        print("   -> 偵測到 'api_keys_test.txt'，將使用個人金鑰進行載入。", flush=True)
    elif os.path.exists(default_keys_path):
        keys_path_to_use = default_keys_path
        print("   -> 未找到個人金鑰檔案，將使用 'api_keys.txt' (公開範本) 進行載入。", flush=True)
    
    try:
        api_keys = []
        if keys_path_to_use:
            with open(keys_path_to_use, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        parts = line.split(',', 1)
                        if len(parts) == 2 and parts[0].strip() and parts[1].strip():
                            api_keys.append({"name": parts[0].strip(), "key": parts[1].strip()})
        else:
            print("   -> 警告：找不到 'api_keys_test.txt' 或 'api_keys.txt'。API 金鑰為空。", flush=True)

        config['GEMINI_API_KEYS'] = api_keys
        config['KEYS_PATH_USED'] = keys_path_to_use
        
        custom_prompts_path = os.path.join(base_path, 'custom_prompts.json')
        if os.path.exists(custom_prompts_path):
            with open(custom_prompts_path, 'r', encoding='utf-8') as f:
                loaded_prompts = json.load(f)
                custom_prompts.update(loaded_prompts)
            print("   -> 成功載入自訂 Prompt 檔案。", flush=True)
        else:
            print("   -> 未找到自訂 Prompt 檔案，將使用預設值並自動建立新檔。", flush=True)
            with open(custom_prompts_path, 'w', encoding='utf-8') as f:
                json.dump(custom_prompts, f, ensure_ascii=False, indent=2)
            set_hidden_attribute(custom_prompts_path) # 【關鍵修正點】

        if api_keys:
            print(f"   -> 成功載入 {len(api_keys)} 個 API Key。", flush=True)
        else:
            print(f"   -> 警告：在設定檔中未找到任何有效的 API Key。", flush=True)
        return config

    except Exception as e:
        print(f"錯誤：載入設定檔時發生未知錯誤: {e}", flush=True)
        return None

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

config = None
API_KEY_COOLDOWN_SECONDS = 60
exhausted_key_timestamps = {}
gemini_initialized_successfully = False

def initialize_gemini():
    # 功能: 使用載入的 API Keys 逐一嘗試初始化並驗證 Google Gemini 服務。
    # input: 無 (讀取全域變數 config)
    # output: (布林值) 成功初始化任何一個 Key 則回傳 True，否則回傳 False。
    # 其他補充: 只有成功通過此驗證，後端的翻譯 API 才會啟用。這能防止因無效金鑰導致的持續性錯誤。
    global gemini_initialized_successfully
    if not config: return False
    api_keys = config.get('GEMINI_API_KEYS', [])
    keys_path_to_use = config.get('KEYS_PATH_USED')

    if not api_keys:
        print("\n錯誤: 在設定檔中未找到任何有效的 API Key。", flush=True)
        return False
        
    print("\n[API Key 驗證流程開始]", flush=True)
    for idx, key_info in enumerate(api_keys):
        key = key_info.get("key")
        name = key_info.get("name", f"Key #{idx + 1}")
        if key and "XXX" not in key:
            try:
                print(f"-> 正在使用 API Key: '{name}' 進行啟動驗證...", flush=True)
                genai.configure(api_key=key)
                model = genai.GenerativeModel('gemini-2.5-flash')
                model.generate_content("test", generation_config={"response_mime_type": "text/plain"})
                print("   -> 啟動驗證成功！ Gemini 服務已就緒。", flush=True)
                gemini_initialized_successfully = True
                return True
            except Exception as e:
                print(f"   -> API Key '{name}' 驗證失敗: {e}", flush=True)
                continue
    
    if keys_path_to_use:
        print(f"\n錯誤: 在 '{os.path.basename(keys_path_to_use)}' 中沒有任何一個 API Key 能通過啟動驗證。", flush=True)
    else:
        print(f"\n錯誤: 在設定檔中沒有任何一個 API Key 能通過啟動驗證。", flush=True)
    gemini_initialized_successfully = False
    return False

def _extract_strings_from_response(data, expected_len):
    # 功能: 一個輔助函式，用於安全地從 Gemini API 的回應中提取翻譯結果。
    # input: data (任意格式) - 從 API 回應解析出的 JSON 物件。
    #        expected_len (整數) - 預期應有的句子數量。
    # output: (列表) 如果 data 是格式正確的字串列表且長度相符，則回傳該列表；否則回傳 None。
    # 其他補充: 這是確保 AI 回應格式正確性的重要防護措施。
    if not isinstance(data, list) or len(data) != expected_len:
        return None
    if all(isinstance(item, str) for item in data):
        return data
    return None

@app.route('/api/translate', methods=['POST'])
def translate():
    # 功能: 提供翻譯服務的核心 API 端點。
    # input from: content.js -> sendBatchForTranslation 函式 (透過 HTTP POST 請求)
    # output to: content.js -> sendBatchForTranslation 函式的回應 (以 HTTP JSON 格式)
    # 其他補充: 此函式會遍歷所有可用的 API Keys 和使用者偏好的模型，直到成功翻譯或全部失敗為止。它也包含了對 API 用量超額的冷卻機制。
    global exhausted_key_timestamps
    if not gemini_initialized_successfully:
        return jsonify({"error": "後端服務未成功初始化，請檢查 API Key 設定。"}), 500
    try:
        data = request.get_json()
        texts = data.get('texts', [])
        models_preference = data.get('models_preference', [])
        source_lang_code = data.get('source_lang', 'ja')
    except Exception as e:
        return jsonify({"error": f"請求格式錯誤: {e}"}), 400
        
    if not texts: return jsonify([])
    
    if not models_preference:
        models_preference = [
            'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
            'gemini-2.0-flash-lite', 'gemini-2.0-flash'
        ]
    
    lang_map = {'ja': '日文', 'ko': '韓文', 'en': '英文'}
    source_lang_name = lang_map.get(source_lang_code, '原文')
    core_prompt = DEFAULT_CORE_PROMPT_TEMPLATE.format(source_lang=source_lang_name, json_input_text="{json_input_text}")
    custom_prompt_part = custom_prompts.get(source_lang_code, "")
    full_prompt_template = f"{custom_prompt_part}\n\n{core_prompt}"
    json_input = json.dumps(texts, ensure_ascii=False)
    prompt = full_prompt_template.format(json_input_text=json_input)
    
    generation_config = {"response_mime_type": "application/json"}
    api_keys = config.get('GEMINI_API_KEYS', [])
    safety_settings = [
        {"category": c, "threshold": HarmBlockThreshold.BLOCK_NONE}
        for c in [
            HarmCategory.HARM_CATEGORY_HARASSMENT, HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT
        ]
    ]
    encountered_errors = set()
    
    print(f"\n[翻譯請求開始] - 語言: {source_lang_name}, 文本數: {len(texts)}, 模型偏好: {models_preference}", flush=True)

    for key_info in api_keys:
        key_name = key_info.get('name', "未命名 Key")
        current_key = key_info.get("key")
        if current_key in exhausted_key_timestamps and time.time() < exhausted_key_timestamps[current_key] + API_KEY_COOLDOWN_SECONDS:
            continue
        exhausted_key_timestamps.pop(current_key, None)
        genai.configure(api_key=current_key)
        for model_name in models_preference:
            print(f"-> 嘗試使用 Key: '{key_name}' 與 模型: '{model_name}'", flush=True)
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(prompt, generation_config=generation_config, safety_settings=safety_settings)
                final_list = _extract_strings_from_response(json.loads(response.text), len(texts))
                if final_list is not None:
                    print(f"   -> 成功！使用 Key: '{key_name}', 模型: '{model_name}' 完成翻譯。", flush=True)
                    return jsonify(final_list)
                else:
                    encountered_errors.add(f"模型 '{model_name}' 回傳格式錯誤。")
                    continue
            except Exception as e:
                error_str = str(e)
                if "quota" in error_str.lower() or "billing" in error_str.lower():
                    msg = f"[ACCOUNT_ISSUE] API Key '{key_name}' 已達用量上限或帳戶計費設置無效。"
                    print(f"   -> {msg}", flush=True)
                    encountered_errors.add(msg)
                    exhausted_key_timestamps[current_key] = time.time()
                    break 
                else:
                    msg = f"模型 '{model_name}' 發生錯誤: {error_str}"
                    print(f"   -> {msg}", flush=True)
                    encountered_errors.add(msg)
                    continue 
                    
    error_summary = "； ".join(encountered_errors) if encountered_errors else "未知原因"
    print(f"錯誤: 所有模型與 API Key 均嘗試失敗。原因: {error_summary}", flush=True)
    return jsonify({"error": f"所有模型與 API Key 均嘗試失敗。原因: {error_summary}"}), 503

@app.route('/api/prompts/custom', methods=['GET'])
def get_custom_prompts():
    # 功能: 提供一個 API 端點，讓設定頁面 (options.html) 能獲取當前儲存的自訂 Prompts。
    # input from: options.html -> loadCustomPrompts 函式 (透過 HTTP GET 請求)
    # output to: options.html -> loadCustomPrompts 函式的回應
    print("[API 請求] GET /api/prompts/custom", flush=True)
    return jsonify(custom_prompts)

@app.route('/api/prompts/custom', methods=['POST'])
def set_custom_prompts():
    # 功能: 提供一個 API 端點，讓設定頁面 (options.html) 能儲存更新後的自訂 Prompts。
    # input from: options.html -> savePromptButton 的點擊事件 (透過 HTTP POST 請求)
    # output to: options.html -> savePromptButton 事件的回應
    # 其他補充: 儲存後會覆寫 custom_prompts.json 檔案。
    global custom_prompts
    try:
        data = request.get_json()
        if not data or not isinstance(data, dict): return jsonify({"error": "請求格式錯誤"}), 400
        valid_langs = {"ja", "ko", "en"}
        if not all(key in valid_langs and isinstance(value, str) for key, value in data.items()):
            return jsonify({"error": "無效的語言代碼或內容格式"}), 400
        base_path = get_base_path()
        custom_prompts_path = os.path.join(base_path, 'custom_prompts.json')
        with open(custom_prompts_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        set_hidden_attribute(custom_prompts_path) # 【關鍵修正點】
        custom_prompts.update(data)
        print("[API 請求] POST /api/prompts/custom - 儲存成功。", flush=True)
        return jsonify({"success": True})
    except Exception as e:
        print(f"錯誤：更新自訂 Prompt 失敗。原因: {e}", flush=True)
        return jsonify({"error": f"伺服器錯誤: {e}"}), 500

@app.route('/api/keys/diagnose', methods=['POST'])
def diagnose_api_keys():
    # 功能: 提供一個 API 端點，讓設定頁面 (options.html) 能診斷所有 API Keys 的基本有效性。
    # input from: options.html -> diagnoseKeysButton 的點擊事件 (透過 HTTP POST 請求)
    # output to: options.html -> diagnoseKeysButton 事件的回應
    # 其他補充: 此功能不會檢測金鑰的剩餘配額。
    print("[API 請求] POST /api/keys/diagnose", flush=True)
    try:
        keys_to_test = config.get('GEMINI_API_KEYS', [])
        if not keys_to_test:
            return jsonify([{"name": "無", "status": "skipped", "error": "後端設定檔中未找到任何 API Keys"}])
        results = []
        for key_info in keys_to_test:
            key = key_info.get("key")
            name = key_info.get("name", "未命名 Key")
            if not key or "XXX" in key:
                results.append({"name": name, "status": "skipped", "error": "金鑰為空或包含預留位置"})
                continue
            try:
                genai.configure(api_key=key)
                model = genai.GenerativeModel('gemini-2.5-flash')
                model.generate_content("test", generation_config={"response_mime_type": "text/plain"})
                results.append({"name": name, "status": "valid"})
            except Exception as e:
                results.append({"name": name, "status": "invalid", "error": str(e)})
        return jsonify(results)
    except Exception as e:
        print(f"錯誤：API Key 診斷失敗。原因: {e}", flush=True)
        return jsonify({"error": f"伺服器錯誤: {e}"}), 500

def quit_action(icon, item):
    # 功能: 定義系統匣圖示中「結束」按鈕的行為。
    # input: icon, item - 由 pystray 函式庫傳入的物件。
    # output: 無 (直接結束程式)
    print("\n-> 收到關閉指令，正在關閉伺服器...", flush=True)
    icon.stop()
    os._exit(0)

def run_tray_icon():
    # 功能: 建立並執行一個 Windows 系統匣的背景圖示，讓使用者可以手動關閉後端服務。
    # input: 無
    # output: 無 (顯示一個系統匣圖示)
    base_path = get_base_path()
    image_path = os.path.join(base_path, 'server_icon.png')
    try:
        image = Image.open(image_path)
    except FileNotFoundError:
        print(f"錯誤：找不到系統匣圖示檔案 'server_icon.png'！", flush=True)
        return
    menu = (item('結束 (Quit)', quit_action),)
    tray_icon = icon("YT_Subtitle_Backend", image, "YT 字幕增強器後端", menu)
    print("-> 系統匣圖示已建立，程式在背景運行中。", flush=True)
    tray_icon.run()

if __name__ == '__main__':
# 功能: 整個後端服務的啟動入口點。
# input: 無
# output: 無
# 其他補充: 依序執行設定載入、Gemini 初始化、啟動 Flask 伺服器執行緒，以及建立系統匣圖示。若初始化失敗，會提示使用者檢查設定並結束程式。
    print("="*50, flush=True)
    print("YT 字幕增強器後端 v1.7.0", flush=True)
    print("="*50, flush=True)
    config = load_config()
    
    if not config or not initialize_gemini():
        print("\n[!] 初始化失敗，後端服務無法啟動。")
        print("請檢查：")
        print("  1. 'api_keys_test.txt' 或 'api_keys.txt' 檔案是否存在且格式正確 (名稱,金鑰)。")
        print("  2. API 金鑰是否有效且有足夠的配額。")
        print("  3. 電腦的網路連線是否正常。")
        input("\n請按 Enter 鍵結束程式...")
        sys.exit(1)
    
    def run_flask_server():
        app.run(host='127.0.0.1', port=5001, debug=False, use_reloader=False)

    flask_thread = threading.Thread(target=run_flask_server, daemon=True)
    flask_thread.start()

    print("\n-> 後端 Flask 伺服器已在背景執行緒啟動 (http://127.0.0.1:5001)。", flush=True)
    run_tray_icon()