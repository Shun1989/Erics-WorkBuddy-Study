import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const exists = (...parts) => fs.existsSync(path.join(root, ...parts));
const relativeFromRoot = (file) => path.relative(root, file).replaceAll(path.sep, "/");
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  if (entry.name === ".git") return [];
  const fullPath = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(fullPath) : [fullPath];
});
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const pngDimensions = (file) => {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 24 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

// Core release files and policy text.
for (const file of ["README.md", "RELEASE_STATUS.md", "LICENSE", "LICENSE-CONTENT", "CONTRIBUTING.md", "SECURITY.md", "docs/DECISIONS.md", "game/index.html", "practice/README.md"]) {
  assert(exists(file), `missing required file: ${file}`);
}
const readme = read("README.md");
const landing = read("index.html");
assert(readme.includes("前三重") && readme.includes("第四重"), "README is missing the free/advanced boundary");
assert(readme.includes("CC BY 4.0") && readme.includes("MIT"), "README is missing the dual-license statement");
assert(!readme.includes("不卖课"), "README still contains the superseded no-paid-training promise");
assert(!landing.includes("agentos-app.net"), "landing page still links to the superseded all-free AgentOS game");
assert(!read("docs", "课程大纲.md").includes("五卷 65+ 支"), "course outline still presents the planned EP63+ work as completed scope");

// All local Markdown and HTML links must resolve. External links are verified separately by browser/API checks.
const textFiles = walk(root).filter((file) => /\.(?:md|html)$/iu.test(file));
for (const file of textFiles) {
  const body = fs.readFileSync(file, "utf8");
  const references = [
    ...[...body.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)].map((match) => match[1]),
    ...[...body.matchAll(/(?:href|src)=["']([^"']+)["']/giu)].map((match) => match[1])
  ];
  for (const reference of references) {
    const clean = reference.trim().replace(/^<|>$/gu, "").split("#")[0].split("?")[0];
    if (!clean || clean.includes("${") || /^(?:https?:|mailto:|data:|javascript:)/iu.test(clean)) continue;
    let decoded;
    try { decoded = decodeURIComponent(clean); }
    catch { failures.push(`${relativeFromRoot(file)} contains an invalid encoded link: ${reference}`); continue; }
    const target = path.resolve(path.dirname(file), decoded);
    assert(target === root || target.startsWith(`${root}${path.sep}`), `${relativeFromRoot(file)} link escapes repository: ${reference}`);
    assert(fs.existsSync(target), `${relativeFromRoot(file)} references missing local target: ${reference}`);
  }
}

// EP01-EP62 must be present and must not reference a nonexistent asset ZIP.
const assetEpisodes = new Set(["12", "13", "14", "16", "21"]);
const episodeFiles = fs.readdirSync(path.join(root, "episodes"))
  .filter((name) => /^EP\d{2}_口播稿\.md$/u.test(name))
  .sort((a, b) => Number(a.slice(2, 4)) - Number(b.slice(2, 4)));
assert(episodeFiles.length === 62, `expected 62 episode scripts, found ${episodeFiles.length}`);
episodeFiles.forEach((name, index) => {
  const expected = String(index + 1).padStart(2, "0");
  assert(name.startsWith(`EP${expected}_`), `episode sequence mismatch at ${name}`);
  const body = read("episodes", name);
  const refs = [...body.matchAll(/EP(\d{2})_素材包\.zip/gu)].map((match) => match[1]);
  for (const ref of refs) {
    assert(assetEpisodes.has(ref), `${name} references unapproved asset package EP${ref}`);
    assert(exists("assets", `EP${ref}_素材包.zip`), `${name} references missing assets/EP${ref}_素材包.zip`);
  }
  if (!assetEpisodes.has(expected)) {
    assert(body.includes("本集无独立素材包"), `${name} does not explicitly declare that it has no package`);
  }
  assert(!body.includes("不卖课"), `${name} contains the superseded no-paid-training promise`);
});

