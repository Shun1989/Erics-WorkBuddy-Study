import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "_site");
if (path.dirname(output) !== root || path.basename(output) !== "_site") {
  throw new Error("Refusing to build outside the repository _site directory");
}
if (fs.existsSync(output)) {
  const stats = fs.lstatSync(output);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("Refusing to replace a non-directory or symbolic-link _site target");
  fs.rmSync(output, { recursive: true });
}
fs.mkdirSync(output);
for (const item of ["index.html", "game", "practice"]) {
  fs.cpSync(path.join(root, item), path.join(output, item), { recursive: true });
}
fs.writeFileSync(path.join(output, ".nojekyll"), "", "utf8");

const files = fs.readdirSync(output, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.relative(output, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, "/"))
  .sort();
const required = ["index.html", "game/index.html", "practice/index.html"];
for (const file of required) {
  if (!files.includes(file)) throw new Error(`Static site is missing ${file}`);
}
const forbidden = files.filter((file) => /^(?:\.git|assets|cards|episodes|docs)(?:\/|$)/u.test(file) || /(?:\.zip|\.xlsx)$/iu.test(file));
if (forbidden.length) throw new Error(`Static site contains forbidden files: ${forbidden.join(", ")}`);
console.log(JSON.stringify({ status: "passed", output, files: files.length }, null, 2));
