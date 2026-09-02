import test from "node:test";
import assert from "node:assert/strict";

import {
    adjustChannel,
    calculateGridDimensions,
    resolveSourceRect,
} from "../src/engine/image-processor.js";
import { generateGlyphGrid, glyphGridToText } from "../src/engine/glyph-generator.js";
import {
    animationPattern,
    patternCharacter,
} from "../src/engine/canvas-animator.js";
import {
    calculateGridForViewport,
    calculateWindowSize,
    fitAspectWithinBounds,
} from "../src/layout/workspace-layout.js";
import { calculateGifTiming } from "../src/export/gif-exporter.js";

test("grid dimensions preserve source aspect for text cells", () => {
    assert.deepEqual(calculateGridDimensions(800, 400, 100, true), {
        columns: 100,
        rows: 25,
    });
});

test("manual crop resolves normalized coordinates", () => {
    assert.deepEqual(resolveSourceRect(1000, 500, {
        mode: "manual",
        x: 0.25,
        y: 0.1,
        width: 0.5,
        height: 0.8,
    }), {
        x: 250,
        y: 50,
        width: 500,
        height: 400,
    });
});

test("channel adjustments clamp and invert", () => {
    assert.equal(adjustChannel(255, 100, 0, false), 255);
    assert.equal(adjustChannel(255, 0, 0, true), 0);
});

test("glyph generator supports luminance and repeating pattern modes", () => {
    const sample = {
        columns: 2,
        rows: 1,
        cells: [
            { luminance: 0 },
            { luminance: 255 },
        ],
    };

    const luminanceGrid = generateGlyphGrid(sample, {
        charset: "@ ",
        textMode: "luminance",
    });
    const patternGrid = generateGlyphGrid(sample, {
        charset: "AB",
        textMode: "pattern",
    });

    assert.equal(glyphGridToText(luminanceGrid), "@ ");
    assert.equal(glyphGridToText(patternGrid), "AB");
});

test("animated pattern wraps in both directions", () => {
    assert.equal(patternCharacter("MIKU ", 0, 1), "I");
    assert.equal(patternCharacter("MIKU ", 0, -1), " ");
});

test("single-character patterns animate without moving color cells", () => {
    assert.equal(animationPattern("."), ". ");
    assert.equal(patternCharacter(".", 0, 0), ".");
    assert.equal(patternCharacter(".", 0, 1), " ");
    assert.equal(patternCharacter(".", 0, 2), ".");
});

test("unicode patterns advance by full characters", () => {
    assert.equal(animationPattern("😀"), "😀 ");
    assert.equal(patternCharacter("😀", 0, 0), "😀");
    assert.equal(patternCharacter("😀", 0, 1), " ");
});

test("GIF timing covers one exact pattern loop", () => {
    assert.deepEqual(calculateGifTiming({
        charset: "MIKU ",
        animation: { speed: 0.1 },
    }), {
        patternLength: 5,
        frameCount: 5,
        delay: 167,
    });

    assert.deepEqual(calculateGifTiming({
        charset: ".",
        animation: { speed: 0 },
    }), {
        patternLength: 2,
        frameCount: 1,
        delay: 1000,
    });
});

test("workspace fitting preserves image aspect", () => {
    assert.deepEqual(fitAspectWithinBounds(16 / 9, 1000, 500), {
        width: 888,
        height: 500,
    });
});

test("smaller text increases resolution without changing viewport", () => {
    const coarse = calculateGridForViewport(800, 450, 10, 18);
    const detailed = calculateGridForViewport(800, 450, 5, 9);

    assert.deepEqual(coarse, { columns: 80, rows: 25 });
    assert.deepEqual(detailed, { columns: 160, rows: 50 });
});

test("window sizing adds chrome and respects screen bounds", () => {
    assert.deepEqual(calculateWindowSize(
        { width: 900, height: 500 },
        { width: 280, height: 110 },
        { width: 1100, height: 700 }
    ), {
        width: 1100,
        height: 610,
    });
});
