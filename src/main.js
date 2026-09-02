import {
    DEFAULT_PROJECT_SETTINGS,
    createProjectStore,
} from "./state/project-state.js";
import {
    resolveSourceRect,
    sampleImage,
} from "./engine/image-processor.js";
import {
    generateGlyphGrid,
    glyphGridToText,
} from "./engine/glyph-generator.js";
import { CanvasAnimator } from "./engine/canvas-animator.js";
import {
    calculateGridForViewport,
    calculateWindowSize,
    fitAspectWithinBounds,
} from "./layout/workspace-layout.js";
import {
    chooseSavePath,
    safeBasename,
    writeBlobToPath,
} from "./export/file-download.js";
import { encodeLoopingGif } from "./export/gif-exporter.js";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
    createMxaDocument,
    parseMxaDocument,
    sourceFileFromMxa,
} from "./export/mxa-format.js";

let appWindow = null;
let LogicalSize = null;

function initTauriApi() {
    const tauri = window.__TAURI__;

    if (!tauri?.window?.getCurrentWindow || !tauri?.dpi?.LogicalSize) {
        console.warn(
            "[TexArtUI] window.__TAURI__ is not available. " +
            "Make sure you are running through Tauri and app.withGlobalTauri is true."
        );
        return false;
    }

    appWindow = tauri.window.getCurrentWindow();
    LogicalSize = tauri.dpi.LogicalSize;

    return true;
}

const BASE_WIDTH = 802;
const BASE_HEIGHT = 507;
const WING_WIDTH = 260;
const GIF_SCALE_STORAGE_KEY = "texart.gifScale";
const MAX_GIF_PIXELS = 33_177_600;

function readGifScale() {
    try {
        const value = Math.round(Number(localStorage.getItem(GIF_SCALE_STORAGE_KEY)));
        return value >= 1 && value <= 4 ? value : 2;
    } catch {
        return 2;
    }
}

const DEFAULT_PALETTE = [
    "#000000", "#ffffff", "#808080", "#800000",
    "#ff0000", "#808000", "#ffff00", "#008000",
    "#00ff00", "#008080", "#00ffff", "#000080",
    "#0000ff", "#800080", "#ff00ff", "#c0c0c0",
    "#404040", "#7f3300", "#ff7f00", "#b5a642",
    "#7fff00", "#20b2aa", "#4169e1", "#9932cc",
    "#ff1493", "#8b4513", "#d2691e", "#f4a460",
    "#4682b4", "#87ceeb", "#9370db", "#ff69b4",
];

const DEFAULT_SETTINGS = DEFAULT_PROJECT_SETTINGS;
const projectStore = createProjectStore({
    settings: {
        ...DEFAULT_SETTINGS,
        palette: DEFAULT_PALETTE,
    },
});

const state = {
    screen: "workspace",
    imageFile: null,
    imageUrl: null,
    imageElement: null,
    wingOpen: false,
    selectedColor: null,
    palette: [...DEFAULT_PALETTE],
    activeMenu: null,
    currentStatus: "Ready. Hover over a control for details.",
    previewEditedUrl: null,
    previewShowingEdits: false,
    previewEditGeneration: 0,
    gifScale: readGifScale(),
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {};
let canvasAnimator = null;
let liveProcessTimer = null;
let resizeProcessTimer = null;
let programmaticResizeUntil = 0;
let lastProcessedScene = null;
let exportInProgress = false;
let pendingMxaViewport = null;
let previewEditTimer = null;
let paletteRefreshTimer = null;

function cacheElements() {
    Object.assign(els, {
        shell: $("#app-shell"),
        windowTitle: $("#window-title"),
        minimize: $("#win-minimize"),
        maximize: $("#win-maximize"),
        close: $("#win-close"),

        fileInput: $("#image-file-input"),
        uploadBtn: $("#upload-btn"),
        processBtn: $("#process-btn"),
        exportGifBtn: $("#export-gif-btn"),
        exportMxaBtn: $("#export-mxa-btn"),
        gifExportScale: $("#gif-export-scale"),
        gifExportSize: $("#gif-export-size"),

        outputShell: $("#texart-output-shell"),
        output: $("#texart-output"),
        outputCanvas: $("#texart-canvas"),
        outputPlaceholder: $("#texart-placeholder"),

        palette: $("#palette-grid"),
        paletteSwatches: $$(".palette-swatch"),
        paletteColorPicker: $("#palette-color-picker"),

        previewWing: $("#image-wing"),
        previewEmpty: $("#image-preview-empty"),
        previewFrame: $("#preview-frame"),
        preview: $("#image-preview"),

        settingsPanel: $("#texart-settings"),

        statusMessage: $("#status-message"),
        statusImageSize: $("#status-image-size"),
        statusZoom: $("#status-zoom"),

        resetSettingsBtn: $("#settings-reset-btn"),

        settingResolution: $("#setting-resolution"),
        settingCharset: $("#setting-charset"),
        settingFontSize: $("#setting-font-size"),
        settingFontSizeValue: $("#setting-font-size-value"),
        settingFontFamily: $("#setting-font-family"),
        settingCharacterSpacing: $("#setting-character-spacing"),
        settingCharacterSpacingValue: $("#setting-character-spacing-value"),
        settingAnimationSpeed: $("#setting-animation-speed"),
        settingAnimationSpeedValue: $("#setting-animation-speed-value"),
        settingBrightness: $("#setting-brightness"),
        settingBrightnessValue: $("#setting-brightness-value"),
        settingContrast: $("#setting-contrast"),
        settingContrastValue: $("#setting-contrast-value"),
        settingColorCount: $("#setting-color-count"),
        settingPaletteMode: $("#setting-palette-mode"),
        settingInvert: $("#setting-invert"),
        settingDither: $("#setting-dither"),

        aboutBackdrop: $("#about-backdrop"),
        aboutDialog: $("#about-dialog"),
        aboutTitlebar: $("#about-titlebar"),
        aboutClose: $("#about-close"),
        aboutOk: $("#about-ok"),
        aboutGithub: $("#about-github"),
    });
}

function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

function isDisabledMenuItem(element) {
    return element?.getAttribute("aria-disabled") === "true";
}

function numberSetting(input, fallback) {
    const value = Number(input?.value);
    return Number.isFinite(value) && input?.value !== "" ? value : fallback;
}

// swap between app screens without spreading visibility logic everywhere

function showScreen(name) {
    const screens = $$("[data-screen]");
    let found = false;

    for (const screen of screens) {
        const matches = screen.dataset.screen === name;
        screen.classList.toggle("hidden", !matches);
        found = found || matches;
    }

    if (!found) {
        console.warn(`[TexArtUI] Unknown screen: ${name}`);
        return;
    }

    state.screen = name;
    emit("texart:screen-changed", { screen: name });
}

// keep the custom title bar synced with the actual tauri window

async function initializeWindowChrome() {
    if (!appWindow) return;

    try {
        await appWindow.setDecorations(false);

        if (LogicalSize) {
            await appWindow.setSize(new LogicalSize(BASE_WIDTH, BASE_HEIGHT));
        }
    } catch (error) {
        console.warn("[TexArtUI] Could not apply Tauri window chrome:", error);
    }
}

async function toggleMaximize() {
    if (!appWindow) return;

    try {
        const maximized = await appWindow.isMaximized();

        if (maximized) {
            await appWindow.unmaximize();
            els.maximize?.setAttribute("aria-label", "Maximize");
        } else {
            await appWindow.maximize();
            els.maximize?.setAttribute("aria-label", "Restore");
        }
    } catch (error) {
        console.warn("[TexArtUI] Maximize failed:", error);
    }
}

async function setWingOpen(open, { resizeWindow = true } = {}) {
    if (!els.previewWing) return;

    const shouldOpen = Boolean(open);
    const wasOpen = state.wingOpen;
    state.wingOpen = shouldOpen;

    els.previewWing.classList.toggle("open", shouldOpen);
    els.previewWing.setAttribute("aria-hidden", String(!shouldOpen));

    if (resizeWindow && shouldOpen !== wasOpen && appWindow && LogicalSize) {
        try {
            const widthDelta = shouldOpen ? WING_WIDTH : -WING_WIDTH;
            await appWindow.setSize(
                new LogicalSize(
                    Math.max(360, window.innerWidth + widthDelta),
                    Math.max(320, window.innerHeight)
                )
            );
        } catch (error) {
            console.warn("[TexArtUI] Window resize failed:", error);
        }
    }

    emit("texart:wing-toggled", { open: shouldOpen });
}

// menu behavior is shared so every dropdown feels the same

const menuMap = {
    "menu-file": "file-menu-popup",
    "menu-edit": "edit-menu-popup",
    "menu-view": "view-menu-popup",
    "menu-image": "image-menu-popup",
    "menu-colors": "colors-menu-popup",
    "menu-help": "help-menu-popup",
};

function closeMenus() {
    $$(".xp-context-menu.visible").forEach((menu) =>
        menu.classList.remove("visible")
    );

    $$("button.menu-top[aria-expanded='true']").forEach((button) => {
        button.setAttribute("aria-expanded", "false");
    });

    state.activeMenu = null;
}

function openMenu(buttonId, popupId) {
    closeMenus();

    const button = document.getElementById(buttonId);
    const popup = document.getElementById(popupId);

    if (!button || !popup) return;

    const rect = button.getBoundingClientRect();

    popup.style.left = `${Math.round(rect.left)}px`;
    popup.style.top = `${Math.round(rect.bottom + 1)}px`;
    popup.classList.add("visible");

    button.setAttribute("aria-expanded", "true");
    state.activeMenu = popupId;
}

function toggleMenu(buttonId, popupId) {
    if (state.activeMenu === popupId) {
        closeMenus();
    } else {
        openMenu(buttonId, popupId);
    }
}

function wireMenus() {
    Object.entries(menuMap).forEach(([buttonId, popupId]) => {
        const button = document.getElementById(buttonId);
        const popup = document.getElementById(popupId);

        if (!button || !popup) return;

        button.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleMenu(buttonId, popupId);
        });

        button.addEventListener("mouseenter", () => {
            if (state.activeMenu && state.activeMenu !== popupId) {
                openMenu(buttonId, popupId);
            }
        });
    });

    document.addEventListener("pointerdown", (event) => {
        if (
            !event.target.closest(".xp-context-menu") &&
            !event.target.closest(".menu-top")
        ) {
            closeMenus();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMenus();
    });
}

