package com.nextext.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.view.View;
import androidx.core.app.ActivityCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(
    name = "NextextNative",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone"),
        @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera"),
        @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = "contacts"),
        @Permission(strings = {
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VIDEO,
            Manifest.permission.READ_MEDIA_AUDIO,
            Manifest.permission.READ_EXTERNAL_STORAGE
        }, alias = "media"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications"),
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "location")
    }
)
public class NextextNativePlugin extends Plugin {

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent intent = new Intent(Settings.ACTION_SETTINGS);
                getActivity().startActivity(intent);
                call.resolve();
            } catch (Exception ex) {
                call.reject("Unable to open app settings");
            }
        }
    }

    @PluginMethod
    public void openExternalUrl(PluginCall call) {
        // Opens a URL in the device's system browser via an Android intent.
        // window.open("_system") inside the WebView is unreliable on some
        // devices (returns a truthy handle but opens nothing), so downloads and
        // share fallbacks go through this instead.
        final String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("No URL provided");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open URL: " + (e.getMessage() == null ? String.valueOf(e) : e.getMessage()));
        }
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        // Android 13+ (API 33) requires a runtime prompt for POST_NOTIFICATIONS.
        // On older Android the permission is granted automatically and no prompt
        // exists (and none should be shown).
        if (android.os.Build.VERSION.SDK_INT < 33) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            ret.put("status", "granted");
            call.resolve(ret);
            return;
        }
        if (getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            ret.put("status", "granted");
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("notifications", call, "notifPermsCallback");
    }

    @PluginMethod
    public void getAndroidSdkVersion(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("sdkInt", android.os.Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestLocationPermission(PluginCall call) {
        // Android 10+ (API 29) requires ACCESS_FINE_LOCATION or ACCESS_COARSE_LOCATION.
        // We request ACCESS_FINE_LOCATION for best accuracy.
        if (getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            ret.put("status", "granted");
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("location", call, "locationPermsCallback");
    }

    @PluginMethod
    public void getLocationPermission(PluginCall call) {
        // Pure status query — NEVER triggers the runtime prompt. The Permissions
        // screen uses this for the status row so that simply opening the screen
        // (or refreshing it) doesn't pop the OS dialog.
        boolean fine = getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = getContext().checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", fine || coarse);
        ret.put("fineGranted", fine);
        ret.put("coarseGranted", coarse);
        ret.put("status", (fine || coarse) ? "granted" : "unknown");
        call.resolve(ret);
    }

    // A chatId carried by a tapped local notification, held until the web app
    // is ready to route it (emitted as an event, and retrievable on cold start
    // via getPendingNotificationTap so the tap isn't lost before JS mounts).
    private static String pendingNotificationTapChatId = null;

    public void onNotificationTap(String chatId) {
        if (chatId == null || chatId.isEmpty()) return;
        pendingNotificationTapChatId = chatId;
        try {
            JSObject data = new JSObject();
            data.put("chatId", chatId);
            notifyListeners("localNotificationTap", data);
        } catch (Exception ignored) { /* event delivery is best-effort */ }
    }

    @PluginMethod
    public void getPendingNotificationTap(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("chatId", pendingNotificationTapChatId == null ? "" : pendingNotificationTapChatId);
        pendingNotificationTapChatId = null;
        call.resolve(ret);
    }

    @PluginMethod
    public void showLocalNotification(PluginCall call) {
        // Shows a real Android status-bar notification. HTML5 Notification is a
        // no-op in the Capacitor WebView on modern Android, so this native
        // bridge is the real notification path: heads-up/inbox notifications on
        // the dedicated nextext_messages channel. The title is the sender's
        // name (direct chats) or the group name (group chats, with the sender
        // as a sub-text), with a proper white notification icon, the brand
        // green accent, a large app-icon image and an expanded big-text body —
        // and tapping it routes straight into the chat that sent the message.
        final String fallbackTitle = call.getString("title", "NexText");
        final String fallbackBody = call.getString("body", "");
        final String senderName = call.getString("senderName", "");
        final String groupName = call.getString("groupName", "");
        final String messageText = call.getString("messageText", "");
        final String chatId = call.getString("chatId", "");
        final String tag = call.getString("tag", "nextext");
        new Thread(() -> {
            try {
                android.content.Context ctx = getContext();
                String channelId = "nextext_messages";
                android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) {
                    call.reject("no notification manager");
                    return;
                }
                if (android.os.Build.VERSION.SDK_INT >= 26) {
                    android.app.NotificationChannel channel = new android.app.NotificationChannel(
                        channelId, "Messages", android.app.NotificationManager.IMPORTANCE_HIGH);
                    channel.setDescription("New messages and alerts");
                    channel.enableLights(true);
                    channel.setLightColor(0xFF10B981);
                    nm.createNotificationChannel(channel);
                }
                // Title: for group messages the GROUP name leads (the sender
                // appears as a small sub-text beneath it); for direct messages
                // the sender's name is the title.
                String title;
                String subText = null;
                if (groupName != null && !groupName.isEmpty()) {
                    title = groupName;
                    subText = senderName;
                } else if (senderName != null && !senderName.isEmpty()) {
                    title = senderName;
                } else {
                    title = fallbackTitle;
                }
                String body = (messageText != null && !messageText.isEmpty()) ? messageText : fallbackBody;
                android.app.Notification.Builder builder;
                if (android.os.Build.VERSION.SDK_INT >= 26) {
                    builder = new android.app.Notification.Builder(ctx, channelId);
                } else {
                    builder = new android.app.Notification.Builder(ctx);
                }
                builder.setSmallIcon(R.drawable.ic_stat_nextext)
                    .setColor(0xFF10B981)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setAutoCancel(true)
                    .setWhen(System.currentTimeMillis())
                    .setPriority(android.app.Notification.PRIORITY_HIGH)
                    .setCategory(android.app.Notification.CATEGORY_MESSAGE)
                    .setDefaults(android.app.Notification.DEFAULT_SOUND | android.app.Notification.DEFAULT_VIBRATE | android.app.Notification.DEFAULT_LIGHTS);
                // Group messages show the sender as a small sub-text under the
                // group name (title), so the sender is always identifiable.
                try {
                    if (subText != null && !subText.isEmpty() && android.os.Build.VERSION.SDK_INT >= 16) {
                        builder.setSubText(subText);
                    }
                } catch (Exception ignored) { /* sub-text is best-effort */ }
                // Large icon = the app's launcher icon, for a richer heads-up.
                try {
                    android.graphics.Bitmap large = android.graphics.BitmapFactory.decodeResource(
                        ctx.getResources(), ctx.getApplicationInfo().icon);
                    if (large != null) builder.setLargeIcon(large);
                } catch (Exception ignored) { /* large icon is best-effort */ }
                // Expanded big-text body showing the full message.
                try {
                    if (android.os.Build.VERSION.SDK_INT >= 16) {
                        builder.setStyle(new android.app.Notification.BigTextStyle().bigText(body));
                    }
                } catch (Exception ignored) { /* style is best-effort */ }
                // Content intent: launches the app carrying the chatId so the
                // tap can route the user straight into the conversation.
                android.content.Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    if (chatId != null && !chatId.isEmpty()) launch.putExtra("nextext_chat_id", chatId);
                    android.app.PendingIntent pi = android.app.PendingIntent.getActivity(
                        ctx, (chatId == null ? "".hashCode() : chatId.hashCode()), launch,
                        android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
                    builder.setContentIntent(pi);
                }
                nm.notify(tag, 0, builder.build());
                call.resolve();
            } catch (final Exception e) {
                call.reject("notification failed: " + (e.getMessage() == null ? String.valueOf(e) : e.getMessage()));
            }
        }).start();
    }

    @PermissionCallback
    private void locationPermsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        boolean granted = getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        ret.put("granted", granted);
        ret.put("status", granted ? "granted" : "denied");
        call.resolve(ret);
    }

    @PermissionCallback
    private void notifPermsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        boolean granted = getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        ret.put("granted", granted);
        ret.put("status", granted ? "granted" : "denied");
        call.resolve(ret);
    }

    @PluginMethod
    public void getMicrophonePermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", micGranted());
        call.resolve(ret);
    }

    @PluginMethod
    public void testMicrophone(final PluginCall call) {
        // Runs a real native AudioRecord/MediaRecorder probe off the UI thread.
        // If this succeeds while the WebView's getUserMedia throws
        // NotReadableError, the problem is the WebView media path (fix: record
        // natively). If this also fails, the OS-level mic is busy/unavailable.
        new Thread(() -> {
            JSObject ret = new JSObject();
            ret.put("osGranted", micGranted());
            if (!micGranted()) {
                ret.put("works", false);
                ret.put("reason", "os_permission_not_granted");
                call.resolve(ret);
                return;
            }
            android.media.MediaRecorder recorder = null;
            try {
                String file = getContext().getCacheDir() + "/nextext_mic_probe.m4a";
                recorder = new android.media.MediaRecorder();
                recorder.setAudioSource(android.media.MediaRecorder.AudioSource.MIC);
                recorder.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4);
                recorder.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC);
                recorder.setAudioEncodingBitRate(128000);
                recorder.setAudioSamplingRate(44100);
                recorder.setOutputFile(file);
                recorder.prepare();
                recorder.start();
                Thread.sleep(300);
                recorder.stop();
                recorder.release();
                recorder = null;
                ret.put("works", true);
            } catch (Exception e) {
                ret.put("works", false);
                ret.put("reason", String.valueOf(e));
            } finally {
                if (recorder != null) {
                    try { recorder.release(); } catch (Exception ignored) {}
                }
            }
            call.resolve(ret);
        }).start();
    }

    @PluginMethod
    public void getCameraPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", camGranted());
        call.resolve(ret);
    }

    @PluginMethod
    public void getContactsPermission(PluginCall call) {
        resolveGranted(call, contactsGranted());
    }

    @PluginMethod
    public void getMediaPermission(PluginCall call) {
        resolveGranted(call, mediaGranted());
    }

    @PluginMethod
    public void requestContacts(PluginCall call) {
        if (contactsGranted()) {
            resolveGranted(call, true);
            return;
        }
        requestPermissionForAlias("contacts", call, "contactsPermissionResult");
    }

    @PluginMethod
    public void getDeviceContacts(final PluginCall call) {
        // Reads names + phone numbers from the device's contacts so the app can
        // match them against NexText users and offer invite/share for the rest.
        new Thread(() -> {
            JSObject ret = new JSObject();
            if (!contactsGranted()) {
                ret.put("granted", false);
                call.resolve(ret);
                return;
            }
            org.json.JSONArray list = new org.json.JSONArray();
            try {
                android.content.Context ctx = getContext();
                android.net.Uri uri = android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI;
                String[] projection = new String[] {
                    android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER
                };
                android.database.Cursor cur = ctx.getContentResolver().query(
                    uri, projection, null, null, android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " COLLATE NOCASE ASC");
                if (cur != null) {
                    java.util.HashSet<String> seen = new java.util.HashSet<>();
                    while (cur.moveToNext()) {
                        String name = cur.getString(0);
                        String number = cur.getString(1);
                        String digits = number == null ? "" : number.replaceAll("[^0-9+]", "");
                        String key = (name == null ? "" : name) + "|" + digits;
                        if (name == null || digits.length() < 6 || !seen.add(key)) continue;
                        org.json.JSONObject c = new org.json.JSONObject();
                        c.put("name", name);
                        c.put("phone", digits);
                        list.put(c);
                    }
                    cur.close();
                }
                ret.put("granted", true);
                ret.put("contacts", list);
            } catch (Exception e) {
                ret.put("granted", true);
                ret.put("contacts", list);
                ret.put("error", String.valueOf(e));
            }
            call.resolve(ret);
        }).start();
    }

    @PluginMethod
    public void requestMedia(PluginCall call) {
        if (mediaGranted()) {
            resolveGranted(call, true);
            return;
        }
        // On API 33+ only the READ_MEDIA_* permissions are real runtime
        // permissions (READ_EXTERNAL_STORAGE is ignored). Below 33 the reverse
        // is true. Requesting both sets is harmless — the OS silently denies
        // the ones that don't apply to this version.
        requestPermissionForAlias("media", call, "mediaPermissionResult");
    }

    @PermissionCallback
    private void contactsPermissionResult(PluginCall call) {
        resolveGranted(call, contactsGranted());
    }

    @PermissionCallback
    private void mediaPermissionResult(PluginCall call) {
        resolveGranted(call, mediaGranted());
    }

    @PluginMethod
    public void getSystemInsets(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            View decorView = getActivity().getWindow().getDecorView();
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decorView);
            int top = 0;
            int bottom = 0;
            if (insets != null) {
                androidx.core.graphics.Insets sys = insets.getInsets(WindowInsetsCompat.Type.systemBars());
                // Only report insets the app ACTUALLY draws under (edge-to-edge).
                // When the window is not edge-to-edge the system lays the WebView
                // out below the status bar / above the nav bar, so the app does
                // not need to pad for them (padding them again would create gaps).
                android.graphics.Rect frame = new android.graphics.Rect();
                decorView.getWindowVisibleDisplayFrame(frame);
                if (frame.top <= 0) top = sys.top;          // content reaches under the status bar
                if (frame.bottom >= decorView.getHeight()) bottom = sys.bottom; // content reaches under the nav bar
            }
            ret.put("top", top);
            ret.put("bottom", bottom);
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("top", 0);
            ret.put("bottom", 0);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void downloadAndInstallApk(final PluginCall call) {
        // Downloads an APK to the app's private cache and hands it to the
        // Android package installer via FileProvider — no browser needed, so it
        // works on phones without a browser app installed.
        final String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("No download URL provided");
            return;
        }
        new Thread(() -> {
            File apk = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists()) dir.mkdirs();
                apk = new File(dir, "nextext-update.apk");
                HttpURLConnection conn = openFollowingRedirects(url);
                int code = conn.getResponseCode();
                if (code >= 400) {
                    call.reject("Download failed (HTTP " + code + ")");
                    conn.disconnect();
                    return;
                }
                InputStream in = conn.getInputStream();
                FileOutputStream out = new FileOutputStream(apk);
                byte[] buf = new byte[8192];
                int n;
                long total = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    total += n;
                }
                out.flush();
                out.close();
                in.close();
                conn.disconnect();
                if (total == 0 || apk.length() == 0) {
                    call.reject("Downloaded file is empty");
                    return;
                }
                // Android 8+ requires the user to allow "Install unknown apps"
                // for THIS app before the package installer will accept it. If
                // it's not granted, route them to the permission screen instead
                // of silently failing with a confusing installer error.
                if (android.os.Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    settingsIntent.setData(Uri.parse("package:" + getContext().getPackageName()));
                    settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        getActivity().startActivity(settingsIntent);
                    } catch (Exception ignored) {
                        // No settings screen available — let the installer try anyway.
                    }
                    call.reject("REQUIRES_INSTALL_PERMISSION");
                    return;
                }
                Uri contentUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apk
                );
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                // FLAG_ACTIVITY_NEW_TASK is required when startActivity is called
                // from outside an Activity context (which is the case inside a
                // Capacitor plugin that may resolve after the foreground activity
                // state has changed).
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
                call.resolve();
            } catch (final Exception e) {
                call.reject("Download failed: " + (e.getMessage() == null ? String.valueOf(e) : e.getMessage()));
            }
        }).start();
    }

    /**
     * Opens an HttpURLConnection to {@code url} and manually follows HTTP
     * redirects (301/302/303/307/308). Java's HttpURLConnection does NOT
     * follow cross-host redirects by default (e.g. github.com →
     * objects.githubusercontent.com), so this helper is mandatory for
     * downloading GitHub release assets over S3-backed redirects.
     *
     * IMPORTANT: request properties and timeouts are applied to EVERY
     * connection BEFORE its request is made (before getResponseCode() is ever
     * called). Applying them to the returned connection would throw
     * "cannot set request property after request is made", because the redirect
     * loop below already made the request to detect the redirect.
     */
    private HttpURLConnection openFollowingRedirects(String url) throws java.io.IOException {
        String current = url;
        for (int i = 0; i < 5; i++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(120000);
            conn.setRequestProperty("Accept", "application/vnd.android.package-archive");
            conn.setRequestProperty("User-Agent", "NexText-Android/" + android.os.Build.VERSION.RELEASE);
            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_PERM
                    || code == HttpURLConnection.HTTP_MOVED_TEMP
                    || code == HttpURLConnection.HTTP_SEE_OTHER
                    || code == 307
                    || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null || loc.isEmpty()) throw new java.io.IOException("Redirect with no Location");
                current = loc;
                continue;
            }
            return conn;
        }
        throw new java.io.IOException("Too many redirects");
    }

    @PluginMethod
    public void saveApkToDevice(final PluginCall call) {
        // Downloads the APK and saves it into the device's Downloads folder so
        // the user can find/install it later, WITHOUT launching the installer.
        final String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("No download URL provided");
            return;
        }
        new Thread(() -> {
            File temp = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists()) dir.mkdirs();
                temp = new File(dir, "nextext-download.apk");
                HttpURLConnection conn = openFollowingRedirects(url);
                int code = conn.getResponseCode();
                if (code >= 400) {
                    call.reject("Download failed (HTTP " + code + ")");
                    conn.disconnect();
                    return;
                }
                InputStream in = conn.getInputStream();
                FileOutputStream out = new FileOutputStream(temp);
                byte[] buf = new byte[8192];
                int n;
                long total = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    total += n;
                }
                out.flush();
                out.close();
                in.close();
                conn.disconnect();
                if (total == 0 || temp.length() == 0) {
                    call.reject("Downloaded file is empty");
                    return;
                }

                String fileName = "NexText-" + System.currentTimeMillis() + ".apk";
                String savedPath;
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    // Scoped storage: write via MediaStore.Downloads (no permission needed).
                    android.content.ContentValues cv = new android.content.ContentValues();
                    cv.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                    cv.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/vnd.android.package-archive");
                    cv.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/NexText");
                    Uri item = getContext().getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (item == null) {
                        call.reject("Could not create file in Downloads");
                        return;
                    }
                    java.io.OutputStream os = getContext().getContentResolver().openOutputStream(item);
                    java.io.FileInputStream fis = new java.io.FileInputStream(temp);
                    byte[] b = new byte[8192];
                    int read;
                    while ((read = fis.read(b)) > 0) os.write(b, 0, read);
                    os.flush();
                    os.close();
                    fis.close();
                    savedPath = item.toString();
                } else {
                    // Legacy storage: write to the public Downloads directory.
                    File dl = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                    if (dl == null || !dl.exists()) dl.mkdirs();
                    File dest = new File(dl, fileName);
                    java.io.FileInputStream fis = new java.io.FileInputStream(temp);
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(dest);
                    byte[] b = new byte[8192];
                    int read;
                    while ((read = fis.read(b)) > 0) fos.write(b, 0, read);
                    fos.flush();
                    fos.close();
                    fis.close();
                    savedPath = dest.getAbsolutePath();
                }
                temp.delete();
                JSObject ret = new JSObject();
                ret.put("path", savedPath);
                ret.put("fileName", fileName);
                call.resolve(ret);
            } catch (final Exception e) {
                if (temp != null) { try { temp.delete(); } catch (Exception ignored) {} }
                call.reject("Download failed: " + (e.getMessage() == null ? String.valueOf(e) : e.getMessage()));
            }
        }).start();
    }

    @PluginMethod
    public void requestMicrophone(PluginCall call) {
        if (micGranted()) {
            resolveGranted(call, true);
            return;
        }
        requestPermissionForAlias("microphone", call, "micPermissionResult");
    }

    @PluginMethod
    public void requestCamera(PluginCall call) {
        if (camGranted()) {
            resolveGranted(call, true);
            return;
        }
        requestPermissionForAlias("camera", call, "cameraPermissionResult");
    }

    @PermissionCallback
    private void micPermissionResult(PluginCall call) {
        resolveGranted(call, micGranted());
    }

    @PermissionCallback
    private void cameraPermissionResult(PluginCall call) {
        resolveGranted(call, camGranted());
    }

    private boolean micGranted() {
        return getContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private android.media.MediaRecorder activeRecorder = null;
    private File activeRecorderFile = null;

    @PluginMethod
    public void startVoiceRecording(final PluginCall call) {
        if (!micGranted()) {
            requestPermissionForAlias("microphone", call, "micPermissionForVoice");
            return;
        }
        try {
            stopAndReleaseRecorder();
            File out = new File(getContext().getCacheDir(), "nextext_voice_" + System.currentTimeMillis() + ".m4a");
            android.media.MediaRecorder r = new android.media.MediaRecorder();
            // Preferred config: mono AAC/MPEG-4 at 44.1kHz, 96kbps. Explicit
            // mono channels prevent some AAC encoders from emitting flat/silent
            // output when the channel count is unset. If a device rejects this
            // config at prepare() (exotic encoders), retry with a minimal
            // config so recording still works instead of failing to the webview.
            try {
                r.setAudioSource(android.media.MediaRecorder.AudioSource.MIC);
                r.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4);
                r.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC);
                r.setAudioEncodingBitRate(96000);
                r.setAudioSamplingRate(44100);
                r.setAudioChannels(1);
                r.setOutputFile(out.getAbsolutePath());
                r.prepare();
            } catch (final Exception first) {
                try { r.reset(); } catch (final Exception ignored) {}
                r.setAudioSource(android.media.MediaRecorder.AudioSource.MIC);
                r.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4);
                r.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC);
                r.setOutputFile(out.getAbsolutePath());
                r.prepare();
            }
            r.start();
            activeRecorder = r;
            activeRecorderFile = out;
            startAmplitudeTimer(r);
            call.resolve();
        } catch (final Exception e) {
            stopAndReleaseRecorder();
            call.reject("start failed: " + (e.getMessage() == null ? String.valueOf(e) : e.getMessage()));
        }
    }

    @PermissionCallback
    private void micPermissionForVoice(PluginCall call) {
        if (!micGranted()) {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            call.resolve(ret);
            return;
        }
        startVoiceRecording(call);
    }

    // Tiny one-shot haptic buzz used to confirm a press (e.g. starting a
    // hold-to-record gesture). Clamped to 1-400ms so a bad arg can't vibrate
    // the phone for minutes.
    @PluginMethod
    public void vibrate(PluginCall call) {
        Long ms = call.getLong("ms");
        if (ms == null) ms = 30L;
        final long duration = Math.max(1, Math.min(400, ms));
        try {
            android.os.Vibrator v = (android.os.Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) { call.resolve(); return; }
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                v.vibrate(android.os.VibrationEffect.createOneShot(duration, android.os.VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(duration);
            }
            call.resolve();
        } catch (final Exception e) {
            call.reject("vibrate failed: " + (e.getMessage() == null ? String.valueOf(e) : e.getMessage()));
        }
    }

    // Polls MediaRecorder.getMaxAmplitude() on a background timer and emits a
    // "voiceLevel" event (0..1) so the JS side can draw a live waveform while
    // the user is recording. getMaxAmplitude() returns the peak since the last
    // call, so polling every ~80ms produces a real audio envelope.
    private java.util.Timer amplitudeTimer = null;

    private void startAmplitudeTimer(final android.media.MediaRecorder r) {
        stopAmplitudeTimer();
        if (r == null) return;
        final java.util.Timer t = new java.util.Timer();
        amplitudeTimer = t;
        t.scheduleAtFixedRate(new java.util.TimerTask() {
            @Override
            public void run() {
                if (r != null) {
                    int amp = 0;
                    try { amp = r.getMaxAmplitude(); } catch (final Exception ignored) {}
                    // getMaxAmplitude returns 0 during initial silence, else 1..32767.
                    // 16000 is a comfortable full-scale threshold for a voice level.
                    final double norm = Math.min(1.0, amp / 16000.0);
                    try {
                        JSObject data = new JSObject();
                        data.put("level", norm);
                        getActivity().runOnUiThread(() -> {
                            try { notifyListeners("voiceLevel", data); } catch (final Exception ignored) {}
                        });
                    } catch (final Exception ignored) {}
                }
            }
        }, 120, 80);
    }

    private void stopAmplitudeTimer() {
        final java.util.Timer t = amplitudeTimer;
        amplitudeTimer = null;
        if (t != null) { try { t.cancel(); } catch (final Exception ignored) {} }
    }

    @PluginMethod
    public void pauseVoiceRecording(PluginCall call) {
        try {
            if (activeRecorder == null) { call.resolve(); return; }
            activeRecorder.pause();
            call.resolve();
        } catch (final Exception e) {
            call.reject("pause failed: " + (e.getMessage() == null ? String.valueOf(e) : e.getMessage()));
        }
    }

    @PluginMethod
    public void resumeVoiceRecording(PluginCall call) {
        try {
            if (activeRecorder == null) { call.resolve(); return; }
            activeRecorder.resume();
            call.resolve();
        } catch (final Exception e) {
            call.reject("resume failed: " + (e.getMessage() == null ? String.valueOf(e) : e.getMessage()));
        }
    }

    @PluginMethod
    public void stopVoiceRecording(final PluginCall call) {
        // Stop + read the recorded file off the UI thread; stop() can block for
        // a moment and base64-encoding a multi-MB file must never run on the
        // main thread.
        new Thread(() -> {
            stopAmplitudeTimer();
            File out = activeRecorderFile;
            android.media.MediaRecorder r = activeRecorder;
            activeRecorder = null;
            activeRecorderFile = null;
            try {
                if (r != null) {
                    try { r.stop(); } catch (Exception ignored) {}
                    try { r.release(); } catch (Exception ignored) {}
                }
                if (out == null || !out.exists() || out.length() == 0) {
                    call.reject("no recording");
                    return;
                }
                byte[] bytes = new byte[(int) out.length()];
                java.io.FileInputStream fis = new java.io.FileInputStream(out);
                try {
                    int off = 0;
                    while (off < bytes.length) {
                        int n = fis.read(bytes, off, bytes.length - off);
                        if (n < 0) break;
                        off += n;
                    }
                } finally {
                    fis.close();
                }
                out.delete();
                JSObject ret = new JSObject();
                ret.put("base64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
                ret.put("mimeType", "audio/mp4");
                call.resolve(ret);
            } catch (final Exception e) {
                if (out != null) { try { out.delete(); } catch (Exception ignored) {} }
                call.reject("stop failed: " + (e.getMessage() == null ? String.valueOf(e) : e.getMessage()));
            }
        }).start();
    }

    @PluginMethod
    public void cancelVoiceRecording(PluginCall call) {
        stopAndReleaseRecorder();
        call.resolve();
    }

    private void stopAndReleaseRecorder() {
        stopAmplitudeTimer();
        android.media.MediaRecorder r = activeRecorder;
        activeRecorder = null;
        File out = activeRecorderFile;
        activeRecorderFile = null;
        if (r != null) {
            try { r.stop(); } catch (Exception ignored) {}
            try { r.release(); } catch (Exception ignored) {}
        }
        if (out != null) {
            try { out.delete(); } catch (Exception ignored) {}
        }
    }

    private boolean camGranted() {
        return getContext().checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean contactsGranted() {
        return getContext().checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean mediaGranted() {
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            boolean images = getContext().checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED;
            boolean video = getContext().checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED;
            return images || video;
        }
        return getContext().checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void resolveGranted(PluginCall call, boolean granted) {
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }
}
