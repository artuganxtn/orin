package com.orin.app;

import android.app.Activity;
import com.orin.app.security.NativeSecurity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.webkit.JsPromptResult;
import android.util.Log;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.ValueCallback;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Bundled ORIN web app. The owned HTTPS origin preserves Firebase email action URLs.
 * No remote home page or administrator key is embedded. Native security uses a scoped prompt bridge.
 */
public final class MainActivity extends Activity {
    private static final String HOST = "orin-99951.web.app";
    private static final String HOME = "https://" + HOST + "/";
    private WebView web;
    private NativeSecurity nativeSecurity;
    private ValueCallback<Uri[]> fileSelection;
    private byte[] pendingExport;
    private static final int PICK_IMAGE=1001, SAVE_EXPORT=1002;

    @Override public void onCreate(Bundle savedInstanceState) {
        String mode=getPreferences(MODE_PRIVATE).getString("appearance","system");
        boolean dark="dark".equals(mode)||("system".equals(mode)&&(getResources().getConfiguration().uiMode & 0x30)==0x20);
        if(dark)setTheme(getResources().getIdentifier("OrinThemeDark","style",getPackageName()));
        super.onCreate(savedInstanceState);
        applyAppearance(dark);
        int background=dark?Color.rgb(6,17,31):Color.rgb(237,244,255);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(background);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        // Keep the unchanged web layout above Android status/navigation bars and keyboard.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());view.setPadding(safe.left,safe.top,safe.right,safe.bottom);return WindowInsets.CONSUMED;}
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        root.requestApplyInsets();
        web.setBackgroundColor(background);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        try { settings.setUserAgentString(settings.getUserAgentString() + " ORINAndroid/" + getPackageManager().getPackageInfo(getPackageName(),0).versionName); } catch(Exception ignored) {}
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsPrompt(WebView view,String url,String message,String value,JsPromptResult result){
                if(nativeSecurity != null && nativeSecurity.handlePrompt(url,message,value,result))return true;
                if(nativeSecurity != null && nativeSecurity.isLocked()){result.cancel();return true;}
                if(message==null || !isLocal(Uri.parse(url)) || !message.startsWith("ORIN_"))return false;
                boolean share=message.startsWith("ORIN_SHARE_REFERRAL:"),copy=message.startsWith("ORIN_COPY_REFERRAL:");
                if(!share&&!copy)return false;
                String content=message.substring(message.indexOf(':')+1);
                boolean validCode=copy&&content.matches("ORIN-[A-F0-9]{12}");
                Uri link=Uri.parse(content);
                boolean validLink=("orin-trader.top".equals(link.getHost())||HOST.equals(link.getHost()))
                    &&"https".equals(link.getScheme())
                    &&"/register".equals(link.getPath())
                    &&link.getQueryParameter("ref")!=null
                    &&link.getQueryParameter("ref").matches("ORIN-[A-F0-9]{12}")
                    &&content.length()<150;
                if(!validCode&&!validLink){result.cancel();return true;}
                try{if(share){Intent intent=new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,content).putExtra(Intent.EXTRA_SUBJECT,"ORIN");startActivity(Intent.createChooser(intent,"دعوة صديق · ORIN"));}
                    else ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("ORIN referral",content));
                    result.confirm("ok");
                }catch(Exception error){result.cancel();}return true;
            }

            @Override public boolean onConsoleMessage(ConsoleMessage message){
                String text=message.message();
                if(message.sourceId()!=null&&message.sourceId().startsWith(HOME)&&text.startsWith("ORIN_DIAGNOSTIC ")){Log.w("ORIN",text);return true;}
                if(message.sourceId()!=null&&message.sourceId().startsWith(HOME)&&text.matches("ORIN_APPEARANCE:(light|dark|system):(light|dark)")){
                    String[] values=text.split(":");getPreferences(MODE_PRIVATE).edit().putString("appearance",values[1]).apply();applyAppearance("dark".equals(values[2]));return true;
                }
                return false;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params){
                if(nativeSecurity!=null&&nativeSecurity.isLocked()){callback.onReceiveValue(null);return true;}
                if(fileSelection!=null)fileSelection.onReceiveValue(null);
                fileSelection=callback;
                Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                pick.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/jpeg","image/png","image/webp"});
                try{startActivityForResult(pick,PICK_IMAGE);}catch(ActivityNotFoundException error){fileSelection.onReceiveValue(null);fileSelection=null;Toast.makeText(MainActivity.this,"تعذر فتح اختيار الصور",Toast.LENGTH_SHORT).show();}
                return true;
            }
        });
        web.setDownloadListener((url,userAgent,disposition,mime,length)->exportFile(url));
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap favicon){if(nativeSecurity!=null)nativeSecurity.invalidateBridge();}
            @Override public void onPageFinished(WebView view,String url){if(isLocal(Uri.parse(url))){view.evaluateJavascript("window.orinNativeReferral=true",null);if(nativeSecurity!=null)nativeSecurity.publishBridge();}}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!isLocal(url)) return null;
                if (!"GET".equals(request.getMethod())) return empty(405, "Method Not Allowed");
                String path = url.getPath();
                if (path == null) path = "/";
                // Reject traversal and keep local missing files from falling back to a remote app.
                if (path.indexOf('\0') >= 0 || path.indexOf('\\') >= 0) return empty(400, "Bad Request");
                for (String part : path.split("/")) if (part.equals("..") || part.equals(".")) return empty(400, "Bad Request");
                String name = path.substring(1);
                if (name.isEmpty() || !name.substring(name.lastIndexOf('/') + 1).contains(".")) name = "index.html";
                try {
                    InputStream data = getAssets().open("public/" + name);
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-cache");
                    headers.put("X-Content-Type-Options", "nosniff");
                    headers.put("Referrer-Policy", "strict-origin-when-cross-origin");
                    return new WebResourceResponse(mime(name), "UTF-8", 200, "OK", headers, data);
                } catch (IOException error) { return empty(404, "Not Found"); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!request.isForMainFrame()) return false;
                if("data".equals(url.getScheme())){exportFile(url.toString());return true;}
                if (isLocal(url) && !url.getPath().startsWith("/__/")) return false;
                String scheme = url.getScheme();
                if ("https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE)); }
                    catch (ActivityNotFoundException error) { Toast.makeText(MainActivity.this, "تعذر فتح الرابط", Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }
        });
        nativeSecurity = new NativeSecurity(this, web, root);
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(HOME);
    }

    private void applyAppearance(boolean dark){
        int color=dark?Color.rgb(6,17,31):Color.rgb(237,244,255);
        getWindow().setStatusBarColor(color);getWindow().setNavigationBarColor(color);
        getWindow().getDecorView().setSystemUiVisibility(dark?0:View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if(web!=null)web.setBackgroundColor(color);
    }
    private static boolean isLocal(Uri url) {
        return "https".equals(url.getScheme()) && HOST.equals(url.getHost()) && (url.getPort() == -1 || url.getPort() == 443);
    }
    private void exportFile(String url){
        if((nativeSecurity!=null&&nativeSecurity.isLocked())||web.getUrl()==null||!isLocal(Uri.parse(web.getUrl()))||pendingExport!=null)return;
        String type=url.startsWith("data:application/pdf;")?"application/pdf":url.startsWith("data:application/json;")?"application/json":url.startsWith("data:text/csv;")?"text/csv":null;
        if(type==null||url.length()>11000000)return;
        try{int comma=url.indexOf(',');if(comma<0)return;boolean pdf=type.equals("application/pdf");
            byte[] content;
            if(pdf){if(!url.substring(0,comma).endsWith(";base64"))return;content=android.util.Base64.decode(url.substring(comma+1),android.util.Base64.DEFAULT);if(content.length<5||content.length>8000000||!new String(content,0,5,StandardCharsets.US_ASCII).equals("%PDF-"))return;}
            else{content=URLDecoder.decode(url.substring(comma+1),"UTF-8").getBytes(StandardCharsets.UTF_8);if(content.length>500000)return;}
            pendingExport=content;
            Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(type).putExtra(Intent.EXTRA_TITLE,pdf?"ORIN-statement.pdf":type.equals("application/json")?"ORIN-my-data.json":"ORIN-statement.csv");startActivityForResult(save,SAVE_EXPORT);
        }catch(Exception error){pendingExport=null;Toast.makeText(this,"تعذر حفظ الملف",Toast.LENGTH_SHORT).show();}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==PICK_IMAGE&&fileSelection!=null){Uri selected=result==RESULT_OK&&data!=null?data.getData():null;if(selected!=null&&!"content".equals(selected.getScheme()))selected=null;fileSelection.onReceiveValue(selected==null?null:new Uri[]{selected});fileSelection=null;}
        if(request==SAVE_EXPORT){byte[] bytes=pendingExport;pendingExport=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null&&bytes!=null){try(OutputStream out=getContentResolver().openOutputStream(data.getData())){if(out!=null)out.write(bytes);Toast.makeText(this,"تم حفظ الملف",Toast.LENGTH_SHORT).show();}catch(IOException error){Toast.makeText(this,"تعذر حفظ الملف",Toast.LENGTH_SHORT).show();}}}
    }
    private static WebResourceResponse empty(int code, String status) {
        return new WebResourceResponse("text/plain", "UTF-8", code, status, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
    private static String mime(String name) {
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (extension) {
            case "html": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": case "webmanifest": return "application/json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "ico": return "image/x-icon";
            case "ttf": return "font/ttf";
            case "woff": return "font/woff";
            case "woff2": return "font/woff2";
            case "wav": return "audio/wav";
            case "ogg": return "audio/ogg";
            case "caf": return "audio/x-caf";
            default: return "application/octet-stream";
        }
    }
    @Override public void onBackPressed() {
        if(nativeSecurity != null && nativeSecurity.interceptBack())return;
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onSaveInstanceState(Bundle state) { web.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onPause() { if(nativeSecurity!=null)nativeSecurity.onPause(); web.onPause(); CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if(nativeSecurity!=null)nativeSecurity.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() { if(nativeSecurity!=null)nativeSecurity.onDestroy(); if(fileSelection!=null){fileSelection.onReceiveValue(null);fileSelection=null;}pendingExport=null;web.destroy(); super.onDestroy(); }
}
