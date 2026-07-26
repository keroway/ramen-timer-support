import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://ramentimer.keroway.com",
  output: "static",
  compressHTML: true,
  build: {
    assets: "_astro",
    inlineStylesheets: "never",
  },
  integrations: [sitemap()],
});
