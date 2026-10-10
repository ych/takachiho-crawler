# 高千穂峡貸しボート 預約表單欄位規格表

本文檔整理自 **高千穂峡貸しボート（高千穂町觀光協會）** 線上預約系統（eipro.jp）的前端結構、條款與 CakePHP 表單慣例，供 10/24 自動化預約 11/7 船班時建立請求參數與自動填表設定。

---

## 一、 預約限制與乘船規則

* **乘船時間**：30 分鐘（超過每 10 分鐘加收 1,000 日圓，現場付現）。
* **乘船人數**：
  * 每艘船上限 **3 名大人**（小學生以上皆視為大人，中學生以上可操船）。
  * 若含未就學幼兒，一艘船最多可乘載 **4 名**（例如：3 大 1 幼 或 2 大 2 幼）。
* **多艘船預約條件**：
  * 若預約 2 艘以上，必須分次下單，且每艘船必須填寫**不同的代表者姓名與資料**（同一代表者姓名無法重複預約）。
* **付款方式**：
  * 線上信用卡刷卡（PayJP 閘道，支援 Visa, MasterCard, JCB, Amex, Diners, Discover）。
  * 必須開通 **3D 驗證（本人認證服務）**。

---

## 二、 表單欄位詳細對照表

表單採用 CakePHP 的標準命名慣例：`data[Model][field_name]`。

### 1. 代表者客戶資料 (`Customer`)

| 欄位名稱 (中文) | 欄位代號 (`name`) | 必填 | 格式說明與範例 |
| :--- | :--- | :---: | :--- |
| **代表者 姓** | `data[Customer][l_name]` | 是 | 漢字或護照英文姓，例如：`王` 或 `WANG` |
| **代表者 名** | `data[Customer][f_name]` | 是 | 漢字或護照英文名，例如：`大明` 或 `DAMING` |
| **代表者 姓 (片假名)** | `data[Customer][l_name_kana]` | 是 | 全形日文片假名（フリガナ），例如：`ワン` |
| **代表者 名 (片假名)** | `data[Customer][f_name_kana]` | 是 | 全形日文片假名（フリガナ），例如：`ダイミン` |
| **電子郵件信箱** | `data[Customer][mail]` | 是 | 用於接收預約確認信與停航通知，例如：`example@gmail.com` |
| **確認電子郵件** | `data[Customer][mail_confirm]` | 是 | 再次輸入電子信箱確認 |
| **聯絡電話** | `data[Customer][tel]` | 是 | 手機號碼（例如：`0912345678` 或 `+886912345678`） |
| **郵遞區號** | `data[Customer][zip]` | 是 | 數字格式，例如：`882-1101`（高千穂當地）或居住地/住宿飯店郵遞區號 |
| **住址** | `data[Customer][address]` | 是 | 台灣住址或日本住宿飯店地址 |
| **出生年月日** | `data[Customer][birthday]` | 是 | `YYYY/MM/DD` 或下拉選單年/月/日（例如：`1990/05/20`） |

---

### 2. 訂單時段與人數設定 (`OrderDetail`)

| 欄位名稱 (中文) | 欄位代號 (`name`) | 必填 | 格式說明與範例 |
| :--- | :--- | :---: | :--- |
| **大人人數** | `data[OrderDetail][adult_count]` | 是 | `1` ~ `3` 人（小學生以上算大人） |
| **幼兒人數** | `data[OrderDetail][child_count]` | 否 | `0` ~ `1` 人（未就學兒童，整船含大人上限 4 人） |
| **服務代碼** | `data[service_cd]` | 是 | 固定值：`6892dd9d-5b54-4202-bd1d-4aa6c0a8018d` |
| **時段 Session 代碼** | `data[service_session_cd]` | 是 | 依當天具體時段而定（例如：`68a914a3-4d0c-4b20-88e0-9dd8c0a8018d`） |
| **服務開始時間** | `data[service_start_datetime]` | 是 | 格式：`YYYY/MM/DD HH:MM:SS`（例如：`2026/11/07 08:30:00`） |
| **服務結束時間** | `data[service_end_datetime]` | 是 | 格式：`YYYY/MM/DD HH:MM:SS`（例如：`2026/11/07 09:00:00`） |

---

### 3. 線上信用卡付款資料 (PayJP)

系統前端整合 Pay.jp 令牌化付款機制（`PayjpToken`）：
* **租戶 ID (Tenant ID)**：`ten_b2a99be6306e5e0b44f330f43de4`
* **信用卡欄位**：
  1. 卡號（16 碼）
  2. 到期年月（MM/YY）
  3. 安全碼（CVC / CVV，3 或 4 碼）
  4. 持卡人姓名（英文大寫）

---

## 三、 搶訂流程步驟 (10/24 08:00 AM 台灣時間)

搶訂 11/7 船班的最佳自動化管線：

```text
[Step 1] 07:59:50 預熱 Session (prime_session)
         └── 造訪日曆頁面取得 Cookie 與 action_token
         └── 呼叫 eventCalendars/search 初始化日曆快取

[Step 2] 08:00:00 開放瞬間鎖位 (hold_slot)
         └── 發送 POST /apiServices/api/hold_slot
         └── 伺服器回傳 result: "1" (席位暫時鎖定成功，保留 15 分鐘)

[Step 3] 08:00:02 載入表單 (orders/add)
         └── 帶同一個 Session Cookie 存取 /orders/add
         └── 伺服器回傳包含完整 Customer/OrderDetail 欄位之頁面

[Step 4] 08:00:04 填表並送出確認 (orders/confirm -> orders/save)
         └── 填入代表者資料與乘船人數
         └── 取得 PayJP 3D 驗證 Token
         └── 送出並完成預約
```

---

## 四、 個人預約設定 JSON 範例範本 (`booking_profile.json`)

可將以下範本儲存為本機設定檔，供自動化填表機器人使用：

```json
{
  "customer": {
    "l_name": "王",
    "f_name": "大明",
    "l_name_kana": "ワン",
    "f_name_kana": "ダイミン",
    "mail": "your_email@gmail.com",
    "tel": "0912345678",
    "zip": "882-1101",
    "address": "宮崎県西臼杵郡高千穂町大字三田井御塩井",
    "birthday": "1990/05/20"
  },
  "order": {
    "adult_count": 2,
    "child_count": 0
  },
  "credit_card": {
    "card_number": "4111222233334444",
    "exp_month": "12",
    "exp_year": "28",
    "cvc": "123"
  }
}
```
