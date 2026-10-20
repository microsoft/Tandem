import type { PrototypeFlow, PrototypePreviewTarget } from "./prototype-flow.js";

export const visualManifestName = "tandem-visual-directions.json";
export const visualSettingsValues = {
    colorMode: ["light", "dark"],
    accent: ["neutral", "blue", "teal", "violet", "amber"],
    density: ["comfortable", "compact"],
    textSize: ["standard", "large"],
    effects: ["none", "subtle"],
} as const;

export type VisualSettings = { [K in keyof typeof visualSettingsValues]: (typeof visualSettingsValues)[K][number] };
export interface VisualSelection { directionId: string; settings: VisualSettings }
export interface VisualDirection {
    id: string;
    name: string;
    summary: string;
    layout: string;
    typography: string;
    palette: string;
    effects: string;
    sketchChanges: string;
    defaults: VisualSettings;
}
export interface VisualManifest {
    version: 1;
    directions: VisualDirection[];
    defaultSelection: VisualSelection;
}
export interface VisualCheckpoint {
    operation: "explore" | "refine" | "choose" | "preserve";
    explorationCheckpointId: string | null;
    selection: VisualSelection | null;
    manifest: VisualManifest | null;
}
export interface VisualExploration {
    checkpointId: string;
    activeDirectionId: string;
    selections: VisualSelection[];
    appliedCheckpointId: string | null;
}

const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
    Object.keys(value).sort().join(",") === keys.sort().join(",");
const id = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9-]{0,47}$/.test(value);

export function readVisualSettings(value: unknown): VisualSettings {
    if (!object(value) || !exactKeys(value, Object.keys(visualSettingsValues)) ||
        Object.entries(visualSettingsValues).some(([key, values]) => !values.some(item => item === value[key]))) {
        throw new Error("Choose valid visual appearance, accent, density, text size and effects settings.");
    }
    return {
        colorMode: value.colorMode as VisualSettings["colorMode"], accent: value.accent as VisualSettings["accent"],
        density: value.density as VisualSettings["density"], textSize: value.textSize as VisualSettings["textSize"],
        effects: value.effects as VisualSettings["effects"],
    };
}

export function readVisualSelection(value: unknown): VisualSelection {
    if (!object(value) || !exactKeys(value, ["directionId", "settings"]) || !id(value.directionId)) {
        throw new Error("A visual choice needs an exact direction and its settings.");
    }
    return { directionId: value.directionId, settings: readVisualSettings(value.settings) };
}

export function readVisualManifest(value: unknown): VisualManifest {
    if (!object(value) || !exactKeys(value, ["version", "directions", "defaultSelection"]) || value.version !== 1 ||
        !Array.isArray(value.directions) || value.directions.length < 2 || value.directions.length > 3) {
        throw new Error("Visual exploration requires a version 1 manifest with two or three distinct directions.");
    }
    const textKeys = ["name", "summary", "layout", "typography", "palette", "effects", "sketchChanges"] as const;
    const directions = value.directions.map((entry): VisualDirection => {
        if (!object(entry) || !exactKeys(entry, ["id", "defaults", ...textKeys]) || !id(entry.id) ||
            textKeys.some(key => typeof entry[key] !== "string" || !entry[key].trim() ||
                entry[key].length > (key === "name" ? 80 : 600))) {
            throw new Error("Each visual direction needs a stable ID, name, layout, style, effects and drawing-change description.");
        }
        return {
            id: entry.id, name: String(entry.name).trim(), summary: String(entry.summary).trim(),
            layout: String(entry.layout).trim(), typography: String(entry.typography).trim(),
            palette: String(entry.palette).trim(), effects: String(entry.effects).trim(),
            sketchChanges: String(entry.sketchChanges).trim(), defaults: readVisualSettings(entry.defaults),
        };
    });
    const normalized = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
    for (const key of ["id", "name", "layout"] as const) {
        if (new Set(directions.map(direction => normalized(direction[key]))).size !== directions.length) {
            throw new Error("Visual directions must have distinct identities, names and layouts, not only different colors.");
        }
    }
    if (new Set(directions.map(direction => normalized(direction.typography + "|" + direction.effects))).size !== directions.length) {
        throw new Error("Visual directions must vary their typography or effects as well as layout and palette.");
    }
    const defaultSelection = readVisualSelection(value.defaultSelection);
    if (!directions.some(direction => direction.id === defaultSelection.directionId)) {
        throw new Error("The default visual choice does not belong to these directions.");
    }
    return { version: 1, directions, defaultSelection };
}

