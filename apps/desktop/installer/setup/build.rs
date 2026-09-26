// The window's icon and the exe's icon are the app's, and the manifest asks
// for no elevation: the install is per user, into %LOCALAPPDATA%.
fn main() {
    println!("cargo:rerun-if-changed=../../build/icon.ico");
    println!("cargo:rerun-if-changed=setup.manifest");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let mut res = winresource::WindowsResource::new();
    res.set_icon_with_id("../../build/icon.ico", "1");
    res.set_manifest_file("setup.manifest");
    res.set("ProductName", "WeaveForge");
    res.set("FileDescription", "WeaveForge setup");
    res.set("CompanyName", "WeaveForge");
    res.set("LegalCopyright", "AGPL-3.0-only");
    res.compile().expect("compile Windows resources");
}
