# ==============================================================================
# YT Subtitle Enhancer - Backend with System Tray (v1.0.0 )
# Copyright (c) 2025 [yuforfun]
#
# This program is free software distributed under the MIT License.
# You can find a copy of the license in the LICENSE file that should be
# distributed with this software.
#
# This version runs the Flask server in a background thread and provides a
# system tray icon for easy management and shutdown.
# ==============================================================================

# --- 核心函式庫 ---
import sys
import os
import json
import time
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS

# --- 系統匣圖示相關 ---
from pystray import MenuItem as item, Icon as icon
from PIL import Image

# --- Google Gemini API ---
import google.generativeai as genai


# --- 1. Flask App (伺服器核心邏輯) ---

def load_config():
    """載入與 exe 同目錄的 config.json 檔案"""
    try:
        # 確定 config.json 的路徑，對 .py 和 .exe 均有效
        if getattr(sys, 'frozen', False):
            base_path = os.path.dirname(sys.executable)
        else:
            base_path = os.path.dirname(os.path.abspath(__file__))
        
        config_path = os.path.join(base_path, 'config.json')
        
        with open(config_path, 'r', encoding='utf-8') as f:
            print(f"-> 正在從 {config_path} 載入設定...", flush=True)
            return json.load(f)
    except Exception as e:
        print(f"錯誤：載入設定檔時發生錯誤: {e}", flush=True)
        return None

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "https://www.youtube.com"}})
config = load_config()

# 全域變數
API_KEY_COOLDOWN_SECONDS = 60 
exhausted_key_timestamps = {}
gemini_initialized_successfully = False

def initialize_gemini():
    """驗證 config.json 中至少有一個有效的 Gemini API Key"""
    global gemini_initialized_successfully
    if not config: return False
    
    api_keys = config.get('GEMINI_API_KEYS', [])
    for idx, key_info in enumerate(api_keys):
        key = key_info.get("key")
        name = key_info.get("name", f"Key #{idx + 1}")
        if key and "在這裡貼上" not in key:
            try:
                print(f"-> 正在使用 API Key: '{name}' 進行啟動驗證...", flush=True)
                genai.configure(api_key=key)
                genai.list_models()
                print("   -> 啟動驗證成功！", flush=True)
                gemini_initialized_successfully = True
                return True
            except Exception as e:
                print(f"   -> API Key '{name}' 驗證失敗: {e}", flush=True)
                continue
    
    print("錯誤: config.json 中沒有任何一個有效的 Gemini API Key 可供啟動。", flush=True)
    gemini_initialized_successfully = False
    return False

def _extract_strings_from_response(data, expected_len):
    """從 AI 的回應中智慧提取字串列表"""
    if not isinstance(data, list) or len(data) != expected_len: return None
    if all(isinstance(item, str) for item in data): return data
    if all(isinstance(item, dict) for item in data):
        keys_to_try = ['translation', 'text', 'translatedText', 'output']
        for key in keys_to_try:
            if all(key in item for item in data):
                try:
                    extracted_list = [str(item[key]) for item in data]
                    if all(isinstance(s, str) for s in extracted_list):
                        return extracted_list
                except Exception: continue
    return None

@app.route('/api/translate', methods=['POST'])
def translate():
    """處理來自前端的翻譯請求"""
    global exhausted_key_timestamps
    if not gemini_initialized_successfully: 
        return jsonify({"error": "Gemini 後端未成功初始化"}), 500
        
    data = request.json
    texts = data.get('texts', [])
    if not texts: return jsonify([])
    
    json_input = json.dumps(texts, ensure_ascii=False)
    generation_config = {"response_mime_type": "application/json", "response_schema": {"type": "ARRAY", "items": {"type": "STRING"}}}
    api_keys = config.get('GEMINI_API_KEYS', [])
    model_preference = config.get('MODEL_PREFERENCE', [])
    prompt_lines = config.get('GEMINI_PROMPT_TEMPLATE_LINES', [])
    prompt_template = "\n".join(prompt_lines)

    for key_index, key_info in enumerate(api_keys):
        # ... (此處省略了與之前版本相同的 key 輪詢和翻譯邏輯) ...
        # ... (請確保您貼上完整的函式) ...
        key_name = key_info.get('name', f"Key #{key_index+1}")
        if key_index in exhausted_key_timestamps and time.time() < exhausted_key_timestamps[key_index] + API_KEY_COOLDOWN_SECONDS:
            continue
        exhausted_key_timestamps.pop(key_index, None)
        genai.configure(api_key=key_info.get("key"))
        for model_name in model_preference:
            try:
                model = genai.GenerativeModel(model_name)
                prompt = prompt_template.format(json_input_text=json_input)
                response = model.generate_content(prompt, generation_config=generation_config)
                final_list = _extract_strings_from_response(json.loads(response.text), len(texts))
                if final_list is not None:
                    return jsonify(final_list)
                else:
                    raise ValueError("AI 回傳格式無法解析")
            except Exception as e:
                if "quota" in str(e).lower():
                    exhausted_key_timestamps[key_index] = time.time()
                    break
                else:
                    continue
    return jsonify({"error": "所有 API Key 當前均不可用。"}), 503

# --- 2. 系統匣圖示邏輯 ---

def quit_action(icon, item):
    """點擊「結束」選單時觸發的動作"""
    print("-> 收到關閉指令，正在關閉伺服器...", flush=True)
    icon.stop()
    os._exit(0) # 強制結束所有執行緒

def run_tray_icon():
    """建立並運行系統匣圖示"""
    if getattr(sys, 'frozen', False):
        base_path = os.path.dirname(sys.executable)
    else:
        base_path = os.path.dirname(os.path.abspath(__file__))
    
    image_path = os.path.join(base_path, 'server_icon.png')

    try:
        image = Image.open(image_path)
    except FileNotFoundError:
        print(f"錯誤：找不到系統匣圖示檔案 'server_icon.png'！系統匣功能將無法啟用。", flush=True)
        return

    menu = (item('結束 (Quit)', quit_action),)
    tray_icon = icon("YT_Subtitle_Backend", image, "YT 字幕增強器後端", menu)
    
    print("-> 系統匣圖示已建立，程式在背景運行中。", flush=True)
    tray_icon.run()

# --- 3. 主執行區塊 ---

if __name__ == '__main__':
    print("="*50, flush=True)
    print("YT 字幕增強器後端 v1.0.0", flush=True)
    print("="*50, flush=True)

    if not config or not initialize_gemini():
        # 在 GUI 模式下，print 可能看不到，所以 input 更為可靠
        input("初始化失敗，請檢查 config.json 與 API Key 後按 Enter 結束...")
        sys.exit(1)

    # 將 Flask 伺服器放到一個背景執行緒中
    flask_thread = threading.Thread(
        target=lambda: app.run(host='127.0.0.1', port=5001), 
        daemon=True
    )
    flask_thread.start()
    print("-> 後端 Flask 伺服器已在背景執行緒啟動 (http://127.0.0.1:5001)。", flush=True)

    # 在主執行緒中運行系統匣圖示
    run_tray_icon()