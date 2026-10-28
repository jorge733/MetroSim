"""
AndroidManifest.xml binario (AXML) y resources.arsc mínimos, sin aapt.

El manifiesto se describe como árbol (etiqueta, atributos, hijos). Cada
atributo android:* lleva su id de recurso del framework (resource map).
La tabla de recursos tiene un solo recurso: el ícono (drawable 0x7f010000).
"""
import struct

ANDROID_NS = "http://schemas.android.com/apk/res/android"

# Ids de atributos del framework (android.R.attr)
ATTR_IDS = {
    "theme": 0x01010000, "label": 0x01010001, "icon": 0x01010002, "name": 0x01010003,
    "exported": 0x01010010, "screenOrientation": 0x0101001E, "configChanges": 0x0101001F,
    "minSdkVersion": 0x0101020C, "versionCode": 0x0101021B, "versionName": 0x0101021C,
    "targetSdkVersion": 0x01010270, "hardwareAccelerated": 0x010102D3,
}

TYPE_REFERENCE, TYPE_STRING, TYPE_INT_DEC, TYPE_INT_HEX, TYPE_INT_BOOLEAN = 0x01, 0x03, 0x10, 0x11, 0x12


def string_pool(strings):
    """Pool de strings en UTF-16 (chunk RES_STRING_POOL_TYPE)."""
    offsets, data = [], bytearray()
    for s in strings:
        offsets.append(len(data))
        u = s.encode("utf-16-le")
        assert len(s) < 0x8000
        data += struct.pack("<H", len(u) // 2) + u + b"\0\0"
    while len(data) % 4:
        data += b"\0"
    header_size = 28
    strings_start = header_size + 4 * len(offsets)
    size = strings_start + len(data)
    return struct.pack("<HHIIIIII", 0x0001, header_size, size, len(strings), 0, 0, strings_start, 0) + \
        struct.pack("<%dI" % len(offsets), *offsets) + bytes(data)


def manifest(tree):
    """tree = (tag, [(ns_android?, nombre, valor, tipo)], [hijos])"""
    # Strings: primero los nombres de atributos android (en el orden del resource map)
    attr_names = []

    def walk(node, fn):
        fn(node)
        for ch in node[2]:
            walk(ch, fn)

    def collect_attrs(node):
        for ns, name, _, _ in node[1]:
            if ns and name not in attr_names:
                attr_names.append(name)
    walk(tree, collect_attrs)
    attr_names.sort(key=lambda n: ATTR_IDS[n])
    strings = list(attr_names)

    def s(x):
        if x not in strings:
            strings.append(x)
        return strings.index(x)

    s("android")
    s(ANDROID_NS)

    def collect_rest(node):
        s(node[0])
        for ns, name, value, typ in node[1]:
            s(name)
            if typ == TYPE_STRING:
                s(value)
    walk(tree, collect_rest)

    nodes = bytearray()
    NO = 0xFFFFFFFF

    def node_header(typ, size):
        return struct.pack("<HHIII", typ, 16, size, 1, NO)

    ns_ext = struct.pack("<II", s("android"), s(ANDROID_NS))
    nodes += node_header(0x0100, 24) + ns_ext

    def emit(node):
        nonlocal nodes
        tag, attrs, children = node
        attrs = sorted(attrs, key=lambda a: ATTR_IDS[a[1]] if a[0] else -1)
        body = struct.pack("<IIHHHHHH", NO, s(tag), 20, 20, len(attrs), 0, 0, 0)
        for ns, name, value, typ in attrs:
            raw = s(value) if typ == TYPE_STRING else NO
            data = s(value) if typ == TYPE_STRING else (0xFFFFFFFF if (typ == TYPE_INT_BOOLEAN and value) else int(value))
            body += struct.pack("<IIIHBBI", s(ANDROID_NS) if ns else NO, s(name), raw, 8, 0, typ, data & 0xFFFFFFFF)
        nodes += node_header(0x0102, 16 + len(body)) + body
        for ch in children:
            emit(ch)
        nodes += node_header(0x0103, 24) + struct.pack("<II", NO, s(tag))

    emit(tree)
    nodes += node_header(0x0101, 24) + ns_ext

    pool = string_pool(strings)
    res_map = struct.pack("<HHI", 0x0180, 8, 8 + 4 * len(attr_names)) + struct.pack("<%dI" % len(attr_names), *[ATTR_IDS[n] for n in attr_names])
    body = pool + res_map + bytes(nodes)
    return struct.pack("<HHI", 0x0003, 8, 8 + len(body)) + body


def resources(package, icon_path):
    """resources.arsc con un recurso: drawable/icon → icon_path (id 0x7f010000)."""
    values = string_pool([icon_path])
    types = string_pool(["drawable"])
    keys = string_pool(["icon"])

    # typeSpec: tipo 1, una entrada sin variantes de configuración
    spec = struct.pack("<HHIBBHI", 0x0202, 16, 16 + 4, 1, 0, 0, 1) + struct.pack("<I", 0)
    # type: configuración por defecto (ResTable_config de 64 bytes, solo el tamaño)
    config = struct.pack("<I", 64) + b"\0" * 60
    header_size = 8 + 4 + 4 + 4 + len(config)          # chunk + id/res0/res1 + entryCount + entriesStart + config
    entries_start = header_size + 4
    entry = struct.pack("<HHI", 8, 0, 0) + struct.pack("<HBBI", 8, 0, TYPE_STRING, 0)
    type_size = entries_start + len(entry)
    type_chunk = struct.pack("<HHIBBHII", 0x0201, header_size, type_size, 1, 0, 0, 1, entries_start) + config + struct.pack("<I", 0) + entry

    name = package.encode("utf-16-le")[:254]
    name += b"\0" * (256 - len(name))
    pkg_header = 288
    type_strings_off = pkg_header
    key_strings_off = type_strings_off + len(types)
    pkg_body = types + keys + spec + type_chunk
    pkg = struct.pack("<HHII", 0x0200, pkg_header, pkg_header + len(pkg_body), 0x7F) + name + \
        struct.pack("<IIIII", type_strings_off, 1, key_strings_off, 1, 0) + pkg_body
    assert len(pkg) == pkg_header + len(pkg_body)
    body = values + pkg
    return struct.pack("<HHII", 0x0002, 12, 12 + len(body), 1) + body
