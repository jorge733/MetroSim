"""
Android App Bundle (.aab) para Google Play, sin aapt2 ni bundletool.

Un AAB es un zip con un módulo `base/` cuyo manifiesto y tabla de recursos van en
protobuf (el formato de aapt2, Resources.proto), no en el XML binario del APK:

    BundleConfig.pb
    base/manifest/AndroidManifest.xml   (XmlNode en protobuf)
    base/resources.pb                   (ResourceTable en protobuf)
    base/dex/classes.dex
    base/res/drawable/icon.png
    base/assets/www/...

Se firma con jarsigner (firma JAR v1): esa es la clave de subida; Google Play
vuelve a firmar los APK que entrega con la clave de firma de la app.
"""
import struct
import subprocess

import axml

BUNDLETOOL_VERSION = "1.18.1"      # versión de bundletool que declara BundleConfig.pb


# ── Codificador protobuf mínimo ────────────────────────────────────────────────
def varint(n):
    out = bytearray()
    n &= (1 << 64) - 1
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def f_int(field, n):
    """uint32 / int32 / bool / enum (wire type 0); se omite si vale 0 (proto3)."""
    return varint(field << 3) + varint(int(n)) if n else b""


def f_bytes(field, data):
    """string / bytes / mensaje (wire type 2); un mensaje vacío se escribe igual (marca presencia)."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    return varint(field << 3 | 2) + varint(len(data)) + data


def f_str(field, s):
    return f_bytes(field, s) if s else b""


# ── Manifiesto (aapt.pb.XmlNode) ───────────────────────────────────────────────
def compiled_item(value, typ):
    """aapt.pb.Item del valor de un atributo, o None si es texto."""
    if typ == axml.TYPE_STRING:
        return None
    if typ == axml.TYPE_REFERENCE:
        return f_bytes(1, f_int(2, value))                          # Item.ref → Reference.id
    if typ == axml.TYPE_INT_DEC:
        prim = varint(6 << 3) + varint(value)                       # Primitive.int_decimal_value (aunque sea 0)
    elif typ == axml.TYPE_INT_HEX:
        prim = varint(7 << 3) + varint(value)                       # Primitive.int_hexadecimal_value
    elif typ == axml.TYPE_INT_BOOLEAN:
        prim = varint(8 << 3) + varint(1 if value else 0)           # Primitive.boolean_value
    else:
        raise ValueError(typ)
    return f_bytes(7, prim)                                         # Item.prim


def text_value(value, typ):
    if typ == axml.TYPE_INT_BOOLEAN:
        return "true" if value else "false"
    if typ == axml.TYPE_INT_HEX:
        return "0x%x" % value
    if typ == axml.TYPE_REFERENCE:
        return "@0x%08x" % value
    return str(value)


def xml_element(node, root=False):
    tag, attrs, children = node
    el = b""
    if root:
        el += f_bytes(1, f_str(1, "android") + f_str(2, axml.ANDROID_NS))     # namespace_declaration
    el += f_str(3, tag)
    for ns, name, value, typ in attrs:
        at = b""
        if ns:
            at += f_str(1, axml.ANDROID_NS)
        at += f_str(2, name) + f_str(3, text_value(value, typ))
        if ns:
            at += f_int(5, axml.ATTR_IDS[name])                               # resource_id
        item = compiled_item(value, typ)
        if item is not None:
            at += f_bytes(6, item)                                            # compiled_item
        el += f_bytes(4, at)
    for ch in children:
        el += f_bytes(5, f_bytes(1, xml_element(ch)))                         # child → XmlNode.element
    return el


def manifest(tree):
    return f_bytes(1, xml_element(tree, root=True))


# ── Tabla de recursos (aapt.pb.ResourceTable) ──────────────────────────────────
def resources(package, icon_path):
    """Un recurso, como en axml.resources: drawable/icon (0x7f010000) → icon_path (PNG)."""
    file_ref = f_str(1, icon_path) + f_int(2, 1)                              # FileReference{path, type=PNG}
    value = f_bytes(4, f_bytes(5, file_ref))                                  # Value.item → Item.file
    config_value = f_bytes(1, b"") + f_bytes(2, value)                        # configuración por defecto
    entry = f_bytes(1, f_int(1, 0)) + f_str(2, "icon") + f_bytes(6, config_value)
    typ = f_bytes(1, f_int(1, 1)) + f_str(2, "drawable") + f_bytes(3, entry)
    pkg = f_bytes(1, f_int(1, 0x7F)) + f_str(2, package) + f_bytes(3, typ)
    return f_bytes(2, pkg)


def bundle_config():
    return f_bytes(1, f_str(2, BUNDLETOOL_VERSION))                           # BundleConfig.bundletool.version


# ── Firma ─────────────────────────────────────────────────────────────────────
def sign(aab_path, keystore, alias, password):
    subprocess.run(["jarsigner", "-keystore", keystore, "-storepass", password, "-keypass", password,
                    "-sigalg", "SHA256withRSA", "-digestalg", "SHA-256", aab_path, alias],
                   check=True, stdout=subprocess.DEVNULL)
    out = subprocess.run(["jarsigner", "-verify", aab_path], check=True, capture_output=True, text=True).stdout
    assert "jar verified" in out, out
