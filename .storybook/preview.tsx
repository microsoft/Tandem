import type { Preview } from "@storybook/react-vite";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import "../development/tandem/public/project-theme.css";
import "../src/renderer/ui/styles.css";
import "./preview.css";

const preview: Preview = {
  decorators: [
    withThemeByDataAttribute({
      themes: { light: "light", dark: "dark" },
      defaultTheme: "light",
      attributeName: "data-project-theme",
    }),
    (Story) => <div className="tandem-story"><Story /></div>,
  ],
  parameters: {
    layout: "padded",
    controls: { expanded: true },
    options: { storySort: { order: ["Foundations", "Controls", "Feedback", "Overlays"] } },
  },
};

export default preview;
