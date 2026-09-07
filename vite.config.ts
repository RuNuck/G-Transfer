import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig(({ command, isPreview }) => ({
  server: {
    port: 8080,
    // Forged assets, their bakes and any engine project built from them live under exports/.
    // None of it is source, and a Godot project's .godot cache rewrites and briefly locks files
    // while it imports, which crashes the watcher with EBUSY and takes the dev server down.
    watch: { ignored: ["**/exports/**", "**/.godot/**"] },
  },
  preview: { port: 8081 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    // Nitro wraps only build/preview so the dev server stays plain Vite.
    ...(command === "build" || isPreview ? [nitro({ preset: "vercel" })] : []),
    viteReact(),
  ],
}));
