# The JS bridge and the plugin are found by reflection.
-keep class org.weaveforge.ink.InkPlugin { *; }

# R8 must keep the methods the page calls through window.AndroidInkingBridge.
-keepclassmembers class org.weaveforge.ink.InkBridge {
    @android.webkit.JavascriptInterface <methods>;
}
