import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const exists = (...parts) => fs.existsSync(path.join(root, ...parts));

// Core release files and policy text.
for (const file of ["README.md", "RELEASE_STATUS.md", "LICENSE", "LICENSE-CONTENT", "docs/DECISIONS.md", "game/index.html"]) {
  assert(exists(file), `missing required file: ${file}`);
}
const readme = read("README.md");
const landing = read("index.html");
assert(readme.includes("前三重") && readme.includes("第四重"), "README is missing the free/advanced boundary");
assert(readme.includes("CC BY 4.0") && readme.includes("MIT"), "README is missing the dual-license statement");
assert(!readme.includes("不卖课"), "README still contains the superseded no-paid-training promise");
assert(!landing.includes("agentos-app.net"), "landing page still links to the superseded all-free AgentOS game");

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
  assert(fs.existsSync(qaPath), `${dir} missing cards/qa-report.json`);
  assert(fs.existsSync(specPath), `${dir} missing card-spec.json`);
  if (!fs.existsSync(qaPath)) continue;
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  assert(qa.automaticChecks === "passed", `${dir} automaticChecks is not passed`);
  assert(qa.visualReview === "passed", `${dir} visualReview is not passed`);
  assert(qa.publishable === true, `${dir} is not publishable`);
  assert(qa.orientation === "landscape" && qa.platform === "universal", `${dir} is not landscape/universal`);
  assert(Array.isArray(qa.files) && qa.files.length === 9, `${dir} must contain 9 verified cards`);
  for (const file of qa.files || []) {
    assert(file.width === 1920 && file.height === 1080, `${dir}/${file.file} is not 1920x1080`);
    assert(exists("cards", dir, "cards", file.file), `${dir}/${file.file} is missing`);
  }
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
assert(!/fetch\s*\(|XMLHttpRequest|WebSocket\s*\(|https?:\/\/[^\s"']+\.js/iu.test(game), "game contains a network primitive or external script URL");

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
  gameLevels: 9,
  freeLevels: 3,
  advancedLevels: 6
}, null, 2));
