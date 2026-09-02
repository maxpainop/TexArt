import test from "node:test";
import assert from "node:assert/strict";

import { MXA_SCHEMA_VERSION } from "../src/state/project-state.js";
import { MXA_FORMAT, parseMxaDocument } from "../src/export/mxa-format.js";

test("MXA parser accepts the portable project envelope", () => {
    const document = {
        format: MXA_FORMAT,
        version: MXA_SCHEMA_VERSION,
        source: { dataUrl: "data:image/png;base64,AA==" },
        project: { settings: { charset: "MIKU " } },
    };

    assert.deepEqual(parseMxaDocument(JSON.stringify(document)), document);
});

test("MXA parser rejects unrelated JSON", () => {
    assert.throws(
        () => parseMxaDocument('{"format":"other"}'),
        /not a supported MXA project/
    );
});
