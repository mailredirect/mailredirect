"use strict";

const Cc = Components.classes, Ci = Components.interfaces;

const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

// Load additional JavaScript files
Services.scriptloader.loadSubScript("chrome://mailredirect/content/mailredirect-addons.js", window, "UTF-8");

function onLoad(activatedWhileWindowOpen) {
  window.addEventListener("ViewChanged", window.MailredirectAddonOptions, false);
}

function onUnload(deactivatedWhileWindowOpen) {
}
