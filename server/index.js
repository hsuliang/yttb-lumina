/**
 * Cloudflare Worker entry point for the static Vite build used by Sites.
 */
export default {
    async fetch(request, env) {
        if (!env?.ASSETS?.fetch) {
            return new Response('Static asset binding is unavailable.', { status: 500 });
        }
        return env.ASSETS.fetch(request);
    },
};
