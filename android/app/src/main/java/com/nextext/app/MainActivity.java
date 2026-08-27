package com.nextext.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.PluginHandle;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private boolean keepSplash = true;
    private NextextWebChromeClient chromeClient;
    private NextextNativePlugin nextextPlugin;

    private static final String NOTIF_CHAT_ID_EXTRA = "nextext_chat_id";
    private static final String NOTIF_ACTION_EXTRA = "nextext_action";
    private static final String NOTIF_ACTION_MARK_READ = "mark_read";

    // A tapped local notification carries the chatId as an intent extra. Cold
    // starts arrive in onCreate, warm starts (app already in memory) in
    // onNewIntent. Both funnel here: the plugin stores the chatId for the web
    // app to poll (getPendingNotificationTap) and fires a best-effort event.
    // The "Mark as read" action uses the same extras plus a marker extra and
    // routes to the mark-read handler instead of opening the chat.
    private void handleNotificationTap(Intent intent) {
        if (intent == null) return;
        String chatId = intent.getStringExtra(NOTIF_CHAT_ID_EXTRA);
        if (chatId == null || chatId.isEmpty()) return;
        boolean isMarkRead = NOTIF_ACTION_MARK_READ.equals(intent.getStringExtra(NOTIF_ACTION_EXTRA));
        // Consume the extras so a plain icon re-launch can't re-trigger a route.
        intent.removeExtra(NOTIF_CHAT_ID_EXTRA);
        intent.removeExtra(NOTIF_ACTION_EXTRA);
        if (nextextPlugin == null && bridge != null) {
            try {
                PluginHandle handle = bridge.getPlugin("NextextNative");
                if (handle != null) nextextPlugin = (NextextNativePlugin) handle.getInstance();
            } catch (Exception ignored) { /* plugin may not be loaded yet */ }
        }
        if (nextextPlugin != null) {
            if (isMarkRead) nextextPlugin.onNotificationMarkRead(chatId);
            else nextextPlugin.onNotificationTap(chatId);
        }
    }

    // Device "Share to NexText" (ACTION_SEND / ACTION_SEND_MULTIPLE). Captures
    // the shared text + any media URIs, persists them so the web app can read
    // them on first paint, and fires a window event when the WebView is ready.
    private void handleIncomingShare(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            try {
                String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                ArrayList<String> uris = new ArrayList<>();
                if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                    ArrayList<android.os.Parcelable> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                    if (list != null) {
                        for (android.os.Parcelable p : list) {
                            if (p instanceof android.net.Uri) uris.add(((android.net.Uri) p).toString());
                        }
                    }
                } else {
                    android.os.Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                    if (p instanceof android.net.Uri) uris.add(((android.net.Uri) p).toString());
                }
                if ((text == null || text.isEmpty()) && (subject == null || subject.isEmpty()) && uris.isEmpty()) {
                    intent.removeExtra(Intent.EXTRA_TEXT);
                    intent.removeExtra(Intent.EXTRA_STREAM);
                    return;
                }
                StringBuilder sb = new StringBuilder();
                sb.append("{\"text\":").append(esc(text)).append(",\"subject\":").append(esc(subject)).append(",\"uris\":[");
                for (int i = 0; i < uris.size(); i++) {
                    if (i > 0) sb.append(",");
                    sb.append(esc(uris.get(i)));
                }
                sb.append("]}");
                String json = sb.toString();
                android.content.SharedPreferences prefs = getSharedPreferences("NexTextPrefs", MODE_PRIVATE);
                prefs.edit().putString("nextext_pending_share", json).apply();
                if (bridge != null && bridge.getWebView() != null) {
                    String js = "window.dispatchEvent(new CustomEvent('nextextShare', {detail: " + json + "}));";
                    bridge.getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception ignored) { /* ignore malformed share intents */ }
        }
    }

    private static String esc(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') { b.append('\\'); b.append(c); }
            else if (c == '\n') b.append("\\n");
            else if (c == '\r') b.append("\\r");
            else if (c == '\t') b.append("\\t");
            else b.append(c);
        }
        b.append("\"");
        return b.toString();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationTap(intent);
        handleIncomingShare(intent);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Custom plugin: legacy GoogleSignInClient flow as a fallback for
        // devices where Google Credential Manager is unavailable
        // ("getCredentialAsync no provider dependencies found").
        // Must be registered BEFORE super.onCreate: BridgeActivity creates the
        // bridge inside onCreate, consuming the plugin builder; adding plugins
        // afterwards silently never registers them.
        try {
            this.registerPlugin(LegacyGoogleSignInPlugin.class);
            this.registerPlugin(NextextNativePlugin.class);
        } catch (Exception ignored) { /* plugin registers via annotation scan as fallback */ }

        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> keepSplash);
        super.onCreate(savedInstanceState);

        // Replace the default WebChromeClient with one that manages the WebView
        // media permission request. When the OS-level RECORD_AUDIO/CAMERA
        // permission is not granted yet, it requests it on behalf of the
        // WebView instead of denying the request outright (a denied WebView
        // media request surfaces as NotReadableError "Could not start audio
        // source" and Android keeps a per-session denial for the origin).
        try {
            if (bridge != null && bridge.getWebView() != null) {
                chromeClient = new NextextWebChromeClient(bridge, this);
                bridge.getWebView().setWebChromeClient(chromeClient);
            }
        } catch (Exception ignored) { /* keep default client on any failure */ }

        // Expose a tiny synchronous bridge so the JS disguise gate can read the
        // active icon profile (and the calculator PIN / notepad keyword) from
        // native SharedPreferences on the VERY FIRST paint — without waiting for
        // an async Capacitor call. The WebView localStorage is dropped when
        // setAppIcon kills the process, so reading localStorage first would
        // flash the wrong (default) screen for a frame. This bridge reads the
        // value the native side persisted, eliminating that flash.
        try {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().addJavascriptInterface(new NexTextIconBridge(), "NexTextNativeBridge");
            }
        } catch (Exception ignored) { /* bridge is best-effort */ }

        // Dismiss splash once the Capacitor bridge is fully initialized
        new Handler(Looper.getMainLooper()).postDelayed(() -> keepSplash = false, 1500);

        // Cold start from a tapped notification → route into that chat.
        handleNotificationTap(getIntent());
        handleIncomingShare(getIntent());

        // Apply saved app-icon profile on cold start. On a fresh install the
        // MainActivity is the only enabled launcher entry, so this is a no-op.
        // After the user picks a disguise, the alias gets enabled and the
        // process is killed — on the next launch the launcher shows the alias
        // entry directly, but the alias only renders properly if it stays
        // enabled across process restarts. setComponentEnabledSetting persists
        // through uninstall reinstalls only with the default-component setting,
        // so we re-apply the saved profile here on every cold start as a
        // belt-and-braces guarantee. The JS side has already written the value
        // to a SharedPreferences file (`nextext_icon_profile`) via the bridge.
        try {
            android.content.SharedPreferences prefs = getSharedPreferences("NexTextPrefs", MODE_PRIVATE);
            String profile = prefs.getString("nextext_icon_profile", "default");
            applyIconProfile(profile);
        } catch (Exception ignored) { /* first launch with no saved profile */ }
    }

    /**
     * Enables exactly one launcher entry — either MainActivity (the "default"
     * profile) or one of the MainActivityAlias* activities. Mirrors the same
     * profile table in NextextNativePlugin.setAppIcon(). Runs on a worker
     * thread because PackageManager writes are blocking on some devices.
     */
    private void applyIconProfile(final String profileId) {
        new Thread(() -> {
            try {
                android.content.pm.PackageManager pm = getPackageManager();
                String ctxPkg = getPackageName();
                String[][] profiles = new String[][] {
                    { "default", "com.nextext.app.MainActivity" },
                    { "icon1",   "com.nextext.app.MainActivityAlias1" },
                    { "icon2",   "com.nextext.app.MainActivityAlias2" },
                    { "icon3",   "com.nextext.app.MainActivityAlias3" },
                    { "icon4",   "com.nextext.app.MainActivityAlias4" },
                    { "icon5",   "com.nextext.app.MainActivityAlias5" },
                    { "icon6",   "com.nextext.app.MainActivityAlias6" },
                    { "icon7",   "com.nextext.app.MainActivityAlias7" }
                };
                // setAppIcon() in the plugin already applied the correct component
                // state before killing the process, so on the next cold start the
                // saved profile already matches what's enabled. Re-issuing every
                // setComponentEnabledSetting here is redundant — and doing Package
                // Manager writes during the launch window can get the process
                // killed mid-loop on some ROMs. If that happens with MainActivity
                // already disabled and the alias not yet enabled, there is no
                // enabled launcher entry and Android re-enables the default icon
                // (the "flash, crash, default icon returns" symptom). So we first
                // check whether anything actually needs to change and bail out if
                // the launcher state already matches the saved profile.
                boolean needsChange = false;
                for (String[] p : profiles) {
                    android.content.ComponentName cn = new android.content.ComponentName(ctxPkg, p[1]);
                    int current = pm.getComponentEnabledSetting(cn);
                    int desired = p[0].equals(profileId)
                        ? android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        : android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
                    if (current != desired) { needsChange = true; break; }
                }
                if (!needsChange) return;
                for (String[] p : profiles) {
                    android.content.ComponentName cn = new android.content.ComponentName(ctxPkg, p[1]);
                    int newState = p[0].equals(profileId)
                        ? android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        : android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
                    try {
                        pm.setComponentEnabledSetting(cn, newState,
                            android.content.pm.PackageManager.DONT_KILL_APP);
                    } catch (Exception ignored) { /* unknown alias — skip */ }
                }
            } catch (Exception ignored) { /* best-effort; first launch with no prefs */ }
        }).start();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (chromeClient != null && chromeClient.onActivityPermissionResult(requestCode, grantResults)) {
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    private static class NextextWebChromeClient extends BridgeWebChromeClient {
        private static final int NEXTTEXT_WEBVIEW_PERMS = 7142;
        private final MainActivity activity;
        private PermissionRequest pendingPermissionRequest;

        NextextWebChromeClient(Bridge bridge, MainActivity activity) {
            super(bridge);
            this.activity = activity;
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            android.util.Log.d("NextextMic", "onPermissionRequest resources=" + android.text.TextUtils.join(",", request.getResources()));
            String[] resources = request.getResources();
            if (resources == null || resources.length == 0) {
                android.util.Log.w("NextextMic", "empty permission request -> deny");
                request.deny();
                return;
            }

            boolean needAudio = false;
            boolean needVideo = false;
            boolean needOther = false;
            for (String resource : resources) {
                if ("android.webkit.resource.AUDIO_CAPTURE".equals(resource)) {
                    needAudio = true;
                } else if ("android.webkit.resource.VIDEO_CAPTURE".equals(resource)) {
                    needVideo = true;
                } else {
                    needOther = true;
                }
            }

            if (needOther) {
                // Unknown resource types: let the framework decide.
                super.onPermissionRequest(request);
                return;
            }

            boolean audioGranted = !needAudio
                    || activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
            boolean videoGranted = !needVideo
                    || activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;

            android.util.Log.d("NextextMic", "audioGranted=" + audioGranted + " videoGranted=" + videoGranted);
            if (audioGranted && videoGranted) {
                request.grant(request.getResources());
                return;
            }

            if (pendingPermissionRequest != null) {
                // A permission prompt is already in flight; do not stack another.
                super.onPermissionRequest(request);
                return;
            }

            // Trigger the OS runtime permission prompt so the WebView media
            // request can actually succeed instead of being denied silently.
            pendingPermissionRequest = request;
            List<String> missing = new ArrayList<>();
            if (!audioGranted) missing.add(Manifest.permission.RECORD_AUDIO);
            if (!videoGranted) missing.add(Manifest.permission.CAMERA);
            activity.requestPermissions(missing.toArray(new String[0]), NEXTTEXT_WEBVIEW_PERMS);
        }

        boolean onActivityPermissionResult(int requestCode, int[] grantResults) {
            if (requestCode != NEXTTEXT_WEBVIEW_PERMS || pendingPermissionRequest == null) {
                return false;
            }
            PermissionRequest pr = pendingPermissionRequest;
            pendingPermissionRequest = null;
            boolean allGranted = grantResults != null;
            if (allGranted) {
                for (int r : grantResults) {
                    if (r != PackageManager.PERMISSION_GRANTED) {
                        allGranted = false;
                        break;
                    }
                }
            }
            android.util.Log.d("NextextMic", "permission result allGranted=" + allGranted);
            if (allGranted) {
                pr.grant(pr.getResources());
            } else {
                pr.deny();
            }
            return true;
        }
    }

    // Synchronous bridge for the JS disguise gate. Called from getActiveProfileId
    // / getCalculatorPin / getNotepadKeyword on the first paint so the launcher
    // icon + unlock state are correct without an async round-trip. Reads the
    // same SharedPreferences that NextextNativePlugin.setAppIcon writes.
    private class NexTextIconBridge {
        @JavascriptInterface
        public String getActiveIcon() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("NexTextPrefs", MODE_PRIVATE);
                return prefs.getString("nextext_icon_profile", "default");
            } catch (Exception ignored) { return "default"; }
        }

        @JavascriptInterface
        public String getCalculatorPin() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("NexTextPrefs", MODE_PRIVATE);
                return prefs.getString("nextext_calc_pin", "");
            } catch (Exception ignored) { return ""; }
        }

        @JavascriptInterface
        public String getNotepadKeyword() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("NexTextPrefs", MODE_PRIVATE);
                return prefs.getString("nextext_notes_keyword", "");
            } catch (Exception ignored) { return ""; }
        }

        @JavascriptInterface
        public String getPendingShare() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("NexTextPrefs", MODE_PRIVATE);
                return prefs.getString("nextext_pending_share", "");
            } catch (Exception ignored) { return ""; }
        }

        @JavascriptInterface
        public void clearPendingShare() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("NexTextPrefs", MODE_PRIVATE);
                prefs.edit().remove("nextext_pending_share").apply();
            } catch (Exception ignored) { /* best-effort */ }
        }
    }
}
