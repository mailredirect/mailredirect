"use strict";

(function() {

const Cc = Components.classes, Ci = Components.interfaces;

const prefString = "extensions.mailredirect.debug";

window.MailredirectDebug = {
  Dump: function()
  {
    this.init();
  }
}

MailredirectDebug.Dump.prototype =
{
  aConsoleService: null,
  prefBranch: null,
  number: 0,
  debug: false,
  observerAdded: false,

  prefObserver:
  {
    mydump: null,
    observe: function(subject, topic, prefName)
    {
      if (topic === "nsPref:changed") {
        if (prefName === prefString) {
          if (this.mydump) {
            this.mydump.init();
          }
        }
      }
    }
  },

  init: function()
  {
    if (!this.prefBranch) {
      var prefService = Cc["@mozilla.org/preferences-service;1"].
                        getService(Ci.nsIPrefService);
      this.prefBranch = prefService.getBranch(null);
    }

    if (!this.aConsoleService) {
      this.aConsoleService = Cc["@mozilla.org/consoleservice;1"].
                             getService(Ci.nsIConsoleService);
    }

    if (!this.observerAdded) {
      this.prefObserver.mydump = this;
      this.prefBranch.addObserver(prefString, this.prefObserver, false);
      this.observerAdded = true;
    }

    try {
      this.debug = this.prefBranch.getBoolPref(prefString);
    } catch(ex) { }

    return;
  },

  dump : function(str)
  {
    if (this.debug) {
      // this.aConsoleService.logStringMessage(str);
      this.aConsoleService.logStringMessage("[mailredirect:" + ++this.number + "] " + str);
    }
    return;
  }
}

})();
