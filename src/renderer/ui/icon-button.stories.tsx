import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { History, Pin, RefreshCw } from "lucide-react";
import { IconButton } from "./index.js";

const meta = {
  title: "Controls/IconButton",
  component: IconButton,
  tags: ["autodocs"],
  args: { "aria-label": "Open request history", title: "Request history", children: <History aria-hidden="true" /> },
  argTypes: { children: { control: false } },
  parameters: { docs: { description: { component:
    "An accessible aria-label is required. Keep the icon decorative, use aria-pressed for toggles, and preserve aria-expanded/aria-controls for disclosure controls. The forwarded button ref supports Radix asChild composition. Touch pointers receive a 44px target at every size." } } },
} satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Loading: Story = {
  args: { loading: true, "aria-label": "Refreshing preview", title: "Refreshing preview", children: <RefreshCw aria-hidden="true" /> },
};
export const Disabled: Story = { args: { disabled: true } };
export const Toggle: Story = {
  parameters: { controls: { disable: true } },
  render: function Toggle() {
    const [pinned, setPinned] = useState(false);
    return <IconButton aria-label="Pin review" title="Pin review" aria-pressed={pinned}
      variant={pinned ? "primary" : "secondary"} onClick={() => setPinned(value => !value)}>
      <Pin aria-hidden="true" />
    </IconButton>;
  },
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "Pin review" });
    await userEvent.click(button);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button);
    await expect(button).toHaveAttribute("aria-pressed", "false");
  },
};