export function readVisualCheckpoint(value: unknown): VisualCheckpoint {
    if (!object(value) || !exactKeys(value, ["operation", "explorationCheckpointId", "selection", "manifest"]) ||
        !["explore", "refine", "choose", "preserve"].includes(String(value.operation)) ||
        !(value.explorationCheckpointId === null || typeof value.explorationCheckpointId === "string" && value.explorationCheckpointId.length > 0)) {
        throw new Error("The saved visual checkpoint request is invalid.");
    }
    const operation = value.operation as VisualCheckpoint["operation"];
    const selection = value.selection === null ? null : readVisualSelection(value.selection);
    const manifest = value.manifest === null ? null : readVisualManifest(value.manifest);
    if ((operation === "explore") !== (selection === null) ||
        (operation === "explore") !== (value.explorationCheckpointId === null)) {
        throw new Error("The visual request lost its exploration or selected-direction identity.");
    }
    if (manifest && selection && !manifest.directions.some(direction => direction.id === selection.directionId)) {
        throw new Error("The selected direction is missing from the saved visual checkpoint.");
    }
    if (manifest && (operation === "choose" || operation === "preserve") &&
        JSON.stringify(manifest.defaultSelection) !== JSON.stringify(selection)) {
        throw new Error("The chosen visual settings were not saved as the application's defaults.");
    }
    return { operation, explorationCheckpointId: typeof value.explorationCheckpointId === "string" ? value.explorationCheckpointId : null,
        selection, manifest };
}

export function visualPreviewUrl(url: string, selection: VisualSelection): string {
    const result = new URL(url);
    result.searchParams.set("tandem-direction", selection.directionId);
    for (const [key, value] of Object.entries(selection.settings)) result.searchParams.set("tandem-" + key, value);
    return result.href;
}

export function isVisualExploration(checkpoint: { visual?: VisualCheckpoint } | null | undefined): boolean {
    return checkpoint?.visual?.operation === "explore" || checkpoint?.visual?.operation === "refine";
}

export function originalPrototypeCheckpointId(flow: PrototypeFlow | null | undefined): string | null {
    let checkpoint = flow?.checkpoints.find(item => item.id === flow.visualExploration?.checkpointId);
    const visited = new Set<string>();
    while (checkpoint?.visual?.operation === "refine") {
        if (visited.has(checkpoint.id)) throw new Error("The saved visual exploration source chain contains a cycle.");
        visited.add(checkpoint.id);
        checkpoint = flow?.checkpoints.find(item => item.id === checkpoint?.visual?.explorationCheckpointId);
    }
    return isVisualExploration(checkpoint) ? checkpoint?.baseCheckpointId ?? null : null;
}

export function prototypePreviewCheckpointId(flow: PrototypeFlow | null | undefined, target: PrototypePreviewTarget): string | null {
    return (target === "current" ? flow?.displayedCheckpointId
        : target === "pending" ? flow?.pendingCheckpointId
        : target === "original" ? originalPrototypeCheckpointId(flow) : flow?.visualExploration?.checkpointId) ?? null;
}

export function visualExplorationIsCurrent(flow: PrototypeFlow): boolean {
    const exploration = flow.visualExploration;
    const checkpoint = exploration && flow.checkpoints.find(item => item.id === exploration.checkpointId);
    const displayed = flow.checkpoints.find(item => item.id === flow.displayedCheckpointId);
    return Boolean(checkpoint && displayed && (checkpoint.baseCheckpointId === displayed.id ||
        originalPrototypeCheckpointId(flow) === displayed.id ||
        displayed?.visual?.operation === "choose" && displayed.visual.explorationCheckpointId === checkpoint.id));
}

export function awaitingVisualChoice(flow: PrototypeFlow): boolean {
    return Boolean(flow.visualRequested && flow.visualExploration &&
        flow.visualExploration.appliedCheckpointId !== flow.displayedCheckpointId);
}

export const visualSelectionSchema = {
    type: "object", additionalProperties: false,
    properties: {
        directionId: { type: "string", pattern: "^[a-z][a-z0-9-]{0,47}$" },
        settings: {
            type: "object", additionalProperties: false,
            properties: Object.fromEntries(Object.entries(visualSettingsValues).map(([key, values]) => [key, { type: "string", enum: [...values] }])),
            required: Object.keys(visualSettingsValues),
        },
    },
    required: ["directionId", "settings"],
};
