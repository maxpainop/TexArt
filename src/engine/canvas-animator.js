// canvas playback stays independent from uploads, palettes, and project files
const FRAME_DURATION = 1000 / 60;
const MAX_CATCH_UP_FRAMES = 4;

// keep unicode characters whole so emoji and symbols do not get split apart
export function animationPattern(text) {
    const characters = Array.from(String(text || " "));
    return characters.length === 1 ? `${characters[0]} ` : characters.join("");
}

export function patternCharacter(text, column, offset) {
    const pattern = Array.from(animationPattern(text));
    const shiftedColumn = column + Math.floor(offset);
    const index = (
        (shiftedColumn % pattern.length) + pattern.length
    ) % pattern.length;
    return pattern[index];
}

// this owns canvas playback only; image sampling lives in processing layer
export class CanvasAnimator {
    constructor(canvas, { pixelRatio = null } = {}) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError("CanvasAnimator requires a canvas element.");
        }

        this.canvas = canvas;
        this.context = canvas.getContext("2d");
        this.scene = null;
        this.frameId = null;
        this.offset = 0;
        this.lastTime = null;
        this.viewport = { width: 1, height: 1 };
        this.contentAspect = 1;
        this.pixelRatio = pixelRatio;
        this.lastRenderedCell = 0;
        this.tick = this.tick.bind(this);
    }

    measureText(settings) {
        const primaryFont = (
            `${settings.fontWeight} ${settings.fontSize}px ` +
            `"${settings.fontFamily}"`
        );
        const font = `${primaryFont}, "Courier New", monospace`;
        this.context.font = font;

        return {
            font,
            characterWidth: Math.max(1, this.context.measureText("M").width),
            lineHeight: Math.max(1, settings.fontSize * 0.9),
        };
    }

    setScene(grid, settings, viewport, contentAspect = null) {
        this.stop();
        this.scene = { grid, settings };
        this.viewport = {
            width: Math.max(1, Math.floor(viewport.width)),
            height: Math.max(1, Math.floor(viewport.height)),
        };
        this.contentAspect = Number(contentAspect) > 0
            ? Number(contentAspect)
            : this.viewport.width / this.viewport.height;
        this.offset = 0;
        this.lastRenderedCell = 0;
        this.lastTime = null;
        this.resize();
        this.paint();

        if (settings.animation.enabled && settings.animation.speed > 0) {
            this.frameId = requestAnimationFrame(this.tick);
        }
    }

    resize() {
        if (!this.scene || !this.context) return;

        const { grid, settings } = this.scene;
        const measured = this.measureText(settings);
        const pixelRatio = this.pixelRatio ?? Math.max(
            1,
            window.devicePixelRatio || 1
        );
        const displayWidth = this.viewport.width;
        const displayHeight = this.viewport.height;
        let contentWidth = displayWidth;
        let contentHeight = contentWidth / this.contentAspect;

        if (contentHeight > displayHeight) {
            contentHeight = displayHeight;
            contentWidth = contentHeight * this.contentAspect;
        }

        const characterWidth = contentWidth / grid.columns;
        const lineHeight = contentHeight / grid.rows;

        this.canvas.width = Math.ceil(displayWidth * pixelRatio);
        this.canvas.height = Math.ceil(displayHeight * pixelRatio);
        this.canvas.style.width = `${displayWidth}px`;
        this.canvas.style.height = `${displayHeight}px`;

        this.metrics = {
            characterWidth,
            lineHeight,
            font: measured.font,
            pixelRatio,
            left: (displayWidth - contentWidth) / 2,
            top: (displayHeight - contentHeight) / 2,
        };
    }

    resizeViewport(viewport) {
        this.viewport = {
            width: Math.max(1, Math.floor(viewport.width)),
            height: Math.max(1, Math.floor(viewport.height)),
        };

        if (!this.scene) return;
        this.resize();
        this.paint();
    }

    renderAtOffset(offset) {
        this.offset = Number(offset) || 0;
        this.lastRenderedCell = Math.floor(this.offset);
        this.paint();
    }

    tick(time) {
        if (!this.scene) return;

        if (this.lastTime !== null) {
            const elapsedFrames = Math.min(
                MAX_CATCH_UP_FRAMES,
                (time - this.lastTime) / FRAME_DURATION
            );
            const direction = this.scene.settings.animation.direction === "right"
                ? -1
                : 1;

            this.offset += (
                this.scene.settings.animation.speed *
                elapsedFrames *
                direction
            );
        }

        this.lastTime = time;
        const renderedCell = Math.floor(this.offset);

        // the glyph only changes at whole-cell steps, so skip identical redraws
        if (renderedCell !== this.lastRenderedCell) {
            this.lastRenderedCell = renderedCell;
            this.paint();
        }

        this.frameId = requestAnimationFrame(this.tick);
    }

    paint() {
        if (!this.scene || !this.context || !this.metrics) return;

        const { grid, settings } = this.scene;
        const {
            characterWidth,
            lineHeight,
            font,
            pixelRatio,
            left,
            top,
        } = this.metrics;
        const context = this.context;

        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.fillStyle = "#000000";
        context.fillRect(
            0,
            0,
            this.canvas.width / pixelRatio,
            this.canvas.height / pixelRatio
        );
        context.font = font;
        context.textBaseline = "top";

        // colors stay pinned to the image; only the text phase moves across them
        for (let row = 0; row < grid.rows; row += 1) {
            for (let column = 0; column < grid.columns; column += 1) {
                const cell = grid.cells[(row * grid.columns) + column];
                if (!cell || cell.alpha === 0) continue;

                const character = settings.textMode === "pattern"
                    ? patternCharacter(
                        settings.charset,
                        column,
                        this.offset
                    )
                    : cell.character;

                context.fillStyle = settings.colored
                    ? `rgb(${cell.red}, ${cell.green}, ${cell.blue})`
                    : settings.selectedColor || "#00ff00";
                context.fillText(
                    character,
                    left + (column * characterWidth),
                    top + (row * lineHeight)
                );
            }
        }
    }

    stop() {
        if (this.frameId !== null) cancelAnimationFrame(this.frameId);
        this.frameId = null;
        this.lastTime = null;
    }

    clear() {
        this.stop();
        this.scene = null;
        this.offset = 0;
        this.metrics = null;
        this.context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.canvas.width = 1;
        this.canvas.height = 1;
        this.canvas.style.width = "1px";
        this.canvas.style.height = "1px";
    }
}