// remove browser behaviors that make the app feel like a web page
function wireDesktopDefaults() {
    document.addEventListener("contextmenu", (event) => {
        event.preventDefault();
    });

    $$('input, textarea').forEach((control) => {
        control.setAttribute("autocomplete", "off");
        control.setAttribute("autocapitalize", "off");
        control.setAttribute("autocorrect", "off");
        control.spellcheck = false;
    });
}

// about uses pointer capture so dragging stays smooth outside its title bar
function openAboutDialog() {
    closeMenus();
    if (!els.aboutBackdrop || !els.aboutDialog) return;

    els.aboutBackdrop.hidden = false;

    const left = Math.max(8, (window.innerWidth - els.aboutDialog.offsetWidth) / 2);
    const top = Math.max(8, (window.innerHeight - els.aboutDialog.offsetHeight) / 2);

    els.aboutDialog.style.left = `${Math.round(left)}px`;
    els.aboutDialog.style.top = `${Math.round(top)}px`;
    els.aboutClose?.focus();
}

function closeAboutDialog() {
    if (els.aboutBackdrop) els.aboutBackdrop.hidden = true;
}

function wireAboutDialog() {
    els.aboutClose?.addEventListener("click", closeAboutDialog);
    els.aboutOk?.addEventListener("click", closeAboutDialog);
    els.aboutGithub?.addEventListener("click", async (event) => {
        event.preventDefault();

        try {
            await openUrl(event.currentTarget.href);
        } catch (error) {
            console.warn("[TexArtUI] GitHub link failed:", error);
            setStatus("Could not open the GitHub page.");
        }
    });

    els.aboutBackdrop?.addEventListener("pointerdown", (event) => {
        if (event.target === els.aboutBackdrop) closeAboutDialog();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !els.aboutBackdrop?.hidden) {
            closeAboutDialog();
        }
    });

    let drag = null;

    els.aboutTitlebar?.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;

        const rect = els.aboutDialog.getBoundingClientRect();
        drag = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
        };

        els.aboutTitlebar.setPointerCapture(event.pointerId);
    });

    els.aboutTitlebar?.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;

        const maxLeft = Math.max(0, window.innerWidth - els.aboutDialog.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - els.aboutDialog.offsetHeight);
        const left = Math.min(maxLeft, Math.max(0, event.clientX - drag.offsetX));
        const top = Math.min(maxTop, Math.max(0, event.clientY - drag.offsetY));

        els.aboutDialog.style.left = `${Math.round(left)}px`;
        els.aboutDialog.style.top = `${Math.round(top)}px`;
    });

    const stopDragging = (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag = null;
    };

    els.aboutTitlebar?.addEventListener("pointerup", stopDragging);
    els.aboutTitlebar?.addEventListener("pointercancel", stopDragging);
}

// image loading also prepares the preview and a useful starting palette

function openFilePicker() {
    if (els.fileInput) els.fileInput.value = "";
    els.fileInput?.click();
}

