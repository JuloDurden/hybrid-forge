"""Modèles de plans Hybrid Forge -> src/data/plans.json.

Séance : d (0 = lundi … 4 = vendredi), kind (run | long | strength | pull | mobility | wod), title, detail, min, key (séance clé)
  run  : {"warm": s, "reps": n, "on": s, "off": s, "cool": s, "hr": [min, max]}   (course-marche ou continue si off = 0)
  wod  : séance au format WOD (format, rounds, rest, moves[{key, reps, load}]) pour muscu / tractions
  mob  : {"protocol": id, "minutes": 3 | 8 | 15 | 22}
Critères de passage : sessions (min faites), pain (douleur max), runHr (courses sous la FC cible, part mini 0..1).
Les courses se raisonnent en minutes et en FC, jamais en km.
"""
import json
from pathlib import Path

HR = [105, 140]


def run(d, title, warm, reps, on, off, cool, key=False, hr=HR, kind="run"):
    total = round((warm + reps * (on + off) + cool) / 60)
    if off:
        detail = f"{reps} × ({on // 60}' course / {off // 60 if off >= 60 else off}{chr(39) if off >= 60 else ' s'} marche) · FC < {hr[1]}"
    else:
        detail = f"{on // 60}' continu en endurance · FC < {hr[1]}"
    import re
    title = re.sub(r" \d+'$", "", title) + f" {total}'"
    return dict(d=d, kind=kind, title=title, detail=detail, min=total, key=key,
                run=dict(warm=warm, reps=reps, on=on, off=off, cool=cool, hr=hr))


def mv(key, reps=None, load=None):
    return {k: v for k, v in dict(key=key, reps=reps, load=load).items() if v is not None}


def strength(d, title, rounds, rest, moves, minutes, kind="strength", key=False, warm="act-bas", cool="rec-muscu"):
    detail = ", ".join(m["key"] for m in moves)
    return dict(d=d, kind=kind, title=title, min=minutes, key=key, detail=None,
                wod=dict(format="fortime", rounds=rounds, rest=rest, moves=moves,
                         warmup=dict(protocol=warm, minutes=8), cooldown=dict(protocol=cool, minutes=3)), _d=detail)


def mob(d, title, protocol, minutes, extra=""):
    return dict(d=d, kind="mobility", title=title, detail=extra or None, min=minutes, key=False, mob=dict(protocol=protocol, minutes=minutes))


# ---------- Reprise en douceur (6 semaines) ----------
MUSCU_1 = [mv("goblet-squat", 10, 16), mv("glute-bridge", 12), mv("ring-row", 10), mv("push-up", 8), mv("bird-dog", 8)]
MUSCU_2 = [mv("goblet-squat", 10, 20), mv("db-rdl", 10, 12.5), mv("db-row", 10, 17.5), mv("db-bench", 10, 15), mv("bird-dog", 10)]
MUSCU_3 = [mv("goblet-squat", 8, 22.5), mv("db-rdl", 8, 17.5), mv("reverse-lunge", 8, 10), mv("db-row", 10, 22.5), mv("db-press", 8, 15), mv("glute-bridge", 15)]
PULL_1 = [mv("dead-hang", 20), mv("scap-pull", 8), mv("ring-row", 10), mv("face-pull", 12), mv("bird-dog", 8)]
PULL_2 = [mv("dead-hang", 25), mv("scap-pull", 8), mv("negative-pull-up", 3), mv("ring-row", 10), mv("knee-raise", 8)]
PULL_3 = [mv("scap-pull", 8), mv("banded-pull-up", 5), mv("negative-pull-up", 3), mv("ring-row", 12), mv("knee-raise", 10)]

