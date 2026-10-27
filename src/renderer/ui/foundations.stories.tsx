import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Status } from "./index.js";

const meta = {
  title: "Foundations/Tokens",
  tags: ["autodocs"],
  parameters: { controls: { disable: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  render: () => <div className="tandem-story-foundations">
    <h1>Tandem UI foundations</h1>
    <p>Shared tokens and controls for a compact, review-focused workspace. These examples use the production theme and component styles, without starting an application runtime.</p>
    <Status>Use the theme toolbar to review light and dark modes, including portaled dialogs.</Status>
    <h2>Semantic colors</h2>
    <div className="tandem-story-swatches">
      {[
        ["Surface", "--studio-surface"], ["Panel", "--studio-panel"], ["Text", "--studio-text"],
        ["Muted text", "--studio-muted"], ["Accent", "--studio-accent"], ["Primary action", "--studio-action-bg"],
        ["Success", "--studio-success"], ["Warning", "--studio-warning"], ["Error", "--studio-danger"],
      ].map(([label, token]) => <div className="tandem-story-swatch" key={token}>
        <div style={{ background: `var(${token})` }} /><strong>{label}</strong><code>{token}</code>
      </div>)}
    </div>
    <h2>Spacing</h2>
    <div className="tandem-story-spacing">{[1, 2, 3, 4, 5, 6, 8].map(step => <div key={step}>
      <span style={{ width: `var(--studio-space-${step})` }} /><code>{step * 4}px</code>
    </div>)}</div>
    <h2>Typography and density</h2>
    <table><thead><tr><th scope="col">Purpose</th><th scope="col">Example</th></tr></thead><tbody>
      <tr><th scope="row">Title</th><td style={{ fontSize: "var(--studio-text-title)" }}>Review saved changes</td></tr>
      <tr><th scope="row">Body</th><td>Compact 13px body text, with the host's font family.</td></tr>
      <tr><th scope="row">Supporting text</th><td style={{ fontSize: "var(--studio-text-small)" }}>Keep the original source and review history.</td></tr>
      <tr><th scope="row">Code</th><td style={{ fontFamily: "var(--studio-font-mono)" }}>--studio-control-height: 30px</td></tr>
    </tbody></table>
    <h2>Action hierarchy</h2>
    <div className="tandem-story-row"><Button variant="primary">Continue</Button><Button>Review details</Button><Button variant="ghost">Cancel</Button></div>
    <p>Use one main action per decision. Keep labels explicit, errors visible, and touch targets at least 44px. Small and large variants are intentional exceptions, not new per-screen CSS.</p>
  </div>,
};
