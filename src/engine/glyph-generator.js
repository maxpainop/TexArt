// brightness decides the glyph only when luminance mode is being used
// turn sampled cells into text without knowing anything about the canvas
function characterForLuminance(luminance, charset) {
    const safeCharset = Array.from(charset.length ? charset : " ");
    const normalized = Math.min(255, Math.max(0, Number(luminance) || 0)) / 255;
    const index = Math.min(
        safeCharset.length - 1,
        Math.floor(normalized * safeCharset.length)
    );
    return safeCharset[index];
}

export function generateGlyphGrid(sample, settings) {
    const text = Array.from(String(settings.charset || " "));
    const patternMode = settings.textMode === "pattern";
    const luminanceValues = sample.cells.map((cell) => cell.luminance);

    if (settings.dither && !patternMode && text.length > 1) {
        const lastCharacterIndex = text.length - 1;

        // spread the rounding error forward so low-color output keeps its detail
        for (let row = 0; row < sample.rows; row += 1) {
            for (let column = 0; column < sample.columns; column += 1) {
                const index = (row * sample.columns) + column;
                const oldValue = Math.min(255, Math.max(0, luminanceValues[index]));
                const level = Math.round((oldValue / 255) * lastCharacterIndex);
                const newValue = (level / lastCharacterIndex) * 255;
                const error = oldValue - newValue;

                if (column + 1 < sample.columns) {
                    luminanceValues[index + 1] += error * (7 / 16);
                }
                if (row + 1 >= sample.rows) continue;

                if (column > 0) {
                    luminanceValues[index + sample.columns - 1] += error * (3 / 16);
                }
                luminanceValues[index + sample.columns] += error * (5 / 16);
                if (column + 1 < sample.columns) {
                    luminanceValues[index + sample.columns + 1] += error * (1 / 16);
                }
            }
        }
    }

    return {
        columns: sample.columns,
        rows: sample.rows,
        cells: sample.cells.map((cell, index) => ({
            ...cell,
            character: patternMode
                ? text[index % text.length]
                : characterForLuminance(luminanceValues[index], text),
        })),
    };
}

export function glyphGridToText(grid) {
    const lines = [];

    for (let row = 0; row < grid.rows; row += 1) {
        const start = row * grid.columns;
        const end = start + grid.columns;
        const line = grid.cells
            .slice(start, end)
            .map((cell) => cell.character)
            .join("");

        lines.push(line);
    }

    return lines.join("\n");
}