function hasActiveImageEdits(settings) {
    return Number(settings.brightness) !== 0 ||
        Number(settings.contrast) !== 0 ||
        Boolean(settings.invert) ||
        Boolean(settings.paletteMode) ||
        settings.crop?.mode === "manual";
}

function disposeEditedPreview() {
    clearTimeout(previewEditTimer);
    previewEditTimer = null;
    state.previewEditGeneration += 1;
    state.previewShowingEdits = false;

    if (state.previewEditedUrl) {
        URL.revokeObjectURL(state.previewEditedUrl);
        state.previewEditedUrl = null;
    }

    els.preview?.classList.remove("showing-edits");
}

function showOriginalPreview() {
    disposeEditedPreview();
    if (!els.preview || !state.imageUrl) return;

    els.preview.src = state.imageUrl;
    els.preview.classList.remove("showing-edits");
    els.preview.alt = state.imageFile?.name || "Uploaded image";
}

async function createEditedPreviewUrl(image, settings) {
    const sourceRect = resolveSourceRect(
        image.naturalWidth,
        image.naturalHeight,
        settings.crop
    );
    const scale = Math.min(
        1,
        720 / Math.max(sourceRect.width, sourceRect.height)
    );
    const width = Math.max(1, Math.round(sourceRect.width * scale));
    const height = Math.max(1, Math.round(sourceRect.height * scale));
    const sample = sampleImage(image, settings, {
        columns: width,
        rows: height,
    });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) throw new Error("Preview canvas is unavailable.");

    canvas.width = width;
    canvas.height = height;

    const pixels = context.createImageData(width, height);

    for (let index = 0; index < sample.cells.length; index += 1) {
        const cell = sample.cells[index];
        const pixel = index * 4;

        pixels.data[pixel] = cell.red;
        pixels.data[pixel + 1] = cell.green;
        pixels.data[pixel + 2] = cell.blue;
        pixels.data[pixel + 3] = cell.alpha;
    }

    context.putImageData(pixels, 0, 0);

    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
            if (result) resolve(result);
            else reject(new Error("Edited preview could not be created."));
        }, "image/png");
    });

    return URL.createObjectURL(blob);
}

async function showEditedPreview(settings = getSettings()) {
    if (!els.preview || !state.imageElement || !hasActiveImageEdits(settings)) {
        showOriginalPreview();
        return;
    }

    state.previewShowingEdits = true;
    const generation = ++state.previewEditGeneration;

    try {
        const url = await createEditedPreviewUrl(state.imageElement, settings);

        if (
            generation !== state.previewEditGeneration ||
            !state.previewShowingEdits
        ) {
            URL.revokeObjectURL(url);
            return;
        }

        if (state.previewEditedUrl) URL.revokeObjectURL(state.previewEditedUrl);
        state.previewEditedUrl = url;
        els.preview.src = url;
        els.preview.classList.add("showing-edits");
        els.preview.alt = "Edited image preview";
    } catch (error) {
        console.warn("[TexArtUI] Edited preview failed:", error);
        showOriginalPreview();
        setStatus("Edited preview could not be shown.");
    }
}

function scheduleEditedPreview(settings) {
    clearTimeout(previewEditTimer);
    const snapshot = structuredClone(settings);

    previewEditTimer = setTimeout(() => {
        previewEditTimer = null;
        showEditedPreview(snapshot);
    }, 80);
}

function syncPreviewEditState(settings = getSettings()) {
    if (!els.preview) return;

    const active = Boolean(state.imageElement) && hasActiveImageEdits(settings);
    els.preview.classList.toggle("has-active-edits", active);
    els.preview.setAttribute("aria-disabled", String(!active));
    els.preview.title = active
        ? "Click to toggle the edited preview."
        : "No image edits are active.";

    if (!active) {
        showOriginalPreview();
    } else if (state.previewShowingEdits) {
        scheduleEditedPreview(settings);
    }
}

function toggleEditedPreview() {
    const settings = getSettings();
    if (!hasActiveImageEdits(settings)) return;

    if (state.previewShowingEdits) {
        showOriginalPreview();
        syncPreviewEditState(settings);
        setStatus("Showing original preview.");
    } else {
        showEditedPreview(settings);
        setStatus("Showing edited preview.");
    }
}

async function clearImage() {
    if (
        !els.previewFrame ||
        !els.previewEmpty ||
        !els.processBtn ||
        !els.settingsPanel
    ) {
        return;
    }

    clearTimeout(liveProcessTimer);
    clearTimeout(paletteRefreshTimer);
    liveProcessTimer = null;
    paletteRefreshTimer = null;

    if (state.imageUrl) {
        URL.revokeObjectURL(state.imageUrl);
    }

    disposeEditedPreview();

    state.imageFile = null;
    state.imageUrl = null;
    state.imageElement = null;
    lastProcessedScene = null;
    projectStore.setImage(null);
    canvasAnimator?.clear();
    setExportEnabled(false);

    if (els.fileInput) els.fileInput.value = "";

    els.preview?.removeAttribute("src");
    syncPreviewEditState(getSettings());
    els.previewFrame.hidden = true;
    els.settingsPanel.hidden = true;
    els.previewEmpty.hidden = false;

    els.processBtn.disabled = true;

    setMenuItemEnabled("file-process", false);
    setMenuItemEnabled("file-clear", false);
    setMenuItemEnabled("image-process", false);
    setMenuItemEnabled("colors-auto", false);

    setPalette(DEFAULT_PALETTE);

    setTexArt("> Begin by going to ‘file’ and uploading an image!");
    setCanvasPlaceholder("> Press File and upload an image to begin.");
    setResolution(null);
    setImageSize(null);
    setStatus("Ready. Hover over a control for details.");

    if (els.windowTitle) {
        els.windowTitle.textContent = "TexArt";
    }

    document.title = "TexArt";

    await setWingOpen(false, { resizeWindow: false });

    // clear means back to the same plain window the app started with
    if (appWindow && LogicalSize) {
        try {
            if (await appWindow.isMaximized()) await appWindow.unmaximize();
            programmaticResizeUntil = Date.now() + 350;
            await appWindow.setSize(new LogicalSize(BASE_WIDTH, BASE_HEIGHT));
        } catch (error) {
            console.warn("[TexArtUI] Base window restore failed:", error);
        }
    }

    emit("texart:image-cleared");
}

