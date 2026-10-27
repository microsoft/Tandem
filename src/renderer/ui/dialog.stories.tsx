import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor, within } from "storybook/test";
import { Button, Dialog, FormField, Input } from "./index.js";

const meta = {
  title: "Overlays/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  args: {
    open: false, onOpenChange: fn(), title: "Review sample changes",
    description: "This isolated example does not submit a Tandem request or modify project files.",
    children: <FormField label="Sample name">{control => <Input {...control} defaultValue="Weekend planner" />}</FormField>,
  },
  argTypes: {
    title: { control: "text" }, description: { control: "text" },
    open: { control: false }, children: { control: false }, trigger: { control: false }, footer: { control: false },
  },
  render: function Example(args) {
    const [open, setOpen] = useState(false);
    return <Dialog {...args} open={open} onOpenChange={value => { setOpen(value); args.onOpenChange(value); }}
      trigger={<Button>Review sample changes</Button>}
      footer={<><Button onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" onClick={() => setOpen(false)}>Confirm sample</Button></>} />;
  },
  parameters: { docs: { description: { component:
    "A controlled Radix dialog with a required title and description, shared overlay and footer styling, keyboard dismissal and focus containment. A trigger provides focus restoration; callers with external triggers can preserve their own onCloseAutoFocus handler. Keep consequential confirmation flows on Radix AlertDialog rather than replacing them with this dismissible dialog." } } },
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Review sample changes" });
    await userEvent.click(trigger);
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getByRole("dialog", { name: "Review sample changes" })).toBeVisible();
    await expect(page.getByLabelText("Sample name")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(page.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(trigger).toHaveFocus();
  },
};
export const LongContent: Story = {
  args: {
    title: "Review the saved changes before continuing to the next stage",
    children: <div>{Array.from({ length: 12 }, (_, index) =>
      <p key={index}>Sample decision {index + 1}: keep the reviewed navigation and saved history intact. Long content scrolls inside the dialog instead of overflowing the viewport.</p>)}</div>,
  },
};
