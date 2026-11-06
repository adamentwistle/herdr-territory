// Sends the mod's imports of the app's modules to the stand-ins beside this file.

import { registerHooks } from "node:module";

const stubs = {
  "gpui-kit": new URL("./gpui.js", import.meta.url).href,
  "gpui-base": new URL("./gpui.js", import.meta.url).href,
  herdr: new URL("./herdr.js", import.meta.url).href,
};

registerHooks({
  resolve(specifier, context, next) {
    return stubs[specifier] ? { url: stubs[specifier], shortCircuit: true } : next(specifier, context);
  },
});
