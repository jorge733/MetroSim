# ==========================================================================
# RedMoviSim — 2.7 · tools/zonas-osm.py
# Recorta del extracto de OpenStreetMap de Santiago una zona (≈ 900 × 900 m) alrededor de cada
# estación del juego, en el formato de la API de OSM (map.json). Lo usa tools/calles-osm.mjs.
#
#   1. curl -o /tmp/osm/Santiago.osm.pbf https://download.bbbike.org/osm/bbbike/Santiago/Santiago.osm.pbf
#   2. node tools/calles-osm.mjs --lista > /tmp/osm/estaciones.json
#   3. python3 tools/zonas-osm.py /tmp/osm/Santiago.osm.pbf /tmp/osm/estaciones.json /tmp/osm/zonas
#      (necesita pyosmium: pip install osmium)
#   4. node tools/calles-osm.mjs --zonas /tmp/osm/zonas
# Datos © colaboradores de OpenStreetMap, licencia ODbL.
# ==========================================================================
import osmium, json, sys, os, math, unicodedata, re
pbf, est, out = sys.argv[1:4]
HALF = float(sys.argv[4]) if len(sys.argv) > 4 else 460

# 1 · Estaciones de OSM (nodos railway=station / public_transport=station con nombre)
class Est(osmium.SimpleHandler):
    def __init__(s): super().__init__(); s.st = []
    def node(s, n):
        t = n.tags
        if (t.get('railway') in ('station', 'halt') or t.get('public_transport') == 'station') and 'name' in t:
            s.st.append([n.id, t.get('name'), t.get('station') or t.get('railway'), n.location.lat, n.location.lon])
e = Est(); e.apply_file(pbf)
osm = e.st
def nz(s):
    s = unicodedata.normalize('NFD', s); s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s); s = re.sub(r"\bESTACION\b|\bMETRO\b", "", s); return re.sub(r"\s+", " ", s).strip()
game = json.load(open(est))
idx = {}
for o in osm: idx.setdefault(nz(o[1]), []).append(o)
zones = []
for name, lines in game.items():
    c = idx.get(nz(name))
    if not c: continue
    metro = [o for o in c if o[2] == 'subway'] or c
    if all(l in ('NOS', 'RAN') for l in lines): metro = [o for o in c if o[2] in ('train', 'station', 'halt')] or c
    o = metro[0]
    lat, lon = o[3], o[4]
    dl, dn = HALF / 110574, HALF / (111320 * math.cos(math.radians(lat)))
    zones.append({ 'name': name, 'lines': lines, 'station': { 'id': o[0], 'lat': lat, 'lon': lon, 'kind': o[2] },
                   'box': (lat - dl, lon - dn, lat + dl, lon + dn), 'nodes': {}, 'ways': {}, 'rels': {} })
CELL = 0.01
grid = {}
for i, z in enumerate(zones):
    a, b, c, d = z['box']
    for gy in range(math.floor(a / CELL), math.floor(c / CELL) + 1):
        for gx in range(math.floor(b / CELL), math.floor(d / CELL) + 1):
            grid.setdefault((gy, gx), []).append(i)
def zones_at(lat, lon):
    r = []
    for i in grid.get((math.floor(lat / CELL), math.floor(lon / CELL)), ()):
        a, b, c, d = zones[i]['box']
        if a <= lat <= c and b <= lon <= d: r.append(i)
    return r
KEEP = ('building', 'highway', 'natural', 'leisure', 'landuse', 'railway', 'public_transport', 'amenity', 'tourism', 'historic', 'place', 'crossing', 'building:part', 'man_made')
class H(osmium.SimpleHandler):
    def node(s, n):
        t = n.tags
        if not len(t) or not any(k in t for k in KEEP): return
        for i in zones_at(n.location.lat, n.location.lon):
            zones[i]['nodes'][n.id] = { 'type': 'node', 'id': n.id, 'lat': n.location.lat, 'lon': n.location.lon, 'tags': dict(t) }
    def way(s, w):
        hit = set()
        pts = []
        for nd in w.nodes:
            if not nd.location.valid(): continue
            pts.append((nd.ref, nd.location.lat, nd.location.lon))
            hit.update(zones_at(nd.location.lat, nd.location.lon))
        if not hit: return
        el = { 'type': 'way', 'id': w.id, 'nodes': [p[0] for p in pts], 'tags': dict(w.tags) }
        for i in hit:
            z = zones[i]; z['ways'][w.id] = el
            for ref, la, lo in pts:
                if ref not in z['nodes']: z['nodes'][ref] = { 'type': 'node', 'id': ref, 'lat': la, 'lon': lo }
    def relation(s, r):
        t = r.tags
        if 'building' not in t and t.get('type') != 'multipolygon': return
        mem = [{ 'type': {'w': 'way', 'n': 'node', 'r': 'relation'}[m.type], 'ref': m.ref, 'role': m.role } for m in r.members]
        for z in zones:
            if any(m['type'] == 'way' and m['ref'] in z['ways'] for m in mem):
                z['rels'][r.id] = { 'type': 'relation', 'id': r.id, 'members': mem, 'tags': dict(t) }
H().apply_file(pbf, locations=True)
os.makedirs(out, exist_ok=True)
index = []
for z in zones:
    slug = re.sub(r"[^a-z0-9]+", "-", nz(z['name']).lower()).strip('-')
    els = list(z['nodes'].values()) + list(z['ways'].values()) + list(z['rels'].values())
    json.dump({ 'elements': els }, open(os.path.join(out, slug + '.json'), 'w'))
    index.append({ 'name': z['name'], 'slug': slug, 'lines': z['lines'], 'station': z['station'] })
json.dump(index, open(os.path.join(out, 'indice.json'), 'w'), ensure_ascii=False)
print(len(index), 'zonas')
