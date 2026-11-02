import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "..", "dist");

// Ensure shebang on bin
const binPath = path.join(dist, "bin.js");
if (fs.existsSync(binPath)) {
  let content = fs.readFileSync(binPath, "utf8");
  if (!content.startsWith("#!")) {
    content = "#!/usr/bin/env node\n" + content;
    fs.writeFileSync(binPath, content);
  }
}

// Copy hook runner next to dist for absolute path stability
const hookSrc = path.join(dist, "hook.js");
if (fs.existsSync(hookSrc)) {
  // ok
}