REPRISE = dict(
    id="reprise", name="Reprise en douceur", weeks_label="6 semaines", per_week="3 à 5 séances", color="lime",
    desc="Après une blessure ou une coupure. Mobilité quotidienne, course-marche, muscu sans charge sur le dos, puis retour progressif au rythme normal.",
    tags=["Mobilité", "Course", "Muscu"],
    gates=["Mobilité sciatique faite au moins 4 fois cette semaine", "Douleur ≤ 2/10 au quotidien depuis 7 jours",
           "Plus de douleur qui descend dans la jambe", "Feu vert du médecin ou du kiné"],
    rules=["Douleur > 3/10 pendant une séance ou le lendemain : la séance suivante devient une mobilité sciatique.",
           "Douleur qui descend dans la jambe : arrêt de la course et de la muscu, mobilité seulement, et avis médical.",
           "Une séance manquée n'est jamais rattrapée en doublant une journée."],
    phases=[dict(name="Réactivation", weeks=[1, 2], color="lime"), dict(name="Reconstruction", weeks=[3, 4], color="blue"),
            dict(name="Retour au rythme", weeks=[5, 6], color="orange")],
    weeks=[
        dict(n=1, criteria=dict(sessions=3, pain=2, runHr=0.5), sessions=[
            run(0, "Course-marche 20'", 180, 6, 60, 120, 120, key=True),
            strength(1, "Muscu sans charge axiale", 2, 60, MUSCU_1, 35, key=True),
            mob(2, "Mobilité sciatique", "cl-sciatique", 15, "+ marche 30' si tout va bien"),
            run(3, "Course-marche 20'", 180, 6, 60, 120, 120),
            strength(4, "Tractions et gainage", 2, 60, PULL_1, 30, kind="pull", key=True, warm="act-haut", cool="cl-sciatique"),
        ]),
        dict(n=2, criteria=dict(sessions=4, pain=2, runHr=0.5), sessions=[
            run(0, "Course-marche 24'", 180, 8, 120, 60, 120, key=True),
            strength(1, "Muscu sans charge axiale", 3, 60, MUSCU_1, 40, key=True),
            mob(2, "Mobilité sciatique", "cl-sciatique", 15, "+ marche 30'"),
            run(3, "Course-marche 24'", 180, 8, 120, 60, 120),
            strength(4, "Tractions et gainage", 3, 60, PULL_1, 30, kind="pull", key=True, warm="act-haut", cool="cl-sciatique"),
        ]),
        dict(n=3, criteria=dict(sessions=4, pain=2, runHr=0.5), sessions=[
            run(0, "Course-marche 30'", 180, 6, 240, 60, 120, key=True),
            strength(1, "Muscu haltères", 3, 75, MUSCU_2, 40, key=True),
            strength(2, "Tractions et gainage", 3, 60, PULL_2, 30, kind="pull", key=True, warm="act-haut", cool="cl-sciatique"),
            run(3, "Course-marche 30'", 180, 6, 240, 60, 120),
            mob(4, "Mobilité sciatique", "cl-sciatique", 15, "+ marche 30'"),
        ]),
        dict(n=4, criteria=dict(sessions=4, pain=2, runHr=0.5), sessions=[
            run(0, "Course continue 25'", 300, 1, 1200, 0, 120, key=True),
            strength(1, "Muscu haltères", 3, 75, MUSCU_2, 40, key=True),
            strength(2, "Tractions et gainage", 3, 60, PULL_2, 30, kind="pull", key=True, warm="act-haut", cool="cl-sciatique"),
            run(3, "Course continue 30'", 300, 1, 1500, 0, 120),
            dict(d=4, kind="wod", title="WOD léger 20'", detail="EMOM sans charge lourde", min=35, key=False,
                 wod=dict(format="emom", minutes=16, every=60, emom="alternate", moves=[mv("kb-swing", 10, 16), mv("push-up", 8), mv("air-squat", 12), mv("ring-row", 8)],
                          warmup=dict(protocol="act-wod", minutes=8), cooldown=dict(protocol="cl-sciatique", minutes=8))),
        ]),
        dict(n=5, criteria=dict(sessions=4, pain=2, runHr=0.5), sessions=[
            run(0, "Course 30'", 300, 1, 1500, 0, 180, key=True),
            strength(1, "Muscu complète", 3, 90, MUSCU_3, 45, key=True),
            strength(2, "Tractions", 4, 75, PULL_3, 30, kind="pull", key=True, warm="act-haut", cool="rec-muscu"),
            run(3, "Course 30'", 300, 1, 1500, 0, 180),
            run(4, "Sortie longue 40'", 300, 1, 2100, 0, 300, key=True, kind="long"),
        ]),
        dict(n=6, criteria=dict(sessions=4, pain=2, runHr=0.5), sessions=[
            run(0, "Course 35'", 300, 1, 1800, 0, 180, key=True),
            strength(1, "Muscu complète", 4, 90, MUSCU_3, 50, key=True),
            dict(d=2, kind="wod", title="WOD 20'", detail="AMRAP modéré", min=40, key=False,
                 wod=dict(format="amrap", minutes=15, moves=[mv("banded-pull-up", 5), mv("push-up", 10), mv("goblet-squat", 12, 16), mv("kb-swing", 12, 16)],
                          warmup=dict(protocol="act-wod", minutes=8), cooldown=dict(protocol="rec-wod", minutes=8))),
            run(3, "Course 30'", 300, 1, 1500, 0, 180),
            run(4, "Sortie longue 50'", 300, 1, 2700, 0, 300, key=True, kind="long"),
        ]),
    ],
)

