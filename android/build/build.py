#!/usr/bin/env python3
"""
Construye MetroSim.apk (o MetroSim.aab para Google Play) sin el SDK de Android.

    python3 android/build/build.py [--three DIR] [--out MetroSim.apk]
    python3 android/build/build.py --aab [--out MetroSim.aab]

1. Copia el juego a assets/www (con Three.js local en vendor/three, sin CDN).
2. Genera classes.dex (dex.py + app.py), AndroidManifest.xml y resources.arsc (axml.py).
3. Empaqueta, alinea los archivos sin comprimir y firma con el esquema v2 (firma.py, con openssl).
   Con --aab arma en cambio el App Bundle (manifiesto y recursos en protobuf, aab.py) y lo firma con jarsigner.

Three.js: --three apunta al paquete npm "three" descomprimido (carpeta con
build/ y examples/); si no se indica, se descarga con `npm pack three@VERSIÓN`.
La firma usa android/metrosim.keystore (no va al repositorio; si no existe
se crea una nueva con keytool): hay que firmar siempre con la misma clave
para poder actualizar la app sin desinstalarla (desinstalar borra el avance).
"""
import argparse
import os
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.dirname(HERE)
ROOT = os.path.dirname(ANDROID)
sys.path.insert(0, HERE)

from dex import build as build_dex          # noqa: E402
from app import CLASSES                      # noqa: E402
import aab                                   # noqa: E402
import axml                                  # noqa: E402
import firma                                 # noqa: E402

PACKAGE = "cl.metrosim.app"
THREE_VERSION = "0.180.0"
TARGET_SDK = 36                              # Android 16: lo exige Google Play desde agosto de 2026 (y Play Protect bloquea las antiguas)
KEYSTORE = os.path.join(ANDROID, "metrosim.keystore")
KEY_ALIAS, KEY_PASS = "metrosim", "metrosim"
GAME = ["index.html", "styles.css", "favicon.svg", "logo.svg", "manifest.webmanifest", "js", "audio", "fonts", "icons"]
THREE_FILES = ["build/three.module.js", "build/three.core.js",
               "examples/jsm/environments/RoomEnvironment.js", "examples/jsm/utils/BufferGeometryUtils.js"]
STORED = (".png", ".jpg", ".jpeg", ".mp3", ".ogg", ".woff2", ".arsc")


def version():
    """Versión del juego (la de sw.js: metrosim-vX.Y o metrosim-vX.Y.Z) → (versionName, versionCode).
    versionCode = X·10000 + Y·100 + Z (1.6 → 10600, 1.6.1 → 10601): siempre mayor que el de 1.5 (105)."""
    m = re.search(r'metrosim-v(\d+)\.(\d+)(?:\.(\d+))?', open(os.path.join(ROOT, "sw.js"), encoding="utf-8").read())
    major, minor, patch = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    return (f"{major}.{minor}.{patch}" if patch else f"{major}.{minor}"), major * 10000 + minor * 100 + patch


def get_three(tmp):
    d = os.path.join(tmp, "three")
    os.makedirs(d)
    subprocess.run(["npm", "pack", f"three@{THREE_VERSION}", "--silent"], cwd=d, check=True, stdout=subprocess.DEVNULL)
    with tarfile.open(os.path.join(d, f"three-{THREE_VERSION}.tgz")) as t:
        t.extractall(d, filter="data")
    return os.path.join(d, "package")