async function handleFile(file, { fitOnLoad = true } = {}) {
    if (!file || !file.type.startsWith("image/")) return;

    clearTimeout(liveProcessTimer);
    clearTimeout(paletteRefreshTimer);
    liveProcessTimer = null;
    paletteRefreshTimer = null;

    if (
        !els.preview ||
        !els.previewFrame ||
        !els.previewEmpty ||
        !els.processBtn ||
        !els.settingsPanel
    ) {
        return;
    }

    if (state.imageUrl) {
        URL.revokeObjectURL(state.imageUrl);
    }

    disposeEditedPreview();

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = async () => {
        state.imageFile = file;
        state.imageUrl = objectUrl;
        state.imageElement = image;
        lastProcessedScene = null;
        canvasAnimator?.clear();
        setExportEnabled(false);
        projectStore.setImage({
            name: file.name,
            type: file.type,
            size: file.size,
            width: image.naturalWidth,
            height: image.naturalHeight,
        });

        els.preview.src = objectUrl;
        els.preview.alt = file.name || "Uploaded image";
        syncPreviewEditState(getSettings());

        els.previewEmpty.hidden = true;
        els.previewFrame.hidden = false;
        els.settingsPanel.hidden = false;

        els.processBtn.disabled = false;

        setMenuItemEnabled("file-process", true);
        setMenuItemEnabled("file-clear", true);
        setMenuItemEnabled("image-process", true);
        setMenuItemEnabled("colors-auto", true);

        if (els.windowTitle) {
            els.windowTitle.textContent = `${file.name} - TexArt`;
        }

        document.title = `${file.name} - TexArt`;

        setTexArt("");
        setCanvasPlaceholder("> Press Process to generate the animation.");
        setStatus("Image loaded. Adjust settings or click Process.");
        setImageSize(image.naturalWidth, image.naturalHeight);

        const palette = extractProminentColors(
            image,
            numberSetting(els.settingColorCount, DEFAULT_SETTINGS.colorCount)
        );
        if (palette.length) setPalette(palette);

        await setWingOpen(true);
        await nextPaint();

        if (fitOnLoad) {
            await fitWindowToImage(image, getSettings());
        }

        emit("texart:image-selected", {
            file,
            url: objectUrl,
            width: image.naturalWidth,
            height: image.naturalHeight,
            palette: [...state.palette],
        });
    };

    image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setStatus("Could not load that image.");
        emit("texart:image-error", { file });
    };

    image.src = objectUrl;
}

// pull a small useful palette straight from the uploaded image
function rgbToHex(red, green, blue) {
    const toHex = (value) => value.toString(16).padStart(2, "0");
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function extractProminentColors(image, maxColors = 32) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const maxSampleEdge = 180;
    const scale = Math.min(
        1,
        maxSampleEdge / Math.max(image.naturalWidth, image.naturalHeight)
    );

    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const buckets = new Map();

    for (let pixel = 0; pixel < data.length; pixel += 4) {
        const alpha = data[pixel + 3];
        if (alpha < 128) continue;

        const red = data[pixel];
        const green = data[pixel + 1];
        const blue = data[pixel + 2];

        const roundedRed = Math.round(red / 32) * 32;
        const roundedGreen = Math.round(green / 32) * 32;
        const roundedBlue = Math.round(blue / 32) * 32;

        const bucketRed = Math.min(255, roundedRed);
        const bucketGreen = Math.min(255, roundedGreen);
        const bucketBlue = Math.min(255, roundedBlue);

        const key = `${bucketRed},${bucketGreen},${bucketBlue}`;
        buckets.set(key, (buckets.get(key) || 0) + 1);
    }

    return [...buckets.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxColors)
        .map(([key]) => {
            const [red, green, blue] = key.split(",").map(Number);
            return rgbToHex(red, green, blue);
        });
}

function renderPalette() {
    if (!els.palette) return;

    els.palette.innerHTML = "";

    els.paletteSwatches = state.palette.map((color, index) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "palette-swatch";
        button.dataset.color = color;
        button.style.background = color;
        button.title = color;

        button.setAttribute(
            "aria-label",
            `Palette color ${index + 1}: ${color}`
        );

        button.setAttribute(
            "aria-pressed",
            state.selectedColor === color ? "true" : "false"
        );

        button.addEventListener("click", () => {
            if (!els.paletteColorPicker) return;
            els.paletteColorPicker.dataset.index = String(index);
            els.paletteColorPicker.value = button.dataset.color;
            if (typeof els.paletteColorPicker.showPicker === "function") {
                els.paletteColorPicker.showPicker();
            } else {
                els.paletteColorPicker.click();
            }
        });

        els.palette.appendChild(button);

        return button;
    });
}

function setPalette(colors) {
    if (!Array.isArray(colors) || !colors.length) return;

    const normalized = colors
        .filter(Boolean)
        .map((color) => String(color).trim())
        .slice(0, 256);

    state.palette = normalized;

    if (state.selectedColor && !normalized.includes(state.selectedColor)) {
        state.selectedColor = null;
    }

    renderPalette();
    projectStore.setSettings({
        palette: [...state.palette],
        selectedColor: state.selectedColor,
    });

    emit("texart:palette-changed", {
        colors: [...state.palette],
    });

    if (state.imageElement) syncPreviewEditState(getSettings());
}

// ui controls always pass through the project store before processing
function getSettings() {
    projectStore.setSettings({
        charset: els.settingCharset?.value || DEFAULT_SETTINGS.charset,
        fontSize: numberSetting(els.settingFontSize, DEFAULT_SETTINGS.fontSize),
        fontFamily: els.settingFontFamily?.value || DEFAULT_SETTINGS.fontFamily,
        characterSpacing: numberSetting(
            els.settingCharacterSpacing,
            DEFAULT_SETTINGS.characterSpacing * 100
        ) / 100,
        brightness: numberSetting(
            els.settingBrightness,
            DEFAULT_SETTINGS.brightness
        ),
        contrast: numberSetting(
            els.settingContrast,
            DEFAULT_SETTINGS.contrast
        ),
        colorCount: numberSetting(
            els.settingColorCount,
            DEFAULT_SETTINGS.colorCount
        ),
        colored: true,
        paletteMode: Boolean(
            els.settingPaletteMode?.checked ?? DEFAULT_SETTINGS.paletteMode
        ),
        invert: Boolean(els.settingInvert?.checked ?? DEFAULT_SETTINGS.invert),
        dither: Boolean(els.settingDither?.checked ?? DEFAULT_SETTINGS.dither),
        preserveAspect: true,
        selectedColor: state.selectedColor,
        palette: [...state.palette],
        textMode: "pattern",
        animation: {
            ...projectStore.getSnapshot().settings.animation,
            enabled: true,
            speed: numberSetting(
                els.settingAnimationSpeed,
                DEFAULT_SETTINGS.animation.speed
            ),
        },
    });

    return projectStore.getSnapshot().settings;
}

