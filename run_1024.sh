#!/bin/bash
# 監控 10/24 08:30 船班開放 (明天 10/10 08:00 AM 執行)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd /Users/ych/takachiho_crawler

TARGET_URL="https://eipro.jp/takachiho1/events/view/EV00000007?closable=1&service_cd=6892dd9d-5b54-4202-bd1d-4aa6c0a8018d&service_session_cd=68a915a5-d904-4502-8530-9dd8c0a8018d&service_start_datetime=2026/10/24%2008:30:00&service_end_datetime=2026/10/24%2009:00:00"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 啟動 10/24 船班監控 (每 3 秒檢查一次，偵測到變動並存檔後自動結束，最長執行 10 分鐘)..."
/opt/homebrew/bin/python3 crawler.py --url "$TARGET_URL" --interval 3 --stop-on-change --max-runtime 600
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 10/24 船班監控結束。"
