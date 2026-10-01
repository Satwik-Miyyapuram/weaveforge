import SafariServices
import UIKit
import WebKit

/// The whole app is the web app in a WKWebView, with the same host allow-list as
/// the Android shell (apps/android/app/build.gradle.kts): anything else opens in Safari.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private static let appURL = URL(string: "https://app.weaveforge.org/")!
    private static let allowedHosts: [String] = [
        "app.weaveforge.org", "api.weaveforge.org", "weaveforge.org", "supabase.co",
        "google.com", "gstatic.com", "googleusercontent.com", "googleapis.com",
        "google-analytics.com", "googletagmanager.com", "cloudflarestorage.com",
    ]

    private var webView: WKWebView!

    private static func isAllowed(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased() else { return false }
        return allowedHosts.contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        // Google sign-in refuses embedded web views whose UA lacks the Safari token.
        config.applicationNameForUserAgent = "Version/17.0 Mobile/15E148 Safari/604.1"

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0xF1 / 255, green: 0xEC / 255, blue: 0xE1 / 255, alpha: 1)
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: Self.appURL))
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let url = navigationAction.request.url
        if url?.scheme == "about" || url?.scheme == "blob" || url?.scheme == "data" || Self.isAllowed(url) {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        if let url, ["http", "https"].contains(url.scheme ?? "") {
            present(SFSafariViewController(url: url), animated: true)
        } else if let url {
            UIApplication.shared.open(url)
        }
    }

    // window.open: load allowed pages here (OAuth popups), send the rest to Safari.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            if Self.isAllowed(url) {
                webView.load(navigationAction.request)
            } else if ["http", "https"].contains(url.scheme ?? "") {
                present(SFSafariViewController(url: url), animated: true)
            }
        }
        return nil
    }

    // A killed web content process leaves a blank view; reload it.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
