const { chmodSync } = require("fs");
const targets = [
  "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
  "node_modules/node-pty/prebuilds/darwin-x64/spawn-helper",
  "node_modules/node-pty/prebuilds/win32-x64/spawn-helper",
];
for (const t of targets) {
  try { chmodSync(t, 0o755); console.log("chmod +x " + t); }
  catch (e) { console.log("skip " + t + ": " + e.message); }
}
