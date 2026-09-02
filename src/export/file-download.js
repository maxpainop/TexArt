import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

// always ask first instead of quietly dropping exports into downloads
export function chooseSavePath({ filename, title, extension, filterName }) {
    return save({
        title,
        defaultPath: filename,
        filters: [{
            name: filterName,
            extensions: [extension],
        }],
    });
}

export async function writeBlobToPath(path, blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeFile(path, bytes);
}

export function safeBasename(filename, fallback = "texart-animation") {
    const name = String(filename || "").replace(/\.[^.]+$/, "");
    const sanitized = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
    return sanitized || fallback;
}
