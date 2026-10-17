(() => {
  if (globalThis.__qingyinLabelsLoadedV1) return;
  globalThis.__qingyinLabelsLoadedV1 = true;
  const entry = chrome.runtime.getManifest().content_scripts.flatMap(item => item.js || []).find(file => file.endsWith('/integration/loader.js'));
  const base = entry.replace(/integration\/loader\.js$/, '');
  const appUrl = chrome.runtime.getURL(`${base}ui/app.mjs`);
  import(appUrl)
    .then(async ({ mountLabelApp }) => {
      const { createExtensionServices } = await import(new URL('../integration/bridge.mjs', appUrl).href);
      const { OPEN_PANEL } = await import(new URL('../integration/extension-api.mjs', appUrl).href);
      const app = await mountLabelApp(await createExtensionServices(), new URL('./style.css', appUrl).href);
      chrome.runtime.onMessage.addListener((message, sender, reply) => {
        if (sender.id !== chrome.runtime.id || message?.type !== OPEN_PANEL) return;
        app.open().then(() => reply({ ok: true }), error => reply({ ok: false, error: error.message }));
        return true;
      });
    })
    .catch(error => { console.error('[轻印标签助手] 初始化失败', error); globalThis.__qingyinLabelsLoadedV1 = false; });
})();