function resetSettings() {
    if (els.settingCharset) els.settingCharset.value = DEFAULT_SETTINGS.charset;
    if (els.settingFontSize) els.settingFontSize.value = DEFAULT_SETTINGS.fontSize;
    if (els.settingFontSizeValue) {
        els.settingFontSizeValue.textContent = `${DEFAULT_SETTINGS.fontSize}px`;
    }
    if (els.settingFontFamily) {
        els.settingFontFamily.value = DEFAULT_SETTINGS.fontFamily;
    }
    if (els.settingCharacterSpacing) {
        els.settingCharacterSpacing.value = DEFAULT_SETTINGS.characterSpacing * 100;
    }
    if (els.settingCharacterSpacingValue) {
        const defaultSpacing = DEFAULT_SETTINGS.characterSpacing * 100;
        els.settingCharacterSpacingValue.textContent = `${defaultSpacing}%`;
    }
    if (els.settingAnimationSpeed) {
        els.settingAnimationSpeed.value = DEFAULT_SETTINGS.animation.speed;
    }
    if (els.settingAnimationSpeedValue) {
        els.settingAnimationSpeedValue.textContent = `${Math.round(DEFAULT_SETTINGS.animation.speed * 100)}%`;
    }
    if (els.settingBrightness) els.settingBrightness.value = DEFAULT_SETTINGS.brightness;
    if (els.settingBrightnessValue) {
        els.settingBrightnessValue.textContent = `${DEFAULT_SETTINGS.brightness}%`;
    }
    if (els.settingContrast) els.settingContrast.value = DEFAULT_SETTINGS.contrast;
    if (els.settingContrastValue) {
        els.settingContrastValue.textContent = `${DEFAULT_SETTINGS.contrast}%`;
    }
    if (els.settingColorCount) els.settingColorCount.value = DEFAULT_SETTINGS.colorCount;
    if (els.settingPaletteMode) {
        els.settingPaletteMode.checked = DEFAULT_SETTINGS.paletteMode;
    }
    if (els.settingInvert) els.settingInvert.checked = DEFAULT_SETTINGS.invert;
    if (els.settingDither) els.settingDither.checked = DEFAULT_SETTINGS.dither;

    state.selectedColor = null;
    projectStore.resetSettings({
        ...DEFAULT_SETTINGS,
        palette: [...state.palette],
    });

    renderPalette();

    const settings = getSettings();
    syncPreviewEditState(settings);
    emit("texart:settings-reset", { settings });
    scheduleLiveProcess();
}

function wireSettings() {
    const controls = [
        els.settingCharset,
        els.settingFontSize,
        els.settingFontFamily,
        els.settingCharacterSpacing,
        els.settingAnimationSpeed,
        els.settingBrightness,
        els.settingContrast,
        els.settingColorCount,
        els.settingPaletteMode,
        els.settingInvert,
        els.settingDither,
    ].filter(Boolean);

    for (const control of controls) {
        control.addEventListener("input", () => {
            if (control === els.settingFontSize && els.settingFontSizeValue) {
                els.settingFontSizeValue.textContent = `${control.value}px`;
            }
            if (
                control === els.settingCharacterSpacing &&
                els.settingCharacterSpacingValue
            ) {
                els.settingCharacterSpacingValue.textContent = `${control.value}%`;
            }
            if (
                control === els.settingAnimationSpeed &&
                els.settingAnimationSpeedValue
            ) {
                els.settingAnimationSpeedValue.textContent = `${Math.round(Number(control.value) * 100)}%`;
            }
            if (control === els.settingBrightness && els.settingBrightnessValue) {
                els.settingBrightnessValue.textContent = `${control.value}%`;
            }
            if (control === els.settingContrast && els.settingContrastValue) {
                els.settingContrastValue.textContent = `${control.value}%`;
            }

            const settings = getSettings();
            syncPreviewEditState(settings);

            emit("texart:setting-changed", {
                id: control.id,
                value: control.type === "checkbox" ? control.checked : control.value,
                settings,
            });

            // number inputs fire a lot while scrolling, palette size gets its own pause
            if (control === els.settingColorCount) {
                schedulePaletteRefresh();
            } else {
                scheduleLiveProcess();
            }
        });

        control.addEventListener("change", () => {
            emit("texart:settings-committed", {
                settings: getSettings(),
            });
        });
    }

    els.resetSettingsBtn?.addEventListener("click", resetSettings);
}

function scheduleLiveProcess() {
    if (!state.imageElement) return;
    clearTimeout(liveProcessTimer);
    liveProcessTimer = setTimeout(() => requestProcess("live-settings"), 140);
}

function schedulePaletteRefresh() {
    if (!state.imageElement) return;
    clearTimeout(paletteRefreshTimer);

    paletteRefreshTimer = setTimeout(() => {
        paletteRefreshTimer = null;

        const colorCount = getSettings().colorCount;
        const colors = extractProminentColors(state.imageElement, colorCount);

        if (colors.length) setPalette(colors);
        if (els.settingPaletteMode?.checked) scheduleLiveProcess();
    }, 200);
}

function wireHoverDescriptions() {
    document.querySelectorAll("[data-description]").forEach((el) => {
        el.addEventListener("mouseenter", (e) => {
            if (els.statusMessage) {
                els.statusMessage.textContent = e.currentTarget.dataset.description;
            }
        });
        el.addEventListener("mouseleave", () => {
            if (els.statusMessage) {
                els.statusMessage.textContent = state.currentStatus;
            }
        });
    });
}

// processing turns the current image and settings into a fresh canvas scene

function requestProcess(source = "unknown") {
    if (!state.imageFile || !state.imageElement) return;

    const payload = {
        source,
        file: state.imageFile,
        imageUrl: state.imageUrl,
        imageWidth: state.imageElement.naturalWidth,
        imageHeight: state.imageElement.naturalHeight,
        settings: getSettings(),
    };

    setStatus("Processing...");
    emit("texart:process-requested", payload);
}

let processingGeneration = 0;

function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

function getWorkspaceViewport() {
    return {
        width: Math.max(1, els.outputShell?.clientWidth || 1),
        height: Math.max(1, els.outputShell?.clientHeight || 1),
    };
}

