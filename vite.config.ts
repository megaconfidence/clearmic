import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// The Cloudflare plugin reads wrangler.jsonc and runs the Worker (worker/index.ts)
// inside the workerd runtime during `vite dev`, so the React client and the
// `/api/*` backend share one dev server with real bindings.
export default defineConfig({
	plugins: [react(), cloudflare(), tailwindcss()],
});
