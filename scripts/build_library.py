"""Construit src/data/library.json : la bibliothèque de mouvements d'Hybrid Forge.

Sources :
  - free-exercise-db (Unlicense) : ~870 mouvements avec muscles, matériel, consignes, images
  - catalogue Garmin Connect (1 527 exercices muscu) via python-garminconnect (MIT)

Pour chaque mouvement, calcule l'équivalent Garmin le plus proche (score 0-100)
et 2 alternatives. Les exercices Garmin sans équivalent dans free-exercise-db
sont ajoutés tels quels, déjà reliés à eux-mêmes (score 100).

Usage : python scripts/build_library.py
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEDB = json.loads((ROOT / "scripts/vendor/free-exercise-db.json").read_text())
GARMIN = json.loads((ROOT / "src/data/garmin-exercises.json").read_text())
IMG_BASE = "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/"

# ---------------------------------------------------------------- normalisation

SYN = [
    (r"\bdumbbells?\b|\bdb\b", "dumbbell"), (r"\bbarbells?\b|\bbb\b", "barbell"),
    (r"\bkettlebells?\b|\bkb\b", "kettlebell"), (r"\bpull ?ups?\b|\bpullups?\b", "pullup"),
    (r"\bchin ?ups?\b|\bchins\b", "chinup"), (r"\bpush ?ups?\b|\bpushups?\b", "pushup"),
    (r"\bsit ?ups?\b", "situp"), (r"\bstep ?ups?\b", "stepup"), (r"\bt ?bar\b", "tbar"),
    (r"\bez ?(curl )?bar\b", "ezbar"), (r"\btrx\b|\bsuspended\b|\bsuspension\b", "suspension"),
    (r"\bmedicine ball\b|\bmed ball\b", "medball"), (r"\bswiss ball\b|\bstability ball\b|\bexercise ball\b", "swissball"),
    (r"\bbands?\b|\bbanded\b", "band"), (r"\bflyes?\b|\bflys?\b", "fly"), (r"\bcrunches\b", "crunch"),
    (r"\bsquats\b", "squat"), (r"\blunges\b", "lunge"), (r"\brows\b|\browing\b", "row"),
    (r"\bcurls\b", "curl"), (r"\braises\b", "raise"), (r"\bpresses\b", "press"), (r"\bdips\b", "dip"),
    (r"\bshrugs\b", "shrug"), (r"\bextensions\b", "extension"), (r"\bstretches\b|\bstretching\b", "stretch"),
    (r"\bthrusters\b", "thruster"), (r"\bswings\b", "swing"), (r"\bjumps\b", "jump"),
    (r"\bhyperextensions\b", "hyperextension"), (r"\btriceps\b|\btricep\b", "triceps"),
    (r"\bbiceps\b|\bbicep\b", "biceps"), (r"\bpulldowns?\b|\bpull downs?\b", "pulldown"),
    (r"\bdeadlifts?\b", "deadlift"), (r"\brdl\b", "romanian deadlift"), (r"\bmilitary press\b", "overhead press"),
    (r"\bdumbell\b", "dumbbell"), (r"\bsingle arm\b|\bone arm\b", "singlearm"), (r"\bsingle leg\b|\bone leg\b", "singleleg"),
]
STOP = {"with", "the", "to", "on", "and", "of", "a", "an", "in", "s", "your", "it", "at", "from", "or", "version", "progression", "exercise", "position"}
EQUIP_TOKENS = {
    "barbell": "barre", "dumbbell": "haltères", "kettlebell": "kettlebell", "cable": "poulie",
    "band": "élastique", "suspension": "TRX", "medball": "medicine ball", "swissball": "swiss ball",
    "ezbar": "barre EZ", "sandbag": "sandbag", "machine": "machine", "smith": "machine", "sled": "traîneau",
    "rope": "corde", "box": "box", "bench": "banc", "ring": "anneaux", "landmine": "landmine",
}
FEDB_EQUIP = {
    "barbell": "barbell", "dumbbell": "dumbbell", "kettlebells": "kettlebell", "cable": "cable",
    "bands": "band", "medicine ball": "medball", "exercise ball": "swissball", "e-z curl bar": "ezbar",
    "machine": "machine", "body only": "body", "foam roll": "foamroll", "other": "other",
}
MY_EQUIP = {"barbell", "dumbbell", "kettlebell", "cable", "band", "suspension", "medball", "ezbar", "body", "box", "bench", "rope", "foamroll", "other", "landmine", "swissball"}


def norm(name: str) -> str:
    s = name.lower().replace("-", " ").replace("’", "'").replace("'", "")
    s = re.sub(r"[^a-z0-9/ ]", " ", s)
    for pat, rep in SYN:
        s = re.sub(pat, rep, s)
    return re.sub(r"\s+", " ", s).strip()


def tokens(name: str) -> list[str]:
    return [t for t in norm(name).split() if t not in STOP]


def equipment_of(toks: list[str]) -> set[str]:
    return {t for t in toks if t in EQUIP_TOKENS}


# ---------------------------------------------------------------- traduction FR

# (anglais normalisé, français, rôle) : rôle "m" = mouvement (tête), "q" = qualificatif
PHRASES: list[tuple[str, str, str]] = [
    ("romanian deadlift", "soulevé de terre roumain", "m"), ("stiff legged deadlift", "soulevé de terre jambes tendues", "m"),
    ("sumo deadlift", "soulevé de terre sumo", "m"), ("deadlift", "soulevé de terre", "m"),
    ("bench press", "développé couché", "m"), ("floor press", "développé au sol", "m"),
    ("overhead press", "développé militaire", "m"), ("shoulder press", "développé épaules", "m"),
    ("push press", "push press", "m"), ("arnold press", "développé Arnold", "m"), ("leg press", "presse à cuisses", "m"),
    ("front squat", "front squat", "m"), ("back squat", "back squat", "m"), ("overhead squat", "squat bras tendus", "m"),
    ("goblet squat", "goblet squat", "m"), ("split squat", "squat bulgare", "m"), ("pistol squat", "pistol squat", "m"),
    ("hack squat", "hack squat", "m"), ("squat", "squat", "m"),
    ("good morning", "good morning", "m"), ("hip thrust", "hip thrust", "m"), ("glute bridge", "pont fessier", "m"),
    ("power clean", "power clean", "m"), ("hang clean", "hang clean", "m"), ("clean and jerk", "épaulé-jeté", "m"),
    ("clean", "épaulé", "m"), ("push jerk", "push jerk", "m"), ("split jerk", "split jerk", "m"), ("jerk", "jeté", "m"),
    ("power snatch", "power snatch", "m"), ("snatch", "arraché", "m"), ("thruster", "thruster", "m"),
    ("wall ball", "wall ball", "m"), ("kettlebell swing", "swing kettlebell", "m"), ("swing", "swing", "m"),
    ("turkish get up", "turkish get-up", "m"), ("windmill", "windmill", "m"),
    ("bent over row", "rowing buste penché", "m"), ("upright row", "tirage menton", "m"), ("inverted row", "rowing inversé", "m"),
    ("renegade row", "renegade row", "m"), ("row", "rowing", "m"),
    ("lat pulldown", "tirage vertical", "m"), ("pulldown", "tirage vertical", "m"), ("face pull", "face pull", "m"),
    ("pullover", "pull-over", "m"), ("pullup", "traction", "m"), ("chinup", "traction supination", "m"),
    ("muscle up", "muscle-up", "m"), ("pushup", "pompe", "m"), ("dip", "dips", "m"),
    ("hammer curl", "curl marteau", "m"), ("preacher curl", "curl pupitre", "m"), ("concentration curl", "curl concentré", "m"),
    ("leg curl", "leg curl", "m"), ("curl", "curl", "m"),
    ("triceps extension", "extension triceps", "m"), ("skull crusher", "barre au front", "m"), ("pushdown", "extension triceps poulie", "m"),
    ("kickback", "kickback", "m"), ("leg extension", "leg extension", "m"), ("back extension", "extension lombaire", "m"),
    ("hyperextension", "hyperextension", "m"), ("extension", "extension", "m"),
    ("lateral raise", "élévation latérale", "m"), ("front raise", "élévation frontale", "m"), ("calf raise", "mollets", "m"),
    ("knee raise", "relevé de genoux", "m"), ("leg raise", "relevé de jambes", "m"), ("raise", "élévation", "m"),
    ("fly", "écarté", "m"), ("shrug", "shrug", "m"), ("lunge", "fente", "m"), ("stepup", "step-up", "m"),
    ("box jump", "box jump", "m"), ("broad jump", "saut en longueur", "m"), ("jump", "saut", "m"),
    ("burpee", "burpee", "m"), ("mountain climber", "mountain climber", "m"), ("jumping jack", "jumping jack", "m"),
    ("situp", "sit-up", "m"), ("v up", "v-up", "m"), ("crunch", "crunch", "m"), ("side plank", "planche latérale", "m"),
    ("plank", "planche", "m"), ("rollout", "roll-out", "m"), ("ab roller", "roue abdominale", "m"), ("dead bug", "dead bug", "m"),
    ("russian twist", "russian twist", "m"), ("twist", "rotation", "m"), ("chop", "chop", "m"), ("pallof press", "pallof press", "m"),
    ("bird dog", "bird dog", "m"), ("superman", "superman", "m"), ("bear crawl", "marche de l'ours", "m"),
    ("inchworm", "inchworm", "m"), ("farmers walk", "marche du fermier", "m"), ("farmers carry", "marche du fermier", "m"),
    ("carry", "porté", "m"), ("press", "développé", "m"), ("bridge", "pont", "m"), ("toes to bar", "toes to bar", "m"),
    ("double under", "double unders", "m"), ("jump rope", "corde à sauter", "m"), ("handstand pushup", "pompe en équilibre", "m"),
    ("handstand", "équilibre sur les mains", "m"), ("wall walk", "wall walk", "m"), ("arm circles", "cercles de bras", "m"),
    ("leg swings", "balancés de jambe", "m"), ("cat cow", "chat-vache", "m"), ("childs pose", "posture de l'enfant", "m"),
    ("90/90", "90/90", "m"), ("pigeon", "pigeon", "m"), ("worlds greatest stretch", "world's greatest stretch", "m"),
    ("stretch", "étirement", "m"), ("smr", "auto-massage", "m"), ("hip circles", "cercles de hanches", "m"),
    ("rack pull", "rack pull", "m"), ("slam", "slam", "m"), ("medicine ball slam", "slam medicine ball", "m"),
    ("wrist curl", "curl poignets", "m"), ("knee to chest", "genou-poitrine", "m"), ("pelvic tilt", "bascule du bassin", "m"),
    ("tuck", "tuck", "m"), ("tucks", "tuck", "m"), ("hops", "sauts", "m"), ("hop", "saut", "m"), ("skater", "skater", "m"),
    ("sprint", "sprint", "m"), ("bound", "bonds", "m"), ("ladder", "échelle", "m"), ("shuffle", "pas chassés", "m"),
    ("scapular pullup", "traction scapulaire", "m"), ("scapular retraction", "rétraction scapulaire", "m"),
    ("hollow hold", "hollow hold", "m"), ("hollow rock", "hollow rock", "m"), ("l sit", "L-sit", "m"), ("sprawl", "sprawl", "m"),
    ("bear", "ours", "q"), ("palms down", "paumes vers le bas", "q"), ("palms up", "paumes vers le haut", "q"),
    ("partial", "partiel", "q"), ("deficit", "déficit", "q"), ("pause", "pause", "q"), ("paused", "avec pause", "q"),
    ("supination", "supination", "q"), ("pronation", "pronation", "q"), ("cross body", "croisé", "q"), ("crossover", "croisé", "q"),
    ("diagonal", "diagonal", "q"), ("rotational", "rotatif", "q"), ("rotation", "rotation", "q"), ("prone", "ventral", "q"),
    ("supine", "dorsal", "q"), ("quadruped", "quadrupédie", "q"), ("plyo", "pliométrique", "q"), ("plyometric", "pliométrique", "q"),
    ("touch", "touche", "q"), ("hold", "maintien", "q"), ("slide", "glissé", "q"), ("sliding", "glissé", "q"), ("discs", "disques", "q"),
    ("mid", "milieu", "q"), ("upper", "haut", "q"), ("lower", "bas", "q"), ("outer", "extérieur", "q"), ("inner", "intérieur", "q"),
    ("wall", "mur", "q"), ("chair", "chaise", "q"), ("forward", "avant", "q"), ("backward", "arrière", "q"), ("back", "dos", "q"),
    # qualificatifs
    ("singlearm", "un bras", "q"), ("singleleg", "une jambe", "q"), ("alternating", "alterné", "q"), ("alternate", "alterné", "q"),
    ("seated", "assis", "q"), ("standing", "debout", "q"), ("lying", "allongé", "q"), ("kneeling", "à genoux", "q"),
    ("incline", "incliné", "q"), ("decline", "décliné", "q"), ("close grip", "prise serrée", "q"), ("wide grip", "prise large", "q"),
    ("reverse grip", "prise inversée", "q"), ("neutral grip", "prise neutre", "q"), ("underhand", "supination", "q"),
    ("overhead", "au-dessus de la tête", "q"), ("reverse", "inversé", "q"), ("weighted", "lesté", "q"), ("hanging", "suspendu", "q"),
    ("bent over", "buste penché", "q"), ("bent knee", "jambes fléchies", "q"), ("straight leg", "jambes tendues", "q"),
    ("hang", "hang", "q"), ("power", "power", "q"), ("sumo", "sumo", "q"), ("front", "avant", "q"), ("side", "latéral", "q"),
    ("lateral", "latéral", "q"), ("rear delt", "deltoïde arrière", "q"), ("rear", "arrière", "q"), ("walking", "marché", "q"),
    ("jumping", "sauté", "q"), ("explosive", "explosif", "q"), ("isometric", "isométrique", "q"), ("assisted", "assisté", "q"),
    ("floor", "au sol", "q"), ("elevated", "surélevé", "q"), ("feet elevated", "pieds surélevés", "q"), ("tempo", "tempo", "q"),
    ("hip", "hanches", "q"), ("hamstring", "ischios", "q"), ("hamstrings", "ischios", "q"), ("quad", "quadriceps", "q"),
    ("quadriceps", "quadriceps", "q"), ("glute", "fessiers", "q"), ("chest", "pectoraux", "q"), ("shoulder", "épaules", "q"),
    ("shoulders", "épaules", "q"), ("calf", "mollets", "q"), ("calves", "mollets", "q"), ("triceps", "triceps", "q"),
    ("biceps", "biceps", "q"), ("lat", "grand dorsal", "q"), ("lats", "grand dorsal", "q"), ("neck", "nuque", "q"),
    ("wrist", "poignets", "q"), ("ankle", "chevilles", "q"), ("groin", "adducteurs", "q"), ("adductor", "adducteurs", "q"),
    ("abductor", "abducteurs", "q"), ("hip flexor", "fléchisseurs de hanche", "q"), ("piriformis", "piriforme", "q"),
    ("it band", "bandelette ilio-tibiale", "q"), ("lower back", "bas du dos", "q"), ("upper back", "haut du dos", "q"),
    ("thoracic", "thoracique", "q"), ("spinal", "colonne", "q"), ("abs", "abdos", "q"), ("oblique", "obliques", "q"),
    ("full body", "corps entier", "q"), ("static", "statique", "q"), ("dynamic", "dynamique", "q"),
    ("knee", "genou", "q"), ("knees", "genoux", "q"), ("arm", "bras", "q"), ("arms", "bras", "q"), ("leg", "jambe", "q"),
    ("legs", "jambes", "q"), ("one", "un", "q"), ("two", "deux", "q"), ("double", "double", "q"), ("high", "haut", "q"),
    ("low", "bas", "q"), ("up", "", "q"), ("down", "", "q"), ("out", "", "q"), ("over", "", "q"),
]
PHRASES.sort(key=lambda p: -len(p[0]))
EQUIP_FR_SUFFIX = {
    "barbell": "barre", "dumbbell": "haltères", "kettlebell": "kettlebell", "cable": "poulie", "band": "élastique",
    "suspension": "TRX", "medball": "medicine ball", "swissball": "swiss ball", "ezbar": "barre EZ",
    "sandbag": "sandbag", "machine": "machine", "smith": "Smith machine", "landmine": "landmine", "ring": "anneaux",
}


def translate(name: str) -> str | None:
    """Traduction par lexique. Renvoie None si un mot n'est pas reconnu (on garde l'anglais)."""
    s = f" {norm(name)} "
    heads, quals, equip = [], [], []
    for t in list(EQUIP_FR_SUFFIX):
        if f" {t} " in s:
            equip.append(EQUIP_FR_SUFFIX[t])
            s = s.replace(f" {t} ", " ")
    for en, fr, role in PHRASES:
        while f" {en} " in s:
            (heads if role == "m" else quals).append(fr)
            s = s.replace(f" {en} ", " ", 1)
    rest = [t for t in s.split() if t not in STOP and t not in {"bench", "box", "rope", "bar", "body", "only", "plate", "ball", "with"}]
    if rest or not heads:
        return None
    parts = [heads[0]] + heads[1:] + [q for q in quals if q] + equip
    out = " ".join(dict.fromkeys(parts))
    return out[0].upper() + out[1:]


MUSCLES_FR = {
    "abdominals": "Abdominaux", "abductors": "Abducteurs", "adductors": "Adducteurs", "biceps": "Biceps",
    "calves": "Mollets", "chest": "Pectoraux", "forearms": "Avant-bras", "glutes": "Fessiers", "hamstrings": "Ischios",
    "lats": "Grand dorsal", "lower back": "Lombaires", "middle back": "Milieu du dos", "neck": "Cou",
    "quadriceps": "Quadriceps", "shoulders": "Épaules", "traps": "Trapèzes", "triceps": "Triceps",
}
CAT_FEDB = {
    "strength": "muscu", "powerlifting": "muscu", "strongman": "muscu", "olympic weightlifting": "halto",
    "plyometrics": "plyo", "cardio": "cardio", "stretching": "mobilite",
}
GARMIN_CAT = {
    "WARM_UP": "mobilite", "HIP_STABILITY": "mobilite", "SHOULDER_STABILITY": "mobilite", "OLYMPIC_LIFT": "halto",
    "PLYO": "plyo", "CARDIO": "cardio", "RUN": "cardio", "RUN_INDOOR": "cardio", "INDOOR_BIKE": "cardio",
    "BIKE_OUTDOOR": "cardio", "ELLIPTICAL": "cardio", "STAIR_STEPPER": "cardio", "FLOOR_CLIMB": "cardio",
    "BATTLE_ROPE": "cardio", "LADDER": "cardio", "TOTAL_BODY": "wod", "SLED": "wod", "SLEDGE_HAMMER": "wod", "TIRE": "wod",
    "SANDBAG": "wod", "CORE": "gainage", "PLANK": "gainage", "CRUNCH": "gainage", "SIT_UP": "gainage", "LEG_RAISE": "gainage",
    "CHOP": "gainage", "HYPEREXTENSION": "gainage",
}
GARMIN_MUSCLES = {
    "BENCH_PRESS": ["chest", "triceps"], "SHOULDER_PRESS": ["shoulders", "triceps"], "LATERAL_RAISE": ["shoulders"],
    "ROW": ["middle back", "lats"], "PULL_UP": ["lats", "biceps"], "CURL": ["biceps"], "TRICEPS_EXTENSION": ["triceps"],
    "SQUAT": ["quadriceps", "glutes"], "LUNGE": ["quadriceps", "glutes"], "DEADLIFT": ["hamstrings", "lower back"],
    "HIP_RAISE": ["glutes", "hamstrings"], "LEG_CURL": ["hamstrings"], "CALF_RAISE": ["calves"], "FLYE": ["chest"],
    "PUSH_UP": ["chest", "triceps"], "SHRUG": ["traps"], "CORE": ["abdominals"], "PLANK": ["abdominals"],
    "CRUNCH": ["abdominals"], "SIT_UP": ["abdominals"], "LEG_RAISE": ["abdominals"], "CHOP": ["abdominals"],
    "HYPEREXTENSION": ["lower back"], "OLYMPIC_LIFT": ["quadriceps", "shoulders"], "CARRY": ["forearms", "traps"],
    "HIP_STABILITY": ["glutes"], "SHOULDER_STABILITY": ["shoulders"], "SUSPENSION": ["abdominals"], "PLYO": ["quadriceps"],
}
# catégories Garmin compatibles par muscle principal (bonus de score)
MUSCLE_CATS = {
    "chest": {"BENCH_PRESS", "PUSH_UP", "FLYE"}, "shoulders": {"SHOULDER_PRESS", "LATERAL_RAISE", "SHOULDER_STABILITY"},
    "lats": {"PULL_UP", "ROW"}, "middle back": {"ROW"}, "biceps": {"CURL", "PULL_UP"}, "triceps": {"TRICEPS_EXTENSION", "BENCH_PRESS", "PUSH_UP"},
    "quadriceps": {"SQUAT", "LUNGE", "PLYO", "OLYMPIC_LIFT"}, "glutes": {"HIP_RAISE", "SQUAT", "LUNGE", "HIP_STABILITY", "HIP_SWING"},
    "hamstrings": {"DEADLIFT", "LEG_CURL", "HIP_RAISE"}, "lower back": {"HYPEREXTENSION", "DEADLIFT"}, "calves": {"CALF_RAISE"},
    "abdominals": {"CORE", "PLANK", "CRUNCH", "SIT_UP", "LEG_RAISE", "CHOP"}, "traps": {"SHRUG", "CARRY"}, "forearms": {"CURL", "CARRY"},
}

# ---------------------------------------------------------------- correspondance

g_entries = []
for g in GARMIN:
    tk = tokens(g["name"])
    g_entries.append({**g, "tok": tk, "eq": equipment_of(tk)})
docs = [set(e["tok"]) for e in g_entries] + [set(tokens(x["name"])) for x in FEDB]
df = Counter(t for d in docs for t in d)
N = len(docs)
idf = {t: math.log(N / (1 + c)) + 1 for t, c in df.items()}


def score(src_tok: list[str], src_eq: set[str], muscles: list[str], is_stretch: bool, g: dict) -> float:
    a, b = set(src_tok), set(g["tok"])
    if not a or not b:
        return 0.0
    inter = sum(idf.get(t, 1) for t in a & b)
    total = sum(idf.get(t, 1) for t in a) + sum(idf.get(t, 1) for t in b)
    s = 2 * inter / total
    ge = g["eq"] - {"bench", "box"}
    se = src_eq - {"bench", "box"}
    if ge and se:
        s += 0.12 if ge & se else -0.25
    elif ge and not se:
        s -= 0.08
    if muscles and g["category"] in set().union(*(MUSCLE_CATS.get(m, set()) for m in muscles[:1])):
        s += 0.08
    if is_stretch and ("stretch" in b or g["category"] in {"WARM_UP", "HIP_STABILITY", "SHOULDER_STABILITY"}):
        s += 0.1
    if not is_stretch and "stretch" in b:
        s -= 0.3
    return s


def match(name: str, equip: str | None, muscles: list[str], is_stretch: bool) -> list[tuple[float, dict]]:
    tk = tokens(name)
    eq = equipment_of(tk)
    if equip and FEDB_EQUIP.get(equip) in EQUIP_TOKENS:
        eq.add(FEDB_EQUIP[equip])
    cand = sorted(((score(tk, eq, muscles, is_stretch, g), g) for g in g_entries), key=lambda x: -x[0])
    return cand[:3]


def garmin_ref(sc: float, g: dict, src_name: str | None = None) -> dict:
    ref = {"c": g["category"], "e": g["exercise"], "n": g["name"], "s": max(0, min(100, round(sc * 100)))}
    if src_name is not None and set(tokens(src_name)) == set(g["tok"]):
        ref["x"] = 1  # mêmes mots : correspondance certaine
    return ref


library = []
used_garmin: dict[tuple[str, str], float] = {}
for x in FEDB:
    is_stretch = x["category"] == "stretching"
    top = match(x["name"], x.get("equipment"), x.get("primaryMuscles") or [], is_stretch)
    best_s, best = top[0]
    if is_stretch and best_s < 0.55:
        fallback = next(g for g in g_entries if g["category"] == "WARM_UP" and g["exercise"] == "WARM_UP")
        top = [(0.5, fallback)] + top[:2]
    eq = FEDB_EQUIP.get(x.get("equipment") or "", "other")
    entry = {
        "id": x["id"],
        "name": translate(x["name"]) or x["name"],
        "en": x["name"],
        "cat": CAT_FEDB.get(x["category"], "muscu"),
        "eq": eq,
        "mine": eq in MY_EQUIP,
        "pm": [MUSCLES_FR.get(m, m) for m in x.get("primaryMuscles") or []],
        "sm": [MUSCLES_FR.get(m, m) for m in x.get("secondaryMuscles") or []],
        "lvl": x.get("level"),
        "how": x.get("instructions") or [],
        "img": [IMG_BASE + i for i in (x.get("images") or [])[:2]],
        "g": [garmin_ref(s, g, x["name"]) for s, g in top],
        "src": "fedb",
    }
    if entry["cat"] == "muscu" and any(m in ("Abdominaux",) for m in entry["pm"]):
        entry["cat"] = "gainage"
    library.append(entry)
    k = (top[0][1]["category"], top[0][1]["exercise"])
    used_garmin[k] = max(used_garmin.get(k, 0), top[0][0])

# exercices Garmin non couverts (ou mal couverts) : ajoutés comme mouvements à part entière
for g in g_entries:
    k = (g["category"], g["exercise"])
    if used_garmin.get(k, 0) >= 0.8:
        continue
    eqs = g["eq"] - {"bench", "box", "rope"}
    eq = next(iter(eqs)) if eqs else "body"
    muscles = GARMIN_MUSCLES.get(g["category"], [])
    library.append({
        "id": f"garmin:{g['category']}:{g['exercise']}",
        "name": translate(g["name"]) or g["name"],
        "en": g["name"],
        "cat": GARMIN_CAT.get(g["category"], "muscu"),
        "eq": eq,
        "mine": eq in MY_EQUIP or eq in {"suspension"},
        "pm": [MUSCLES_FR[m] for m in muscles],
        "sm": [],
        "lvl": None,
        "how": [],
        "img": [],
        "g": [{"c": g["category"], "e": g["exercise"], "n": g["name"], "s": 100}],
        "src": "garmin",
    })

# ---------------------------------------------------------------- vidéos CrossFit.com
CF_PATH = ROOT / "scripts/vendor/crossfit-movements.json"
CF_EQUIP = {"dumbbell": "dumbbell", "kettlebell": "kettlebell", "barbell": "barbell", "medball": "medball", "ring": "ring", "rope": "rope", "box": "box"}
OLY = {"clean", "snatch", "jerk", "sots"}
GYM = {"handstand", "muscle", "kipping", "rope", "ring", "rings", "lsit", "l", "pirouette", "scale", "roll", "kip", "skin", "shoot", "straddle", "toes", "knees", "pullup", "butterfly"}
# correspondances Garmin choisies à la main quand le calcul automatique se trompe
CF_GARMIN = {
    "Strict Pull-up": "Pull-up", "Butterfly Pull-up": "Kipping Pull-up", "Kipping Chest-to-bar Pull-up": "Kipping Pull-up",
    "Strict Chest-to-bar Pull-up": "Pull-up", "Strict Knees-to-elbows": "Toes to Elbows", "Strict Toes-to-rings": "Toes to Bar",
    "Strict Toes-to-bar": "Toes to Bar", "Kipping Toes-to-bar": "Toes to Bar", "Strict Muscle-up": "Ring Muscle-up",
    "Kipping Muscle-up": "Ring Muscle-up", "Strict Bar Muscle-up": "Bar Muscle-up", "Kipping Bar Muscle-up": "Bar Muscle-up",
    "Strict Handstand Push-up": "Handstand Push-up", "Freestanding Handstand Push-up": "Handstand Push-up",
    "Chest-to-wall Handstand Push-up": "Handstand Push-up", "Handstand Push-up Variations": "Handstand Push-up",
    "Kipping Deficit Handstand Push-up": "Kipping Parallette Handstand Push-up", "Single-under": "Jump Rope",
    "Slam Ball": "Medicine Ball Slam", "Dip": "Body-weight Dip", "Single-leg Squat (Pistol)": "Pistol Squat",
    "Barbell Front-rack Lunge": "Barbell Lunge", "Dumbbell Front-rack Lunge": "Alternating Dumbbell Lunge",
    "Front Squat": "Barbell Front Squat", "Back Squat": "Barbell Back Squat", "Bench Press": "Barbell Bench Press",
    "Shoulder Press": "Overhead Barbell Press", "Pull-over": "Lying Dumbbell Pull-over to Extension",
    "AbMat Sit-up": "Sit-up", "Hang Clean": "Barbell Hang Squat Clean", "Inverted Burpee": "Burpee",
}
G_BY_NAME = {g["name"]: g for g in g_entries}
cf_added = cf_linked = 0
if CF_PATH.exists():
    by_tokens: dict[frozenset, list[dict]] = {}
    for e in library:
        by_tokens.setdefault(frozenset(tokens(e["en"])), []).append(e)
    for cf in json.loads(CF_PATH.read_text()):
        if not cf.get("youtube") or cf["slug"] == "movements" or cf["name"].lower().startswith("what is"):
            continue
        tk = tokens(cf["name"])
        hits = by_tokens.get(frozenset(tk), []) or by_tokens.get(frozenset(tk + ["barbell"]), [])
        if hits:
            for e in hits:
                e["yt"] = cf["youtube"]
                e["ytSrc"] = cf["url"]
            cf_linked += 1
            continue
        top = match(cf["name"], None, [], False)
        if cf["name"] in CF_GARMIN and CF_GARMIN[cf["name"]] in G_BY_NAME:
            forced = G_BY_NAME[CF_GARMIN[cf["name"]]]
            top = [(1.0, forced)] + [t for t in top if t[1] is not forced][:2]
        best_s, best = top[0]
        eqs = [CF_EQUIP[t] for t in tk if t in CF_EQUIP]
        eq = eqs[0] if eqs else ("barbell" if set(tk) & OLY or "barbell" in best["tok"] else "rope" if "rope" in tk else "body")
        cat = "halto" if set(tk) & OLY else "wod" if set(tk) & GYM or "ghd" in tk else GARMIN_CAT.get(best["category"], "muscu")
        muscles = GARMIN_MUSCLES.get(best["category"], [])
        library.append({
            "id": f"crossfit:{cf['slug']}",
            "name": translate(cf["name"]) or cf["name"],
            "en": cf["name"],
            "cat": cat, "eq": eq, "mine": eq in MY_EQUIP and not set(tk) & {"ring", "rings", "ghd", "rope", "abmat"},
            "pm": [MUSCLES_FR[m] for m in muscles], "sm": [], "lvl": None, "how": [], "img": [],
            "g": [garmin_ref(sc, g, cf["name"]) for sc, g in top],
            "src": "crossfit", "yt": cf["youtube"], "ytSrc": cf["url"],
        })
        cf_added += 1
print(f"CrossFit : {cf_linked} vidéos rattachées à des mouvements existants, {cf_added} mouvements ajoutés")

library.sort(key=lambda e: e["name"].lower())
garmin_fr = {f"{g['category']}/{g['exercise']}": translate(g["name"]) or g["name"] for g in GARMIN}
(ROOT / "src/data/garmin-fr.json").write_text(json.dumps(garmin_fr, ensure_ascii=False, separators=(",", ":")))
out = ROOT / "src/data/library.json"
out.write_text(json.dumps(library, ensure_ascii=False, separators=(",", ":")))

fr = sum(1 for e in library if e["name"] != e["en"])
fedb = [e for e in library if e["src"] == "fedb"]
bands = Counter("exact" if e["g"][0]["s"] >= 80 else "approché" if e["g"][0]["s"] >= 55 else "générique" for e in fedb)
print(f"{len(library)} mouvements ({len(fedb)} free-exercise-db + {len(library) - len(fedb)} Garmin), {fr} noms traduits")
print("correspondances free-exercise-db :", dict(bands))
print(f"taille : {out.stat().st_size // 1024} Ko")
