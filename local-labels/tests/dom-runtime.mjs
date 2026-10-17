// A DOM/canvas test environment, not a real browser or a print-driver test.
import { JSDOM } from 'jsdom';
import { createCanvas, loadImage } from '@napi-rs/canvas';

export function installDom(html = '<!doctype html><html><body></body></html>') {
  const dom = new JSDOM(html, { url: 'https://seller.kuajingmaihuo.com/main/product/label', pretendToBeVisual: true });
  const { window } = dom, nativeCanvases = new WeakMap();
  const originalCreate = window.document.createElement.bind(window.document);
  for (const dimension of ['width', 'height']) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLCanvasElement.prototype, dimension);
    Object.defineProperty(window.HTMLCanvasElement.prototype, dimension, {
      configurable: true, get() { return descriptor.get.call(this); },
      set(value) { descriptor.set.call(this, value); const canvas = nativeCanvases.get(this); if (canvas) canvas[dimension] = descriptor.get.call(this); },
    });
  }
  const nativeCanvas = element => {
    let canvas = nativeCanvases.get(element);
    if (!canvas) {
      canvas = createCanvas(element.width || 300, element.height || 150);
      canvas.setAttribute = element.setAttribute.bind(element);
      canvas.getAttribute = element.getAttribute.bind(element);
      canvas.style = element.style;
      nativeCanvases.set(element, canvas);
    }
    if (canvas.width !== element.width) canvas.width = element.width;
    if (canvas.height !== element.height) canvas.height = element.height;
    return canvas;
  };
  window.HTMLCanvasElement.prototype.getContext = function (type, options) {
    const context = nativeCanvas(this).getContext(type, options);
    if (!context.__testAdapted) {
      const draw = context.drawImage.bind(context);
      context.drawImage = (image, ...args) => draw(image?._nativeImage || (image instanceof window.HTMLCanvasElement ? nativeCanvas(image) : image), ...args);
      context.__testAdapted = true;
    }
    return context;
  };
  window.HTMLCanvasElement.prototype.toDataURL = function (...args) { return nativeCanvas(this).toDataURL(...args); };
  function createImage() {
    const element = originalCreate('img');
    let value = '';
    Object.defineProperties(element, {
      src: {
        get: () => value,
        set: url => {
          value = url;
          if (!url) return;
          Promise.resolve().then(async () => {
            const bytes = url.startsWith('blob:') ? Buffer.from(await (await fetch(url)).arrayBuffer()) : url;
            const image = await loadImage(bytes);
            if (value !== url) return;
            element._nativeImage = image;
            element.onload?.(new window.Event('load'));
          }).catch(error => element.onerror?.(error));
        },
      },
      naturalWidth: { get: () => element._nativeImage?.width || 0 },
      naturalHeight: { get: () => element._nativeImage?.height || 0 },
      width: { get: () => element._nativeImage?.width || 0 },
      height: { get: () => element._nativeImage?.height || 0 },
      complete: { get: () => Boolean(element._nativeImage) },
    });
    return element;
  }
  window.document.createElement = (tag, options) => tag.toLowerCase() === 'img' ? createImage() : originalCreate(tag, options);
  window.Image = function () { return createImage(); };
  for (const name of ['window', 'document', 'location', 'Element', 'HTMLElement', 'HTMLCanvasElement', 'HTMLImageElement', 'XMLSerializer', 'DOMParser', 'FormData', 'FileReader', 'Image']) globalThis[name] = name === 'window' ? window : window[name];
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  return dom;
}