async function fitWindowToImage(image, settings) {
    if (!appWindow || !LogicalSize || !els.outputShell) return;

    const sourceRect = resolveSourceRect(
        image.naturalWidth,
        image.naturalHeight,
        settings.crop
    );
    const currentViewport = getWorkspaceViewport();
    const chrome = {
        width: Math.max(0, window.innerWidth - currentViewport.width),
        height: Math.max(0, window.innerHeight - currentViewport.height),
    };
    const availableScreen = {
        width: Math.max(480, (window.screen?.availWidth || window.innerWidth) - 48),
        height: Math.max(360, (window.screen?.availHeight || window.innerHeight) - 48),
    };
    const maximumViewport = {
        width: Math.max(1, availableScreen.width - chrome.width),
        height: Math.max(1, availableScreen.height - chrome.height),
    };
    const preferredBounds = {
        width: Math.min(maximumViewport.width, Math.max(480, sourceRect.width)),
        height: Math.min(maximumViewport.height, Math.max(270, sourceRect.height)),
    };
    const viewport = fitAspectWithinBounds(
        sourceRect.width / sourceRect.height,
        preferredBounds.width,
        preferredBounds.height
    );
    const windowSize = calculateWindowSize(viewport, chrome, availableScreen);

    try {
        if (await appWindow.isMaximized()) await appWindow.unmaximize();
        programmaticResizeUntil = Date.now() + 350;
        await appWindow.setSize(new LogicalSize(windowSize.width, windowSize.height));
        await nextPaint();
        await nextPaint();
    } catch (error) {
        console.warn("[TexArtUI] Aspect-ratio window fit failed:", error);
    }
}

async function fitWindowToViewport(viewport) {
    if (!appWindow || !LogicalSize || !els.outputShell) return;

    const currentViewport = getWorkspaceViewport();
    const chrome = {
        width: Math.max(0, window.innerWidth - currentViewport.width),
        height: Math.max(0, window.innerHeight - currentViewport.height),
    };
    const availableScreen = {
        width: Math.max(480, (window.screen?.availWidth || window.innerWidth) - 48),
        height: Math.max(360, (window.screen?.availHeight || window.innerHeight) - 48),
    };
    const windowSize = calculateWindowSize(viewport, chrome, availableScreen);

    try {
        if (await appWindow.isMaximized()) await appWindow.unmaximize();
        programmaticResizeUntil = Date.now() + 350;
        await appWindow.setSize(new LogicalSize(windowSize.width, windowSize.height));
        await nextPaint();
        await nextPaint();
    } catch (error) {
        console.warn("[TexArtUI] MXA viewport restore failed:", error);
    }
}

async function handleProcessRequest(event) {
    const generation = ++processingGeneration;
    const { imageElement, settings } = {
        imageElement: state.imageElement,
        settings: event.detail?.settings || getSettings(),
    };

    if (!imageElement) return;

    try {
        const source = event.detail?.source || "unknown";

        // upload already fits the window. process is just a redraw after that.
        if (source === "mxa-load" && pendingMxaViewport) {
            await fitWindowToViewport(pendingMxaViewport);
            pendingMxaViewport = null;
        }

        await nextPaint();
        const viewport = getWorkspaceViewport();
        const sourceRect = resolveSourceRect(
            imageElement.naturalWidth,
            imageElement.naturalHeight,
            settings.crop
        );
        const contentAspect = sourceRect.width / sourceRect.height;
        const contentViewport = fitAspectWithinBounds(
            contentAspect,
            viewport.width,
            viewport.height
        );
        const textMetrics = canvasAnimator?.measureText(settings) || {
            characterWidth: settings.fontSize * 0.6,
            lineHeight: settings.fontSize * 0.9,
        };
        const resolution = calculateGridForViewport(
            contentViewport.width,
            contentViewport.height,
            textMetrics.characterWidth * settings.characterSpacing,
            textMetrics.lineHeight * settings.characterSpacing
        );
        const sample = sampleImage(imageElement, settings, resolution);
        const glyphGrid = generateGlyphGrid(sample, settings);

        if (generation !== processingGeneration) return;

        settings.width = resolution.columns;
        projectStore.setSettings({ width: resolution.columns });
        setTexArt(glyphGridToText(glyphGrid));
        setCanvasPlaceholder(null);
        canvasAnimator?.setScene(glyphGrid, settings, viewport, contentAspect);
        lastProcessedScene = {
            grid: glyphGrid,
            settings: structuredClone(settings),
            viewport: { ...contentViewport },
        };
        setExportEnabled(true);
        setResolution(resolution.columns, resolution.rows);
        setStatus(`Processed ${glyphGrid.columns} × ${glyphGrid.rows} characters.`);

        emit("texart:processed", {
            source,
            sample,
            glyphGrid,
            project: projectStore.getSnapshot(),
        });
    } catch (error) {
        if (generation !== processingGeneration) return;
        console.error("[TexArtUI] Processing failed:", error);
        setCanvasPlaceholder("> Image processing failed.");
        setStatus("Image processing failed.");
        emit("texart:processing-error", { error });
    }
}

function wireProcessing() {
    window.addEventListener("texart:process-requested", handleProcessRequest);
}

function wireWorkspaceResize() {
    window.addEventListener("resize", () => {
        canvasAnimator?.resizeViewport(getWorkspaceViewport());

        if (!state.imageElement || Date.now() < programmaticResizeUntil) return;

        clearTimeout(resizeProcessTimer);
        resizeProcessTimer = setTimeout(
            () => requestProcess("window-resize"),
            220
        );
    });
}

// small output helpers keep canvas, status text, and events in sync

function setTexArt(text) {
    if (!els.output) return;

    els.output.textContent = text ?? "";

    emit("texart:output-changed", {
        text: els.output.textContent,
    });
}

function setStatus(message) {
    state.currentStatus = message ?? "";
    if (!els.statusMessage) return;
    els.statusMessage.textContent = state.currentStatus;
}

function setImageSize(width, height) {
    if (!els.statusImageSize) return;

    els.statusImageSize.textContent =
        Number.isFinite(width) && Number.isFinite(height)
            ? `${width} × ${height}`
            : "";
}

function setCanvasPlaceholder(message) {
    if (!els.outputPlaceholder) return;

    els.outputPlaceholder.textContent = message || "";
    els.outputPlaceholder.hidden = !message;
}

function setResolution(columns, rows) {
    if (!els.settingResolution) return;

    els.settingResolution.textContent =
        Number.isFinite(columns) && Number.isFinite(rows)
            ? `${columns} × ${rows}`
            : "—";
}

function setZoom(percent) {
    const zoom = Number(percent) || 100;

    if (els.output) {
        els.output.style.fontSize = `${Math.max(5, 14 * (zoom / 100))}px`;
    }

    if (els.statusZoom) {
        els.statusZoom.textContent = `${Math.round(zoom)}%`;
    }

    emit("texart:zoom-changed", { zoom });
}

function setMenuItemEnabled(id, enabled) {
    const item = document.getElementById(id);
    if (!item) return;

    item.setAttribute("aria-disabled", String(!enabled));
}

