import type { VisualManifest } from "../../src/visual-directions.js";
import type { UiState } from "../../src/renderer/ui-context.js";
import { readyPrototype } from "../renderer-fixtures.test.js";

export function visualManifest(): VisualManifest {
    return {
        version: 1,
        directions: [
            { id: "precision", name: "Precision workspace", summary: "Compact tools and a structured inspector.",
                layout: "A fixed left toolbar and right inspector frame the scene.",
                typography: "System sans with compact monospace measurements.", palette: "Cool neutral surfaces with blue accents.",
                effects: "Thin borders and restrained selection highlights.", sketchChanges: "The existing tools move into a left rail; navigation and primary actions are unchanged.",
                defaults: { colorMode: "light", accent: "blue", density: "compact", textSize: "standard", effects: "none" } },
            { id: "canvas", name: "Canvas first", summary: "More room for the scene, with floating tools.",
                layout: "A centered floating toolbar sits above an edge-to-edge canvas.",
                typography: "Spacious humanist sans labels with large headings.", palette: "Deep neutral surfaces and teal accents.",
                effects: "Soft panel shadows and short focus transitions.", sketchChanges: "Panels float over the same scene; no workflow or navigation is removed.",
                defaults: { colorMode: "dark", accent: "teal", density: "comfortable", textSize: "standard", effects: "subtle" } },
            { id: "presentation", name: "Presentation", summary: "A quiet stage with an anchored bottom toolbar.",
                layout: "A wide scene sits above a full-width bottom control strip.",
                typography: "Editorial headings paired with plain tool labels.", palette: "Warm neutral surfaces and amber accents.",
                effects: "Soft section gradients with no ambient animation.", sketchChanges: "The toolbar moves below the same scene; all actions remain reachable.",
                defaults: { colorMode: "light", accent: "amber", density: "comfortable", textSize: "large", effects: "subtle" } },
        ],
        defaultSelection: { directionId: "precision",
            settings: { colorMode: "light", accent: "blue", density: "compact", textSize: "standard", effects: "none" } },
    };
}

export function exploringPrototype(revision = 1): UiState {
    const value: UiState = readyPrototype(revision);
    const flow = value.prototypeFlow!;
    const manifest = visualManifest();
    flow.checkpoints.push({
        id: "visual-bundle", requestId: "visual-bundle", generation: value.generation, milestone: "visual",
        baseCheckpointId: flow.displayedCheckpointId, sourceCheckpointId: flow.displayedCheckpointId, revisionId: null,
        workspacePath: "C:\\fixture-project\\.tandem\\efforts\\fixture\\previews\\visual-bundle", workspacePrepared: true,
        status: "ready", previewUrl: "http://127.0.0.1:10000/", summary: "Three working visual directions.", focus: "Compare the same primary journey.",
        requestedAt: value.updatedAt, completedAt: value.updatedAt, timeoutSeconds: null,
        visual: { operation: "explore", explorationCheckpointId: null, selection: null, manifest },
    });
    flow.visualRequested = true;
    flow.visualExploration = { checkpointId: "visual-bundle", activeDirectionId: "precision", appliedCheckpointId: null,
        selections: manifest.directions.map(direction => ({ directionId: direction.id, settings: { ...direction.defaults } })) };
    return value;
}
