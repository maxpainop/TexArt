// layout math stays pure so window sizing cannot accidentally touch the scene
const MAX_ANIMATION_CELLS = 100_000;

function positiveNumber(value, fallback = 1) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function fitAspectWithinBounds(aspectRatio, maximumWidth, maximumHeight) {
    const aspect = positiveNumber(aspectRatio);
    const maxWidth = positiveNumber(maximumWidth);
    const maxHeight = positiveNumber(maximumHeight);
    let width = maxWidth;
    let height = width / aspect;

    if (height > maxHeight) {
        height = maxHeight;
        width = height * aspect;
    }

    return {
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height)),
    };
}

export function calculateGridForViewport(
    viewportWidth,
    viewportHeight,
    characterWidth,
    lineHeight,
    maximumCells = MAX_ANIMATION_CELLS
) {
    let columns = Math.max(1, Math.floor(
        positiveNumber(viewportWidth) / positiveNumber(characterWidth)
    ));
    let rows = Math.max(1, Math.floor(
        positiveNumber(viewportHeight) / positiveNumber(lineHeight)
    ));
    const cellLimit = Math.max(1, Math.floor(positiveNumber(maximumCells)));
    const cellCount = columns * rows;

    // dense settings can explode quickly, so keep the canvas workload bounded
    if (cellCount > cellLimit) {
        const scale = Math.sqrt(cellLimit / cellCount);
        columns = Math.max(1, Math.floor(columns * scale));
        rows = Math.max(1, Math.floor(rows * scale));
    }

    return { columns, rows };
}

export function calculateWindowSize(viewport, chrome, availableScreen) {
    const width = Math.min(
        positiveNumber(availableScreen.width),
        positiveNumber(viewport.width) + Math.max(0, Number(chrome.width) || 0)
    );
    const height = Math.min(
        positiveNumber(availableScreen.height),
        positiveNumber(viewport.height) + Math.max(0, Number(chrome.height) || 0)
    );

    return {
        width: Math.max(1, Math.ceil(width)),
        height: Math.max(1, Math.ceil(height)),
    };
}
