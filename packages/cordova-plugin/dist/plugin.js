(function(global, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? factory(require("cordova")) : typeof define === "function" && define.amd ? define(["cordova"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.cordova));
})(this, function(cordova) {
  "use strict";
  function s(t) {
    t.CapacitorUtils.Synapse = new Proxy(
      {},
      {
        get(e, o) {
          return new Proxy({}, {
            get(w, r) {
              return (c, p, n) => {
                const i = t.Capacitor.Plugins[o];
                if (i === void 0) {
                  n(new Error(`Capacitor plugin ${o} not found`));
                  return;
                }
                if (typeof i[r] != "function") {
                  n(new Error(`Method ${r} not found in Capacitor plugin ${o}`));
                  return;
                }
                (async () => {
                  try {
                    const a = await i[r](c);
                    p(a);
                  } catch (a) {
                    n(a);
                  }
                })();
              };
            }
          });
        }
      }
    );
  }
  function u(t) {
    t.CapacitorUtils.Synapse = new Proxy(
      {},
      {
        get(e, o) {
          return t.cordova.plugins[o];
        }
      }
    );
  }
  function y(t = false) {
    window.CapacitorUtils = window.CapacitorUtils || {}, window.Capacitor !== void 0 && !t ? s(window) : window.cordova !== void 0 && u(window);
  }
  const exec = cordova.require("cordova/exec");
  function downloadFile(options, success, error) {
    exec(success, error, "OSFileTransferPlugin", "downloadFile", [options]);
  }
  function uploadFile(options, success, error) {
    exec(success, error, "OSFileTransferPlugin", "uploadFile", [options]);
  }
  function addListener(eventName, listenerFunc) {
    exec(listenerFunc, emptyListener, "OSFileTransferPlugin", "addListener", [eventName]);
  }
  function removeAllListeners() {
    exec(emptyListener, emptyListener, "OSFileTransferPlugin", "removeAllListeners", []);
  }
  function emptyListener(_) {
    return;
  }
  module.exports = {
    downloadFile,
    uploadFile,
    addListener,
    removeAllListeners
  };
  y(true);
});
