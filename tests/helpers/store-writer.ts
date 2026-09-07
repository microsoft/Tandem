import assert from "node:assert/strict";
import { ProjectStore, type StoredProject } from "../../src/project-store.js";

interface State extends StoredProject { answers: string[] }
const root = process.argv[2];
const writer = process.argv[3];
assert.ok(root && writer);
const store = new ProjectStore<State>({
    root,
    create: (prototypeId) => ({ version: 1, prototypeId, revision: 0, updatedAt: "", answers: [] }),
    normalize: (value) => {
        assert.ok(value && typeof value === "object" && "answers" in value && Array.isArray(value.answers));
        return value as State;
    },
});
for (let iteration = 0; iteration < 5; iteration += 1) {
    await store.transaction("shared", async () => {
        const state = await store.load("shared");
        state.answers.push(`${writer}-${iteration}`);
        await store.save(state);
    });
}
