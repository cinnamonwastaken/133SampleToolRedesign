/* ============================================================================
 * build/afterPack.js — ad-hoc code signing for macOS builds
 * ============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * We have no Apple Developer ID certificate, so `mac.identity` is null and
 * electron-builder skips code signing entirely (see macPackager.js: identity
 * null -> "skipped macOS code signing", return false — it does NOT fall back
 * to an ad-hoc signature).
 *
 * On Intel Macs an unsigned app merely trips Gatekeeper. On Apple Silicon it
 * does not run at all: arm64 macOS requires *some* valid signature, and the
 * kernel SIGKILLs an unsigned binary — the user sees "the application is
 * damaged and can't be opened", which is not a Gatekeeper prompt they can
 * click through.
 *
 * An ad-hoc signature (`codesign --sign -`) satisfies that kernel requirement.
 * It carries no identity and no trust, so Gatekeeper still quarantines the
 * download — the user clears that once, on first launch (see README). But the
 * app launches, which is the difference between "installable" and "broken".
 *
 * This runs after packing and before the dmg/zip is assembled, so the
 * signature is what ends up inside the distributed disk image.
 *
 * NOTE: requires the `codesign` tool, so it is a no-op anywhere but macOS.
 * A Linux or Windows CI job packing the mac target cannot sign, and the
 * resulting arm64 build would not launch — build the mac artifacts on a
 * macOS runner (the GitHub workflow does).
 * ========================================================================= */

const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  // Only the macOS target needs this; skip Windows/Linux packs entirely.
  if (context.electronPlatformName !== "darwin") return;

  // Signing on a non-macOS host is impossible — `codesign` is part of Xcode's
  // command line tools. Warn loudly rather than failing the whole build, so
  // cross-platform `--mac` packs still produce inspectable output.
  if (process.platform !== "darwin") {
    console.warn(
      "  • afterPack: NOT on macOS, skipping ad-hoc signing — the resulting " +
        "arm64 .app will NOT launch. Build mac artifacts on a macOS host."
    );
    return;
  }

  // If a real signing identity was configured, electron-builder's own signing
  // step handles it properly (and would be a stronger signature than ours);
  // re-signing ad-hoc here would actively downgrade it.
  const identity = context.packager.platformSpecificBuildOptions.identity;
  if (identity) {
    console.log("  • afterPack: real signing identity configured, skipping ad-hoc signing");
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`  • afterPack: ad-hoc signing ${appPath} (arch=${context.arch})`);

  // --deep signs the nested Electron helper apps and frameworks too. Apple
  // deprecates --deep for real distribution signing, where each nested binary
  // should be signed individually — but for an ad-hoc signature whose only job
  // is to satisfy the arm64 load check, it is the correct tool.
  // --force overwrites the signature Electron ships with its prebuilt binaries.
  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    { stdio: "inherit" }
  );

  // Fail the build loudly if the signature did not take: shipping a dmg whose
  // app cannot launch is far worse than a failed build.
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });

  console.log("  • afterPack: ad-hoc signature verified");
};
