"""
Bytecode Dalvik del lanzador (equivale a android/src/cl/metrosim/app/MainActivity.java).
Registros: los parámetros van al final (p0 = this en métodos de instancia).
"""
from dex import Class, Method

HOST = "appassets.androidplatform.net"
ACT = "Lcl/metrosim/app/MainActivity;"
CLI = "Lcl/metrosim/app/MainActivity$Client;"
A = "Landroid/app/Activity;"
WV = "Landroid/webkit/WebView;"
WS = "Landroid/webkit/WebSettings;"
WRR = "Landroid/webkit/WebResourceResponse;"
REQ = "Landroid/webkit/WebResourceRequest;"
STR = "Ljava/lang/String;"
OBJ = "Ljava/lang/Object;"
URI = "Landroid/net/Uri;"
AM = "Landroid/content/res/AssetManager;"
WEB = f"{ACT}->web:{WV}"
ASSETS = f"{CLI}->assets:{AM}"
PUBLIC, PROTECTED, PRIVATE, STATIC, CONSTRUCTOR = 0x1, 0x4, 0x2, 0x8, 0x10000

# Pantalla completa inmersiva: IMMERSIVE_STICKY | FULLSCREEN | HIDE_NAVIGATION | LAYOUT_STABLE | LAYOUT_HIDE_NAVIGATION | LAYOUT_FULLSCREEN
UI_FLAGS = 0x1000 | 0x4 | 0x2 | 0x100 | 0x200 | 0x400
# FLAG_KEEP_SCREEN_ON | FLAG_FULLSCREEN
WINDOW_FLAGS = 0x80 | 0x400

MIMES = [(".html", "text/html"), (".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css"),
         (".json", "application/json"), (".webmanifest", "application/manifest+json"), (".svg", "image/svg+xml"),
         (".png", "image/png"), (".jpg", "image/jpeg"), (".jpeg", "image/jpeg"), (".mp3", "audio/mpeg"),
         (".ogg", "audio/ogg"), (".woff2", "font/woff2")]


def main_activity():
    # p0 = v4, p1 = v5 (Bundle)
    on_create = Method(f"{ACT}->onCreate(Landroid/os/Bundle;)V", PROTECTED, 6, [
        ("invoke-super", [4, 5], f"{A}->onCreate(Landroid/os/Bundle;)V"),
        ("invoke-virtual", [4], f"{A}->getWindow()Landroid/view/Window;"),
        ("move-result-object", 0),
        ("const/16", 1, WINDOW_FLAGS),
        ("invoke-virtual", [0, 1], "Landroid/view/Window;->addFlags(I)V"),
        ("new-instance", 0, WV),
        ("invoke-direct", [0, 4], f"{WV}-><init>(Landroid/content/Context;)V"),
        ("iput-object", 0, 4, WEB),
        ("invoke-virtual", [0], f"{WV}->getSettings()Landroid/webkit/WebSettings;"),
        ("move-result-object", 1),
        ("const/4", 2, 1),
        ("const/4", 3, 0),
        ("invoke-virtual", [1, 2], f"{WS}->setJavaScriptEnabled(Z)V"),
        ("invoke-virtual", [1, 2], f"{WS}->setDomStorageEnabled(Z)V"),
        ("invoke-virtual", [1, 2], f"{WS}->setDatabaseEnabled(Z)V"),
        ("invoke-virtual", [1, 3], f"{WS}->setMediaPlaybackRequiresUserGesture(Z)V"),
        ("invoke-virtual", [1, 3], f"{WS}->setAllowFileAccess(Z)V"),
        ("new-instance", 1, CLI),
        ("invoke-virtual", [4], f"{A}->getAssets()Landroid/content/res/AssetManager;"),
        ("move-result-object", 2),
        ("invoke-direct", [1, 2], f"{CLI}-><init>({AM})V"),
        ("invoke-virtual", [0, 1], f"{WV}->setWebViewClient(Landroid/webkit/WebViewClient;)V"),
        ("new-instance", 1, "Landroid/webkit/WebChromeClient;"),
        ("invoke-direct", [1], "Landroid/webkit/WebChromeClient;-><init>()V"),
        ("invoke-virtual", [0, 1], f"{WV}->setWebChromeClient(Landroid/webkit/WebChromeClient;)V"),
        ("invoke-virtual", [4, 0], f"{A}->setContentView(Landroid/view/View;)V"),
        ("invoke-direct", [4], f"{ACT}->hideBars()V"),
        ("const-string", 1, f"https://{HOST}/index.html"),
        ("invoke-virtual", [0, 1], f"{WV}->loadUrl({STR})V"),
        ("return-void",),
    ])
    init = Method(f"{ACT}-><init>()V", PUBLIC | CONSTRUCTOR, 1, [
        ("invoke-direct", [0], f"{A}-><init>()V"),
        ("return-void",),
    ])
    hide_bars = Method(f"{ACT}->hideBars()V", PRIVATE, 3, [
        ("iget-object", 0, 2, WEB),
        ("const/16", 1, UI_FLAGS),
        ("invoke-virtual", [0, 1], f"{WV}->setSystemUiVisibility(I)V"),
        ("return-void",),
    ])
    focus = Method(f"{ACT}->onWindowFocusChanged(Z)V", PUBLIC, 2, [
        ("invoke-super", [0, 1], f"{A}->onWindowFocusChanged(Z)V"),
        ("if-eqz", 1, "end"),
        ("invoke-direct", [0], f"{ACT}->hideBars()V"),
        ("label", "end"),
        ("return-void",),
    ])
    back = Method(f"{ACT}->onBackPressed()V", PUBLIC, 3, [
        ("iget-object", 0, 2, WEB),
        ("invoke-virtual", [0], f"{WV}->canGoBack()Z"),
        ("move-result", 1),
        ("if-eqz", 1, "exit"),
        ("invoke-virtual", [0], f"{WV}->goBack()V"),
        ("return-void",),
        ("label", "exit"),
        ("invoke-super", [2], f"{A}->onBackPressed()V"),
        ("return-void",),
    ])
    pause = Method(f"{ACT}->onPause()V", PROTECTED, 2, [
        ("iget-object", 0, 1, WEB),
        ("invoke-virtual", [0], f"{WV}->onPause()V"),
        ("invoke-super", [1], f"{A}->onPause()V"),
        ("return-void",),
    ])
    resume = Method(f"{ACT}->onResume()V", PROTECTED, 2, [
        ("invoke-super", [1], f"{A}->onResume()V"),
        ("iget-object", 0, 1, WEB),
        ("invoke-virtual", [0], f"{WV}->onResume()V"),
        ("invoke-direct", [1], f"{ACT}->hideBars()V"),
        ("return-void",),
    ])
    return Class(ACT, PUBLIC, A, fields=[(WEB, PRIVATE)],
                 methods=[init, on_create, hide_bars, focus, back, pause, resume])


