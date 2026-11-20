"""Construit src/data/wods.json (dictionnaire de mouvements WOD + benchmarks)."""
import json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from wod_content import M, BENCH

R = Path(__file__).resolve().parent.parent
garmin = {f"{g['category']}/{g['exercise']}" for g in json.loads((R / 'src/data/garmin-exercises.json').read_text())}
lib = json.loads((R / 'src/data/library.json').read_text())
by_en = {}
for m in lib:
    by_en.setdefault(m['en'].lower(), m)

bad = []
moves = {}
for k, m in M.items():
    if m['garmin'] and m['garmin'] not in garmin:
        bad.append((k, m['garmin']))
    hit = by_en.get(m['en'].lower()) or by_en.get(('the ' + m['en']).lower())
    if not hit:
        cand = [x for x in lib if x['src'] == 'crossfit' and m['en'].lower() in x['en'].lower()]
        hit = cand[0] if cand else None
    moves[k] = dict(m, key=k, unit=m.get('unit', 'reps'), load=m.get('load'), rx=m.get('rx'), my=m.get('my'), sc=m.get('sc'),
                    sub=m.get('sub', {}), lib=hit['id'] if hit else None, yt=(hit or {}).get('yt'), img=((hit or {}).get('img') or [None])[0])
for b in BENCH:
    for x in b['moves']:
        assert x['key'] in moves, (b['id'], x['key'])
    for v in moves.values():
        for lvl, (sk, _) in v['sub'].items():
            assert sk in moves, (v['key'], sk)
(R / 'src/data/wods.json').write_text(json.dumps(dict(moves=moves, bench=BENCH), ensure_ascii=False, separators=(',', ':')))
print(len(moves), 'mouvements,', len(BENCH), 'benchmarks,', sum(1 for v in moves.values() if v['lib']), 'reliés à la bibliothèque')
for b in bad: print('! garmin', b)
