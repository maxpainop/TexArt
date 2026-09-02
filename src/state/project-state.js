// every setting passes through here before it can enter an mxa or scene
export const MXA_SCHEMA_VERSION = 1;

export const DEFAULT_PROJECT_SETTINGS = Object.freeze({
    width: 120,
    charset: "TEXT ",
    brightness: 0,
    contrast: 0,
    colorCount: 16,
    colored: true,
    paletteMode: false,
    invert: false,
    dither: false,
    preserveAspect: true,
    selectedColor: null,
    palette: [],
    crop: Object.freeze({
        mode: "full",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
    }),
    textMode: "pattern",
    fontSize: 12,
    fontFamily: "Perfect DOS VGA 437 Win",
    fontWeight: "bold",
    characterSpacing: 1,
    animation: Object.freeze({
        enabled: true,
        speed: 0.15,
        direction: "left",
    }),
});

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clone(value) {
    return structuredClone(value);
}

function normalizeCrop(crop = {}) {
    const x = clamp(finiteNumber(crop.x, 0), 0, 1);
    const y = clamp(finiteNumber(crop.y, 0), 0, 1);
    const width = clamp(finiteNumber(crop.width, 1), 0.001, 1 - x);
    const height = clamp(finiteNumber(crop.height, 1), 0.001, 1 - y);

    return {
        mode: crop.mode === "manual" ? "manual" : "full",
        x,
        y,
        width,
        height,
    };
}

export function normalizeProjectSettings(settings = {}) {
    const defaults = DEFAULT_PROJECT_SETTINGS;
    const charset = String(settings.charset ?? defaults.charset);
    const palette = Array.isArray(settings.palette)
        ? settings.palette.filter(Boolean).map(String).slice(0, 256)
        : [...defaults.palette];

    return {
        width: Math.round(clamp(
            finiteNumber(settings.width, defaults.width),
            10,
            500
        )),
        charset: charset.length ? charset : defaults.charset,
        brightness: clamp(
            finiteNumber(settings.brightness, defaults.brightness),
            -100,
            100
        ),
        contrast: clamp(
            finiteNumber(settings.contrast, defaults.contrast),
            -100,
            100
        ),
        colorCount: Math.round(clamp(
            finiteNumber(settings.colorCount, defaults.colorCount),
            2,
            256
        )),
        colored: Boolean(settings.colored ?? defaults.colored),
        paletteMode: Boolean(settings.paletteMode ?? defaults.paletteMode),
        invert: Boolean(settings.invert ?? defaults.invert),
        dither: Boolean(settings.dither ?? defaults.dither),
        preserveAspect: Boolean(
            settings.preserveAspect ?? defaults.preserveAspect
        ),
        selectedColor: settings.selectedColor
            ? String(settings.selectedColor)
            : null,
        palette,
        crop: normalizeCrop(settings.crop ?? defaults.crop),
        textMode: settings.textMode === "pattern" ? "pattern" : "luminance",
        fontSize: clamp(
            finiteNumber(settings.fontSize, defaults.fontSize),
            5,
            256
        ),
        fontFamily: String(settings.fontFamily ?? defaults.fontFamily),
        fontWeight: String(settings.fontWeight ?? defaults.fontWeight),
        characterSpacing: clamp(
            finiteNumber(settings.characterSpacing, defaults.characterSpacing),
            0.1,
            1
        ),
        animation: {
            enabled: Boolean(
                settings.animation?.enabled ?? defaults.animation.enabled
            ),
            speed: clamp(
                finiteNumber(
                    settings.animation?.speed,
                    defaults.animation.speed
                ),
                0,
                20
            ),
            direction: settings.animation?.direction === "right"
                ? "right"
                : "left",
        },
    };
}

function normalizeImageMetadata(image) {
    if (!image) return null;

    return {
        name: String(image.name ?? ""),
        type: String(image.type ?? ""),
        size: Math.max(0, finiteNumber(image.size, 0)),
        width: Math.max(1, Math.round(finiteNumber(image.width, 1))),
        height: Math.max(1, Math.round(finiteNumber(image.height, 1))),
    };
}

export function createProjectStore(initial = {}) {
    let project = {
        schemaVersion: MXA_SCHEMA_VERSION,
        image: normalizeImageMetadata(initial.image),
        settings: normalizeProjectSettings(initial.settings),
    };
    const listeners = new Set();

    function notify() {
        // listeners get their own copy so nobody can mutate the saved project
        const snapshot = clone(project);
        listeners.forEach((listener) => listener(snapshot));
    }

    return Object.freeze({
        getSnapshot() {
            return clone(project);
        },

        setImage(image) {
            project = { ...project, image: normalizeImageMetadata(image) };
            notify();
            return this.getSnapshot();
        },

        setSettings(settings) {
            project = {
                ...project,
                settings: normalizeProjectSettings({
                    ...project.settings,
                    ...settings,
                    crop: settings.crop ?? project.settings.crop,
                    animation: settings.animation ?? project.settings.animation,
                }),
            };
            notify();
            return this.getSnapshot();
        },

        resetSettings(settings = {}) {
            project = {
                ...project,
                settings: normalizeProjectSettings(settings),
            };
            notify();
            return this.getSnapshot();
        },

        reset() {
            project = {
                schemaVersion: MXA_SCHEMA_VERSION,
                image: null,
                settings: normalizeProjectSettings(),
            };
            notify();
            return this.getSnapshot();
        },

        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    });
}
