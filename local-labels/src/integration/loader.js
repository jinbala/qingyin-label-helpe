(() => {
  if (globalThis.__qingyinLabelsLoadedV1) return;
  globalThis.__qingyinLabelsLoadedV1 = true;
  const entry = chrome.runtime.getManifest().content_scripts.flatMap(item => item.js || []).find(file => file.endsWith('/integration/loader.js'));
  const base = entry.replace(/integration\/loader\.js$/, '');
  const appUrl = chrome.runtime.getURL(`${base}ui/app.mjs`);
  const stylesheet = new URL('./style.css', appUrl).href;
  let appPromise, launcher, launcherHost, routeTimer;

  // The whole panel (and its template-storage read) is imported on first use.
  // Most seller pages never open it, and the launcher below needs no app code.
  const mount = () => {
    if (!appPromise) {
      appPromise = (async () => {
        const [{ mountLabelApp }, { createExtensionServices }] = await Promise.all([
          import(appUrl),
          import(new URL('../integration/bridge.mjs', appUrl).href),
        ]);
        return mountLabelApp(await createExtensionServices(), stylesheet);
      })().catch(error => { appPromise = undefined; throw error; });
    }
    return appPromise;
  };

  const removeLauncher = () => {
    clearInterval(routeTimer); routeTimer = undefined;
    launcherHost?.remove(); launcherHost = undefined; launcher = undefined;
  };
  const open = async () => {
    const instance = await mount();
    removeLauncher();
    if (instance && typeof instance.open === 'function') await instance.open();
  };

  // A lightweight launcher keeps the panel clickable before the app loads and
  // is removed once the full panel has mounted.
  if (!document.querySelector('#qingyin-label-helper-launcher')) {
    launcherHost = document.createElement('div');
    launcherHost.id = 'qingyin-label-helper-launcher';
    launcherHost.style.cssText = 'all: initial';
    const root = launcherHost.attachShadow({ mode: 'open' });
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = stylesheet;
    launcher = document.createElement('button');
    launcher.type = 'button'; launcher.className = 'launcher'; launcher.textContent = '轻印标签助手'; launcher.hidden = true;
    // Inline fallback so the entry stays usable even if the page CSP blocks the
    // stylesheet link inside this shadow root; the shared stylesheet refines it.
    launcher.style.cssText = 'position:fixed;right:22px;bottom:88px;z-index:2147483645;background:#1e52bd;color:#fff;border:0;padding:12px 18px;border-radius:12px;cursor:pointer;font:14px system-ui,"Microsoft YaHei",sans-serif';
    launcher.addEventListener('click', () => {
      open().catch(error => {
        if (!launcher) return;
        launcher.hidden = false;
        launcher.textContent = '轻印加载失败，请刷新重试';
        launcher.title = String(error?.message || error);
      });
    });
    root.append(link, launcher);
    document.documentElement.append(launcherHost);
    import(new URL('../integration/dom.mjs', appUrl).href).then(({ pageType }) => {
      const sync = () => { if (launcher) launcher.hidden = !pageType(); };
      sync(); routeTimer = setInterval(sync, 1000);
    }).catch(() => { if (launcher) launcher.hidden = false; });
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    // Mirrors OPEN_PANEL from integration/extension-api.mjs; the loader must
    // register this listener synchronously, before any module import resolves.
    if (sender.id !== chrome.runtime.id || message?.type !== 'QINGYIN_LABEL_OPEN_PANEL_V1') return;
    open().then(() => reply({ ok: true }), error => reply({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();
