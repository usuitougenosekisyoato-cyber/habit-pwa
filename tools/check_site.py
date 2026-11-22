"""公開(push)の前に実行する確認スクリプト。Python 標準ライブラリだけで動きます。

使い方(habit-tracker フォルダで):
    python tools/check_site.py

確かめること:
  1. 載せない情報 … メールアドレス、電話番号、郵便番号・住所らしいもの、
     手元のパソコンのパス(C:\\Users\\… など)、トークンや秘密鍵らしい文字列
  2. 大文字小文字の違い … HTML / manifest / JS が参照するファイル名が、
     大文字小文字まで実物と一致しているか(Windows では開けても、公開先では 404 になる)

見つかったものを「要確認」として表示し、最後に件数を出します。0 件なら終了コード 0。
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SELF = Path(__file__).resolve()
SKIP_DIRS = {".git", "node_modules", "__pycache__"}
TEXT_EXT = {".html", ".css", ".js", ".mjs", ".json", ".webmanifest", ".md", ".svg", ".txt", ".py", ".yml", ".yaml"}

# 1. 載せない情報(見つけたら要確認)
SENSITIVE = [
    ("メールアドレス", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
    ("電話番号らしいもの", re.compile(r"(?<![\d-])0\d{1,4}-\d{1,4}-\d{3,4}(?![\d-])")),
    ("郵便番号らしいもの", re.compile(r"〒\s*\d{3}-?\d{4}|(?<![\d-])\d{3}-\d{4}(?![\d-])")),
    ("住所らしいもの", re.compile(r"[一-龥]{1,3}[都道府県][一-龥ぁ-んァ-ン]{1,8}[市区町村郡][一-龥ぁ-んァ-ン0-9０-９]{0,10}[0-9０-９]+(?:丁目|番地?|号|-)")),
    ("手元のパソコンのパス", re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+|/Users/[^/\s]+/|/home/[^/\s]+/")),
    ("トークン・鍵らしいもの", re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----")),
]

# 2. 参照しているファイル名
REF_PATTERNS = {
    ".html": re.compile(r"""(?:href|src)\s*=\s*["']([^"'#?]+)"""),
    ".js": re.compile(r"""(?:from\s+|import\s*\(\s*|register\(\s*)["'](\.{1,2}/[^"'?#]+)["']"""),
}


def iter_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            yield Path(dirpath) / name


def rel(p: Path) -> str:
    return p.relative_to(ROOT).as_posix()


def exact_case_exists(base: Path, ref: str) -> bool:
    """ref(相対パス)が、大文字小文字まで一致して存在するか"""
    current = base
    for part in Path(ref).parts:
        if part in ("", "."):
            continue
        if part == "..":
            current = current.parent
            continue
        try:
            names = os.listdir(current)
        except OSError:
            return False
        if part not in names:
            return False
        current = current / part
    return True


def is_local_ref(ref: str) -> bool:
    return not re.match(r"^[a-z][a-z0-9+.-]*:|^//", ref, re.I)


def main() -> int:
    findings: list[str] = []

    for path in iter_files():
        if path.suffix.lower() not in TEXT_EXT:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")

        # 1. 載せない情報(このスクリプト自身は検索パターンを含むので除く)
        if path.resolve() != SELF:
            for lineno, line in enumerate(text.splitlines(), 1):
                for label, pattern in SENSITIVE:
                    for m in pattern.finditer(line):
                        findings.append(f"[載せない情報] {rel(path)}:{lineno} {label}: {m.group(0)}")

        # 2. 参照しているファイル名(大文字小文字まで)
        refs: list[str] = []
        suffix = path.suffix.lower()
        if suffix in REF_PATTERNS:
            refs += REF_PATTERNS[suffix].findall(text)
        if suffix == ".webmanifest":
            data = json.loads(text)
            refs += [icon["src"] for icon in data.get("icons", [])]
        if path.name == "sw.js":
            m = re.search(r"const APP_FILES = \[([\s\S]*?)\];", text)
            if m:
                refs += re.findall(r"'([^']+)'", m.group(1))
        for ref in refs:
            if not is_local_ref(ref) or ref in ("./", "/"):
                continue
            if not exact_case_exists(path.parent, ref):
                findings.append(f"[ファイル名] {rel(path)} が参照する「{ref}」が見つかりません(大文字小文字の違いを含む)")

    for f in findings:
        print(f)
    print(f"要確認 {len(findings)} 件")
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
