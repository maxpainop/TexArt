// image work ends here; the animator only receives finished cells
const CHARACTER_HEIGHT_RATIO = 0.5;

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function calculateGridDimensions(
    sourceWidth,
    sourceHeight,
    requestedColumns,
    preserveAspect = true,
    characterHeightRatio = CHARACTER_HEIGHT_RATIO
) {
    const columns = Math.max(1, Math.round(requestedColumns));
    const safeWidth = Math.max(1, Number(sourceWidth) || 1);
    const safeHeight = Math.max(1, Number(sourceHeight) || 1);
    const proportionalRows = Math.round(
        (safeHeight / safeWidth) * columns * characterHeightRatio
    );
    const rows = preserveAspect ? Math.max(1, proportionalRows) : columns;

    return { columns, rows };
}

export function resolveSourceRect(sourceWidth, sourceHeight, crop = {}) {
    const width = Math.max(1, Number(sourceWidth) || 1);
    const height = Math.max(1, Number(sourceHeight) || 1);

    if (crop.mode !== "manual") {
        return { x: 0, y: 0, width, height };
    }

    const normalizedX = clamp(Number(crop.x) || 0, 0, 1);
    const normalizedY = clamp(Number(crop.y) || 0, 0, 1);
    const normalizedWidth = clamp(Number(crop.width) || 1, 0.001, 1 - normalizedX);
    const normalizedHeight = clamp(Number(crop.height) || 1, 0.001, 1 - normalizedY);

    return {
        x: normalizedX * width,
        y: normalizedY * height,
        width: normalizedWidth * width,
        height: normalizedHeight * height,
    };
}

export function adjustChannel(channel, brightness = 0, contrast = 0, invert = false) {
    const brightnessOffset = clamp(Number(brightness) || 0, -100, 100) * 2.55;
    const safeContrast = clamp(Number(contrast) || 0, -100, 100);
    const factor = (259 * (safeContrast + 255)) / (255 * (259 - safeContrast));
    let adjusted = factor * (channel - 128) + 128 + brightnessOffset;
    adjusted = clamp(Math.round(adjusted), 0, 255);
    return invert ? 255 - adjusted : adjusted;
}

export function calculateLuminance(red, green, blue) {
    return Math.round((0.2126 * red) + (0.7152 * green) + (0.0722 * blue));
}

function parseHexColor(color) {
    const match = /^#([0-9a-f]{6})$/i.exec(String(color));
    if (!match) return null;

    const value = Number.parseInt(match[1], 16);
    return {
        red: (value >> 16) & 255,
        green: (value >> 8) & 255,
        blue: value & 255,
    };
}

function nearestPaletteColor(red, green, blue, palette) {
    let nearest = null;
    let nearestDistance = Infinity;

    for (const color of palette) {
        const redDelta = red - color.red;
        const greenDelta = green - color.green;
        const blueDelta = blue - color.blue;
        const distance = (redDelta * redDelta * 0.2126) +
            (greenDelta * greenDelta * 0.7152) +
            (blueDelta * blueDelta * 0.0722);

        if (distance < nearestDistance) {
            nearest = color;
            nearestDistance = distance;
        }
    }

    return nearest || { red, green, blue };
}

// shrink the source into the exact grid we need before building text cells
export function sampleImage(image, settings, requestedDimensions = null) {
    if (!image?.naturalWidth || !image?.naturalHeight) {
        throw new TypeError("A decoded image is required.");
    }

    const sourceRect = resolveSourceRect(
        image.naturalWidth,
        image.naturalHeight,
        settings.crop
    );
    const dimensions = requestedDimensions
        ? {
            columns: Math.max(1, Math.round(requestedDimensions.columns)),
            rows: Math.max(1, Math.round(requestedDimensions.rows)),
        }
        : calculateGridDimensions(
            sourceRect.width,
            sourceRect.height,
            settings.width,
            settings.preserveAspect
        );
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) throw new Error("Canvas 2D is unavailable.");

    canvas.width = dimensions.columns;
    canvas.height = dimensions.rows;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
        image,
        sourceRect.x,
        sourceRect.y,
        sourceRect.width,
        sourceRect.height,
        0,
        0,
        dimensions.columns,
        dimensions.rows
    );

    const pixels = context.getImageData(
        0,
        0,
        dimensions.columns,
        dimensions.rows
    ).data;
    const cells = new Array(dimensions.columns * dimensions.rows);
    const activePalette = settings.paletteMode
        ? settings.palette
            .slice(0, settings.colorCount)
            .map(parseHexColor)
            .filter(Boolean)
        : [];

    for (let index = 0, pixel = 0; pixel < pixels.length; index += 1, pixel += 4) {
        let red = adjustChannel(
            pixels[pixel],
            settings.brightness,
            settings.contrast,
            settings.invert
        );
        let green = adjustChannel(
            pixels[pixel + 1],
            settings.brightness,
            settings.contrast,
            settings.invert
        );
        let blue = adjustChannel(
            pixels[pixel + 2],
            settings.brightness,
            settings.contrast,
            settings.invert
        );

        // palette mode snaps each cell after brightness and contrast are applied
        if (activePalette.length) {
            ({ red, green, blue } = nearestPaletteColor(
                red,
                green,
                blue,
                activePalette
            ));
        }

        cells[index] = {
            red,
            green,
            blue,
            alpha: pixels[pixel + 3],
            luminance: calculateLuminance(red, green, blue),
        };
    }

    return {
        ...dimensions,
        sourceRect,
        cells,
    };
}
