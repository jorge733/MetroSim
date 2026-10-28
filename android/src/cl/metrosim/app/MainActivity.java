package cl.metrosim.app;

import android.app.Activity;
import android.content.Intent;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;

/**
 * MetroSim para Android: un WebView a pantalla completa con el juego.
 *
 * Referencia legible: el APK no se compila desde este archivo sino desde
 * android/build/app.py, que arma el mismo bytecode Dalvik sin el SDK de
 * Android (ver android/LEEME.md). Si se cambia uno, hay que cambiar el otro.
 * Los archivos del juego van dentro del APK (assets/www) y se sirven desde
 * https://appassets.androidplatform.net/ para que los módulos ES, fetch()
 * y localStorage funcionen igual que en el navegador.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        web.setWebViewClient(new Client(getAssets()));
        web.setWebChromeClient(new WebChromeClient());
        setContentView(web);
        hideBars();
        web.loadUrl("https://" + HOST + "/index.html");
    }

    /** Pantalla completa inmersiva (las barras del sistema aparecen al deslizar y se vuelven a ocultar). */
    private void hideBars() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) hideBars();
    }

    /** "Atrás" lo maneja el juego (cierra ventanas o pide confirmación); en la portada sale de la app. */
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() { web.onPause(); super.onPause(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); hideBars(); }

    static class Client extends WebViewClient {
        private final AssetManager assets;
        Client(AssetManager assets) { this.assets = assets; }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri url = req.getUrl();
            if (!HOST.equals(url.getHost())) return null;            // el resto (clima) va por internet
            String path = url.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            HashMap<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            String mime = mime(path), charset = charset(mime);
            try {
                InputStream in = assets.open("www".concat(path));
                return new WebResourceResponse(mime, charset, 200, "OK", headers, in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, null);
            }
        }

        /** Enlaces a otros sitios: se abren en el navegador. */
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri url = req.getUrl();
            if (HOST.equals(url.getHost())) return false;
            try { view.getContext().startActivity(new Intent(Intent.ACTION_VIEW, url)); } catch (RuntimeException e) { /* sin navegador */ }
            return true;
        }

        public static String charset(String mime) {
            return mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("xml") ? "utf-8" : null;
        }

        public static String mime(String path) {
            String p = path.toLowerCase();
            if (p.endsWith(".html")) return "text/html";
            if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
            if (p.endsWith(".css")) return "text/css";
            if (p.endsWith(".json")) return "application/json";
            if (p.endsWith(".webmanifest")) return "application/manifest+json";
            if (p.endsWith(".svg")) return "image/svg+xml";
            if (p.endsWith(".png")) return "image/png";
            if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
            if (p.endsWith(".mp3")) return "audio/mpeg";
            if (p.endsWith(".ogg")) return "audio/ogg";
            if (p.endsWith(".woff2")) return "font/woff2";
            return "application/octet-stream";
        }
    }
}