def copy_game(www, three):
    for item in GAME:
        src = os.path.join(ROOT, item)
        (shutil.copytree if os.path.isdir(src) else shutil.copy2)(src, os.path.join(www, item))
    for f in THREE_FILES:
        dst = os.path.join(www, "vendor/three", f.replace("build/", "").replace("examples/jsm/", "addons/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(three, f), dst)

    # index.html: Three.js local (sin CDN ni es-module-shims)
    p = os.path.join(www, "index.html")
    html = open(p, encoding="utf-8").read()
    html = re.sub(r'\s*<script async src="https://unpkg\.com/es-module-shims[^"]*"></script>', "", html)
    html = html.replace(f"https://cdn.jsdelivr.net/npm/three@{THREE_VERSION}/build/three.module.js", "./vendor/three/three.module.js")
    html = html.replace(f"https://cdn.jsdelivr.net/npm/three@{THREE_VERSION}/examples/jsm/", "./vendor/three/addons/")
    assert "cdn.jsdelivr.net" not in html, "index.html todavía apunta al CDN (¿cambió la versión de Three.js?)"
    # La app ya es pantalla completa y horizontal: el juego no pide la API de pantalla completa
    # (en un WebView sin vista a pantalla completa propia dejaría la imagen en negro)
    html = html.replace("<head>", "<head>\n  <script>delete Element.prototype.requestFullscreen;</script>", 1)
    open(p, "w", encoding="utf-8").write(html)

    # pwa.js: dentro de la app no hay service worker ni botón de instalar
    p = os.path.join(www, "js/pwa.js")
    js = open(p, encoding="utf-8").read()
    js2 = js.replace('if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {', "if (false) {   // app Android: sin service worker")
    js2 = js2.replace("if (!button || installed()) return;", "if (true) return;   // app Android: ya instalada")
    assert js2 != js
    open(p, "w", encoding="utf-8").write(js2)


def manifest_tree(version_name, version_code):
    S, I, H, B, R = axml.TYPE_STRING, axml.TYPE_INT_DEC, axml.TYPE_INT_HEX, axml.TYPE_INT_BOOLEAN, axml.TYPE_REFERENCE
    a = lambda name, value, typ: (True, name, value, typ)          # atributo android:*
    activity = ("activity", [
        a("name", f"{PACKAGE}.MainActivity", S),
        a("exported", True, B),
        # orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|screenLayout|uiMode|navigation: no se reinicia al girar
        a("configChanges", 0xFF0, H),
        a("screenOrientation", 6, I),             # sensorLandscape: horizontal, en cualquiera de los dos sentidos
        a("label", "MetroSim", S),
    ], [("intent-filter", [], [
        ("action", [a("name", "android.intent.action.MAIN", S)], []),
        ("category", [a("name", "android.intent.category.LAUNCHER", S)], []),
    ])])
    app = ("application", [
        a("label", "MetroSim", S),
        a("icon", 0x7F010000, R),
        a("theme", 0x01030007, R),                 # @android:style/Theme.NoTitleBar.Fullscreen
        a("hardwareAccelerated", True, B),
        # Android 16 (API 36) ya no llama a onBackPressed salvo que la app lo pida: el «atrás» va al historial del juego
        a("enableOnBackInvokedCallback", False, B),
    ], [activity])
    return ("manifest", [
        (False, "package", PACKAGE, S),
        a("versionCode", version_code, I),
        a("versionName", version_name, S),
    ], [
        ("uses-sdk", [a("minSdkVersion", 24, I), a("targetSdkVersion", TARGET_SDK, I)], []),
        ("uses-permission", [a("name", "android.permission.INTERNET", S)], []),
        app,
    ])


def keystore():
    if os.path.exists(KEYSTORE):
        return
    subprocess.run(["keytool", "-genkeypair", "-keystore", KEYSTORE, "-storetype", "PKCS12", "-alias", KEY_ALIAS,
                    "-storepass", KEY_PASS, "-keypass", KEY_PASS, "-keyalg", "RSA", "-keysize", "2048",
                    "-validity", "10000", "-dname", "CN=MetroSim, O=MetroSim, C=CL"], check=True)


def align(src, dst):
    """Reescribe el zip con los archivos sin comprimir alineados a 4 bytes (como zipalign)."""
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for info in zin.infolist():
            data = zin.read(info)
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.external_attr = info.external_attr
            zi.compress_type = info.compress_type
            if zi.compress_type == zipfile.ZIP_STORED:
                start = zout.fp.tell() + 30 + len(zi.filename.encode("utf-8"))
                pad = (-(start + 6)) % 4
                zi.extra = struct.pack("<HHH", 0xD935, 2 + pad, 4) + b"\0" * pad    # campo de alineación (como apksigner)
            zout.writestr(zi, data)
    with zipfile.ZipFile(dst) as z:
        for info in z.infolist():
            if info.compress_type == zipfile.ZIP_STORED:
                off = info.header_offset + 30 + len(info.filename.encode("utf-8")) + len(info.extra)
                assert off % 4 == 0, info.filename


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--three", help="paquete npm three descomprimido")
    ap.add_argument("--aab", action="store_true", help="App Bundle para Google Play en vez de APK")
    ap.add_argument("--out", help="archivo de salida (por defecto dist/MetroSim.apk o dist/MetroSim.aab)")
    args = ap.parse_args()
    out = args.out or os.path.join(ROOT, "dist", "MetroSim.aab" if args.aab else "MetroSim.apk")
    version_name, version_code = version()
    tree = manifest_tree(version_name, version_code)

    with tempfile.TemporaryDirectory() as tmp:
        three = args.three or get_three(tmp)
        www = os.path.join(tmp, "www")
        os.makedirs(www)
        copy_game(www, three)
        keystore()
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

        unsigned = os.path.join(tmp, "unsigned.zip")
        base = "base/" if args.aab else ""
        with zipfile.ZipFile(unsigned, "w", zipfile.ZIP_DEFLATED) as z:
            def put(name, data):
                z.writestr(base + name, data, zipfile.ZIP_STORED if name.lower().endswith(STORED) else zipfile.ZIP_DEFLATED)
            if args.aab:
                z.writestr("BundleConfig.pb", aab.bundle_config())
                put("manifest/AndroidManifest.xml", aab.manifest(tree))
                put("dex/classes.dex", build_dex(CLASSES))
                put("resources.pb", aab.resources(PACKAGE, "res/drawable/icon.png"))
            else:
                put("AndroidManifest.xml", axml.manifest(tree))
                put("classes.dex", build_dex(CLASSES))
                put("resources.arsc", axml.resources(PACKAGE, "res/drawable/icon.png"))
            put("res/drawable/icon.png", open(os.path.join(ROOT, "icons/icon-192.png"), "rb").read())
            for root, dirs, files in os.walk(www):
                dirs.sort()
                for f in sorted(files):
                    full = os.path.join(root, f)
                    put("assets/www/" + os.path.relpath(full, www).replace(os.sep, "/"), open(full, "rb").read())

        if args.aab:
            shutil.copy2(unsigned, out)
            aab.sign(out, KEYSTORE, KEY_ALIAS, KEY_PASS)
        else:
            align(unsigned, out)
            firma.sign(out, KEYSTORE, KEY_PASS)
            firma.verify(out)
    print(f"{out} · MetroSim {version_name} (versionCode {version_code}) · {os.path.getsize(out) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
