#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高千穂峡貸しボート 預約頁面爬蟲與異動監控工具
用途: 監控指定預約/時段頁面，先暫存比對，內容若有實質變動則永久存檔並解析表單欄位。
支援多時段/多網址獨立快照、定時排程、超時自動停止與 API 狀態檢測。
"""

import sys
import os
import re
import json
import time
import hashlib
import difflib
import argparse
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path
from html.parser import HTMLParser

DEFAULT_TARGET_URL = (
    "https://eipro.jp/takachiho1/events/view/EV00000007"
    "?closable=1"
    "&service_cd=6892dd9d-5b54-4202-bd1d-4aa6c0a8018d"
    "&service_session_cd=68a915a5-d904-4502-8530-9dd8c0a8018d"
    "&service_start_datetime=2026/10/24%2008:30:00"
    "&service_end_datetime=2026/10/24%2009:00:00"
)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


class FormElementParser(HTMLParser):
    """提取 HTML 中的表單、輸入欄位、按鈕與文字"""
    def __init__(self):
        super().__init__()
        self.forms = []
        self._current_form = None
        self.all_inputs = []
        self.buttons = []
        self.links = []
        self.text_content = []

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)

        if tag == "form":
            self._current_form = {
                "id": attr_dict.get("id"),
                "name": attr_dict.get("name"),
                "action": attr_dict.get("action"),
                "method": attr_dict.get("method", "GET").upper(),
                "inputs": [],
            }
            self.forms.append(self._current_form)

        elif tag in ("input", "select", "textarea"):
            item = {
                "tag": tag,
                "type": attr_dict.get("type", "text" if tag == "input" else tag),
                "name": attr_dict.get("name"),
                "value": attr_dict.get("value"),
                "id": attr_dict.get("id"),
                "class": attr_dict.get("class"),
                "placeholder": attr_dict.get("placeholder"),
            }
            self.all_inputs.append(item)
            if self._current_form is not None:
                self._current_form["inputs"].append(item)

        elif tag == "button":
            self.buttons.append({
                "type": attr_dict.get("type"),
                "id": attr_dict.get("id"),
                "class": attr_dict.get("class"),
            })

        elif tag == "a":
            href = attr_dict.get("href")
            if href and not href.startswith("javascript:") and href != "#":
                self.links.append({
                    "href": href,
                    "id": attr_dict.get("id"),
                    "class": attr_dict.get("class"),
                })

    def handle_endtag(self, tag):
        if tag == "form":
            self._current_form = None

    def handle_data(self, data):
        cleaned = data.strip()
        if cleaned:
            self.text_content.append(cleaned)


def normalize_html(html: str) -> str:
    """
    正規化 HTML 內容，排除每次 HTTP 請求都會變更但無實質意義的動態噪聲：
    1. 統一換行符為 \\n
    2. action_token 隨機雜湊值
    3. 靜態資源檔名中的 ?cache=\\d+ 戳記
    4. 移除各行首尾空白
    """
    h = html.replace("\r\n", "\n").replace("\r", "\n")

    # 遮罩 action_token (避免每次載入隨機生成的 CSRF token 誤判為網頁更新)
    h = re.sub(
        r'(name=[\'\"]action_token[\'\"][^>]*?value=[\'\"])[^\'\"]+',
        r'\1[NORMALIZED_TOKEN]',
        h,
    )
    h = re.sub(
        r'(id=[\'\"]actionTokenId[\'\"][^>]*?value=[\'\"])[^\'\"]+',
        r'\1[NORMALIZED_TOKEN]',
        h,
    )
    # 遮罩靜態資源的快取防緩存戳記 cache=123456
    h = re.sub(r'cache=\d+', 'cache=[NORMALIZED_CACHE]', h)

    lines = [line.rstrip() for line in h.splitlines()]
    return "\n".join(lines).strip()


def parse_page_details(html: str) -> dict:
    """提取表單結構及可視文字摘要"""
    parser = FormElementParser()
    parser.feed(html)

    meaningful_inputs = [
        inp for inp in parser.all_inputs
        if inp.get("type") != "hidden"
        or any(k in str(inp.get("name")) for k in ["Order", "Customer", "service", "datetime"])
    ]

    return {
        "forms_count": len(parser.forms),
        "forms": parser.forms,
        "meaningful_inputs": meaningful_inputs,
        "all_inputs_count": len(parser.all_inputs),
        "buttons_count": len(parser.buttons),
        "links_count": len(parser.links),
        "text_sample": parser.text_content[:40],
    }


def fetch_url(url: str, timeout: int = 15) -> str:
    """發送 HTTP GET 請求抓取指定網頁"""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,ja;q=0.8,en;q=0.7",
            "Connection": "keep-alive",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def check_slot_api(
    service_cd: str,
    service_session_cd: str,
    service_start: str,
    service_end: str,
) -> dict:
    """
    查詢 eipro 內部的 service_unit API，直接確認該時段在日曆系統中的狀態
    """
    url = "https://eipro.jp/takachiho1/apiServices/api/service_unit"
    data = urllib.parse.urlencode({
        "data[service_cd]": service_cd,
        "data[service_session_cd]": service_session_cd,
        "data[service_start_datetime]": service_start,
        "data[service_end_datetime]": service_end,
    }).encode()

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "User-Agent": USER_AGENT,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            res_json = json.loads(resp.read().decode())
            html_data = res_json.get("data", "")
            icon = "unknown"
            status_desc = "未知狀態"

            if "fa-hourglass" in html_data:
                icon = "hourglass"
                status_desc = "⏳ 未開放 (預約準備中 / 沙漏)"
            elif "fa-times" in html_data:
                icon = "times"
                status_desc = "❌ 已額滿 / 預約結束"
            elif "fa-circle" in html_data:
                icon = "circle"
                status_desc = "⭕ 開放預約中！"
            elif "fa-triangle" in html_data:
                icon = "triangle"
                status_desc = "🔺 剩餘少量席位！"

            # 檢查是否有真正的可點擊預約按鈕 (排除一般說明文字與禁止點擊的按鈕)
            has_order_btn = bool(re.search(
                r'<(?:button|a)[^>]*class=[\'"][^\'"]*(?:front_btn|order_btn)[^\'"]*[\'"][^>]*>(?:(?!click_prohibit|予約終了).)*?(?:予約|申込)',
                html_data,
                re.DOTALL,
            ))

            is_open = icon in ("circle", "triangle") or (icon not in ("hourglass", "times") and has_order_btn)

            return {
                "icon": icon,
                "status_desc": status_desc,
                "is_open": is_open,
                "has_order_button": has_order_btn,
                "html_snippet": html_data[:300].replace("\r", "").replace("\n", " "),
            }
    except Exception as e:
        return {"error": str(e), "is_open": False, "status_desc": f"查詢失敗: {e}"}


class TakachihoScraper:
    def __init__(self, target_url: str = DEFAULT_TARGET_URL, base_dir: Path = None):
        self.target_url = target_url
        self.base_dir = base_dir or Path(__file__).resolve().parent

        # 從目標網址解析出專屬時段標籤 (避免多時段互相覆蓋 baseline)
        self._parse_url_params()

        self.temp_dir = self.base_dir / "temp"
        self.snapshots_dir = self.base_dir / "snapshots"
        self.diffs_dir = self.base_dir / "diffs"

        self.temp_dir.mkdir(parents=True, exist_ok=True)
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)
        self.diffs_dir.mkdir(parents=True, exist_ok=True)

        # 針對不同時段分開存儲 baseline 與 temp
        self.temp_file = self.temp_dir / f"latest_temp_{self.session_tag}.html"
        self.latest_snapshot_file = self.snapshots_dir / f"latest_{self.session_tag}.html"
        self.latest_normalized_file = self.snapshots_dir / f"latest_{self.session_tag}_normalized.txt"
        self.history_log_file = self.base_dir / f"crawl_{self.session_tag}.log"

    def _parse_url_params(self):
        """解析網址參數以提取時段代碼與日曆資訊"""
        parsed = urllib.parse.urlparse(self.target_url)
        q = urllib.parse.parse_qs(parsed.query)

        self.service_cd = q.get("service_cd", ["6892dd9d-5b54-4202-bd1d-4aa6c0a8018d"])[0]
        self.service_session_cd = q.get("service_session_cd", ["68a915a5-d904-4502-8530-9dd8c0a8018d"])[0]
        self.service_start = q.get("service_start_datetime", ["2026/10/24 08:30:00"])[0]
        self.service_end = q.get("service_end_datetime", ["2026/10/24 09:00:00"])[0]

        # 產生簡短唯一的 session tag，例如 20261024_0830
        cleaned_date = self.service_start.replace("/", "").replace(":", "").replace(" ", "_")
        self.session_tag = cleaned_date[:13] if len(cleaned_date) >= 13 else "default"

        # 對應的預約輸入頁網址 (orders/add)
        self.order_url = (
            f"https://eipro.jp/takachiho1/orders/add"
            f"?service_cd={urllib.parse.quote(self.service_cd)}"
            f"&service_session_cd={urllib.parse.quote(self.service_session_cd)}"
            f"&service_start_datetime={urllib.parse.quote(self.service_start)}"
            f"&service_end_datetime={urllib.parse.quote(self.service_end)}"
        )

    def log(self, msg: str):
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{ts}][{self.session_tag}] {msg}"
        print(line)
        try:
            with open(self.history_log_file, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass

    def run_check(self) -> dict:
        """
        執行單次爬取與比對：
        1. 抓取目標頁面並先存至 temp
        2. 正規化後與 baseline 比對
        3. 若有實質差異，永久存檔至 snapshots
        4. 解析所有表單與欄位並輸出
        5. 同步檢測 Slot API，若開放則嘗試存取 orders/add
        """
        now = datetime.now()
        timestamp_str = now.strftime("%Y%m%d_%H%M%S")

        self.log(f"開始抓取目標網頁 ({self.service_start} 船班)...")
        try:
            raw_html = fetch_url(self.target_url)
        except Exception as e:
            self.log(f"[ERROR] 抓取失敗: {e}")
            return {"success": False, "error": str(e)}

        # 1. 先暫存到 temp_file
        with open(self.temp_file, "w", encoding="utf-8") as f:
            f.write(raw_html)
        self.log(f"已暫存至: {self.temp_file.name} ({len(raw_html):,} bytes)")

        # 2. 計算正規化內容
        normalized_content = normalize_html(raw_html)

        # 同步檢查 Slot API
        slot_status = check_slot_api(
            self.service_cd,
            self.service_session_cd,
            self.service_start,
            self.service_end,
        )
        self.log(f"【時段 API 狀態】{slot_status.get('status_desc')}")

        # 3. 比對先前的快照
        has_baseline = self.latest_snapshot_file.exists() and self.latest_normalized_file.exists()
        is_changed = False
        diff_text = ""

        if not has_baseline:
            is_changed = True
            self.log(f"⭐ 第一次執行時段 [{self.session_tag}]，建立初始基準快照...")
        else:
            with open(self.latest_normalized_file, "r", encoding="utf-8") as f:
                prev_normalized = f.read()

            if normalized_content != prev_normalized:
                is_changed = True
                self.log("🚨🚨🚨 偵測到網頁實質內容發生變化！ 🚨🚨🚨")
                sys.stdout.write("\a")
                sys.stdout.flush()

                diff_lines = list(difflib.unified_diff(
                    prev_normalized.splitlines(),
                    normalized_content.splitlines(),
                    fromfile=f"baseline_{self.session_tag}",
                    tofile=f"new_{self.session_tag}_{timestamp_str}",
                    lineterm="",
                    n=3,
                ))
                diff_text = "\n".join(diff_lines[:200])
            else:
                self.log("✅ 比對結果：與先前快照內容一致（無實質變更）。")

        # 4. 若有實質異動（或首次建立），真的存下來
        if is_changed:
            snap_file = self.snapshots_dir / f"snapshot_{self.session_tag}_{timestamp_str}.html"
            with open(snap_file, "w", encoding="utf-8") as f:
                f.write(raw_html)

            # 更新 latest 基準
            with open(self.latest_snapshot_file, "w", encoding="utf-8") as f:
                f.write(raw_html)
            with open(self.latest_normalized_file, "w", encoding="utf-8") as f:
                f.write(normalized_content)

            # 解析表單結構
            parsed = parse_page_details(raw_html)
            parsed["timestamp"] = timestamp_str
            parsed["session_tag"] = self.session_tag
            parsed["target_url"] = self.target_url
            parsed["slot_status"] = slot_status

            parsed_file = self.snapshots_dir / f"snapshot_{self.session_tag}_{timestamp_str}_parsed.json"
            with open(parsed_file, "w", encoding="utf-8") as f:
                json.dump(parsed, f, ensure_ascii=False, indent=2)

            # 存下 diff 報告
            if diff_text:
                diff_file = self.diffs_dir / f"diff_{self.session_tag}_{timestamp_str}.patch"
                with open(diff_file, "w", encoding="utf-8") as f:
                    f.write(diff_text)
                self.log(f"已儲存異動差異: {diff_file.name}")
                print("\n=== 異動摘要 (前 25 行) ===")
                for line in diff_lines[:25]:
                    print(line)
                print("===========================\n")

            self.log(f"💾 已永久存檔: {snap_file.name}")
            self.log(f"📋 已儲存表單結構解析: {parsed_file.name}")
            self._print_form_summary(parsed)

        # 5. 若 API 顯示已開放，額外嘗試抓取預約輸入表單頁面 (orders/add)
        if slot_status.get("is_open"):
            self.log("🎉 時段已開放預約！嘗試抓取預約輸入表單 (orders/add)...")
            self._fetch_order_page(timestamp_str)

        return {
            "success": True,
            "is_changed": is_changed,
            "timestamp": timestamp_str,
            "slot_status": slot_status,
        }

    def _fetch_order_page(self, timestamp_str: str):
        """當開放時，抓取實際訂購頁面 orders/add 並解析"""
        try:
            order_html = fetch_url(self.order_url)
            order_snap = self.snapshots_dir / f"order_form_{self.session_tag}_{timestamp_str}.html"
            with open(order_snap, "w", encoding="utf-8") as f:
                f.write(order_html)
            self.log(f"💾 已存下預約表單原始檔: {order_snap.name}")

            order_parsed = parse_page_details(order_html)
            order_parsed_file = self.snapshots_dir / f"order_form_{self.session_tag}_{timestamp_str}_parsed.json"
            with open(order_parsed_file, "w", encoding="utf-8") as f:
                json.dump(order_parsed, f, ensure_ascii=False, indent=2)
            self.log(f"📋 已存下預約表單結構: {order_parsed_file.name}")
            self._print_form_summary(order_parsed)
        except Exception as e:
            self.log(f"[WARN] 抓取 orders/add 失敗: {e}")

    def _print_form_summary(self, parsed: dict):
        """印出清晰易讀的表單欄位摘要"""
        print("\n" + "=" * 55)
        print(f"    【表單結構摘要 - {self.session_tag}】")
        print("=" * 55)
        print(f"• 表單總數: {parsed['forms_count']}")
        print(f"• 輸入欄位總數: {parsed['all_inputs_count']}")
        print(f"• 關鍵/有效欄位數: {len(parsed['meaningful_inputs'])}")
        print("-" * 55)
        for i, inp in enumerate(parsed["meaningful_inputs"], 1):
            tag = inp.get("tag", "input")
            itype = inp.get("type", "")
            name = inp.get("name", "")
            iid = inp.get("id", "")
            val = inp.get("value", "")
            val_str = f" [預設值: {val}]" if val else ""
            print(f"  {i}. <{tag} type='{itype}'> name='{name}' id='{iid}'{val_str}")
        print("=" * 55 + "\n")

    def start_loop(self, interval: int = 5, stop_after_change: bool = False, max_runtime: int = 0):
        """
        定時輪詢監控
        :param interval: 每次輪詢間隔 (秒)
        :param stop_after_change: 發現實質異動並存檔後自動結束
        :param max_runtime: 最長執行時間 (秒)，0 為不限制
        """
        start_time = time.time()
        max_desc = f"，最長執行 {max_runtime} 秒" if max_runtime > 0 else ""
        self.log(f"開始定時監控 (每 {interval} 秒檢查一次{max_desc}，按 Ctrl+C 結束)...")

        try:
            first_run = True
            while True:
                # 檢查是否超過最長執行時間
                if max_runtime > 0 and (time.time() - start_time) >= max_runtime:
                    self.log(f"已達最長執行時間 ({max_runtime} 秒)，結束監控。")
                    break

                res = self.run_check()

                # 如果不是首次執行，且發現實質變化
                if not first_run and stop_after_change and res.get("is_changed"):
                    self.log("偵測到網頁異動且已完成存檔，停止監控。")
                    break

                first_run = False
                time.sleep(interval)
        except KeyboardInterrupt:
            self.log("\n使用者終止監控。")


def wait_until_target_time(target_time_str: str):
    """等待直到指定時間 (格式 HH:MM:SS 或 YYYY-MM-DD HH:MM:SS)"""
    now = datetime.now()
    if ":" in target_time_str and len(target_time_str) <= 8:
        parts = [int(p) for p in target_time_str.split(":")]
        target_dt = now.replace(hour=parts[0], minute=parts[1], second=parts[2] if len(parts) > 2 else 0, microsecond=0)
        if target_dt < now:
            print(f"[提示] 指定時間 {target_dt} 已過，立即開始執行。")
            return
    else:
        target_dt = datetime.strptime(target_time_str, "%Y-%m-%d %H:%M:%S")

    wait_seconds = (target_dt - datetime.now()).total_seconds()
    if wait_seconds > 0:
        print(f"倒數計時中：將於 {target_dt.strftime('%Y-%m-%d %H:%M:%S')} 自動啟動監控 (尚餘 {int(wait_seconds)} 秒)...")
        time.sleep(wait_seconds)
        print(f"時間到達！開始執行爬蟲監控...")


def main():
    parser = argparse.ArgumentParser(
        description="高千穂峡貸しボート 預約頁面爬蟲與異動比對器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--url", default=DEFAULT_TARGET_URL, help="目標網址")
    parser.add_argument("--once", action="store_true", help="只執行一次抓取與比對後結束")
    parser.add_argument("--interval", type=int, default=5, help="輪詢檢查間隔秒數 (預設: 5 秒)")
    parser.add_argument("--stop-on-change", action="store_true", help="當發現實質異動並存檔後自動停止")
    parser.add_argument("--max-runtime", type=int, default=0, help="最長執行時間 (秒)，0 表示無限制")
    parser.add_argument("--status", action="store_true", help="僅查詢目前時段 API 開放狀態")
    parser.add_argument("--start-at", type=str, default="", help="預約啟動時間 (格式: 07:59:50)")

    args = parser.parse_args()

    scraper = TakachihoScraper(target_url=args.url)

    if args.status:
        st = check_slot_api(
            scraper.service_cd,
            scraper.service_session_cd,
            scraper.service_start,
            scraper.service_end,
        )
        print(f"\n時段 [{scraper.session_tag}] 狀態查詢結果:")
        print(json.dumps(st, ensure_ascii=False, indent=2))
        return

    if args.start_at:
        wait_until_target_time(args.start_at)

    if args.once:
        scraper.run_check()
    else:
        scraper.start_loop(
            interval=args.interval,
            stop_after_change=args.stop_on_change,
            max_runtime=args.max_runtime,
        )


if __name__ == "__main__":
    main()
