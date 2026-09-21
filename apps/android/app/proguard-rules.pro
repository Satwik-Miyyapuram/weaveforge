# R8 rules for the inking shell.
#
# ## The one rule that matters
#
# `NativeBridge` is called from JavaScript through `addJavascriptInterface`, which
# is **reflection by another name**: the WebView looks the method up by name on the
# annotated class at call time. R8 cannot see that call — it sees a class nothing in
# the Kotlin references — so without this rule it strips both the class and its
# methods, and the app then ships with `window.AndroidInkingBridge` undefined.
#
# The failure mode is what makes the rule non-optional: it is invisible in debug,
# invisible to the compiler, invisible to every test that does not run a WebView,
# and it takes the whole native capability with it. The web side guards for the
# object's absence (`nativeInkBridge()` returns `null` when `typeof android.setTool`
# is not a function), so the app does not crash — it simply stops inking, silently,
# in release only. That is the worst shape a bug can have, which is why this file
# exists rather than a comment saying "remember the keep rule".
#
# `-keepclassmembers` rather than `-keep`: the class itself may be renamed, because
# nothing outside the WebView refers to it by name. The *members* must survive with
# their names, because the JavaScript calls them as strings.
-keepclassmembers class org.weaveforge.ink.MainActivity$NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# The same argument one level up, and cheap insurance: the bridge class is reached
# only through the instance passed to `addJavascriptInterface`, so a future rename of
# the enclosing activity must not take it out. Keeping the class's name costs a few
# bytes and means the JavascriptInterface debug check can still resolve it.
-keep class org.weaveforge.ink.MainActivity$NativeBridge { *; }

# ## Not needed, and deliberately absent
#
# - The `InkGestureRouter` / `InkGestureView` / `InkingOverlayView` are referenced
#   from code and from `activity_main.xml`. R8 keeps XML-referenced views for the
#   release build through the resource shrinker's own reachability pass, and the
#   custom-view constructor `(Context, AttributeSet)` is kept by the framework rules
#   AGP already applies. A blanket `-keep class org.weaveforge.ink.**` would hide a
#   real problem rather than solve one.
# - There is no reflection anywhere else in this module, and no serialisation, so
#   there is nothing else to name.
