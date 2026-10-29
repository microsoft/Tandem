import type { DslSketchScreen } from "../../src/sketch.js";
import { applyOperations, createDocument, type ComponentType, type Props } from "../../src/vendor/ui-dsl/index.js";

export function addUi(screen: DslSketchScreen, id: string, type: ComponentType, props: Props) {
    screen.ui = applyOperations(screen.ui, [{ op: "add", parent: screen.ui.root, component: { id, type, props } }]);
    return screen;
}

export function buttonScreen(screen: DslSketchScreen, label = "Continue") {
    return addUi(screen, "primary-action", "Button", { label });
}

export { createDocument, applyOperations };
