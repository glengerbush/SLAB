import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";

import { localCms } from "./src/cms/integration";

const developmentCommand = process.argv.includes("dev");

export default defineConfig({
  output: developmentCommand ? "server" : "static",
  integrations: developmentCommand ? [svelte(), localCms()] : [],
  server: { host: "127.0.0.1" },
  vite: { build: { sourcemap: false } },
});
