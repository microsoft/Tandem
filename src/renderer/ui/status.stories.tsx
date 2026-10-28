import type { Meta, StoryObj } from "@storybook/react-vite";
import { Status } from "./index.js";

const meta = {
  title: "Feedback/Status",
  component: Status,
  tags: ["autodocs"],
  args: { children: "The saved Prototype is ready for review." },
  argTypes: {
    children: { control: "text" },
    tone: { control: "select", options: ["info", "success", "warning", "danger"] },
  },
  parameters: { docs: { description: { component:
    "Pair a decorative icon and semantic color with meaningful text; never communicate an outcome through color alone. Static status text is not a live region by default. Pass role=status for non-urgent updates or role=alert for errors requiring immediate attention. The caller supplies known state; Status never infers completion or authorization from prose." } } },
} satisfies Meta<typeof Status>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Tones: Story = {
  render: () => <div className="tandem-story-stack">
    <Status>Ready to review the saved changes.</Status>
    <Status tone="success">The sample changes were saved.</Status>
    <Status tone="warning">The saved version changed. Review it again before continuing.</Status>
    <Status tone="danger">The request failed. Your saved work is unchanged.</Status>
  </div>,
};
export const Loading: Story = { args: { busy: true, role: "status", children: "Reading the saved Prototype..." } };
export const Error: Story = { args: { tone: "danger", role: "alert", children: "The request failed. Review the error before retrying." } };
export const LongMessage: Story = {
  args: { tone: "warning", children: "The saved Prototype changed while this review was open. Close this dialog and review the new version before confirming; no implementation request has been submitted." },
  decorators: [(Story) => <div className="tandem-story-narrow"><Story /></div>],
};