// EP01-EP06 cards: exactly 9 PNGs, approved QA, landscape universal 1920x1080.
const cardDirs = fs.readdirSync(path.join(root, "cards"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^ep0[1-6]-/u.test(entry.name))
  .map((entry) => entry.name)
  .sort();
assert(cardDirs.length === 6, `expected 6 card episodes, found ${cardDirs.length}`);
for (const dir of cardDirs) {
  const qaPath = path.join(root, "cards", dir, "cards", "qa-report.json");
  const specPath = path.join(root, "cards", dir, "card-spec.json");
  const manifestPath = path.join(root, "cards", dir, "cards", "manifest.json");
  const semanticPath = path.join(root, "cards", dir, "semantic-visual-report.json");
  assert(fs.existsSync(qaPath), `${dir} missing cards/qa-report.json`);
  assert(fs.existsSync(specPath), `${dir} missing card-spec.json`);
  assert(fs.existsSync(manifestPath), `${dir} missing cards/manifest.json`);
  assert(fs.existsSync(semanticPath), `${dir} missing semantic-visual-report.json`);
  if (!fs.existsSync(qaPath)) continue;
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const semantic = JSON.parse(fs.readFileSync(semanticPath, "utf8"));
  assert(qa.automaticChecks === "passed", `${dir} automaticChecks is not passed`);
  assert(qa.visualReview === "passed", `${dir} visualReview is not passed`);
  assert(qa.publishable === true, `${dir} is not publishable`);
  assert(qa.orientation === "landscape" && qa.platform === "universal", `${dir} is not landscape/universal`);
  assert(Array.isArray(qa.files) && qa.files.length === 9, `${dir} must contain 9 verified cards`);
  assert(spec.project?.orientation === "landscape" && spec.project?.platform === "universal", `${dir} card spec is not landscape/universal`);
  assert(Array.isArray(spec.cards) && spec.cards.length === 9, `${dir} card spec must contain 9 cards`);
  assert(Array.isArray(manifest.cards) && manifest.cards.length === 9, `${dir} manifest must contain 9 cards`);
  assert(semantic.automaticChecks === "passed" && semantic.errors?.length === 0, `${dir} semantic visual report is not clean`);
  const diskPngs = fs.readdirSync(path.join(root, "cards", dir, "cards")).filter((file) => /^\d{2}\.png$/u.test(file)).sort();
  assert(diskPngs.length === 9, `${dir} cards directory must contain exactly 9 numbered PNGs`);
  for (const file of qa.files || []) {
    assert(file.width === 1920 && file.height === 1080, `${dir}/${file.file} is not 1920x1080`);
    assert(exists("cards", dir, "cards", file.file), `${dir}/${file.file} is missing`);
    const pngPath = path.join(root, "cards", dir, "cards", file.file);
    assert(fs.statSync(pngPath).size === file.bytes, `${dir}/${file.file} byte count differs from QA report`);
    const dimensions = pngDimensions(pngPath);
    assert(dimensions?.width === 1920 && dimensions?.height === 1080, `${dir}/${file.file} PNG header is not 1920x1080`);
  }
  const manifestFiles = manifest.cards.map((card) => card.file).sort();
  assert(JSON.stringify(manifestFiles) === JSON.stringify(diskPngs), `${dir} manifest filenames differ from rendered PNGs`);
}

// Public game must contain nine levels, with full content only for the first three.
const game = read("game", "index.html");
const match = game.match(/\/\* PUBLIC_LEVELS_BEGIN \*\/\s*window\.GAME_LEVELS = Object\.freeze\((\[.*?\])\);\s*\/\* PUBLIC_LEVELS_END \*\//su);
assert(Boolean(match), "could not locate embedded public level data");
if (match) {
  const levels = JSON.parse(match[1]);
  assert(levels.length === 9, `expected 9 game levels, found ${levels.length}`);
  levels.forEach((level, index) => {
    if (index < 3) {
      assert(level.access === "free", `${level.publicName} must be free`);
      assert(Array.isArray(level.task?.steps) && level.task.steps.length > 0, `${level.publicName} is missing free steps`);
      assert(Array.isArray(level.task?.acceptance) && level.task.acceptance.length > 0, `${level.publicName} is missing free acceptance`);
    } else {
      assert(level.access === "advanced", `${level.publicName} must be advanced`);
      for (const key of ["steps", "acceptance", "assets", "evidencePrompts"]) {
        assert(!(key in (level.task || {})), `${level.publicName} leaked advanced task.${key}`);
      }
    }
  });
}
assert(game.includes("前三重完整免费；本重起提供进阶带练与企业内训"), "game is missing the advanced gate copy");
assert(game.includes('courseHome: "../practice/"'), "game does not link to the free practice materials");
assert(game.includes('sourceRepository: "https://github.com/Shun1989/Erics-WorkBuddy-Study"'), "game source repository link is missing");
assert(!/fetch\s*\(|XMLHttpRequest|WebSocket\s*\(|https?:\/\/[^\s"']+\.js/iu.test(game), "game contains a network primitive or external script URL");

// Detect common credential forms without printing matching secrets.
const credentialPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/u,
  /gh[pousr]_[A-Za-z0-9]{20,}/u,
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/u,
  /(?:api[_-]?key|password|secret)\s*[:=]\s*["'][^"'\r\n]{12,}["']/iu
];
for (const file of walk(root).filter((item) => !/\.(?:png|zip|xlsx)$/iu.test(item))) {
  let body;
  try { body = fs.readFileSync(file, "utf8"); } catch { continue; }
  assert(!credentialPatterns.some((pattern) => pattern.test(body)), `${relativeFromRoot(file)} matches a credential-like pattern`);
}

// Syntax-check all inline executable scripts without running DOM code.
for (const [index, script] of [...game.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)].entries()) {
  try { new vm.Script(script[1], { filename: `game-inline-${index + 1}.js` }); }
  catch (error) { failures.push(`game inline script ${index + 1} has invalid JavaScript: ${error.message}`); }
}

if (failures.length) {
  console.error(JSON.stringify({ status: "failed", failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "passed",
  episodes: episodeFiles.length,
  assetPackages: assetEpisodes.size,
  cardEpisodes: cardDirs.length,
  cards: cardDirs.length * 9,
  checkedTextFiles: textFiles.length,
  cardAssetDigest: hash(path.join(root, "cards", "ep01-ai-is-not-magic", "cards", "01.png")).slice(0, 12),
  gameLevels: 9,
  freeLevels: 3,
  advancedLevels: 6
}, null, 2));
