package com.nextext.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationTap(intent);
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

        // Dismiss splash once the Capacitor bridge is fully initialized
        new Handler(Looper.getMainLooper()).postDelayed(() -> keepSplash = false, 1500);

        // Cold start from a tapped notification → route into that chat.
        handleNotificationTap(getIntent());
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
}