# Plans dont le contenu détaillé reste à rédiger (affichés dans la bibliothèque)
OTHERS = [
    dict(id="semi", name="Prépa semi", weeks_label="16 semaines", per_week="5 séances", color="blue", tags=["Course", "Muscu"], draft=True,
         desc="Base aérobie, seuil, sortie longue jusqu'à 1 h 50. Muscu d'entretien. Date de course à fixer."),
    dict(id="tractions", name="Tractions 0 → 5", weeks_label="8 semaines", per_week="2 séances dédiées", color="pink", tags=["Tractions"], draft=True, combinable=True,
         desc="Négatives, élastiques dégressifs, suspension et scapulas. À combiner avec n'importe quel autre plan."),
    dict(id="densification", name="Densification muscu", weeks_label="8 semaines", per_week="3 muscu + 2 course", color="orange", tags=["Muscu", "Course"], draft=True,
         desc="Semaines A/B, upper/lower/core, charges en progression double. Course en entretien."),
    dict(id="base", name="Base aérobie", weeks_label="8 semaines", per_week="3 à 4 courses", color="blue", tags=["Course"], draft=True,
         desc="Uniquement de l'endurance fondamentale, +10 % de minutes par semaine, une semaine allégée sur quatre."),
    dict(id="hybride", name="Hybride CrossFit", weeks_label="6 semaines", per_week="5 séances", color="pink", tags=["WOD", "Force", "Course"], draft=True,
         desc="WOD courts, force, gymnastique adaptée à ton niveau, une sortie longue par semaine."),
]

if __name__ == "__main__":
    R = Path(__file__).resolve().parent.parent
    names = {k: v["fr"] for k, v in json.loads((R / "src/data/wods.json").read_text())["moves"].items()}
    for w in REPRISE["weeks"]:
        for s in w["sessions"]:
            if "_d" in s:
                s["detail"] = ", ".join(names[k] for k in s.pop("_d").split(", "))
                for m in s["wod"]["moves"]:
                    assert m["key"] in names, m
    (R / "src/data/plans.json").write_text(json.dumps([REPRISE, *OTHERS], ensure_ascii=False, separators=(",", ":")))
    print("plans.json :", 1 + len(OTHERS), "plans,", sum(len(w["sessions"]) for w in REPRISE["weeks"]), "séances dans Reprise")
