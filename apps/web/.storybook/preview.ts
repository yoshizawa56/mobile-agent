import type { Preview } from "@storybook/react-vite";
import "../src/styles.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "ink",
      values: [
        { name: "paper", value: "#f4f1ea" },
        { name: "ink", value: "#030704" },
      ],
    },
    controls: { expanded: true },
  },
};

export default preview;
