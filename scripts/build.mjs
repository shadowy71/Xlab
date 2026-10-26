import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const distDir = path.join(projectRoot, "dist");
const entries = ["index.html", "assets", "src"];

for (const entry of entries) {
  if (!fs.existsSync(path.join(projectRoot, entry))) {
    console.error(`Build input missing: ${entry}`);
    process.exit(1);
  }
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

for (const entry of entries) {
  const source = path.join(projectRoot, entry);
  const destination = path.join(distDir, entry);
  fs.cpSync(source, destination, { recursive: true });
}

console.log(`Built static site in ${path.relative(projectRoot, distDir)}/ (${entries.join(", ")}).`);
