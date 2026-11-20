"""Index des mouvements publics de GOWOD (https://www.gowod.app/fr/mobility-exercises)
et des vidéos de leur chaîne YouTube (@gowod_mobilityfirst).

On garde uniquement : nom, zones, matériel, adresse de la fiche et identifiant de la
vidéo YouTube (lue avec le lecteur YouTube intégré). Aucun texte ni aucune vidéo copiés.
Lancé à la main par le workflow « Index GOWOD ».
"""

from __future__ import annotations

import html
import json
import re
import subprocess
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT_MOVES = ROOT / "scripts" / "vendor" / "gowod-movements.json"
OUT_YT = ROOT / "scripts" / "vendor" / "gowod-youtube.json"
BASE = "https://www.gowod.app"
UA = {"User-Agent": "Mozilla/5.0 (hybrid-forge personal training app; one-off index)"}

CARD = re.compile(r'href="(?:https://www\.gowod\.app)?/fr/mobility-exercises/([a-z0-9-]+)"', re.I)
YT = [
    re.compile(r'youtube(?:-nocookie)?\.com/embed/([\w-]{11})'),
    re.compile(r'youtu\.be/([\w-]{11})'),
    re.compile(r'youtube\.com/watch\?v=([\w-]{11})'),
    re.compile(r'data-(?:video-id|youtube-id|yt-id)="([\w-]{11})"'),
    re.compile(r'img\.youtube\.com/vi/([\w-]{11})'),
    re.compile(r'i\.ytimg\.com/vi/([\w-]{11})'),
]
TITLE = re.compile(r'<h1[^>]*>(.*?)</h1>', re.S | re.I)
TAG = re.compile(r'<div[^>]*class="[^"]*(?:tag|pill|chip|badge)[^"]*"[^>]*>(.*?)</div>', re.S | re.I)

ZONES = {"Hanches", "Fessiers", "Adducteurs", "Ischio-jambiers", "Mollets", "Chevilles", "Épaules", "Dorsaux", "Lombaire",
         "Trapèzes", "Pectoraux", "Quadriceps", "Poignets", "Cou", "Thoracique", "Fléchisseurs", "Abdominaux", "Avant-bras",
         "Biceps", "Triceps", "Pieds", "Genoux", "Colonne"}
EQUIP = {"Sans équipement", "Bande", "Rouleau de massage", "Balle de massage", "Barre", "Haltère", "Kettlebell", "Mur",
         "Banc", "Box", "Bâton", "Chaise", "Élastique", "Rack"}


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


LIST_TAGS: dict[str, tuple[list[str], list[str]]] = {}


def card_tags(body: str) -> None:
    """Zones et matériel affichés sur chaque carte de la liste (plus fiables que la page détail)."""
    pos = [(m.start(), m.group(1)) for m in CARD.finditer(body)]
    for i, (start, slug) in enumerate(pos):
        end = pos[i + 1][0] if i + 1 < len(pos) else min(len(body), start + 6000)
        seg = {clean(x) for x in re.findall(r">\s*([^<>]{3,30}?)\s*<", body[start:end])}
        z = sorted(x for x in ZONES if x in seg)
        e = sorted(x for x in EQUIP if x in seg)
        if z and slug not in LIST_TAGS:
            LIST_TAGS[slug] = (z, e)


def list_slugs() -> list[str]:
    slugs: list[str] = []
    for page in range(1, 20):
        url = f"{BASE}/fr/mobility-exercises" + (f"?a58601f4_page={page}" if page > 1 else "")
        body = requests.get(url, headers=UA, timeout=30).text
        card_tags(body)
        new = [s for s in dict.fromkeys(CARD.findall(body)) if s not in slugs]
        if not new:
            break
        slugs += new
        time.sleep(1)
    return slugs


def movement(slug: str) -> dict:
    url = f"{BASE}/fr/mobility-exercises/{slug}"
    body = requests.get(url, headers=UA, timeout=30).text
    vid = next((m.group(1) for rx in YT for m in [rx.search(body)] if m), None)
    t = TITLE.search(body)
    texts = {clean(x) for x in TAG.findall(body)}
    words = set(re.findall(r">\s*([^<>]{3,30}?)\s*<", body))
    found = {clean(w) for w in words}
    if slug in LIST_TAGS:
        zones, equip = LIST_TAGS[slug]
    else:
        zones = sorted(z for z in ZONES if z in found or z in texts)
        equip = sorted(e for e in EQUIP if e in found or e in texts)
    return {
        "slug": slug,
        "name": clean(t.group(1)) if t else slug.replace("-", " ").title(),
        "zones": zones,
        "equipment": equip,
        "url": url,
        "youtube": vid,
    }


def youtube_channel() -> list[dict]:
    try:
        out = subprocess.run(
            ["yt-dlp", "--flat-playlist", "-J", "https://www.youtube.com/@gowod_mobilityfirst/videos"],
            capture_output=True, text=True, timeout=600, check=True,
        ).stdout
        data = json.loads(out)
        return [{"id": e["id"], "title": e.get("title"), "duration": e.get("duration")} for e in data.get("entries", []) if e.get("id")]
    except Exception as e:  # noqa: BLE001
        print(f"chaîne YouTube inaccessible : {e}")
        return []


def main() -> None:
    slugs = list_slugs()
    print(f"{len(slugs)} mouvements GOWOD publics")
    moves = []
    for s in slugs:
        try:
            m = movement(s)
            moves.append(m)
            print(f"  {'✓' if m['youtube'] else '–'} {m['name']}  {m['zones']}  {m['equipment']}")
        except requests.RequestException as e:
            print(f"  ! {s} : {e}")
        time.sleep(1)
    OUT_MOVES.parent.mkdir(parents=True, exist_ok=True)
    OUT_MOVES.write_text(json.dumps(moves, ensure_ascii=False, indent=1))
    vids = youtube_channel()
    OUT_YT.write_text(json.dumps(vids, ensure_ascii=False, indent=1))
    print(f"{sum(1 for m in moves if m['youtube'])}/{len(moves)} avec vidéo ; chaîne YouTube : {len(vids)} vidéos")


if __name__ == "__main__":
    main()
