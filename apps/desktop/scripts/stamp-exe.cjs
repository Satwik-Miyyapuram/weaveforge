/**
 * Puts the app's icon and name into the Windows executable.
 *
 * electron-builder does this itself with rcedit, but only when
 * `signAndEditExecutable` is on, and that also unpacks the winCodeSign
 * toolchain — an archive with symlinks in it, which Windows will not extract
 * without the symlink privilege. So the build turns it off, and until this hook
 * the packaged exe kept Electron's own icon and called itself "Electron": that
 * is what the Start menu, the taskbar and Task Manager read.
 *
 * resedit edits the resources in plain JavaScript, so nothing needs unpacking.
 * It runs after packing and before the installer is made, so the installer's
 * shortcuts point at an exe that already carries the icon.
 */
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function stampExe(context) {
  if (context.electronPlatformName !== "win32") return;
  const ResEdit = await import("resedit");
  const { productFilename, info } = context.packager.appInfo
    ? { productFilename: context.packager.appInfo.productFilename, info: context.packager.appInfo }
    : { productFilename: "WeaveForge", info: null };
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const icoPath = path.resolve(__dirname, "../build/icon.ico");

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));

  // Replace the icon group Electron ships under whatever id it has, so the
  // shell's "first icon in the file" is ours.
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] ?? { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    target.id,
    target.lang,
    icon.icons.map((item) => item.data),
  );

  const version = info?.version ?? require("../package.json").version;
  const [major, minor, patch] = version.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const versionInfo = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const lang = versionInfo.getAllLanguagesForStringValues()[0] ?? { lang: 1033, codepage: 1200 };
  versionInfo.setStringValues(lang, {
    ProductName: "WeaveForge",
    FileDescription: "WeaveForge",
    CompanyName: "WeaveForge",
    InternalName: "WeaveForge",
    OriginalFilename: `${productFilename}.exe`,
    ProductVersion: version,
    FileVersion: version,
    LegalCopyright: "AGPL-3.0-only",
  });
  versionInfo.setFileVersion(major, minor, patch, 0, lang.lang);
  versionInfo.setProductVersion(major, minor, patch, 0, lang.lang);
  versionInfo.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
};
