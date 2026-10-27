import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import nativeStyles from "../../../development/tandem/public/application.css?inline";
import { Button, FormField, Input, NativeDialog, Select, Status, Textarea } from "./index.js";

const meta = {
  title: "Foundations/App surfaces",
  parameters: { controls: { disable: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

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
