"use strict";

(function() {

const prefString = "extensions.mailredirect.debug";

window.MailRedirectDebug = {
  Dump: function()
  {
    this.init();
  }
}

MailRedirectDebug.Dump.prototype =
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
      if (topic === "nsPref:changed")
      {
        if (prefName === prefString)
        {
          if (this.mydump)
            this.mydump.init();
        }
      }
    }
  },

  init: function()
  {
    if (!this.prefBranch)
    {
      var prefService = Components.classes["@mozilla.org/preferences-service;1"].
                                   getService(Components.interfaces.nsIPrefService);
      this.prefBranch = prefService.getBranch(null);
      if (!("addObserver" in this.prefBranch))
      {
        // Only necessary prior to Gecko 13
        try {
          this.prefBranch = this.prefBranch.QueryInterface(Components.interfaces.nsIPrefBranch2);
        } catch(ex) {
          // windows doesn't know nsIPrefBranch2 interface
          this.prefBranch = this.prefBranch.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
        }
      }
    }

    if (!this.aConsoleService) {
      this.aConsoleService = Components.classes["@mozilla.org/consoleservice;1"]
        .getService(Components.interfaces.nsIConsoleService);
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
