# ==========================================================================
# RedMoviSim — 2.21 · tools/paraderos-osm.py
# Datos reales de los PARADEROS de los recorridos del bus (js/bus/redRoutes.js) y de los ACCESOS al Metro
# que hay junto a cada uno, sacados del extracto de OpenStreetMap de Santiago
# (© colaboradores de OpenStreetMap, ODbL). Escribe js/bus/paraderosOsm.js.
#
# Por paradero (por su código, p. ej. PA167): número de parada, nombre, recorridos que paran y si tiene refugio.
# Por paradero junto a una estación: sus accesos reales (letra, calle, ascensor), a cuántos metros quedan a lo
# largo de la calle, en qué lado (la vereda del paradero, el bandejón central o la vereda de enfrente) y hacia
# dónde baja la escalera (si OSM la tiene dibujada).
#
#   1. curl -o /tmp/osm/Santiago.osm.pbf https://download.bbbike.org/osm/bbbike/Santiago/Santiago.osm.pbf
#   2. node --input-type=module -e 'import { RED_ROUTES } from "./js/bus/redRoutes.js"; import { writeFileSync } from "node:fs";
#        writeFileSync("/tmp/osm/rutas.json", JSON.stringify(RED_ROUTES.map(r => ({ id: r.id, stops: r.stops, path: r.path }))))'
#   3. node tools/calles-osm.mjs --lista > /tmp/osm/estaciones.json
#      python3 tools/zonas-osm.py /tmp/osm/Santiago.osm.pbf /tmp/osm/estaciones.json /tmp/osm/zonas   (deja indice.json)
#   4. python3 tools/paraderos-osm.py /tmp/osm/Santiago.osm.pbf /tmp/osm/rutas.json /tmp/osm/zonas/indice.json
#      (necesita pyosmium: pip install osmium)
# ==========================================================================
import osmium, json, sys, math, re, datetime

pbf, rutas_f, indice_f = sys.argv[1:4]
rutas = json.load(open(rutas_f))
indice = {z['name']: z['station'] for z in json.load(open(indice_f))}
codes = {st['code'] for r in rutas for st in r['stops'] if st.get('code')}
DRIVE = {"trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "primary_link", "secondary_link", "tertiary_link", "living_street", "busway"}

class H(osmium.SimpleHandler):
    def __init__(s):
        super().__init__(); s.stops = {}; s.ent = {}; s.roads = []; s.steps = []
    def node(s, n):
        t = n.tags
        if t.get('railway') == 'subway_entrance':
            s.ent[n.id] = (n.location.lat, n.location.lon, dict(t))
        elif t.get('ref') in codes and (t.get('highway') == 'bus_stop' or t.get('public_transport') == 'platform'):
            s.stops[t['ref']] = (n.location.lat, n.location.lon, dict(t))
    def way(s, w):
        t = w.tags
        hw = t.get('highway')
        if hw in DRIVE and t.get('area') != 'yes' and not t.get('tunnel') and t.get('covered') != 'yes':
            try: s.roads.append((t.get('name') or f"w{w.id}", [(n.lat, n.lon) for n in w.nodes]))
            except osmium.InvalidLocationError: pass
        elif hw == 'steps':
            try: s.steps.append((t.get('incline'), [(n.ref, n.lat, n.lon) for n in w.nodes]))
            except osmium.InvalidLocationError: pass
h = H(); h.apply_file(pbf, locations=True)

def stop_info(t):
    full = t.get('ref_name') or t.get('name') or ''
    m = re.match(r'^Parada\s*(\d+)\s*/\s*(.+)$', full, re.I)
    name = (m.group(2) if m else (t.get('name') or full))
    name = re.sub(r'^P[A-Z]\d+\s*-\s*', '', name).strip()
    n = int(m.group(1)) if m else int(t['local_ref']) if (t.get('local_ref') or '').isdigit() else 0
    routes = [r.strip() for r in re.split(r'[;,]', t.get('route_ref') or '') if r.strip()]
    routes.sort(key=lambda r: (int(re.match(r'\d*', r).group() or 9999), r))
    sh = 1 if t.get('shelter') == 'yes' else 0 if t.get('shelter') == 'no' else (1 if len(routes) >= 3 else 0)
    return {'n': n, 'name': name[:42], 'routes': routes[:16], 'shelter': sh}

def ent_info(t):
    return {'ref': (t.get('ref') or '')[:3], 'name': (t.get('name') or '')[:60], 'lift': 1 if t.get('elevator') == 'yes' else 0}

def path_at(path, s):
    """Punto [este, norte] del trazado y su dirección en la distancia s."""
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        if a[2] <= s <= b[2] or i == len(path) - 2:
            L = (b[2] - a[2]) or 1
            k = max(0, min(1, (s - a[2]) / L))
            d = (b[0] - a[0], b[1] - a[1]); dl = math.hypot(*d) or 1
            return (a[0] + d[0] * k, a[1] + d[1] * k), (d[0] / dl, d[1] / dl)
    return (0, 0), (0, 1)

def seg_x(p, q, a, b):
    """¿Se cortan los segmentos pq y ab?"""
    def cr(o, u, v): return (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0])
    return (cr(p, q, a) * cr(p, q, b) < 0) and (cr(a, b, p) * cr(a, b, q) < 0)

paraderos, accesos = {}, {}
for code in sorted(codes):
    if code in h.stops: paraderos[code] = stop_info(h.stops[code][2])

