import { MXA_SCHEMA_VERSION } from "../state/project-state.js";

// this is our portable project envelope, including the original image
export const MXA_FORMAT = "com.maxpainop.texart.mxa";
const LEGACY_MXA_FORMAT = "com.maaz.textart.mxa";

// the source image lives inside the project so an mxa never loses its input
function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(
            reader.error || new Error("Could not read image file.")
        );
        reader.readAsDataURL(file);
    });
}

export async function createMxaDocument({ project, imageFile, viewport }) {
    if (!imageFile) throw new TypeError("An image file is required.");

    return {
        format: MXA_FORMAT,
        version: MXA_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        source: {
            name: imageFile.name,
            type: imageFile.type,
            dataUrl: await readFileAsDataUrl(imageFile),
        },
        project,
        viewport: {
            width: Math.max(1, Math.round(viewport.width)),
            height: Math.max(1, Math.round(viewport.height)),
        },
    };
}

export function parseMxaDocument(text) {
    const document = JSON.parse(text);

    if (
        ![MXA_FORMAT, LEGACY_MXA_FORMAT].includes(document?.format) ||
        document?.version !== MXA_SCHEMA_VERSION ||
        !document?.source?.dataUrl ||
        !document?.project?.settings
    ) {
        throw new TypeError("This is not a supported MXA project.");
    }

    return document;
}

// rebuild a normal browser file so loading an mxa uses the regular image flow
export function sourceFileFromMxa(document) {
    const [header, encoded] = document.source.dataUrl.split(",", 2);
    const mimeMatch = /^data:([^;]+);base64$/.exec(header);
    if (!mimeMatch || !encoded) {
        throw new TypeError("MXA source image is invalid.");
    }

    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new File([bytes], document.source.name || "source-image", {
        type: document.source.type || mimeMatch[1],
    });
}
