import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";

const gamePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : new URL("../game/index.html", import.meta.url);
const html = fs.readFileSync(gamePath, "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)]
  .map((match) => match[1]);

function createRuntime() {
  const records = new Map();
  const context = vm.createContext({
    window: {},
    localStorage: {
      getItem: (key) => records.get(key) ?? null,
      setItem: (key, value) => records.set(key, String(value)),
      removeItem: (key) => records.delete(key)
    },
    console: { warn() {} }
  });
  // Run the shipped config, levels, state machine and storage without the DOM UI.
  for (const script of scripts.slice(0, -1)) vm.runInContext(script, context);
  const { GameStorage: storage, GameState: state, GAME_LEVELS: levels, GAME_CONFIG: config } = context.window;
  assert.ok(storage && state && levels && config, "game runtime must load from the shipped HTML");
  return { storage, state, levels, config, records };
}

test("fractional onboarding steps resolve to an existing panel", () => {
  const { storage } = createRuntime();
  for (const [input, expected] of [[0.5, 0], [1.5, 1], [2.9, 2], [-2, 0], [9, 3], ["2.5", 2], ["invalid", 0]]) {
    const save = storage.createDefaultSave();
    save.onboarding.step = input;
    assert.equal(storage.normalize(save).onboarding.step, expected, `step ${input}`);
  }
});

test("load preserves progress and valid scars when individual entries are malformed", () => {
  const { storage, config, records } = createRuntime();
  const save = storage.createDefaultSave();
  save.progress["realm-01"].status = "in_progress";
  save.progress["realm-01"].stepChecks = [0, 1];
  save.scars = [null, 12, "invalid", [], { id: "keep", title: "保留的劫痕" }];
  records.set(config.storageKey, JSON.stringify(save));
  const loaded = storage.load();
  assert.equal(loaded.progress["realm-01"].status, "in_progress");
  assert.equal(JSON.stringify(loaded.progress["realm-01"].stepChecks), "[0,1]");
  assert.equal(loaded.scars.length, 1);
  assert.equal(loaded.scars[0].id, "keep");
  storage.save(loaded);
  assert.equal(storage.load().scars[0].title, "保留的劫痕");
});

test("import and export round trip repaired v2 saves", () => {
  const { storage } = createRuntime();
  const save = storage.createDefaultSave();
  save.profile.displayName = "测试学徒";
  save.onboarding.step = 1.5;
  save.scars = [null, { id: "keep", title: "虚构复验记录" }];
  const imported = storage.importJson(JSON.stringify(save));
  const exported = JSON.parse(storage.exportJson(imported));
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.profile.displayName, "测试学徒");
  assert.equal(exported.onboarding.step, 1);
  assert.equal(exported.scars.length, 1);
  assert.equal(exported.scars[0].id, "keep");
});

test("legacy v1 saves migrate without losing progress or valid scars", () => {
  const { storage, config, records } = createRuntime();
  const legacy = {
    schemaVersion: 1,
    onboardingComplete: true,
    recommendation: "虚构迁移记录",
    profile: { displayName: "旧存档学徒" },
    progress: { "realm-01": { status: "in_progress", stepChecks: [0] } },
    scars: [null, { id: "legacy", title: "保留旧记录" }]
  };
  records.set(config.legacyStorageKeys[0], JSON.stringify(legacy));
  const loaded = storage.load();
  assert.equal(loaded.schemaVersion, 2);
  assert.equal(loaded.onboarding.completed, true);
  assert.equal(loaded.onboarding.step, 3);
  assert.equal(loaded.profile.displayName, "旧存档学徒");
  assert.equal(loaded.progress["realm-01"].status, "in_progress");
  assert.equal(loaded.scars[0].id, "legacy");
  assert.equal(JSON.parse(records.get(config.storageKey)).schemaVersion, 2);
});

test("invalid entries do not consume the 100 valid scar limit", () => {
  const { storage } = createRuntime();
  const save = storage.createDefaultSave();
  save.scars = [null, ...Array.from({ length: 101 }, (_, index) => ({ id: `scar-${index}` }))];
  const loaded = storage.normalize(save);
  assert.equal(loaded.scars.length, 100);
  assert.equal(loaded.scars[99].id, "scar-99");
});

test("invalid imports leave the current save intact", () => {
  const { storage, config, records } = createRuntime();
  storage.save(storage.createDefaultSave());
  const before = records.get(config.storageKey);
  for (const [raw, code] of [["{", "json"], ["null", "structure"], ['{"schemaVersion":3}', "version-newer"], ['{"schemaVersion":0}', "version-old"], ["{}", "version-missing"]]) {
    assert.throws(() => storage.importJson(raw), (error) => error.code === code);
    assert.equal(records.get(config.storageKey), before);
  }
});

test("state transitions and free/advanced prerequisites remain enforced", () => {
  const { storage, state, levels } = createRuntime();
  const save = storage.createDefaultSave();
  assert.equal(state.transition("available", "start"), "in_progress");
  assert.equal(state.transition("in_progress", "complete"), "completed");
  assert.throws(() => state.transition("available", "complete"));
  assert.equal(state.displayStatus(levels[1], levels, save.progress, false), "locked");
  save.progress[levels[0].id].status = "completed";
  assert.equal(state.isPrerequisiteMet(levels[1], levels, save.progress), true);
  assert.equal(state.displayStatus(levels[1], levels, save.progress, false), "available");
  assert.equal(state.displayStatus(levels[3], levels, save.progress, false), "advanced");
});