for r in rutas:
    path = r['path']
    if not path: continue
    # Origen del trazado (lat, lon del primer punto): se ajusta con los paraderos que están en OSM
    lat0s, lon0s = [], []
    for st in r['stops']:
        o = h.stops.get(st.get('code'))
        if not o: continue
        (e, n), _ = path_at(path, st['s'])
        ky = 110574; kx = 111320 * math.cos(math.radians(o[0]))
        lat0s.append(o[0] - n / ky); lon0s.append(o[1] - e / kx)
    if not lat0s: continue
    lat0s.sort(); lon0s.sort()
    lat0, lon0 = lat0s[len(lat0s) // 2], lon0s[len(lon0s) // 2]
    ky = 110574; kx = 111320 * math.cos(math.radians(lat0))
    EN = lambda la, lo: ((lo - lon0) * kx, (la - lat0) * ky)
    for st in r['stops']:
        metro = st.get('metro')
        if not metro or metro not in indice: continue
        P, t = path_at(path, st['s'])
        o = h.stops.get(st.get('code'))
        S = EN(o[0], o[1]) if o else P
        rt = (t[1], -t[0])                                   # derecha de quien avanza
        sta = indice[metro]; SP = EN(sta['lat'], sta['lon'])
        roads = []
        for name, pts in h.roads:
            q = [EN(*p) for p in pts]
            if any(math.hypot(x - S[0], y - S[1]) < 260 for x, y in q): roads.append((name, q))
        out = []
        for nid, (la, lo, tg) in h.ent.items():
            E = EN(la, lo)
            if math.hypot(E[0] - SP[0], E[1] - SP[1]) > 280: continue
            v = (E[0] - S[0], E[1] - S[1])
            along = v[0] * t[0] + v[1] * t[1]
            if abs(along) > 90: continue
            # Calzadas paralelas a la del bus que hay que cruzar para llegar al acceso
            crossed = set()
            for name, q in roads:
                for i in range(len(q) - 1):
                    d = (q[i + 1][0] - q[i][0], q[i + 1][1] - q[i][1]); dl = math.hypot(*d) or 1
                    if abs((d[0] * t[0] + d[1] * t[1]) / dl) < 0.7: continue
                    # Se mide de lado a lado (perpendicular a la calle), a la altura del acceso
                    A = (S[0] + t[0] * along, S[1] + t[1] * along)
                    if seg_x(A, E, q[i], q[i + 1]): crossed.add(name + str(i))
            if not crossed: side = 0
            else:
                # Más allá del acceso, ¿hay otra calzada paralela a menos de 30 m? Entonces está en el bandejón
                lat = v[0] * rt[0] + v[1] * rt[1]
                sgn = 1 if lat > 0 else -1
                F = (E[0] + rt[0] * sgn * 30, E[1] + rt[1] * sgn * 30)
                beyond = any(seg_x(E, F, q[i], q[i + 1]) and abs(((q[i + 1][0] - q[i][0]) * t[0] + (q[i + 1][1] - q[i][1]) * t[1]) / (math.hypot(q[i + 1][0] - q[i][0], q[i + 1][1] - q[i][1]) or 1)) > 0.7
                             for _, q in roads for i in range(len(q) - 1))
                side = 1 if len(crossed) == 1 and beyond else 2
            # Escalera: hacia dónde baja (+1 hacia adelante, −1 hacia atrás, 0 de través o sin dato)
            down = 0
            for incl, nodes in h.steps:
                ids = [n[0] for n in nodes]
                if nid not in ids: continue
                i = ids.index(nid)
                j = 1 if i == 0 else i - 1 if i == len(ids) - 1 else (i - 1 if incl == 'up' else i + 1 if incl == 'down' else -1)
                if j < 0: continue
                B = EN(nodes[j][1], nodes[j][2]); d = (B[0] - E[0], B[1] - E[1]); dl = math.hypot(*d) or 1
                c = (d[0] * t[0] + d[1] * t[1]) / dl
                down = 1 if c > 0.6 else -1 if c < -0.6 else 0
                break
            out.append({**ent_info(tg), 'along': round(along, 1), 'side': side, 'down': down})
        out.sort(key=lambda a: (a['side'], abs(a['along'])))
        if out: accesos.setdefault(r['id'], {})[st['code']] = out[:6]

body = f"""/* Generado por tools/paraderos-osm.py ({datetime.date.today()}) — no editar a mano.
   Datos © colaboradores de OpenStreetMap (www.openstreetmap.org/copyright), licencia ODbL.
   PARADEROS: por código, el n.º de parada, el nombre, los recorridos que paran y si tiene refugio.
   ACCESOS: por recorrido y paradero (sentido ida), los accesos al Metro de la estación de al lado:
   letra, calle, ascensor, metros a lo largo de la calle (+ hacia adelante), lado (0 la vereda del paradero,
   1 el bandejón central, 2 la vereda de enfrente) y hacia dónde baja la escalera (+1 adelante, −1 atrás). */
export const PARADEROS = {json.dumps(paraderos, ensure_ascii=False, separators=(',', ':'))};
export const ACCESOS_PARADERO = {json.dumps(accesos, ensure_ascii=False, separators=(',', ':'))};
"""
open('js/bus/paraderosOsm.js', 'w').write(body)
n_acc = sum(len(v) for r in accesos.values() for v in r.values())
print(f"{len(paraderos)}/{len(codes)} paraderos · {n_acc} accesos en {sum(len(r) for r in accesos.values())} paraderos · js/bus/paraderosOsm.js {len(body)//1024} KB")
