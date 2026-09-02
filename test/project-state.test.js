import test from "node:test";
import assert from "node:assert/strict";

import {
    MXA_SCHEMA_VERSION,
    createProjectStore,
    normalizeProjectSettings,
} from "../src/state/project-state.js";

test("project settings clamp unsafe numeric input", () => {
    const settings = normalizeProjectSettings({
        width: 9000,
        brightness: -400,
        contrast: 400,
        colorCount: 1,
        characterSpacing: 0,
    });

    assert.equal(settings.width, 500);
    assert.equal(settings.brightness, -100);
    assert.equal(settings.contrast, 100);
    assert.equal(settings.colorCount, 2);
    assert.equal(settings.characterSpacing, 0.1);
});

test("project snapshots are detached and serializable", () => {
    const store = createProjectStore();
    store.setImage({ name: "source.png", width: 640, height: 480 });
    const snapshot = store.getSnapshot();

    snapshot.settings.width = 10;

    assert.equal(store.getSnapshot().settings.width, 120);
    assert.equal(store.getSnapshot().schemaVersion, MXA_SCHEMA_VERSION);
    assert.doesNotThrow(() => JSON.stringify(store.getSnapshot()));
});

test("resetting settings preserves image metadata", () => {
    const store = createProjectStore({ settings: { textMode: "pattern" } });
    store.setImage({ name: "source.png", width: 640, height: 480 });
    store.resetSettings();

    assert.equal(store.getSnapshot().settings.textMode, "luminance");
    assert.equal(store.getSnapshot().image.name, "source.png");
});
