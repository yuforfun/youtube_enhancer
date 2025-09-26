# ==============================================================================
# YT Subtitle Enhancer - Backend with System Tray (v1.3.0)
# Copyright (c) 2025 [yuforfun]
#
# This program is free software distributed under the MIT License.
# You can find a copy of the license in the LICENSE file that should be
# distributed with this software.
#
# This version runs the Flask server in a background thread and provides a
# system tray icon for easy management and shutdown.

# Implemented a dual API key file system (api_keys_test.txt and api_keys.txt).
# ==============================================================================
import sys, os, json, time, threading
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from pystray import MenuItem as item, Icon as icon
from PIL import Image
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold

def get_base_path():
    if getattr(sys, 'frozen', False): return os.path.dirname(sys.executable)
    else: return os.path.dirname(os.path.abspath(__file__))

def setup_logging():
    base_path = get_base_path()
    log_file_path = os.path.join(base_path, 'backend.log')
    log_file = open(log_file_path, 'a', encoding='utf-8', buffering=1)
    sys.stdout = log_file
    sys.stderr = log_file
    print("\n" + "="*50)
    print(f"日誌開始於: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*50)

# 【優化】修改金鑰讀取邏輯
def load_config_from_txt():
    """ 從 api_keys_test.txt (優先) 或 api_keys.txt 載入設定 """
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
        # 載入 API Keys
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
        
        if api_keys:
            print(f"   -> 成功載入 {len(api_keys)} 個 API Key。", flush=True)
        else:
            print(f"   -> 警告：在設定檔中未找到任何有效的 API Key。", flush=True)


        # 載入 Prompt 模板
        prompt_path = os.path.join(base_path, 'prompt.txt')
        with open(prompt_path, 'r', encoding='utf-8') as f:
            full_prompt = f.read()
            config['GEMINI_PROMPT_TEMPLATE_LINES'] = full_prompt.splitlines()
        print("   -> 成功載入 Prompt 模板。", flush=True)
        return config
    except FileNotFoundError as e:
        print(f"錯誤：找不到設定檔 '{os.path.basename(e.filename)}'。", flush=True)
        return None
    except Exception as e:
        print(f"錯誤：載入設定檔時發生未知錯誤: {e}", flush=True)
        return None

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "https://www.youtube.com"}})
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
    # ...(以下函式內容與之前版本相同，此處省略以節省篇幅)...
    # ...(您只需完整替換整個檔案即可)...
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
    if not gemini_initialized_successfully: return jsonify({"error": "後端服務未成功初始化，請檢查 API Key 設定。"}), 500
    try:
        data = request.get_json()
        if not data: raise ValueError("請求主體為空或非 JSON 格式。")
        texts = data.get('texts', [])
        models_preference = data.get('models_preference', [])
    except Exception as e:
        print(f"錯誤: 無法解析請求. 原因: {e}", flush=True)
        return jsonify({"error": f"請求格式錯誤: {e}"}), 400
    if not texts: return jsonify([])
    if not models_preference: return jsonify({"error": "請求中缺少 'models_preference' 列表。"}), 400
    json_input = json.dumps(texts, ensure_ascii=False)
    generation_config = {"response_mime_type": "application/json", "response_schema": {"type": "ARRAY", "items": {"type": "STRING"}}}
    api_keys = config.get('GEMINI_API_KEYS', [])
    prompt_template = "\n".join(config.get('GEMINI_PROMPT_TEMPLATE_LINES', []))
    safety_settings = { HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE, HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE, HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE, HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE, }
    encountered_errors = set()
    for key_index, key_info in enumerate(api_keys):
        key_name = key_info.get('name', f"Key #{key_index+1}")
        if key_index in exhausted_key_timestamps and time.time() < exhausted_key_timestamps[key_index] + API_KEY_COOLDOWN_SECONDS: continue
        exhausted_key_timestamps.pop(key_index, None)
        genai.configure(api_key=key_info.get("key"))
        for model_name in models_preference:
            try:
                model = genai.GenerativeModel(model_name)
                prompt = prompt_template.format(json_input_text=json_input)
                response = model.generate_content(prompt, generation_config=generation_config, safety_settings=safety_settings)
                print(f"   -> AI Raw Response for '{model_name}': {response.text}", flush=True)
                final_list = _extract_strings_from_response(json.loads(response.text), len(texts))
                if final_list is not None: return jsonify(final_list)
                else: raise ValueError("AI 回傳格式無法解析")
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
    return jsonify({"error": f"所有模型與 API Key 均嘗試失敗。原因: {error_summary}"}), 503

def quit_action(icon, item):
    print("-> 收到關閉指令，正在關閉伺服器...", flush=True)
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

if __name__ == '__main__':
    setup_logging()
    print("="*50, flush=True)
    print("YT 字幕增強器後端 v1.3.0", flush=True)
    print("="*50, flush=True)
    config = load_config_from_txt()
    if not config or not initialize_gemini():
        print("初始化失敗，請檢查 backend.log 檔案以獲取詳細錯誤訊息。", flush=True)
        sys.exit(1)
    flask_thread = threading.Thread(target=lambda: app.run(host='127.0.0.1', port=5001), daemon=True)
    flask_thread.start()
    print("-> 後端 Flask 伺服器已在背景執行緒啟動 (http://127.0.0.1:5001)。", flush=True)
    run_tray_icon()