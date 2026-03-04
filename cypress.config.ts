import { defineConfig } from "cypress";

export default defineConfig({
  video: true,
  screenshotOnRunFailure: true,
  e2e: {
    setupNodeEvents(on, config) {},
  },
  component: {
    video: true,
    screenshotOnRunFailure: true,
    devServer: {
      framework: "next",
      bundler: "webpack",
    },
  },
});