function setExportEnabled(enabled) {
    const available = Boolean(enabled) && !exportInProgress;

    if (els.exportGifBtn) els.exportGifBtn.disabled = !available;
    if (els.exportMxaBtn) els.exportMxaBtn.disabled = !available;
    if (els.gifExportScale) els.gifExportScale.disabled = exportInProgress;
    setMenuItemEnabled("file-export-gif", available);
    setMenuItemEnabled("file-export-mxa", available);
    updateGifExportSize();
}

function updateGifExportSize() {
    if (!els.gifExportScale || !els.gifExportSize) return;

    els.gifExportScale.value = String(state.gifScale);

    if (!lastProcessedScene) {
        els.gifExportSize.textContent = "Process first";
        return;
    }

    const { width, height } = lastProcessedScene.viewport;

    // 8k-ish is already a very large gif, past this the encoder gets rough
    for (const option of els.gifExportScale.options) {
        const scale = Number(option.value);
        option.disabled = (width * scale) * (height * scale) > MAX_GIF_PIXELS;
    }

    const chosenOption = els.gifExportScale.selectedOptions[0];
    if (chosenOption?.disabled) {
        const fallback = [...els.gifExportScale.options]
            .reverse()
            .find((option) => !option.disabled);

        state.gifScale = Number(fallback?.value) || 1;
        els.gifExportScale.value = String(state.gifScale);
    }

    const exportWidth = Math.round(width * state.gifScale);
    const exportHeight = Math.round(height * state.gifScale);
    els.gifExportSize.textContent = `${exportWidth} × ${exportHeight}`;
}

async function exportLoopingGif() {
    if (!lastProcessedScene || exportInProgress) return;

    exportInProgress = true;
    setExportEnabled(false);

    try {
        const filename = `${safeBasename(state.imageFile?.name)}.gif`;
        const path = await chooseSavePath({
            filename,
            title: "Save Looping GIF",
            extension: "gif",
            filterName: "GIF Animation",
        });
        if (!path) {
            setStatus("GIF export cancelled.");
            return;
        }

        const blob = await encodeLoopingGif(
            lastProcessedScene,
            (progress) => {
                setStatus(`Recording GIF... ${Math.round(progress * 100)}%`);
            },
            state.gifScale
        );
        await writeBlobToPath(path, blob);
        setStatus(`Saved ${filename}.`);
    } catch (error) {
        console.error("[TexArtUI] GIF export failed:", error);
        setStatus("GIF export failed.");
    } finally {
        exportInProgress = false;
        setExportEnabled(Boolean(lastProcessedScene));
    }
}

async function exportMxaProject() {
    if (!lastProcessedScene || !state.imageFile || exportInProgress) return;

    exportInProgress = true;
    setExportEnabled(false);
    setStatus("Saving MXA project...");

    try {
        const filename = `${safeBasename(state.imageFile.name)}.mxa`;
        const path = await chooseSavePath({
            filename,
            title: "Save MXA Project",
            extension: "mxa",
            filterName: "MXA Project",
        });
        if (!path) {
            setStatus("MXA export cancelled.");
            return;
        }

        const project = projectStore.getSnapshot();
        project.settings = structuredClone(lastProcessedScene.settings);
        const document = await createMxaDocument({
            project,
            imageFile: state.imageFile,
            viewport: lastProcessedScene.viewport,
        });
        const blob = new Blob([JSON.stringify(document)], {
            type: "application/json",
        });

        await writeBlobToPath(path, blob);
        setStatus(`Saved ${filename}.`);
    } catch (error) {
        console.error("[TexArtUI] MXA export failed:", error);
        setStatus("MXA export failed.");
    } finally {
        exportInProgress = false;
        setExportEnabled(Boolean(lastProcessedScene));
    }
}

function applySettingsToControls(settings) {
    projectStore.setSettings(settings);

    if (els.settingCharset) els.settingCharset.value = settings.charset;
    if (els.settingFontSize) els.settingFontSize.value = settings.fontSize;
    if (els.settingFontSizeValue) {
        els.settingFontSizeValue.textContent = `${settings.fontSize}px`;
    }
    if (els.settingFontFamily) els.settingFontFamily.value = settings.fontFamily;
    if (els.settingCharacterSpacing) {
        els.settingCharacterSpacing.value = settings.characterSpacing * 100;
    }
    if (els.settingCharacterSpacingValue) {
        els.settingCharacterSpacingValue.textContent = `${Math.round(settings.characterSpacing * 100)}%`;
    }
    if (els.settingAnimationSpeed) {
        els.settingAnimationSpeed.value = settings.animation.speed;
    }
    if (els.settingAnimationSpeedValue) {
        els.settingAnimationSpeedValue.textContent = `${Math.round(settings.animation.speed * 100)}%`;
    }
    if (els.settingBrightness) els.settingBrightness.value = settings.brightness;
    if (els.settingBrightnessValue) {
        els.settingBrightnessValue.textContent = `${settings.brightness}%`;
    }
    if (els.settingContrast) els.settingContrast.value = settings.contrast;
    if (els.settingContrastValue) {
        els.settingContrastValue.textContent = `${settings.contrast}%`;
    }
    if (els.settingColorCount) els.settingColorCount.value = settings.colorCount;
    if (els.settingPaletteMode) {
        els.settingPaletteMode.checked = settings.paletteMode;
    }
    if (els.settingInvert) els.settingInvert.checked = settings.invert;
    if (els.settingDither) els.settingDither.checked = settings.dither;

    state.selectedColor = settings.selectedColor;
    setPalette(settings.palette?.length ? settings.palette : DEFAULT_PALETTE);
}

async function loadMxaFile(file) {
    try {
        setStatus("Loading MXA project...");
        const document = parseMxaDocument(await file.text());
        const sourceFile = sourceFileFromMxa(document);
        const imageLoaded = new Promise((resolve, reject) => {
            window.addEventListener("texart:image-selected", resolve, { once: true });
            window.addEventListener(
                "texart:image-error",
                () => reject(new Error("MXA image could not be loaded.")),
                { once: true }
            );
        });

        handleFile(sourceFile, { fitOnLoad: false });
        await imageLoaded;
        applySettingsToControls(document.project.settings);
        pendingMxaViewport = document.viewport;
        requestProcess("mxa-load");
    } catch (error) {
        console.error("[TexArtUI] MXA load failed:", error);
        setStatus("Could not load that MXA project.");
    }
}

function handleSelectedFile(file) {
    if (!file) return;

    if (file.name?.toLowerCase().endsWith(".mxa")) {
        loadMxaFile(file);
    } else {
        handleFile(file);
    }
}

// buttons, menus, and shortcuts all end up using these commands

