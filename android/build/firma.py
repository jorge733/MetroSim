"""
Firma APK Signature Scheme v2 (Android 7.0+), sin apksigner.

Calcula los resúmenes SHA-256 por bloques de 1 MB de las tres secciones del
zip (entradas, directorio central y fin de directorio), firma los datos con
RSA PKCS#1 v1.5 + SHA-256 usando openssl y agrega el «APK Signing Block»
entre las entradas y el directorio central.
"""
import hashlib
import os
import struct
import subprocess
import tempfile

ALGO_RSA_PKCS1_SHA256 = 0x0103
V2_BLOCK_ID = 0x7109871A
PADDING_ID = 0x42726577
MAGIC = b"APK Sig Block 42"
CHUNK = 1 << 20


def lp(b):
    """Prefijo de largo (u32) usado en todas las estructuras del bloque de firma."""
    return struct.pack("<I", len(b)) + b


def find_eocd(apk):
    i = apk.rfind(b"PK\x05\x06")
    assert i >= 0 and len(apk) - i == 22, "el zip no debe tener comentario"
    cd_size, cd_off = struct.unpack("<II", apk[i + 12:i + 20])
    assert cd_off + cd_size == i
    return i, cd_off


def content_digest(sections):
    chunks = []
    for s in sections:
        for k in range(0, len(s), CHUNK):
            c = s[k:k + CHUNK]
            chunks.append(hashlib.sha256(b"\xa5" + struct.pack("<I", len(c)) + c).digest())
    return hashlib.sha256(b"\x5a" + struct.pack("<I", len(chunks)) + b"".join(chunks)).digest()


def openssl(*args, data=None):
    return subprocess.run(["openssl", *args], input=data, check=True, capture_output=True).stdout


def sign(apk_path, keystore, password):
    apk = open(apk_path, "rb").read()
    eocd_off, cd_off = find_eocd(apk)
    entries, cd, eocd = apk[:cd_off], apk[cd_off:eocd_off], apk[eocd_off:]
    # El fin de directorio ya apunta a cd_off, que es donde empezará el bloque de firma (como pide el esquema)
    digest = content_digest([entries, cd, eocd])

    with tempfile.TemporaryDirectory() as tmp:
        pem = os.path.join(tmp, "clave.pem")
        openssl("pkcs12", "-in", keystore, "-passin", f"pass:{password}", "-nodes", "-out", pem)
        cert = openssl("x509", "-in", pem, "-outform", "DER")
        pubkey = openssl("pkey", "-in", pem, "-pubout", "-outform", "DER")
        signed_data = lp(lp(struct.pack("<I", ALGO_RSA_PKCS1_SHA256) + lp(digest))) + lp(lp(cert)) + lp(b"")
        key = os.path.join(tmp, "privada.pem")
        openssl("pkey", "-in", pem, "-out", key)
        signature = openssl("dgst", "-sha256", "-sign", key, data=signed_data)

    signer = lp(signed_data) + lp(lp(struct.pack("<I", ALGO_RSA_PKCS1_SHA256) + lp(signature))) + lp(pubkey)
    v2 = lp(lp(signer))

    def pair(pid, value):
        return struct.pack("<QI", 4 + len(value), pid) + value

    pairs = pair(V2_BLOCK_ID, v2)
    # Relleno para que el bloque mida un múltiplo de 4096 bytes (como apksigner)
    total = 8 + len(pairs) + 8 + 16
    pad = (-(total + 12)) % 4096
    pairs += pair(PADDING_ID, b"\0" * pad)
    size = len(pairs) + 8 + 16
    block = struct.pack("<Q", size) + pairs + struct.pack("<Q", size) + MAGIC
    assert len(block) % 4096 == 0

    new_eocd = eocd[:16] + struct.pack("<I", cd_off + len(block)) + eocd[20:]
    open(apk_path, "wb").write(entries + block + cd + new_eocd)


def verify(apk_path):
    """Comprobación propia: rehace el resumen y verifica la firma con la clave pública del bloque."""
    apk = open(apk_path, "rb").read()
    eocd_off, cd_off = find_eocd(apk)
    assert apk[cd_off - 16:cd_off] == MAGIC
    size = struct.unpack("<Q", apk[cd_off - 24:cd_off - 16])[0]
    start = cd_off - size - 8
    assert struct.unpack("<Q", apk[start:start + 8])[0] == size
    pos, v2 = start + 8, None
    while pos < cd_off - 24:
        n, pid = struct.unpack("<QI", apk[pos:pos + 12])
        if pid == V2_BLOCK_ID:
            v2 = apk[pos + 12:pos + 8 + n]
        pos += 8 + n

    def take(b, p):
        n = struct.unpack("<I", b[p:p + 4])[0]
        return b[p + 4:p + 4 + n], p + 4 + n

    signers, _ = take(v2, 0)
    signer, _ = take(signers, 0)
    signed_data, p = take(signer, 0)
    sigs, p = take(signer, p)
    pubkey, _ = take(signer, p)
    sig, _ = take(sigs, 0)
    signature, _ = take(sig, 4)
    digests, _ = take(signed_data, 0)
    d, _ = take(digests, 0)
    digest, _ = take(d, 4)
    eocd = apk[eocd_off:eocd_off + 16] + struct.pack("<I", start) + apk[eocd_off + 20:]
    assert digest == content_digest([apk[:start], apk[cd_off:eocd_off], eocd]), "resumen distinto"
    with tempfile.TemporaryDirectory() as tmp:
        for name, data in (("pub.der", pubkey), ("sig", signature), ("datos", signed_data)):
            open(os.path.join(tmp, name), "wb").write(data)
        openssl("dgst", "-sha256", "-verify", os.path.join(tmp, "pub.der"), "-keyform", "DER",
                "-signature", os.path.join(tmp, "sig"), os.path.join(tmp, "datos"))
    return True
