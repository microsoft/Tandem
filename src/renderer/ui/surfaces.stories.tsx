import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ChevronRight, Monitor } from "lucide-react";
import nativeStyles from "../../../development/tandem/public/application.css?inline";
import { Badge, Button, Disclosure, FormField, Input, NativeDialog, Select, Status, Textarea } from "./index.js";
import { DslStructure } from "../dsl-structure.js";
import { createDslScreen } from "../sketch-editor.js";
import type { DslSketchDocument } from "../../sketch.js";
import { applyOperations } from "../../vendor/ui-dsl/index.js";
import "./layout.css";

const meta = {
  title: "Foundations/App surfaces",
  parameters: { controls: { disable: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const PreDevelopmentPanes: Story = {
  render: () => <div className="tandem-story-stack" style={{ maxWidth: 720 }}>
    {["Preparation work items", "Requirements research", "Designs inspector", "Prototype visual directions"].map(title =>
      <section key={title} className="tandem-pane">
        <h3 className="tandem-pane-heading"><span>{title}</span><Badge tone="success">Ready</Badge></h3>
        <div className="tandem-pane-body">
          <p>Shared surfaces, headings and spacing. Each stage keeps its own content and workflow.</p>
          <div className="tandem-story-row">
            <Badge>Deferred</Badge><Badge tone="info">Running</Badge>
            <Badge tone="warning">Needs attention</Badge><Badge tone="danger">Failed</Badge>
          </div>
        </div>
      </section>)}
  </div>,
  parameters: { docs: { description: { story:
    "Pre-development panes share the Designs inspector treatment. Status badges use the same text scale, shape and semantic tones; deferred checks are neutral rather than failures. No project or runtime APIs are used." } } },
};

const designDocument: DslSketchDocument = { version: 2, screens: [], transitions: [] };
const designScreen = createDslScreen(designDocument, ["arithmetic-operations"]);
designScreen.title = "Calculator";
designScreen.ui = applyOperations(designScreen.ui, [
  { op: "add", parent: "screen", component: { id: "calculator", type: "Stack", props: {} } },
  { op: "add", parent: "calculator", component: { id: "heading", type: "Heading", props: { text: "Calculator" } } },
  { op: "add", parent: "calculator", component: { id: "expression", type: "Input", props: { label: "Arithmetic expression" } } },
  { op: "add", parent: "calculator", component: { id: "calculate", type: "Button", props: { label: "Calculate" } } },
]);

export const DesignInspector: Story = {
  render: function DesignInspector() {
    const [selected, setSelected] = useState<string | null>(null);
    const [purpose, setPurpose] = useState("Enter an arithmetic expression and view the result.");
    return <div className="sketch-sidebar" style={{ width: 224, maxWidth: "100%", height: 720 }}>
      <section className="sketch-pane sketch-screens-pane" aria-label="Sample screens">
        <h3 className="sketch-pane-heading"><span>Screens</span><span className="section-count">1</span></h3>
        <nav className="sketch-list sketch-pane-body" aria-label="Screens">
          <Button variant="item" aria-pressed="true"><Monitor size={15} aria-hidden="true" />Calculator</Button>
        </nav>
      </section>
      <Disclosure className="sketch-pane sketch-screen-details" open>
        <summary className="sketch-pane-heading">
          <ChevronRight className="sketch-pane-chevron" size={14} aria-hidden="true" /><span>Screen details</span>
        </summary>
        <div className="sketch-pane-body sketch-screen-fields">
          <FormField label="Screen title">{control => <Input {...control} defaultValue="Calculator" />}</FormField>
          <FormField label="Purpose" error={purpose.trim() ? "" : "Enter a purpose before saving."}>
            {control => <Textarea {...control} rows={3} value={purpose} onChange={event => setPurpose(event.target.value)} />}
          </FormField>
          <FormField label="Notes">{control => <Textarea {...control} rows={3} defaultValue="Keep reviewed calculation behavior." />}</FormField>
          <FormField label="Requirement decision IDs">{control => <Input {...control} defaultValue="arithmetic-operations" />}</FormField>
        </div>
      </Disclosure>
      <DslStructure screen={designScreen} selectedId={selected} onSelect={setSelected} />
    </div>;
  },
  parameters: { docs: { description: { story:
    "Synthetic Design inspector using the production pane layout and component tree. Compare both themes, long labels, native disclosures and inline field errors. No project or runtime APIs are used." } } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.clear(canvas.getByLabelText("Purpose"));
    await expect(canvas.getByRole("alert")).toHaveTextContent("Enter a purpose before saving.");
    await userEvent.click(canvas.getByText("Screen details"));
    await expect(canvas.getByLabelText("Purpose")).not.toBeVisible();
    await userEvent.click(canvas.getByRole("treeitem", { name: /Button: Calculate/ }));
    await expect(canvas.getByRole("treeitem", { name: /Button: Calculate/ })).toHaveAttribute("aria-selected", "true");
  },
};

export const ReactAndNativeDevelopment: Story = {
  render: (_args, context) => {
    const theme = context.globals.theme === "dark" ? "dark" : "light";
    const native = `<!doctype html><html lang="en"><head><style>${nativeStyles}</style></head>
      <body class="human-app" data-project-panel="conversation" data-theme="${theme}" style="display:block;margin:0;padding:16px;box-sizing:border-box">
        <h2>Native Development</h2><p>Same tokens and control styles. No runtime is running.</p>
        <div class="settings-fields"><label>Project name<input value="Weekend planner"></label></div>
        <div class="settings-fields"><label>Appearance<select><option>System</option><option>Light</option><option>Dark</option></select></label></div>
        <div class="settings-fields"><label style="width:100%">Notes<textarea>Keep saved history intact.</textarea></label></div>
        <div class="implementation-confirmation-actions" style="display:flex;gap:6px;margin-top:16px">
          <button data-implementation-decision="approved" type="button">Save sample</button><button type="button">Cancel</button>
        </div><p role="status">This is an isolated visual fixture.</p>
      </body></html>`;
    return <div className="tandem-story-surfaces">
      <section className="tandem-story-stack"><h2>React workspace</h2><p>Same tokens and control styles. No runtime is running.</p>
        <FormField label="Project name">{control => <Input {...control} defaultValue="Weekend planner" />}</FormField>
        <FormField label="Appearance">{control => <Select {...control}><option>System</option><option>Light</option><option>Dark</option></Select>}</FormField>
        <FormField label="Notes">{control => <Textarea {...control} defaultValue="Keep saved history intact." />}</FormField>
        <div className="tandem-story-row"><Button variant="primary">Save sample</Button><Button>Cancel</Button></div>
        <Status>This is an isolated visual fixture.</Status>
      </section>
      <iframe title="Native Development control catalogue" srcDoc={native} sandbox="" />
    </div>;
  },
};

export const NativeModal: Story = {
  render: function NativeModal() {
    const dialog = useRef<HTMLDialogElement>(null);
    return <><Button onClick={() => dialog.current?.showModal()}>Open native sample</Button>
      <NativeDialog ref={dialog} aria-labelledby="native-dialog-title" aria-describedby="native-dialog-description">
        <h2 id="native-dialog-title">Native dialog</h2><p id="native-dialog-description">Shared appearance, native focus and dismissal. No workflow behavior is replaced.</p>
        <div className="dialog-actions"><Button onClick={() => dialog.current?.close()}>Close sample</Button></div>
      </NativeDialog></>;
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Open native sample" });
    await userEvent.click(trigger);
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getByRole("dialog", { name: "Native dialog" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Close sample" }));
    await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();
  },
};
