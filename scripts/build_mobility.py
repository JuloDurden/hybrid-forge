"""Construit src/data/mobility.json : fiches + protocoles + vidéos GOWOD + mouvements mobilité de la bibliothèque."""
import json, re, sys, unicodedata
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from mobility_content import FICHES, PROTOCOLS

R = Path(__file__).resolve().parent.parent
site = json.loads((R / 'scripts/vendor/gowod-movements.json').read_text())
yt = json.loads((R / 'scripts/vendor/gowod-youtube.json').read_text())
garmin = {f"{g['category']}/{g['exercise']}": g['name'] for g in json.loads((R / 'src/data/garmin-exercises.json').read_text())}

def slug(t):
    t = unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode().lower()
    t = re.sub(r'\b(mobility|exercise|stretch)\b$', '', t.strip())
    t = re.sub(r'\s+(mobility exercise|mobility stretch|mobility)$', '', t)
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')

yt_by = {}
for v in yt:
    if (v.get('duration') or 999) <= 60:
        yt_by.setdefault(slug(v['title']), v['id'])
site_by = {m['slug']: m for m in site}

def video_for(i):
    if i in site_by and site_by[i].get('youtube'):
        return site_by[i]['youtube']
    for k in (i, i + '-stretch', re.sub(r'-stretch$', '', i)):
        if k in yt_by: return yt_by[k]
    for k, v in yt_by.items():
        if k.startswith(i): return v
    return None

moves, missing = {}, []
for i, f in FICHES.items():
    g = f['garmin'] if f['garmin'] in garmin else 'WARM_UP/WARM_UP'
    if g != f['garmin']: missing.append(('garmin', i, f['garmin']))
    vid = video_for(f.get('video_of', i))
    if not vid: missing.append(('video', i))
    s = site_by.get(f.get('video_of', i))
    moves[i] = dict(id=i, name=f['fr'], en=(s['name'] if s else None), kind=f['kind'], sides=f['sides'], zones=f['zones'],
                    garmin=g, garminName=garmin.get(g), yt=vid, url=(s['url'] if s else None),
                    eq=(s['equipment'] if s else None), why=f['why'], how=f['how'], avoid=f['avoid'])

for p in PROTOCOLS:
    for sid, _ in p['steps']:
        assert sid in moves, (p['id'], sid)

# Mouvements GOWOD du site sans fiche : affichés en bibliothèque (lien + vidéo)
extra = [dict(id=m['slug'], name=m['name'], zones=m['zones'], eq=m['equipment'], yt=m.get('youtube'), url=m['url'])
         for m in site if m['slug'] not in moves]
# Vidéos d'exercices de la chaîne (≤ 60 s) sans fiche
known = {v['yt'] for v in moves.values()} | {e['yt'] for e in extra}
clips = [dict(id=v['id'], title=re.sub(r'\s+Mobility (Exercise|Stretch|exercise)$', '', v['title'])) for v in yt
         if (v.get('duration') or 999) <= 60 and v['id'] not in known and 'GOWOD' not in v['title'] and 'CrossFit' not in v['title']
         and not re.search(r'Fraser|Hesketh|Davidsdottir|Georges|Community', v['title'])]

LIB_ZONE = {'Épaules': 'Épaules', 'Fessiers': 'Fessiers', 'Ischios': 'Ischios', 'Quadriceps': 'Quadriceps', 'Mollets': 'Mollets', 'Lombaires': 'Bas du dos',
    'Adducteurs': 'Adducteurs', 'Abducteurs': 'Hanches', 'Grand dorsal': 'Thoracique', 'Milieu du dos': 'Thoracique', 'Pectoraux': 'Pectoraux',
    'Cou': 'Cou', 'Avant-bras': 'Poignets', 'Triceps': 'Épaules', 'Biceps': 'Épaules', 'Abdominaux': 'Bas du dos'}
lib = [dict(id=m['id'], name=m['name'], en=m['en'], img=m['img'], yt=m.get('yt'), how=m['how'],
            zones=list(dict.fromkeys(LIB_ZONE[p] for p in m['pm'] if p in LIB_ZONE)))
       for m in json.loads((R / 'src/data/library.json').read_text()) if m['cat'] == 'mobilite']
lib.sort(key=lambda m: (not m['img'], m['name']))
out = dict(lib=lib, moves=moves, protocols=[dict(p, steps=[dict(id=s, prio=pr) for s, pr in p['steps']]) for p in PROTOCOLS],
           gowod=extra, clips=clips)
(R / 'src/data/mobility.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
print(len(moves), 'fiches,', len(PROTOCOLS), 'protocoles,', len(extra), 'GOWOD sans fiche,', len(clips), 'clips')
for m in missing: print('!', m)
