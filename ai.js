'use strict';
// Local AI: a small language model that runs on the user's own graphics card through WebLLM (WebGPU).
// No server is involved. The model files are downloaded once from Hugging Face and cached on this device.
//
// It needs vendor/web-llm.js, which `node setup-local-ai.js` creates. Without it (or without WebGPU) every
// function here fails with a readable reason and the assistant keeps using its built-in summaries.
(() => {
    const MODELS = {
        fast: {
            label: 'Fast', name: 'Llama 3.2 1B', size: 'about 0.7 GB',
            ids: { f16: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', f32: 'Llama-3.2-1B-Instruct-q4f32_1-MLC' }
        },
        balanced: {
            label: 'Balanced', name: 'Qwen 2.5 1.5B', size: 'about 1 GB',
            ids: { f16: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', f32: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC' }
        },
        smart: {
            label: 'Smart', name: 'Llama 3.2 3B', size: 'about 1.8 GB',
            ids: { f16: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', f32: 'Llama-3.2-3B-Instruct-q4f32_1-MLC' }
        }
    };
    const IDLE_UNLOAD_MS = 10 * 60 * 1000; // give the GPU memory back after 10 idle minutes

    let lib = null;          // the WebLLM module
    let checked = null;      // cached result of check()
    let engine = null;
    let loadedKey = null;
    let loadedId = null;
    let loading = null;
    let generating = null;
    let progressCb = null;
    let idleTimer = null;

    const fail = (reason, message) => Object.assign(new Error(message), { reason });
    const modelId = (key, f16) => MODELS[key].ids[f16 ? 'f16' : 'f32'];

    async function webllm() {
        if (!lib) lib = await import('./vendor/web-llm.js');
        return lib;
    }

    async function appConfig() {
        const w = await webllm();
        // IndexedDB keeps the model cache working for pages loaded from disk.
        return { ...w.prebuiltAppConfig, cacheBackend: 'indexeddb' };
    }

    // { ok: true, f16 } when this computer can run Local AI, otherwise { ok: false, reason, message }.
    async function check() {
        if (checked) return checked;
        if (!navigator.gpu) {
            return { ok: false, reason: 'no-webgpu', message: 'This computer cannot run Local AI: WebGPU is not available (an up-to-date graphics driver is usually the fix).' };
        }
        let adapter = null;
        try { adapter = await navigator.gpu.requestAdapter(); } catch (_) { /* handled below */ }
        if (!adapter) {
            return { ok: false, reason: 'no-adapter', message: 'This computer cannot run Local AI: no usable graphics card was found for WebGPU.' };
        }
        try { await webllm(); } catch (_) {
            return { ok: false, reason: 'not-installed', message: 'Local AI is not set up yet. Run “node setup-local-ai.js” in the Neira folder once, then restart the browser.' };
        }
        checked = { ok: true, f16: adapter.features.has('shader-f16') };
        return checked;
    }

    async function isDownloaded(key) {
        const c = await check();
        if (!c.ok) return false;
        try {
            return !!(await (await webllm()).hasModelInCache(modelId(key, c.f16), await appConfig()));
        } catch (_) {
            return false;
        }
    }

    const isLoaded = key => !!engine && loadedKey === key;

    function touch() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { if (!generating && !loading) unload(); }, IDLE_UNLOAD_MS);
    }

    async function unload() {
        clearTimeout(idleTimer);
        const e = engine;
        engine = null; loadedKey = null; loadedId = null;
        if (e) { try { await e.unload(); } catch (_) { /* already gone */ } }
    }

    // Downloads (first time only) and loads the model into GPU memory. onProgress({ progress: 0..1, text }).
    async function load(key, onProgress) {
        if (!MODELS[key]) throw fail('bad-model', 'Unknown model.');
        const c = await check();
        if (!c.ok) throw fail(c.reason, c.message);
        const id = modelId(key, c.f16);
        if (engine && loadedId === id) { touch(); return; }
        progressCb = onProgress || null;
        if (!loading) {
            loading = (async () => {
                const w = await webllm();
                const cfg = await appConfig();
                if (!cfg.model_list.some(m => m.model_id === id)) {
                    throw fail('unavailable', 'This model is not available in the installed version of WebLLM.');
                }
                await stop();
                await unload();
                engine = await w.CreateMLCEngine(id, {
                    appConfig: cfg,
                    initProgressCallback: p => { if (progressCb) progressCb(p); }
                });
                loadedKey = key;
                loadedId = id;
            })().finally(() => { loading = null; progressCb = null; });
        }
        await loading;
        touch();
    }

    // Streams a reply. onText(textSoFar) is called as it is written. Resolves { text, stopped }.
    async function generate({ messages, maxTokens = 500, temperature = 0.3, onText }) {
        if (!engine) throw fail('not-loaded', 'The model is not loaded.');
        await stop();
        let stopped = false;
        const run = (async () => {
            let text = '';
            const stream = await engine.chat.completions.create({
                messages, stream: true, temperature, top_p: 0.9, max_tokens: maxTokens
            });
            for await (const chunk of stream) {
                const delta = chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
                if (delta) { text += delta; if (onText) onText(text); }
            }
            return text;
        })();
        generating = run;
        generating.stop = () => { stopped = true; };
        try {
            const text = await run;
            return { text, stopped };
        } finally {
            if (generating === run) generating = null;
            touch();
        }
    }

    async function stop() {
        const run = generating;
        if (!run || !engine) return;
        if (run.stop) run.stop();
        try { engine.interruptGenerate(); } catch (_) { /* nothing to interrupt */ }
        try { await run; } catch (_) { /* the caller of generate() sees it */ }
    }

    // Deletes the downloaded model files for a model (both the f16 and f32 variants).
    async function remove(key) {
        if (!MODELS[key]) return;
        if (loadedKey === key) await unload();
        const w = await webllm();
        const cfg = await appConfig();
        for (const id of Object.values(MODELS[key].ids)) {
            try { await w.deleteModelAllInfoInCache(id, cfg); } catch (_) { /* not downloaded */ }
        }
    }

    window.neiraAI = { MODELS, check, isDownloaded, isLoaded, load, generate, stop, unload, remove };
})();