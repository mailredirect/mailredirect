// authors: Onno Ekker

"use strict";

(async () => {
  /*
  let defaultPrefs = {
    "extensions.mailredirect.copyToSentMail": true,
    "extensions.mailredirect.concurrentConnections": 5,
    "extensions.mailredirect.defaultResentTo": "",
    "extensions.mailredirect.defaultResentCc": "",
    "extensions.mailredirect.defaultResentBcc": "",
    "extensions.mailredirect.defaultMode": "addr_to",
    "extensions.mailredirect.debug": false,
    "extensions.mailredirect.addresswidget.numRowsShownDefault": 3,
    "extensions.mailredirect.firstrun.button-contacts": false
  };
  await preferences.init(defaultPrefs);
  */
  messenger.WindowListener.registerDefaultPrefs("defaults/preferences/mailredirect.js")

  let { os } = await messenger.runtime.getPlatformInfo();
  let { version } = await messenger.runtime.getBrowserInfo();
  let majorVersion = version.split(".")[0];
  let skinDir;
  switch (os) {
    case "win":
      if (majorVersion >= 78) {
        skinDir = "skin/classic/thunderbird/aero/";
      } else {
        skinDir = "skin/classic/thunderbird/aeroPre78/";
      }
      break;
    case "linux":
    case "openBSD":
      skinDir = "skin/classic/thunderbird/unix/";
      break;
    case "mac":
      skinDir = "skin/classic/thunderbird/mac/";
      break;
  }

  messenger.WindowListener.registerChromeUrl([
    ["content",  "mailredirect",           "content/"],
    ["content",  "mailredirect-skin",      skinDir],
    ["resource", "mailredirect-shared",    "skin/shared/"],
    ["resource", "mailredirect-os",        skinDir],

    ["locale",   "mailredirect", "en-US",  "locale/en-US/"],
    ["locale",   "mailredirect", "ar",     "locale/ar/"],
    ["locale",   "mailredirect", "bg",     "locale/bg/"],
    ["locale",   "mailredirect", "cs",     "locale/cs/"],
    ["locale",   "mailredirect", "da",     "locale/da/"],
    ["locale",   "mailredirect", "de",     "locale/de/"],
    ["locale",   "mailredirect", "el",     "locale/el/"],
    ["locale",   "mailredirect", "es-AR",  "locale/es-AR/"],
    ["locale",   "mailredirect", "es-ES",  "locale/es-ES/"],
    ["locale",   "mailredirect", "es-MX",  "locale/es-MX/"],
    ["locale",   "mailredirect", "fi",     "locale/fi/"],
    ["locale",   "mailredirect", "fr",     "locale/fr/"],
    ["locale",   "mailredirect", "hr",     "locale/hr/"],
    ["locale",   "mailredirect", "hu",     "locale/hu/"],
    ["locale",   "mailredirect", "id",     "locale/id/"],
    ["locale",   "mailredirect", "it",     "locale/it/"],
    ["locale",   "mailredirect", "ja",     "locale/ja/"],
    ["locale",   "mailredirect", "lt",     "locale/lt/"],
    ["locale",   "mailredirect", "nb",     "locale/nb/"],
    ["locale",   "mailredirect", "nl",     "locale/nl/"],
    ["locale",   "mailredirect", "pl",     "locale/pl/"],
    ["locale",   "mailredirect", "pt",     "locale/pt/"],
    ["locale",   "mailredirect", "pt-BR",  "locale/pt-BR/"],
    ["locale",   "mailredirect", "ro",     "locale/ro/"],
    ["locale",   "mailredirect", "ru",     "locale/ru/"],
    ["locale",   "mailredirect", "sk",     "locale/sk/"],
    ["locale",   "mailredirect", "sl",     "locale/sl/"],
    ["locale",   "mailredirect", "sq",     "locale/sq/"],
    ["locale",   "mailredirect", "sr",     "locale/sr/"],
    ["locale",   "mailredirect", "sv-SE",  "locale/sv-SE/"],
    ["locale",   "mailredirect", "tr",     "locale/tr/"],
    ["locale",   "mailredirect", "uk-UA",  "locale/uk-UA/"],
    ["locale",   "mailredirect", "zh-CN",  "locale/zh-CN/"],
    ["locale",   "mailredirect", "zh-TW",  "locale/zh-TW/"]
  ]);

  messenger.WindowListener.registerOptionsPage(
    "chrome://mailredirect/content/mailredirect-prefs.xul")

  if (majorVersion >= 73) {
    messenger.WindowListener.registerWindow(
      "chrome://messenger/content/messenger.xhtml",
      "chrome://mailredirect/content/mailredirectMessengerOverlay.js");
    messenger.WindowListener.registerWindow(
      "chrome://messenger/content/messenger.xhtml",
      "chrome://mailredirect/content/mailredirectMessengerOverlay.xul");
    messenger.WindowListener.registerWindow(
      "chrome://messenger/content/messageWindow.xhtml",
      "chrome://mailredirect/content/mailredirectMessengerOverlay.js"); // The messageWindow can use the same overlay as messenger
    messenger.WindowListener.registerWindow(
      "chrome://messenger/content/customizeToolbar.xhtml",
      "chrome://mailredirect/content/mailredirectCustomizeToolbarOverlay.xul");
  } else {
    messenger.WindowListener.registerWindow(
      "chrome://messenger/content/messenger.xul",
      "chrome://mailredirect/content/mailredirectMessengerOverlay.js");
    messenger.WindowListener.registerWindow(
      "chrome://messenger/content/messageWindow.xul",
      "chrome://mailredirect/content/mailredirectMessengerOverlay.js"); // The messageWindow can use the same overlay as messenger
    messenger.WindowListener.registerWindow(
      "chrome://messenger/content/customizeToolbar.xul",
      "chrome://mailredirect/content/mailredirectCustomizeToolbarOverlay.xul");
  }

/*
  messenger.WindowListener.registerWindow(
    "chrome://messenger/content/messenger.xul",
    "chrome://mailredirect/content/mailredirectPrefsOverlay.js");
  messenger.WindowListener.registerWindow(
    "about:preferences",
    "chrome://mailredirect/content/mailredirectPrefsOverlay.js");
  messenger.WindowListener.registerWindow(
    "chrome://messenger/content/preferences/aboutPreferences.xul",
    "chrome://mailredirect/content/mailredirectPrefsOverlay.js");
  messenger.WindowListener.registerWindow(
    "about:addons",
    "chrome://mailredirect/content/mailredirectAddonsOverlay.js");
*/

  messenger.WindowListener.startListening();
})();
