import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { closeHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import {
  InMemoryEventStore,
  SqliteEventStore,
} from "../runtime-src/event-store.ts";
import { BackboneArtifactStore } from "../runtime-src/domain/backbone/artifact-store.ts";
import {
  backboneBlockSubmissionSchemas,
  validateBackboneProposal,
} from "../runtime-src/domain/backbone/proposal.ts";
import {
  expandImplementationReviewToWorkspace,
  WorkspaceImplementationFileTracker,
} from "../runtime-src/domain/implementation-review.ts";

test("LC-003 conclusion and inherited notes remain exact-unique without altering review history", async (t) => {
  const root = await workspace(t, "lc-003");
  const artifacts = new BackboneArtifactStore(root);
  const proposal = taskProposal();
  await stage(artifacts, "initial", proposal);
  const firstNotes = ["Trace A.", "Trace A.", "Trace B."];
  const first = await artifacts.conclude("initial", "request-initial", conclusion(proposal, firstNotes));
  const initialSummary = structuredClone(first.reviewSummaries[0]);
  assert.equal(first.notes.length, 2);
  assert.equal(new Set(first.notes).size, 2);

  const baseline = await artifacts.beginRevision("revision", first.artifactPath);
  assert.equal(baseline, first.id);
  const replayedNotes = ["Trace A.", "Trace B.", "Trace C.", "Trace C."];
  const revised = await artifacts.conclude(
    "revision",
    "request-revision",
    conclusion(proposal, replayedNotes),
    baseline,
  );
  const reloaded = await new BackboneArtifactStore(root).loadCurrent();
  const manifest = JSON.parse(await new HostStateFile(root, join(root, revised.artifactPath)).read());
  const allNotes = ["Trace A.", "Trace B.", "Trace C."];

  assert.deepEqual(revised.notes, allNotes);
  assert.deepEqual(reloaded.notes, allNotes);
  assert.deepEqual(manifest.notes, allNotes);
  assert.deepEqual([...new Set(reloaded.notes)], ["Trace A.", "Trace B.", "Trace C."]);
  assert.equal(reloaded.notes.length, 3);
  assert.equal(new Set(reloaded.notes).size, 3);
  const noteText = await new HostStateFile(root, join(root, dirname(revised.artifactPath), "notes.md"),
    undefined, { text: true }).read();
  assert.deepEqual(
    noteText.split(/\r?\n/).filter((line) => line.startsWith("- ")),
    allNotes.map((note) => `- ${note}`),
  );
  assert.deepEqual(reloaded.input, first.input);
  assert.deepEqual(reloaded.reviewSummaries, revised.reviewSummaries);
  assert.deepEqual(manifest.reviewSummaries, reloaded.reviewSummaries);
  assert.equal(reloaded.reviewSummaries.length, 2);
  assert.deepEqual(reloaded.reviewSummaries[0], initialSummary);
  assert.deepEqual(reloaded.reviewSummaries[1], {
    ...conclusion(proposal).reviewSummary,
    proposalId: revised.id,
    reviewedAt: revised.proposedAt,
    kind: "revision",
  });
  t.diagnostic("LC-003 regression: expected and observed notes=3, unique=3 (initial total=2, unique=2); notes.md contains each once. Both immutable review summaries remain intact.");
});

test("LC-006 guide.md-only additions and edits produce zero review evidence, unlike README.md", async (t) => {
  const root = await workspace(t, "lc-006");
  const tracker = new WorkspaceImplementationFileTracker(root);
  const before = await tracker.snapshot();
  const originalGuide = "# Deliverable\nRun the task service.\n";
  await writeFile(join(root, "guide.md"), originalGuide);
  const added = await tracker.snapshot();
  const guideAdded = tracker.summarize(before, added);
  assert.equal(await readFile(join(root, "guide.md"), "utf8"), originalGuide);
  assert.deepEqual(guideAdded.changedFiles, []);
  assert.deepEqual(guideAdded.details, []);
  assert.equal(guideAdded.changedBytes, 0);

  const revisedGuide = "# Deliverable\nRun the task service and inspect its task list.\n";
  await writeFile(join(root, "guide.md"), revisedGuide);
  const edited = await tracker.snapshot();
  const guideEdited = tracker.summarize(added, edited);
  assert.notEqual(await readFile(join(root, "guide.md"), "utf8"), originalGuide);
  assert.deepEqual(guideEdited.changedFiles, []);
  assert.deepEqual(guideEdited.details, []);
  assert.equal(guideEdited.changedBytes, 0);

  await writeFile(join(root, "TANDEM.md"), "# Implementation index\n");
  const withIndex = await tracker.snapshot();
  assert.deepEqual(tracker.summarize(edited, withIndex).changedFiles, []);
  await writeFile(join(root, "README.md"), revisedGuide);
  const withReadme = await tracker.snapshot();
  const readmeChanges = tracker.summarize(withIndex, withReadme);
  assert.deepEqual([...withReadme.keys()], ["README.md"]);
  assert.deepEqual(readmeChanges.addedFiles, ["README.md"]);
  assert.deepEqual(readmeChanges.changedFiles, ["README.md"]);
  assert.equal(readmeChanges.details[0].afterExcerpt, revisedGuide);
  assert.equal(readmeChanges.changedBytes, Buffer.byteLength(revisedGuide));
  t.diagnostic("LC-006 if guide.md is a deliverable, expected tracked files=1; observed added=0, edited=0, changedBytes=0. README positive control=1; TANDEM index=0. This characterizes tracking, not a decided Markdown policy or a dispatched Review.");
});

test("LC-008 workspace-bootstrap review includes three unchanged files while diff details describe only one edit", async (t) => {
  const root = await workspace(t, "lc-008");
  const changedPath = join("src", "task.ts");
  const unrelated = new Map([
    [join("legacy", "cache.ts"), "export const cache = new Map();\n"],
    [join("legacy", "worker.js"), "export const worker = false;\n"],
    [join("fixtures", "unrelated.json"), '{"unrelated":true}\n'],
  ]);
  for (const [path, content] of unrelated) {
    await writeWorkspaceFile(root, path, content);
  }
  await writeWorkspaceFile(root, changedPath, "export const task = 1;\n");
  const tracker = new WorkspaceImplementationFileTracker(root);
  const before = await tracker.snapshot();
  await writeWorkspaceFile(root, changedPath, "export const task = 2;\n");
  const after = await tracker.snapshot();
  const changes = tracker.summarize(before, after);
  const originalChanges = structuredClone(changes);
  assert.deepEqual(changes.changedFiles, [changedPath]);
  assert.equal(changes.changedBytes, 2);
  for (const path of unrelated.keys()) {
    assert.deepEqual(after.get(path), before.get(path));
  }

  const expanded = expandImplementationReviewToWorkspace(changes, after);

  assert.equal(expanded.reviewScope, "workspace-bootstrap");
  assert.deepEqual(expanded.changedFiles, [changedPath, ...unrelated.keys()].sort());
  assert.equal(expanded.changedFiles.length, 4);
  assert.deepEqual(expanded.addedFiles, []);
  assert.deepEqual(expanded.deletedFiles, []);
  assert.deepEqual(expanded.modifiedFiles, [changedPath]);
  assert.deepEqual(expanded.details, changes.details);
  assert.deepEqual(expanded.details.map(({ path }) => path), [changedPath]);
  assert.equal(expanded.details[0].beforeExcerpt, "export const task = 1;\n");
  assert.equal(expanded.details[0].afterExcerpt, "export const task = 2;\n");
  assert.equal(expanded.changedBytes, 2);
  assert.deepEqual(changes, originalChanges);
  t.diagnostic("LC-008 expected turn-scoped evidence paths=1; observed bootstrap paths=4, unchanged unrelated paths=3, actual diff details=1, changedBytes=2. This measures expansion, not LLM cost or restart-reconciliation policy.");
});

async function workspace(t, id) {
  const root = await mkdtemp(join(tmpdir(), `canvas-bug-domain-${id}-`));
  t.after(async () => { await closeHostStateWal(root); await rm(root, { recursive: true, force: true }); });
  return root;
}

async function writeWorkspaceFile(root, path, content) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

async function stage(artifacts, runId, proposal) {
  validateBackboneProposal(proposal);
  for (const name of ["useCases", "contract", "controlFlows", "guiSketches", "systemStacks"]) {
    await artifacts.writeBlock(runId, name, proposal[name]);
  }
}

function conclusion(proposal, notes = ["Created the task design."]) {
  return {
    goal: proposal.goal,
    summary: proposal.summary,
    aspects: proposal.aspects,
    notes,
    reviewSummary: {
      headline: "Record the task-service design.",
      changes: [{
        id: "task-design",
        title: "Describe task capture",
        description: "The user submits a title to create a task.",
        whyItMatters: "The task becomes available for later review.",
        visibility: "summary-only",
        perspective: "use-case",
        elementId: "capture-task",
      }],
    },
  };
}

function taskProposal() {
  return {
    goal: "Manage personal tasks.",
    summary: "A task client captures tasks and reads them from a service.",
    useCases: [
      {
        id: "capture-task",
        title: "Capture a new task",
        actor: "Task user",
        outcome: "The task is saved.",
        steps: [{
          id: "enter-task",
          userAction: "Submit a task title.",
          systemResponse: "Show the created task.",
          interactionId: "create-task",
        }],
      },
      {
        id: "review-tasks",
        title: "Review saved tasks",
        actor: "Task user",
        outcome: "The user sees current work.",
        steps: [{
          id: "view-tasks",
          userAction: "Open the task list.",
          systemResponse: "Show the saved tasks.",
          interactionId: "list-tasks",
        }],
      },
    ],
    contract: {
      schemaVersion: "contract-set/v1",
      title: "Task API",
      context: "The client manages tasks through the service.",
      participants: [
        { id: "task-client", name: "Task client", responsibility: "Submit task requests." },
        { id: "task-service", name: "Task service", responsibility: "Create and list tasks." },
      ],
      interactions: [
        {
          id: "create-task",
          name: "Create task",
          kind: "command",
          fromParticipantId: "task-client",
          toParticipantId: "task-service",
          input: { name: "CreateTask", description: "A non-empty title." },
          output: { name: "Task", description: "The newly created task." },
          errors: [{ code: "invalid-title", meaning: "The title is empty." }],
          guarantees: [{ id: "saved-on-success", statement: "Successful tasks appear in the list." }],
        },
        {
          id: "list-tasks",
          name: "List tasks",
          kind: "query",
          fromParticipantId: "task-client",
          toParticipantId: "task-service",
          input: { name: "ListTasks", description: "A task-list request." },
          output: { name: "Tasks", description: "The saved tasks." },
          errors: [],
          guarantees: [{ id: "all-saved-tasks", statement: "The list contains saved tasks." }],
        },
      ],
      storageContracts: [],
      lifecycleRules: [],
    },
    controlFlows: [],
    guiSketches: [],
    systemStacks: [],
    aspects: [{
      id: "task-contract",
      kind: "contract",
      title: "Task API contract",
      summary: "Defines task commands and queries.",
      relatedElements: ["create-task", "list-tasks"],
    }],
  };
}
