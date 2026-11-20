"""Récupère la liste des mouvements de https://www.crossfit.com/crossfit-movements
et, pour chacun, l'identifiant de sa vidéo YouTube (lecteur intégré officiel).

Ne copie aucune vidéo : on garde le nom, l'adresse de la page et l'ID YouTube.
Lancé à la main par le workflow « Vidéos CrossFit ». Résultat : scripts/vendor/crossfit-movements.json
"""

from __future__ import annotations

import html
import json
import re
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "vendor" / "crossfit-movements.json"
BASE = "https://www.crossfit.com"
UA = {"User-Agent": "Mozilla/5.0 (hybrid-forge personal training app; one-off index of movement videos)"}

LINK = re.compile(r'<a[^>]+href="(?:https://www\.crossfit\.com)?/essentials/([a-z0-9-]+)"[^>]*>(.*?)</a>', re.S | re.I)
YT = [
    re.compile(r'youtube(?:-nocookie)?\.com/embed/([\w-]{11})'),
    re.compile(r'youtu\.be/([\w-]{11})'),
    re.compile(r'youtube\.com/watch\?v=([\w-]{11})'),
    re.compile(r'"videoId"\s*:\s*"([\w-]{11})"'),
]
TITLE = re.compile(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', re.I)


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def main() -> None:
    page = requests.get(f"{BASE}/crossfit-movements", headers=UA, timeout=30).text
    found: dict[str, str] = {}
    for slug, text in LINK.findall(page):
        name = clean(text)
        if name and slug not in found:
            found[slug] = name
    print(f"{len(found)} mouvements dans la liste")
    out = []
    for slug, name in sorted(found.items()):
        url = f"{BASE}/essentials/{slug}"
        try:
            body = requests.get(url, headers=UA, timeout=30).text
        except requests.RequestException as e:
            print(f"  ! {slug} : {e}")
            continue
        vid = next((m.group(1) for rx in YT for m in [rx.search(body)] if m), None)
        t = TITLE.search(body)
        out.append({"slug": slug, "name": re.sub(r"^The\s+", "", clean(t.group(1)) if t else name).strip(), "url": url, "youtube": vid})
        print(f"  {'✓' if vid else '–'} {slug}")
        time.sleep(1)  # sans brusquer le site
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"{sum(1 for x in out if x['youtube'])}/{len(out)} avec vidéo")


if __name__ == "__main__":
    main()
