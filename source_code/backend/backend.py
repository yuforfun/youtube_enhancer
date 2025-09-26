# ==============================================================================
# YT Subtitle Enhancer - Backend with System Tray (v1.4.3 - No Log Redirect)
# Copyright (c) 2025 [yuforfun]
#
# This program is free software distributed under the MIT License.
#
# v1.4.3 update: Removed file logging redirect (setup_logging) to output
# directly to the console/terminal for easier debugging.
# ==============================================================================
import sys, os, json, time, threading
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from pystray import MenuItem as item, Icon as icon
from PIL import Image
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold

# 移除 setup_logging 函式

def get_base_path():
    if getattr(sys, 'frozen', False): return os.path.dirname(sys.executable)
    else: return os.path.dirname(os.path.abspath(__file__))

# 【核心變更】定義所有語言都適用的繁體中文核心指令模板
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

# 預設使用者自訂的 Prompt 內容 (風格指南/專有名詞對照表)
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
- Sakamoto Kazushi -> 坂本一志 -> 坂本一志
- 西條朱音 -> 西條朱音
- 菅田將暉 -> 菅田將暉
- ノブ -> ノブ
""",
    "ko": "--- 韓文自訂 Prompt (請在此輸入風格與對照表) ---", 
    "en": "--- 英文自訂 Prompt (請在此輸入風格與對照表) ---" 
}

# 【核心變更】修改載入設定的函數名稱與內容
def load_config():
    """從 api_keys_test.txt (優先) 或 api_keys.txt 載入設定，並載入自訂 Prompt"""
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
        config['GEMINI_API_KEYS'] = api_keys
        
        # 載入自訂 Prompt (custom_prompts.json)
        custom_prompts_path = os.path.join(base_path, 'custom_prompts.json')
        if os.path.exists(custom_prompts_path):
            with open(custom_prompts_path, 'r', encoding='utf-8') as f:
                loaded_prompts = json.load(f)
                custom_prompts.update(loaded_prompts) # 檔案內容覆蓋預設值
            print("   -> 成功載入自訂 Prompt 檔案。", flush=True)
        else:
            print("   -> 未找到自訂 Prompt 檔案，將使用預設值。", flush=True)
            # 首次運行時創建一個包含預設值的 custom_prompts.json
            with open(custom_prompts_path, 'w', encoding='utf-8') as f:
                json.dump(custom_prompts, f, ensure_ascii=False, indent=2)

        if api_keys:
            print(f"   -> 成功載入 {len(api_keys)} 個 API Key。", flush=True)
        else:
            print(f"   -> 警告：在設定檔中未找到任何有效的 API Key。", flush=True)
        return config
    except FileNotFoundError as e:
        if 'api_keys' in os.path.basename(e.filename):
            print(f"錯誤：找不到設定檔 '{os.path.basename(e.filename)}'。", flush=True)
        else:
             print(f"錯誤：載入檔案時發生錯誤: {e}", flush=True)
        return None
    except Exception as e:
        print(f"錯誤：載入設定檔時發生未知錯誤: {e}", flush=True)
        return None

app = Flask(__name__)
# 【關鍵修正點】：將 resources 內的 origins 設定為 "*"
# 這樣可以允許來自 chrome-extension://... 的請求連線。
CORS(app, resources={r"/api/*": {"origins": "*"}}) 

config = None 
API_KEY_COOLDOWN_SECONDS = 60
exhausted_key_timestamps = {}
gemini_initialized_successfully = False

def initialize_gemini():
    global gemini_initialized_successfully
    if not config: return False
    api_keys = config.get('GEMINI_API_KEYS', [])
    if not api_keys:
        print("錯誤: 設定檔中未設定任何有效的 API Key。", flush=True)
        return False
        
    print("\n[API Key 驗證流程開始]", flush=True)
    for idx, key_info in enumerate(api_keys):
        key = key_info.get("key")
        name = key_info.get("name", f"Key #{idx + 1}")
        if key and "XXX" not in key:
            try:
                print(f"-> 正在使用 API Key: '{name}' 進行嚴格啟動驗證...", flush=True)
                genai.configure(api_key=key)
                model = genai.GenerativeModel('gemini-2.5-flash')
                model.generate_content("test", generation_config={"response_mime_type": "text/plain"}) 
                print("   -> 啟動驗證成功！", flush=True)
                gemini_initialized_successfully = True
                return True
            except Exception as e:
                print(f"   -> API Key '{name}' 驗證失敗: {e}", flush=True)
                continue
    print("錯誤: 'api_keys.txt' 中沒有任何一個 API Key 能通過啟動驗證。", flush=True)
    gemini_initialized_successfully = False
    return False

def _extract_strings_from_response(data, expected_len):
    # ... (此函數邏輯保持不變) ...
    if not isinstance(data, list) or len(data) != expected_len: return None
    if all(isinstance(item, str) for item in data): return data
    if all(isinstance(item, dict) for item in data):
        keys_to_try = ['translation', 'text', 'translatedText', 'output']
        for key in keys_to_try:
            if all(key in item for item in data):
                try:
                    extracted_list = [str(item[key]) for item in data]
                    if all(isinstance(s, str) for s in extracted_list): return extracted_list
                except Exception: continue
    return None

@app.route('/api/translate', methods=['POST'])
def translate():
    global exhausted_key_timestamps
    if not gemini_initialized_successfully: 
        print("錯誤: 後端服務未成功初始化，拒絕翻譯請求。", flush=True)
        return jsonify({"error": "後端服務未成功初始化，請檢查 API Key 設定。"}), 500
    try:
        data = request.get_json()
        if not data: raise ValueError("請求主體為空或非 JSON 格式。")
        texts = data.get('texts', [])
        models_preference = data.get('models_preference', [])
        source_lang_code = data.get('source_lang', 'ja') 
        
    except Exception as e:
        print(f"錯誤: 無法解析請求. 原因: {e}", flush=True)
        return jsonify({"error": f"請求格式錯誤: {e}"}), 400
        
    if not texts: return jsonify([])
    
    # 【關鍵備援修正】：當前端傳來的模型偏好為空時，使用一個備援清單
    if not models_preference:
        models_preference = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash-lite', 'gemini-2.0-flash']
        print(f"警告：請求中缺少模型偏好，已自動使用備援模型清單: {models_preference}", flush=True)

    # 根據語言代碼選擇對應的語言名稱
    lang_map = {'ja': '日文', 'ko': '韓文', 'en': '英文'}
    source_lang_name = lang_map.get(source_lang_code, '原文')

    # 組合核心指令與使用者自訂內容
    core_prompt = DEFAULT_CORE_PROMPT_TEMPLATE.format(source_lang=source_lang_name, json_input_text="{json_input_text}")
    custom_prompt_part = custom_prompts.get(source_lang_code, "")
    full_prompt_template = f"{core_prompt}\n{custom_prompt_part}"
    
    json_input = json.dumps(texts, ensure_ascii=False)
    prompt = full_prompt_template.format(json_input_text=json_input)
    
    generation_config = {"response_mime_type": "application/json", "response_schema": {"type": "ARRAY", "items": {"type": "STRING"}}}
    api_keys = config.get('GEMINI_API_KEYS', [])
    safety_settings = { HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE, HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE, HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE, HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE, }
    encountered_errors = set()
    
    print(f"\n[翻譯請求開始] - 語言: {source_lang_name}, 文本數: {len(texts)}, 模型偏好: {models_preference}", flush=True)

    for key_index, key_info in enumerate(api_keys):
        key_name = key_info.get('name', f"Key #{key_index+1}")
        if key_index in exhausted_key_timestamps and time.time() < exhausted_key_timestamps[key_index] + API_KEY_COOLDOWN_SECONDS: continue
        exhausted_key_timestamps.pop(key_index, None)
        genai.configure(api_key=key_info.get("key"))
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
                    print("   -> 警告：AI 回傳格式無法解析或數量不符。嘗試下一個模型。", flush=True)
                    continue
            except Exception as e:
                error_str = str(e)
                if "quota" in error_str.lower():
                    msg = f"API Key '{key_name}' 已達用量上限。"
                    print(f"   -> {msg}", flush=True)
                    encountered_errors.add(msg)
                    exhausted_key_timestamps[key_index] = time.time()
                    break
                else:
                    msg = f"模型 '{model_name}' 發生錯誤: {error_str}"
                    print(f"   -> {msg}", flush=True)
                    encountered_errors.add(msg)
                    continue
                    
    error_summary = "； ".join(encountered_errors) if encountered_errors else "未知原因"
    print(f"錯誤: 所有模型與 API Key 均嘗試失敗。原因: {error_summary}", flush=True)
    return jsonify({"error": f"所有模型與 API Key 均嘗試失敗。原因: {error_summary}"}), 503

# 新增 API 端點，供前端讀取所有自訂 Prompt
@app.route('/api/prompts/custom', methods=['GET'])
def get_custom_prompts():
    print("[API 請求] GET /api/prompts/custom", flush=True)
    return jsonify(custom_prompts)

# 新增 API 端點，供前端儲存所有自訂 Prompt
@app.route('/api/prompts/custom', methods=['POST'])
def set_custom_prompts():
    global custom_prompts
    try:
        data = request.get_json()
        if not data or not isinstance(data, dict):
            return jsonify({"error": "請求格式錯誤，應為 JSON 物件。"}), 400
        
        # 僅接受有效的語言代碼
        valid_langs = {"ja", "ko", "en"}
        if not all(key in valid_langs and isinstance(value, str) for key, value in data.items()):
            return jsonify({"error": "無效的語言代碼或內容格式。"}), 400
        
        # 儲存到檔案
        base_path = get_base_path()
        custom_prompts_path = os.path.join(base_path, 'custom_prompts.json')
        with open(custom_prompts_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        # 更新記憶體中的資料
        custom_prompts.update(data)
        
        print("[API 請求] POST /api/prompts/custom - 儲存成功。", flush=True)
        return jsonify({"success": True})

    except Exception as e:
        print(f"錯誤：更新自訂 Prompt 失敗。原因: {e}", flush=True)
        return jsonify({"error": f"伺服器錯誤: {e}"}), 500

def quit_action(icon, item):
    print("\n-> 收到關閉指令，正在關閉伺服器...", flush=True)
    icon.stop()
    os._exit(0)

def run_tray_icon():
    base_path = get_base_path()
    image_path = os.path.join(base_path, 'server_icon.png')
    try: image = Image.open(image_path)
    except FileNotFoundError:
        print(f"錯誤：找不到系統匣圖示檔案 'server_icon.png'！系統匣功能將無法啟用。", flush=True)
        return
    menu = (item('結束 (Quit)', quit_action),)
    tray_icon = icon("YT_Subtitle_Backend", image, "YT 字幕增強器後端", menu)
    print("-> 系統匣圖示已建立，程式在背景運行中。", flush=True)
    tray_icon.run()

# 【修正後的啟動區塊】
if __name__ == '__main__':
    # 移除 setup_logging() 的呼叫
    print("="*50, flush=True)
    print("YT 字幕增強器後端 v1.4.4 (最終啟動修正)", flush=True)
    print("="*50, flush=True)
    config = load_config()
    if not config or not initialize_gemini():
        print("初始化失敗，請檢查終端機輸出以獲取詳細錯誤訊息。", flush=True)
        sys.exit(1)
    
    # 確保 app.run 在獨立函數中執行，並禁用 reloader/debug
    def run_flask_server():
        app.run(host='127.0.0.1', port=5001, debug=False, use_reloader=False)

    flask_thread = threading.Thread(target=run_flask_server, daemon=True)
    flask_thread.start()

    print("\n-> 後端 Flask 伺服器已在背景執行緒啟動 (http://127.0.0.1:5001)。", flush=True)
    run_tray_icon()