function runMenuAction(action) {
    closeMenus();

    switch (action) {
        case "open":
            openFilePicker();
            break;

        case "process":
            requestProcess("menu");
            break;

        case "export-gif":
            exportLoopingGif();
            break;

        case "export-mxa":
            exportMxaProject();
            break;

        case "exit":
            appWindow?.close();
            break;

        case "clear":
            clearImage();
            break;

        case "toggle-preview":
            setWingOpen(!state.wingOpen);
            break;

        case "zoom-100":
            setZoom(100);
            break;

        case "reset-settings":
            resetSettings();
            break;

        case "auto-colors":
            if (state.imageElement) {
                const colorCount = numberSetting(
                    els.settingColorCount,
                    DEFAULT_SETTINGS.colorCount
                );

                setPalette(extractProminentColors(state.imageElement, colorCount));
                if (els.settingPaletteMode?.checked) scheduleLiveProcess();
            }
            break;

        case "reset-colors":
            setPalette(DEFAULT_PALETTE);
            if (els.settingPaletteMode?.checked) scheduleLiveProcess();
            break;

        case "about":
            openAboutDialog();
            break;

        default:
            emit("texart:menu-action", { action });
    }
}

function wireCommands() {
    const actions = {
        "file-open": "open",
        "file-process": "process",
        "file-export-gif": "export-gif",
        "file-export-mxa": "export-mxa",
        "file-clear": "clear",
        "file-exit": "exit",

        "edit-clear": "clear",

        "view-toggle-preview": "toggle-preview",
        "view-zoom-100": "zoom-100",

        "image-process": "process",
        "image-reset-settings": "reset-settings",

        "colors-auto": "auto-colors",
        "colors-reset": "reset-colors",

        "help-about": "about",

    };

    Object.entries(actions).forEach(([id, action]) => {
        const element = document.getElementById(id);
        if (!element) return;

        element.addEventListener("click", (event) => {
            const item = event.currentTarget;
            if (isDisabledMenuItem(item)) return;

            runMenuAction(action);
        });
    });

    els.uploadBtn?.addEventListener("click", openFilePicker);

    els.processBtn?.addEventListener("click", () => {
        requestProcess("main-button");
    });

    els.exportGifBtn?.addEventListener("click", exportLoopingGif);
    els.exportMxaBtn?.addEventListener("click", exportMxaProject);

    els.gifExportScale?.addEventListener("change", () => {
        state.gifScale = Math.max(
            1,
            Math.min(4, Math.round(Number(els.gifExportScale.value) || 2))
        );

        try {
            localStorage.setItem(GIF_SCALE_STORAGE_KEY, String(state.gifScale));
        } catch {
            // private storage can fail, the selection still works for this run
        }

        updateGifExportSize();
        setStatus(`GIF export set to ${els.gifExportSize.textContent}.`);
    });

    els.preview?.addEventListener("click", toggleEditedPreview);
    els.preview?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleEditedPreview();
    });

    els.fileInput?.addEventListener("change", () => {
        const [file] = els.fileInput.files || [];
        handleSelectedFile(file);
    });

    els.paletteColorPicker?.addEventListener("input", () => {
        const index = Number.parseInt(els.paletteColorPicker.dataset.index, 10);
        if (!Number.isInteger(index) || !state.palette[index]) return;

        const palette = [...state.palette];
        palette[index] = els.paletteColorPicker.value;
        setPalette(palette);

        if (els.settingPaletteMode?.checked) scheduleLiveProcess();
    });

    document.getElementById("palette-auto-btn")?.addEventListener("click", () => {
        if (!state.imageElement) return;

        const colorCount = numberSetting(
            els.settingColorCount,
            DEFAULT_SETTINGS.colorCount
        );

        setPalette(extractProminentColors(state.imageElement, colorCount));
        if (els.settingPaletteMode?.checked) scheduleLiveProcess();
    });

    document.getElementById("palette-reset-btn")?.addEventListener("click", () => {
        setPalette(DEFAULT_PALETTE);
        if (els.settingPaletteMode?.checked) scheduleLiveProcess();
    });
}

// dropped images and mxa files use the same loader as the file button
function wireDragDrop() {
    document.addEventListener("dragover", (event) => {
        event.preventDefault();
    });

    document.addEventListener("drop", (event) => {
        event.preventDefault();

        const [file] = event.dataTransfer?.files || [];
        const isImage = file?.type?.startsWith("image/");
        const isProject = file?.name?.toLowerCase().endsWith(".mxa");

        if (isImage || isProject) {
            handleSelectedFile(file);
        }
    });
}

// keep shortcuts boring and predictable
function wireKeyboard() {
    document.addEventListener("keydown", (event) => {
        const mod = event.ctrlKey || event.metaKey;

        if (mod && event.key.toLowerCase() === "o") {
            event.preventDefault();
            openFilePicker();
        }

        if (mod && event.key.toLowerCase() === "p") {
            event.preventDefault();
            requestProcess("keyboard");
        }

    });
}

// expose the few controls the tauri shell or later ui code may need

function exposePublicApi() {
    window.TexArtUI = Object.freeze({
        showScreen,
        openFilePicker,
        clearImage,
        requestProcess,
        setTexArt,
        setStatus,
        setImageSize,
        setZoom,
        setPalette,
        getSettings,
        resetSettings,
        getProject: () => projectStore.getSnapshot(),
        setProjectSettings: (settings) => projectStore.setSettings(settings),

        toggleWing: (force) =>
            setWingOpen(
                typeof force === "boolean" ? force : !state.wingOpen
            ),

        getState: () => ({
            screen: state.screen,
            hasImage: Boolean(state.imageFile),
            imageFile: state.imageFile,
            imageUrl: state.imageUrl,
            wingOpen: state.wingOpen,
            selectedColor: state.selectedColor,
            palette: [...state.palette],
            project: projectStore.getSnapshot(),
        }),
    });
}

// wire everything once the document is ready

async function boot() {
    cacheElements();
    if (els.outputCanvas) canvasAnimator = new CanvasAnimator(els.outputCanvas);
    exposePublicApi();
    initTauriApi();

    wireMenus();
    wireDesktopDefaults();
    wireAboutDialog();
    wireSettings();
    wireHoverDescriptions();
    wireCommands();
    wireProcessing();
    wireWorkspaceResize();
    wireDragDrop();
    wireKeyboard();

    els.minimize?.addEventListener("click", () => {
        appWindow?.minimize();
    });

    els.maximize?.addEventListener("click", () => {
        toggleMaximize();
    });

    els.close?.addEventListener("click", () => {
        appWindow?.close();
    });

    await initializeWindowChrome();

    showScreen("workspace");
    await clearImage();
    setZoom(100);

    emit("texart:ready", {
        baseSize: {
            width: BASE_WIDTH,
            height: BASE_HEIGHT,
        },
        wingWidth: WING_WIDTH,
    });
}

if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}