def client():
    init = Method(f"{CLI}-><init>({AM})V", PUBLIC | CONSTRUCTOR, 2, [
        ("invoke-direct", [0], "Landroid/webkit/WebViewClient;-><init>()V"),
        ("iput-object", 1, 0, ASSETS),
        ("return-void",),
    ])

    # mime(String p0): v0 = ruta en minúsculas, v1 = auxiliar
    mime_code = [
        ("invoke-virtual", [2], f"{STR}->toLowerCase()Ljava/lang/String;"),
        ("move-result-object", 0),
    ]
    for i, (ext, mt) in enumerate(MIMES):
        mime_code += [
            ("const-string", 1, ext),
            ("invoke-virtual", [0, 1], f"{STR}->endsWith({STR})Z"),
            ("move-result", 1),
            ("if-eqz", 1, f"n{i}"),
            ("const-string", 1, mt),
            ("return-object", 1),
            ("label", f"n{i}"),
        ]
    mime_code += [("const-string", 1, "application/octet-stream"), ("return-object", 1)]
    mime = Method(f"{CLI}->mime({STR}){STR}", PUBLIC | STATIC, 3, mime_code)

    # charset(String p0): "utf-8" para texto, null para binarios
    charset = Method(f"{CLI}->charset({STR}){STR}", PUBLIC | STATIC, 3, [
        ("const-string", 0, "utf-8"),
        ("const-string", 1, "text/"),
        ("invoke-virtual", [2, 1], f"{STR}->startsWith({STR})Z"),
        ("move-result", 1),
        ("if-nez", 1, "yes"),
        ("const-string", 1, "json"),
        ("invoke-virtual", [2, 1], f"{STR}->endsWith({STR})Z"),
        ("move-result", 1),
        ("if-nez", 1, "yes"),
        ("const-string", 1, "xml"),
        ("invoke-virtual", [2, 1], f"{STR}->endsWith({STR})Z"),
        ("move-result", 1),
        ("if-nez", 1, "yes"),
        ("const/4", 0, 0),
        ("label", "yes"),
        ("return-object", 0),
    ])

    # shouldInterceptRequest(WebView p1, WebResourceRequest p2): v0..v10 locales, p0 = v11, p1 = v12, p2 = v13
    wrr_init = f"{WRR}-><init>({STR}{STR}I{STR}Ljava/util/Map;Ljava/io/InputStream;)V"
    intercept = Method(f"{CLI}->shouldInterceptRequest({WV}{REQ}){WRR}", PUBLIC, 14, [
        ("invoke-interface", [13], f"{REQ}->getUrl(){URI}"),
        ("move-result-object", 0),
        ("invoke-virtual", [0], f"{URI}->getHost(){STR}"),
        ("move-result-object", 1),
        ("const-string", 2, HOST),
        ("invoke-virtual", [2, 1], f"{STR}->equals({OBJ})Z"),
        ("move-result", 1),
        ("if-nez", 1, "ours"),
        ("const/4", 0, 0),
        ("return-object", 0),                                   # otro sitio (clima): por internet
        ("label", "ours"),
        ("invoke-virtual", [0], f"{URI}->getPath(){STR}"),
        ("move-result-object", 0),
        ("if-eqz", 0, "index"),
        ("const-string", 1, "/"),
        ("invoke-virtual", [0, 1], f"{STR}->equals({OBJ})Z"),
        ("move-result", 1),
        ("if-eqz", 1, "path"),
        ("label", "index"),
        ("const-string", 0, "/index.html"),
        ("label", "path"),
        ("new-instance", 9, "Ljava/util/HashMap;"),
        ("invoke-direct", [9], "Ljava/util/HashMap;-><init>()V"),
        ("const-string", 1, "Cache-Control"),
        ("const-string", 2, "no-cache"),
        ("invoke-virtual", [9, 1, 2], f"Ljava/util/HashMap;->put({OBJ}{OBJ}){OBJ}"),
        ("invoke-static", [0], f"{CLI}->mime({STR}){STR}"),
        ("move-result-object", 5),
        ("invoke-static", [5], f"{CLI}->charset({STR}){STR}"),
        ("move-result-object", 6),
        ("label", "try_start"),
        ("iget-object", 1, 11, ASSETS),
        ("const-string", 2, "www"),
        ("invoke-virtual", [2, 0], f"{STR}->concat({STR}){STR}"),
        ("move-result-object", 2),
        ("invoke-virtual", [1, 2], f"{AM}->open({STR})Ljava/io/InputStream;"),
        ("move-result-object", 10),
        ("label", "try_end"),
        ("new-instance", 4, WRR),
        ("const/16", 7, 200),
        ("const-string", 8, "OK"),
        ("invoke-direct/range", 4, 7, wrr_init),
        ("return-object", 4),
        ("label", "missing"),                                   # IOException: el archivo no está
        ("new-instance", 4, WRR),
        ("const-string", 5, "text/plain"),
        ("const-string", 6, "utf-8"),
        ("const/16", 7, 404),
        ("const-string", 8, "Not Found"),
        ("const/4", 10, 0),
        ("invoke-direct/range", 4, 7, wrr_init),
        ("return-object", 4),
    ], tries=[("try_start", "try_end", [("Ljava/io/IOException;", "missing")])])

    # shouldOverrideUrlLoading(WebView p1, WebResourceRequest p2): v0..v3, p0 = v4, p1 = v5, p2 = v6
    override = Method(f"{CLI}->shouldOverrideUrlLoading({WV}{REQ})Z", PUBLIC, 7, [
        ("invoke-interface", [6], f"{REQ}->getUrl(){URI}"),
        ("move-result-object", 0),
        ("invoke-virtual", [0], f"{URI}->getHost(){STR}"),
        ("move-result-object", 1),
        ("const-string", 2, HOST),
        ("invoke-virtual", [2, 1], f"{STR}->equals({OBJ})Z"),
        ("move-result", 1),
        ("if-eqz", 1, "external"),
        ("const/4", 0, 0),
        ("return", 0),
        ("label", "external"),                                  # enlaces a otros sitios: en el navegador
        ("label", "try_start"),
        ("invoke-virtual", [5], "Landroid/view/View;->getContext()Landroid/content/Context;"),
        ("move-result-object", 1),
        ("new-instance", 2, "Landroid/content/Intent;"),
        ("const-string", 3, "android.intent.action.VIEW"),
        ("invoke-direct", [2, 3, 0], f"Landroid/content/Intent;-><init>({STR}{URI})V"),
        ("invoke-virtual", [1, 2], "Landroid/content/Context;->startActivity(Landroid/content/Intent;)V"),
        ("label", "try_end"),
        ("label", "done"),
        ("const/4", 0, 1),
        ("return", 0),
        ("label", "nobrowser"),
        ("goto", "done"),
    ], tries=[("try_start", "try_end", [("Ljava/lang/RuntimeException;", "nobrowser")])])

    return Class(CLI, PUBLIC, "Landroid/webkit/WebViewClient;", fields=[(ASSETS, PRIVATE | 0x10)],
                 methods=[init, mime, charset, intercept, override])


CLASSES = [main_activity(), client()]
