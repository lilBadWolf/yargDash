// electron-builder afterSign hook: sign the macOS app with yargDash's own code-signing certificate.
//
// Why: an ad-hoc signed app gets a new identity with every build, so macOS can't remember its Local Network
// permission (and never asks), and then YARG's data stream is silently dropped. A certificate, even a self-signed
// one, gives the app a stable identity ("certificate leaf = H…"), so the permission sticks across versions.
// It isn't an Apple Developer ID: Gatekeeper still asks on first open, and the app can't update itself in place.
//
// The certificate ("yargDash Code Signing") is in the login keychain on the release Mac, and imported from the
// MAC_CERT_P12 / MAC_CERT_PASSWORD secrets on GitHub Actions. Without it, the app is ad-hoc signed as before.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function sign(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  const id = process.env.YARGDASH_SIGN_ID || 'yargDash Code Signing';
  let found = false;
  try { found = execFileSync('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' }).includes(`"${id}"`); } catch {}
  if (!found) console.log(`  • no "${id}" certificate: ad-hoc signing (macOS won't remember the app's Local Network permission)`);
  else console.log(`  • signing with "${id}"`);
  execFileSync('codesign', ['--force', '--deep', '--sign', found ? id : '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
