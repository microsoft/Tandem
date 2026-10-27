import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { ArrowRight, Check, Trash2 } from "lucide-react";
import { Button } from "./index.js";

const meta = {
  title: "Controls/Button",
  component: Button,
  tags: ["autodocs"],
  args: { children: "Save changes", onClick: fn() },
  argTypes: {
    children: { control: "text" },
    variant: { control: "select", options: ["primary", "secondary", "danger", "ghost", "item"] },
    size: { control: "select", options: ["small", "medium", "large"] },
  },
  parameters: { docs: { description: { component:
    "Use primary for the main action, secondary for alternatives, danger for destructive actions, and ghost for low-emphasis controls. Buttons default to type=button; form submissions must explicitly use type=submit. Loading disables repeat activation and retains the visible label." } } },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { variant: "primary" },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
    await expect(args.onClick).toHaveBeenCalled();
  },
};

export const Variants: Story = {
  render: () => <div className="tandem-story-row">
    <Button variant="primary"><ArrowRight aria-hidden="true" />Continue</Button>
    <Button>Review changes</Button>
    <Button variant="danger"><Trash2 aria-hidden="true" />Discard draft</Button>
    <Button variant="ghost">View details</Button>
  </div>,
};

export const Sizes: Story = {
  render: () => <div className="tandem-story-row">
    {(["small", "medium", "large"] as const).map(size =>
      <Button key={size} size={size}><Check aria-hidden="true" />{size}</Button>)}
  </div>,
};

export const Loading: Story = { args: { variant: "primary", loading: true, children: "Saving changes..." } };
export const Disabled: Story = { args: { disabled: true } };
export const LongLabel: Story = {
  args: { variant: "primary", children: "Review the saved Prototype before continuing to Development" },
  decorators: [(Story) => <div className="tandem-story-narrow"><Story /></div>],
};
