#!/bin/bash

# --- YT 字幕增強器後端 macOS 簡易啟動腳本 ---
# 版本 v1.0
# 功能：自動檢查環境、安裝相依套件並啟動後端服務。
# --------------------------------------------------

# 如果任何指令失敗，腳本將立即停止執行
set -e

# 獲取腳本所在的真實目錄，並切換到該目錄，確保後續指令路徑正確
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$DIR"

echo "================================================="
echo "  YT 字幕增強器後端 啟動程序"
echo "================================================="

# --- 步驟一：檢查 Python 3 環境 ---
echo -e "\n[ 1/4 ] 正在檢查 Python 3 環境..."

if ! command -v python3 &> /dev/null
then
    echo -e "\n\xE2\x9D\x8C 錯誤：找不到 'python3' 指令。"
    echo "您的電腦似乎尚未安裝 Python 3，或沒有設定好環境變數。"
    echo "請前往官方網站下載並安裝 Python 3.9 或更高版本："
    echo "https://www.python.org/downloads/"
    read -p "安裝完成後，請完全關閉並重新開啟此終端機視窗。請按 Enter 鍵結束..."
    exit 1
fi
echo -e "\xE2\x9C\x85 'python3' 指令已找到！"

# --- 步驟二：檢查 Python 版本號 ---
echo -e "\n[ 2/4 ] 正在檢查 Python 版本是否符合要求 (>= 3.9)..."
MIN_MAJOR=3
MIN_MINOR=9

PY_VERSION_STR=$(python3 --version 2>&1) # e.g., "Python 3.10.4"
# 從字串中提取數字版本部分
if [[ $PY_VERSION_STR =~ ([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
    PY_MAJOR=${BASH_REMATCH[1]}
    PY_MINOR=${BASH_REMATCH[2]}

    # 進行版本比較
    if ! ( [ "$PY_MAJOR" -gt "$MIN_MAJOR" ] || ( [ "$PY_MAJOR" -eq "$MIN_MAJOR" ] && [ "$PY_MINOR" -ge "$MIN_MINOR" ] ) ); then
        echo -e "\n\xE2\x9D\x8C 錯誤：偵測到您的 Python 版本為 ${PY_MAJOR}.${PY_MINOR}，版本過舊。"
        echo "此程式需要 Python ${MIN_MAJOR}.${MIN_MINOR} 或更高的版本才能運行。"
        echo "請前往官方網站下載最新版本：https://www.python.org/downloads/"
        read -p "請按 Enter 鍵結束..."
        exit 1
    fi
    echo -e "\xE2\x9C\x85 Python 版本 ${PY_MAJOR}.${PY_MINOR} 符合要求！"
else
    echo "警告：無法自動偵測 Python 詳細版本號，將繼續嘗試..."
fi

# --- 步驟三：安裝相依套件 ---
echo -e "\n[ 3/4 ] 正在安裝或更新必要的相依套件 (可能需要幾分鐘)..."
# 【關鍵修正點】: 創建一個 requirements.txt 來管理依賴
cat > requirements.txt << EOF
Flask==2.2.3
Flask-Cors==3.0.10
google-generativeai==0.7.1
EOF

pip3 install -r requirements.txt
echo -e "\xE2\x9C\x85 相依套件已安裝完成！"


# --- 步驟四：啟動後端伺服器 ---
echo -e "\n[ 4/4 ] 所有設定已完成！正在啟動後端伺服器..."
echo "✅ 成功！後端服務已啟動。"
echo "================================================="
echo "  重要提示：請保持此終端機視窗開啟！"
echo "  關閉此視窗將會關閉後端翻譯服務。"
echo "================================================="
python3 backend.py