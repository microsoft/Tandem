import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent } from "storybook/test";
import { Button, FormField, Input, Select as SelectControl, Status, Textarea } from "./index.js";

const meta = {
  title: "Controls/FormField",
  component: FormField,
  tags: ["autodocs"],
  args: {
    label: "Project name",
    description: "Use a short, recognizable name.",
    children: control => <Input {...control} placeholder="Weekend planner" />,
  },
  argTypes: {
    label: { control: "text" }, description: { control: "text" }, error: { control: "text" },
    children: { control: false }, className: { control: false },
  },
  decorators: [(Story) => <div className="tandem-story-stack"><Story /></div>],
  parameters: { docs: { description: { component:
    "Spread the render-prop attributes onto the native input, textarea, or select. FormField owns the visible label, stable control ID, help/error associations, and aria-invalid. The caller owns the value, validation, disabled state and native required semantics. An explicit id remains the control ID, not the wrapper ID." } } },
} satisfies Meta<typeof FormField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TextInput: Story = {};
export const TextArea: Story = {
  args: { label: "Review notes", description: "Describe the change you want to review.",
    children: control => <Textarea {...control} rows={3} placeholder="Keep the reviewed navigation unchanged." /> },
};
export const RequestComposer: Story = {
  parameters: { controls: { disable: true } },
  render: function RequestComposer() {
    const [value, setValue] = useState("");
    const [sent, setSent] = useState("");
    return <form className="tandem-story-stack" onSubmit={event => {
      event.preventDefault(); setSent(value); setValue("");
    }}>
      <FormField label="Request" description="Enter sends; Ctrl+Enter inserts a new line. This example stays local.">
        {control => <Textarea {...control} submitOnEnter value={value} onChange={event => setValue(event.target.value)} />}
      </FormField>
      <Button type="submit" variant="primary" disabled={!value.trim()}>Send sample</Button>
      {sent && <Status role="status">Sent locally: {sent}</Status>}
    </form>;
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByLabelText("Request"));
    await userEvent.type(canvas.getByLabelText("Request"), "Keep the layout");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect(canvas.getByLabelText("Request")).toHaveValue("Keep the layout\n");
    await userEvent.type(canvas.getByLabelText("Request"), "Change the label");
    await userEvent.keyboard("{Enter}");
    await expect(await canvas.findByRole("status")).toHaveTextContent("Sent locally:");
    await expect(canvas.getByLabelText("Request")).toHaveValue("");
  },
};
export const Select: Story = {
  args: { label: "Preview size", description: "This sample does not change the running app.",
    children: control => <SelectControl {...control} defaultValue="desktop"><option value="desktop">Desktop</option><option value="mobile">Mobile</option></SelectControl> },
};
export const Error: Story = {
  args: { error: "Enter a project name before continuing." },
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByLabelText("Project name"), border = getComputedStyle(input).borderColor;
    await userEvent.click(input);
    await expect(input).toHaveFocus();
    await expect(getComputedStyle(input).borderColor).toBe(border);
    await expect(canvas.getByRole("alert")).toBeVisible();
  },
};
export const Disabled: Story = { args: { children: control => <Input {...control} value="Weekend planner" disabled readOnly /> } };
export const LongContent: Story = {
  args: { label: "Project name shown in the navigation and saved review history",
    description: "This help text intentionally wraps so contributors can review narrow layouts and longer translated labels without hiding useful context." },
  decorators: [(Story) => <div className="tandem-story-narrow"><Story /></div>],
};
export const Validation: Story = {
  parameters: { controls: { disable: true } },
  render: function Validation() {
    const [value, setValue] = useState("");
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);
    return <form className="tandem-story-stack" onSubmit={event => {
      event.preventDefault();
      setError(value.trim() ? "" : "Enter a project name before continuing.");
      setSaved(Boolean(value.trim()));
    }}>
      <FormField label="Project name" description="Only this local example is updated." error={error}>
        {control => <Input {...control} value={value} onChange={event => setValue(event.target.value)} />}
      </FormField>
      <Button type="submit" variant="primary">Save sample</Button>
      {saved && <Status tone="success" role="status">Sample saved. No project files were changed.</Status>}
    </form>;
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save sample" }));
    await expect(canvas.getByLabelText("Project name")).toHaveAttribute("aria-invalid", "true");
    // Native change dispatch also supports controlled inputs in embedded previews.
    await fireEvent.change(canvas.getByLabelText("Project name"), { target: { value: "Weekend planner" } });
    await userEvent.click(canvas.getByRole("button", { name: "Save sample" }));
    await expect(await canvas.findByRole("status")).toHaveTextContent("Sample saved");
    await expect(canvas.getByLabelText("Project name")).not.toHaveAttribute("aria-invalid");
  },
};
