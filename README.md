# 高千穂峡貸しボート 自動搶位與預約全套工具箱 (Takachiho Boat Reservation Helper)

專為 **高千穂峡貸しボート（宮崎縣高千穂町觀光協會）** 線上預約系統（eipro.jp）打造的全套自動化搶票與監控方案。包含 **Chrome 專屬自動搶位擴充功能** 與 **後端 Python 異動監控爬蟲**。

---

## 📥 擴充功能直接下載（免用 Git，下載即可使用）

如果您或同行的旅伴需要使用搶位擴充功能，可以直接下載預先打包好的 ZIP 壓縮檔：
* 📦 **[點此直接下載 takachiho-boat-helper.zip (最新發行版 v1.0.0)](https://github.com/ych/takachiho-crawler/releases/download/v1.0.0/takachiho-boat-helper.zip)**
* 🌐 **[GitHub Releases 官方發布頁](https://github.com/ych/takachiho-crawler/releases/latest)**

> **3 步驟安裝使用**：
> 1. 下載並解壓縮 `takachiho-boat-helper.zip`。
> 2. 打開 Chrome 瀏覽器前往 `chrome://extensions/`，開啟右上角「開發人員模式」。
> 3. 點擊「載入未封裝項目」，選擇解壓縮出來的 `takachiho-boat-helper` 資料夾即可！

## 🎯 預約規則與時程

* **系統網址**：`https://eipro.jp/takachiho1/`
* **開放規則**：乘船日 **2 週前（14 天前）的日本時間上午 09:00（台灣時間上午 08:00）** 開放預約。
* **目標乘船日**：**11/7** 船班（08:30 ~ 16:30）。
* **目標開搶日**：**10/24 台灣時間 08:00（日本時間 09:00）**。
* **搶票實測發現（10/10 實測紀錄）**：
  * 開放瞬間：08:00:03 開放預約。
  * 售罄速度：**約 7 秒內全數額滿**。
  * 關鍵機制：系統具備 `hold_slot` 暫時鎖位機制，只要搶先取得 `result: "1"` 即可**持有該席位 15 分鐘**進行填表與結帳。

---

## 🛶 核心推薦方案：Chrome 擴充功能（一鍵秒殺搶位與 3D 驗證）

為了解決信用卡 3D 驗證（簡訊 OTP）無法在純後端自動完成，以及 eipro 席位保留（`hold_slot`）與瀏覽器 Session Cookie 綁定的問題，本專案提供專屬 Chrome 擴充功能（Manifest V3）。

擴充功能程式碼目錄：[`chrome_extension/`](chrome_extension/)  
詳細手冊：[`chrome_extension/README.md`](chrome_extension/README.md)

### 🌟 核心特色：
1. **開賣瞬間自動鎖位 (`hold_slot`)**：在 07:59:59.5 自動向 eipro 發送鎖位請求，成功後席位保留 15 分鐘，自動轉跳預約表單。
2. **預約表單秒速填寫 (`orders/add`)**：0.3 秒自動填入代表者姓名（漢字與片假名）、電話、Email、日本地址、大人/幼兒人數，以及 PayJP 信用卡資料並自動送出。
3. **無縫銜接 3D 驗證聲響警報**：完全在桌面 Chrome 執行，跳轉至銀行 3D 驗證頁面時自動發出**連續蜂鳴警報聲**，提醒您直接在螢幕上輸入簡訊驗證碼（OTP）完成刷卡！
4. **本機隱私安全**：所有個人與信用卡資料僅安全保存在本機 `chrome.storage.local`，絕不對外傳輸。

### 🚀 3 步驟安裝使用教學：
1. 開啟 Chrome 前往 `chrome://extensions/` ➔ 開啟右上角「開發人員模式」➔ 點擊左上角「載入未封裝項目」➔ 選擇 `chrome_extension` 目錄。
2. 點擊瀏覽器工具列上的小船圖示，設定目標日期（`2026/11/07`）、時段（`08:30:00`）、代表者個人資料與信用卡付款資訊，並點擊「儲存設定」。
3. 搶票當天（10/24 07:58）點擊「開啟高千穂日曆」，右上方將常駐懸浮控制面板，倒數至 07:59:59.5 即全自動觸發搶位流程！

---

## 🐍 方案二：後端 Python 監控與爬蟲 (`crawler.py`)

用於自動監控時段開放、比對網頁實質變化、下載完整表單結構與測試連線。

### 🚀 特點：
1. **智慧正規化比對（避免誤報）**：自動濾除動態 CSRF `action_token` 與靜態資源快取戳記，只比對真實 DOM 異動。
2. **實質異動永久存檔**：內容變化時自動存下完整 HTML 快照至 `snapshots/`，並產出差異 patch 至 `diffs/`。
3. **時段狀態 API 整合**：同步查詢 eipro 內部的 `service_unit` API，自動辨識 ⏳ 沙漏準備中、⭕ 開放預約中、❌ 已售完。
4. **Session 預熱與自動鎖位**：開放時自動呼叫 `hold_slot` 並抓取 `orders/add` 表單。

### 常用指令：
```bash
# 1. 測試執行單次比對
python3 crawler.py --once

# 2. 即時查詢目前時段 API 開放狀態
python3 crawler.py --status

# 3. 測試 Session 預熱與 hold_slot 連線
python3 crawler.py --test-hold

# 4. 定時啟動高頻輪詢 (每 2 秒檢查一次，發現異動並存檔後自動結束)
python3 crawler.py --start-at 07:59:50 --interval 2 --stop-on-change
```

---

## 📁 專案檔案結構

```text
takachiho_crawler/
├── chrome_extension/              # 專屬 Chrome 擴充功能 (Manifest V3)
│   ├── manifest.json              # 擴充功能設定檔
│   ├── popup.html / popup.js      # 設定面板 (時段、代表者資料、信用卡)
│   ├── content.js                 # 網頁注入腳本 (懸浮面板、自動鎖位、填表、3D 警報)
│   ├── icons/                     # 擴充功能圖示 (16x16, 48x48, 128x128)
│   └── README.md                  # 擴充功能專用安裝說明
├── crawler.py                     # 後端 Python 爬蟲與比對監控主程式
├── FORM_FIELDS.md                 # 完整預約表單欄位規格與 CakePHP 映射表
├── README.md                      # 專案總說明文件
├── crontab.txt                    # crontab 定時排程設定檔
├── run_1024.sh / run_1025.sh      # 自動化監控執行腳本
├── temp/                          # 暫存比對快照
├── snapshots/                     # 永久存檔的快照與表單結構 JSON
└── diffs/                         # 異動版本比對 patch 檔
```

---

## 📝 預約必備欄位對照（CakePHP 結構）

詳見 [`FORM_FIELDS.md`](FORM_FIELDS.md)：

| 欄位中文 | 系統欄位名稱 (`name`) | 說明範例 |
| :--- | :--- | :--- |
| **代表者 姓** | `data[Customer][l_name]` | 漢字或護照英文，例如：`王` 或 `WANG` |
| **代表者 名** | `data[Customer][f_name]` | 漢字或護照英文，例如：`大明` 或 `DAMING` |
| **姓 (片假名)** | `data[Customer][l_name_kana]` | 全形片假名，例如：`ワン` |
| **名 (片假名)** | `data[Customer][f_name_kana]` | 全形片假名，例如：`ダイミン` |
| **電子郵件** | `data[Customer][mail]` | 接收預約憑證信箱 |
| **確認郵件** | `data[Customer][mail_confirm]` | 再次確認信箱 |
| **聯絡電話** | `data[Customer][tel]` | 手機號碼，例如：`+886912345678` |
| **郵遞區號** | `data[Customer][zip]` | 預設 `882-1101` 或日本飯店區號 |
| **日本住址** | `data[Customer][address]` | 高千穂當地或住宿飯店住址 |
| **出生年月日** | `data[Customer][birthday]` | `YYYY/MM/DD` |
| **大人人數** | `data[OrderDetail][adult_count]` | `1` ~ `3` 人（一艘船上限 3 名大人） |
| **幼兒人數** | `data[OrderDetail][child_count]` | `0` ~ `1` 人（未就學幼兒） |
| **信用卡資料** | PayJP 閘道 | 卡號 16 碼、到期年月 MM/YY、CVC、持卡人姓名 |
