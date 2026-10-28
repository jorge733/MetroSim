"""
Generador mínimo de archivos DEX (formato 035) para el lanzador de MetroSim.

No depende del SDK de Android: arma las tablas (strings, tipos, prototipos,
campos, métodos y clases) y ensambla el bytecode Dalvik de un pequeño
lenguaje tipo smali con etiquetas. Solo cubre las instrucciones que usa
MainActivity.
"""
import hashlib
import struct
import zlib

NO_INDEX = 0xFFFFFFFF


def uleb(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def sleb(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if (n == 0 and not b & 0x40) or (n == -1 and b & 0x40):
            out.append(b)
            return bytes(out)
        out.append(b | 0x80)


def shorty_of(desc):
    return "L" if desc[0] in "L[" else desc


def parse_method(ref):
    """'Lcl/A;->name(Ljava/lang/String;I)V' → (clase, nombre, [params], retorno)"""
    cls, rest = ref.split("->")
    name, sig = rest.split("(")
    params_s, ret = sig.split(")")
    params, i = [], 0
    while i < len(params_s):
        j = i
        while params_s[j] == "[":
            j += 1
        if params_s[j] == "L":
            j = params_s.index(";", j)
        params.append(params_s[i:j + 1])
        i = j + 1
    return cls, name, params, ret


def parse_field(ref):
    """'Lcl/A;->name:Ltipo;' → (clase, nombre, tipo)"""
    cls, rest = ref.split("->")
    name, typ = rest.split(":")
    return cls, name, typ


class Method:
    def __init__(self, ref, flags, registers, code, tries=()):
        self.ref, self.flags, self.registers, self.code, self.tries = ref, flags, registers, code, tries


class Class:
    def __init__(self, name, flags, superclass, fields=(), methods=()):
        self.name, self.flags, self.superclass = name, flags, superclass
        self.fields, self.methods = list(fields), list(methods)


# ---------------------------------------------------------------------------
# Ensamblador: cada instrucción es una tupla (op, args...)
# ---------------------------------------------------------------------------

INVOKE = {"invoke-virtual": 0x6E, "invoke-super": 0x6F, "invoke-direct": 0x70, "invoke-static": 0x71, "invoke-interface": 0x72}
SIZE = {"return-void": 1, "return-object": 1, "return": 1, "move-result-object": 1, "move-result": 1, "const/4": 1,
        "goto": 1, "const/16": 2, "const-string": 2, "new-instance": 2, "if-eqz": 2, "if-nez": 2,
        "iget-object": 2, "iput-object": 2, "invoke-direct/range": 3, **{k: 3 for k in INVOKE}}


def collect_refs(code):
    strings, types, methods, fields = set(), set(), set(), set()
    for ins in code:
        op = ins[0]
        if op == "const-string":
            strings.add(ins[2])
        elif op == "new-instance":
            types.add(ins[2])
        elif op in ("iget-object", "iput-object"):
            fields.add(ins[3])
        elif op in INVOKE or op == "invoke-direct/range":
            methods.add(ins[-1])
    return strings, types, methods, fields


def assemble(code, idx):
    """Devuelve (unidades de 16 bits, etiquetas→dirección)."""
    labels, addr = {}, 0
    for ins in code:
        if ins[0] == "label":
            labels[ins[1]] = addr
        else:
            addr += SIZE[ins[0]]
    out, addr = [], 0
    for ins in code:
        op = ins[0]
        if op == "label":
            continue
        a = ins[1:]
        if op == "return-void":
            out += [0x000E]
        elif op in ("return-object", "return", "move-result-object", "move-result"):
            out += [(a[0] << 8) | {"return-object": 0x11, "return": 0x0F, "move-result-object": 0x0C, "move-result": 0x0A}[op]]
        elif op == "const/4":
            assert -8 <= a[1] < 8 and a[0] < 16
            out += [((a[1] & 0xF) << 12) | (a[0] << 8) | 0x12]
        elif op == "const/16":
            out += [(a[0] << 8) | 0x13, a[1] & 0xFFFF]
        elif op == "const-string":
            out += [(a[0] << 8) | 0x1A, idx["string"][a[1]]]
        elif op == "new-instance":
            out += [(a[0] << 8) | 0x22, idx["type"][a[1]]]
        elif op == "goto":
            off = labels[a[0]] - addr
            assert -128 <= off < 128
            out += [((off & 0xFF) << 8) | 0x28]
        elif op in ("if-eqz", "if-nez"):
            off = labels[a[1]] - addr
            out += [(a[0] << 8) | (0x38 if op == "if-eqz" else 0x39), off & 0xFFFF]
        elif op in ("iget-object", "iput-object"):
            assert a[0] < 16 and a[1] < 16
            out += [(a[1] << 12) | (a[0] << 8) | (0x54 if op == "iget-object" else 0x5B), idx["field"][a[2]]]
        elif op in INVOKE:
            regs, ref = a[0], a[1]
            assert len(regs) <= 5 and all(r < 16 for r in regs)
            r = list(regs) + [0] * (5 - len(regs))
            out += [(len(regs) << 12) | (r[4] << 8) | INVOKE[op], idx["method"][ref], (r[3] << 12) | (r[2] << 8) | (r[1] << 4) | r[0]]
        elif op == "invoke-direct/range":
            first, count, ref = a
            out += [(count << 8) | 0x76, idx["method"][ref], first]
        else:
            raise ValueError(op)
        addr += SIZE[op]
    assert len(out) == addr
    return out, labels


def outs_of(code):
    n = 0
    for ins in code:
        if ins[0] in INVOKE:
            ref = ins[-1]
            _, _, params, _ = parse_method(ref)
            n = max(n, len(ins[1]))
        elif ins[0] == "invoke-direct/range":
            n = max(n, ins[2])
    return n


def ins_of(m):
    _, _, params, _ = parse_method(m.ref)
    n = sum(2 if p in ("J", "D") else 1 for p in params)
    return n + (0 if m.flags & 0x8 else 1)


def build(classes):
    strings, types, protos, fields, methods = set(), set(), set(), set(), set()

    def add_type(t):
        types.add(t)
        strings.add(t)

    def add_method(ref):
        cls, name, params, ret = parse_method(ref)
        methods.add(ref)
        add_type(cls)
        strings.add(name)
        for p in params:
            add_type(p)
        add_type(ret)
        shorty = shorty_of(ret) + "".join(shorty_of(p) for p in params)
        strings.add(shorty)
        protos.add((shorty, ret, tuple(params)))

    def add_field(ref):
        cls, name, typ = parse_field(ref)
        fields.add(ref)
        add_type(cls)
        add_type(typ)
        strings.add(name)

    for c in classes:
        add_type(c.name)
        add_type(c.superclass)
        for f in c.fields:
            add_field(f[0])
        for m in c.methods:
            add_method(m.ref)
            s, t, mm, ff = collect_refs(m.code)
            strings |= s
            for x in t:
                add_type(x)
            for x in mm:
                add_method(x)
            for x in ff:
                add_field(x)
            for tr in m.tries:
                for typ, _ in tr[2]:
                    add_type(typ)

    def mutf8_key(s):
        return [ord(ch) for ch in s]          # solo ASCII: el orden UTF-16 coincide

    for s in strings:
        assert all(ord(ch) < 128 for ch in s), s
    string_list = sorted(strings, key=mutf8_key)
    sidx = {s: i for i, s in enumerate(string_list)}
    type_list = sorted(types, key=lambda t: sidx[t])
    tidx = {t: i for i, t in enumerate(type_list)}
    proto_list = sorted(protos, key=lambda p: (tidx[p[1]], [tidx[x] for x in p[2]]))
    pidx = {p: i for i, p in enumerate(proto_list)}

    def proto_of(ref):
        cls, name, params, ret = parse_method(ref)
        shorty = shorty_of(ret) + "".join(shorty_of(p) for p in params)
        return (shorty, ret, tuple(params))

    field_list = sorted(fields, key=lambda f: (tidx[parse_field(f)[0]], sidx[parse_field(f)[1]], tidx[parse_field(f)[2]]))
    fidx = {f: i for i, f in enumerate(field_list)}
    method_list = sorted(methods, key=lambda m: (tidx[parse_method(m)[0]], sidx[parse_method(m)[1]], pidx[proto_of(m)]))
    midx = {m: i for i, m in enumerate(method_list)}
    idx = {"string": sidx, "type": tidx, "field": fidx, "method": midx}

    # --- Disposición del archivo ---
    header_size = 0x70
    off = header_size
    string_ids_off = off; off += 4 * len(string_list)
    type_ids_off = off; off += 4 * len(type_list)
    proto_ids_off = off; off += 12 * len(proto_list)
    field_ids_off = off; off += 8 * len(field_list)
    method_ids_off = off; off += 8 * len(method_list)
    class_defs_off = off; off += 32 * len(classes)
    data_off = off

    data = bytearray()

    def pad4():
        while (data_off + len(data)) % 4:
            data.append(0)

    # code_items
    code_offs = {}
    for c in classes:
        for m in c.methods:
            pad4()
            code_offs[m.ref] = data_off + len(data)
            insns, labels = assemble(m.code, idx)
            tries = m.tries
            item = struct.pack("<HHHHII", m.registers, ins_of(m), outs_of(m.code), len(tries), 0, len(insns))
            item += struct.pack("<%dH" % len(insns), *insns)
            if tries:
                if len(insns) % 2:
                    item += b"\0\0"
                # lista de manejadores
                handlers = bytearray(uleb(len(tries)))
                hoffs = []
                for start, end, catches in tries:
                    hoffs.append(len(handlers))
                    handlers += sleb(len(catches))
                    for typ, lab in catches:
                        handlers += uleb(tidx[typ]) + uleb(labels[lab])
                for (start, end, catches), h in zip(tries, hoffs):
                    a0, a1 = labels[start], labels[end]
                    item += struct.pack("<IHH", a0, a1 - a0, h)
                item += bytes(handlers)
            data += item
    code_count = len(code_offs)

    # type_lists (parámetros de prototipos)
    pad4()
    type_lists_start = data_off + len(data)
    tl_offs = {}
    for p in proto_list:
        params = p[2]
        if params and params not in tl_offs:
            pad4()
            tl_offs[params] = data_off + len(data)
            data += struct.pack("<I", len(params)) + struct.pack("<%dH" % len(params), *[tidx[x] for x in params])
    tl_count = len(tl_offs)

    # string_data
    string_data_start = data_off + len(data)
    str_offs = []
    for s in string_list:
        str_offs.append(data_off + len(data))
        data += uleb(len(s)) + s.encode("ascii") + b"\0"

    # class_data
    class_data_start = data_off + len(data)
    cd_offs = []
    for c in classes:
        cd_offs.append(data_off + len(data))
        inst = sorted(c.fields, key=lambda f: fidx[f[0]])
        direct = sorted([m for m in c.methods if m.flags & (0x2 | 0x8 | 0x10000)], key=lambda m: midx[m.ref])
        virtual = sorted([m for m in c.methods if not m.flags & (0x2 | 0x8 | 0x10000)], key=lambda m: midx[m.ref])
        out = uleb(0) + uleb(len(inst)) + uleb(len(direct)) + uleb(len(virtual))
        prev = 0
        for i, (ref, flags) in enumerate(inst):
            out += uleb(fidx[ref] - prev) + uleb(flags)
            prev = fidx[ref]
        for group in (direct, virtual):
            prev = 0
            for m in group:
                out += uleb(midx[m.ref] - prev) + uleb(m.flags) + uleb(code_offs[m.ref])
                prev = midx[m.ref]
        data += out

    # map_list
    pad4()
    map_off = data_off + len(data)
    entries = [
        (0x0000, 1, 0),
        (0x0001, len(string_list), string_ids_off),
        (0x0002, len(type_list), type_ids_off),
        (0x0003, len(proto_list), proto_ids_off),
        (0x0004, len(field_list), field_ids_off) if field_list else None,
        (0x0005, len(method_list), method_ids_off),
        (0x0006, len(classes), class_defs_off),
        (0x2001, code_count, min(code_offs.values())),
        (0x1001, tl_count, min(tl_offs.values())) if tl_count else None,
        (0x2002, len(string_list), string_data_start),
        (0x2000, len(classes), class_data_start),
        (0x1000, 1, map_off),
    ]
    entries = [e for e in entries if e]
    data += struct.pack("<I", len(entries))
    for t, n, o in entries:
        data += struct.pack("<HHII", t, 0, n, o)

    # --- Tablas de índices ---
    body = bytearray()
    for o in str_offs:
        body += struct.pack("<I", o)
    for t in type_list:
        body += struct.pack("<I", sidx[t])
    for p in proto_list:
        body += struct.pack("<III", sidx[p[0]], tidx[p[1]], tl_offs.get(p[2], 0) if p[2] else 0)
    for f in field_list:
        cls, name, typ = parse_field(f)
        body += struct.pack("<HHI", tidx[cls], tidx[typ], sidx[name])
    for m in method_list:
        cls, name, params, ret = parse_method(m)
        body += struct.pack("<HHI", tidx[cls], pidx[proto_of(m)], sidx[name])
    for c, cdo in zip(classes, cd_offs):
        body += struct.pack("<IIIIIIII", tidx[c.name], c.flags, tidx[c.superclass], 0, NO_INDEX, 0, cdo, 0)
    assert header_size + len(body) == data_off

    file_size = data_off + len(data)
    header = bytearray(b"dex\n035\0" + b"\0" * 4 + b"\0" * 20)
    header += struct.pack("<IIII", file_size, header_size, 0x12345678, 0)    # file_size, header_size, endian, link_size
    header += struct.pack("<II", 0, map_off)                                  # link_off, map_off
    header += struct.pack("<II", len(string_list), string_ids_off)
    header += struct.pack("<II", len(type_list), type_ids_off)
    header += struct.pack("<II", len(proto_list), proto_ids_off)
    header += struct.pack("<II", len(field_list), field_ids_off if field_list else 0)
    header += struct.pack("<II", len(method_list), method_ids_off)
    header += struct.pack("<II", len(classes), class_defs_off)
    header += struct.pack("<II", len(data), data_off)
    assert len(header) == header_size
    dex = bytearray(header + body + data)
    dex[12:32] = hashlib.sha1(dex[32:]).digest()
    dex[8:12] = struct.pack("<I", zlib.adler32(bytes(dex[12:])) & 0xFFFFFFFF)
    return bytes(dex)
