import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: {
    autodocs: "tag",
  },
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    define: {
      ...viteConfig.define,
      "import.meta.env.STORYBOOK": JSON.stringify("true"),
      "import.meta.env.VITE_MUXIMOD_MOCK_MODE": JSON.stringify("true"),
    },
  }),
};

export default config;
