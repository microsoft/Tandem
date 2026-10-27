import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Check, History, List, X } from "lucide-react";
import { ActionLink, AlertDialog, Button, Disclosure, IconButton, RadioGroup, Tabs, ToggleGroup, Tooltip } from "./index.js";

const meta = {
  title: "Controls/Navigation and choices",
  tags: ["autodocs"],
  parameters: { controls: { disable: true }, docs: { description: { component:
    "The app uses styled Radix families rather than per-screen copies. Preserve their keyboard behavior and controlled state. Item buttons are for navigation rows; use semantic links for navigation to a URL. Layout can vary without redefining colors, borders, padding, focus, or disabled states." } } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const TabNavigation: Story = {
  render: () => <Tabs.Root defaultValue="requirements">
    <Tabs.List className="tandem-story-row" aria-label="Example stages">
      <Tabs.Trigger value="requirements">Requirements</Tabs.Trigger>
      <Tabs.Trigger value="designs">Designs</Tabs.Trigger>
      <Tabs.Trigger value="prototype" disabled>Prototype</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="requirements"><p>Review the sample requirements.</p></Tabs.Content>
    <Tabs.Content value="designs"><p>Review the sample designs.</p></Tabs.Content>
  </Tabs.Root>,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Requirements" }));
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("tab", { name: "Designs" })).toHaveFocus();
    await expect(canvas.getByRole("tabpanel")).toHaveTextContent("Review the sample designs");
  },
};

export const ChoiceCards: Story = {
  render: () => <RadioGroup.Root defaultValue="list" aria-label="Example navigation" className="tandem-story-stack">
    <RadioGroup.Item value="list" presentation="choice"><RadioGroup.Indicator><Check aria-hidden="true" size={16} /></RadioGroup.Indicator>Show a compact list of saved decisions</RadioGroup.Item>
    <RadioGroup.Item value="tree" presentation="choice"><RadioGroup.Indicator><Check aria-hidden="true" size={16} /></RadioGroup.Indicator>Group decisions in a tree with expandable details</RadioGroup.Item>
    <RadioGroup.Item value="unavailable" presentation="choice" disabled>Unavailable until the sample is ready</RadioGroup.Item>
  </RadioGroup.Root>,
};

export const RadioControls: Story = {
  render: () => <RadioGroup.Root defaultValue="light" aria-label="Example appearance" className="tandem-story-row">
    <RadioGroup.Item id="sample-light" value="light"><RadioGroup.Indicator /></RadioGroup.Item><label htmlFor="sample-light">Light</label>
    <RadioGroup.Item id="sample-dark" value="dark"><RadioGroup.Indicator /></RadioGroup.Item><label htmlFor="sample-dark">Dark</label>
  </RadioGroup.Root>,
};

export const IconToggles: Story = {
  render: () => <ToggleGroup.Root type="single" defaultValue="structure" aria-label="Example side pane" className="tandem-story-row">
    <ToggleGroup.Item value="structure" iconOnly aria-label="Structure"><List size={16} aria-hidden="true" /></ToggleGroup.Item>
    <ToggleGroup.Item value="history" iconOnly aria-label="History"><History size={16} aria-hidden="true" /></ToggleGroup.Item>
  </ToggleGroup.Root>,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("radio", { name: "History" }));
    await expect(canvas.getByRole("radio", { name: "History" })).toHaveAttribute("data-state", "on");
  },
};

export const ActionLinks: Story = {
  render: () => <div className="tandem-story-row">
    <ActionLink href="#sample-details">View sample details</ActionLink>
    <ActionLink href="#sample-history" iconOnly aria-label="View sample history"><History size={16} aria-hidden="true" /></ActionLink>
  </div>,
};

export const NavigationItems: Story = {
  render: function NavigationItems() {
    const [selected, setSelected] = useState("Designs");
    return <nav aria-label="Example project" className="tandem-story-stack">
      {["Requirements", "Designs", "Saved history"].map(label => <Button key={label} variant="item"
        aria-current={label === selected ? "page" : undefined} onClick={() => setSelected(label)}>{label}</Button>)}
    </nav>;
  },
};

export const Tooltips: Story = {
  render: () => <Tooltip.Provider delayDuration={0}><Tooltip.Root>
    <Tooltip.Trigger asChild><IconButton aria-label="Open history"><History size={16} aria-hidden="true" /></IconButton></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content>Read the saved request history. Opening it does not start work.</Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>,
};

export const DisclosureDetails: Story = {
  render: () => <Disclosure><summary>Saved decision details</summary><p>Native disclosure behavior with shared typography and focus. Opening this sample does not start work.</p></Disclosure>,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByText("Saved decision details"));
    await expect(canvas.getByText(/Native disclosure behavior/)).toBeVisible();
  },
};

export const AlertConfirmation: Story = {
  render: () => <AlertDialog.Root>
    <AlertDialog.Trigger asChild><Button>Review sample reset</Button></AlertDialog.Trigger>
    <AlertDialog.Portal><AlertDialog.Overlay /><AlertDialog.Content>
      <AlertDialog.Title>Reset this sample?</AlertDialog.Title>
      <AlertDialog.Description>No project files or saved work will change.</AlertDialog.Description>
      <div className="dialog-actions"><AlertDialog.Cancel><X size={16} aria-hidden="true" />Cancel</AlertDialog.Cancel>
        <AlertDialog.Action variant="danger">Reset sample</AlertDialog.Action></div>
    </AlertDialog.Content></AlertDialog.Portal>
  </AlertDialog.Root>,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Review sample reset" });
    await userEvent.click(trigger);
    const dialog = within(canvasElement.ownerDocument.body).getByRole("alertdialog");
    await expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expect(trigger).toHaveFocus();
  },
};
