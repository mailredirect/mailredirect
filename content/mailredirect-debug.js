/* vim: set sw=2 expandtab softtabstop=2: */

var prefString = "extensions.mailredirect.debug";

function myDump()
{
  this.init();
}

myDump.prototype =
{
  aConsoleService : null,
  prefBranch : null,
  number : 0,
  debug : false,
  observerAdded : false,
  prefObserver : {
    mydump : null,
    observe : function(subject, topic, prefName) {
                if (topic == "nsPref:changed") {
                  if (prefName == prefString) {
                    if (this.mydump)
                      this.mydump.init();
                  }
                }
              }
  },
  init : function()
  {
    if (!this.prefBranch) {
      var pref = Components.classes["@mozilla.org/preferences-service;1"]
        .getService(Components.interfaces.nsIPrefService);
      this.prefBranch = pref.getBranch(null);
      try {
        this.prefBranch = this.prefBranch.QueryInterface(Components.interfaces.nsIPrefBranch2);
      } catch(ex) {
        // windows doesn't know nsIPrefBranch2 interface
        this.prefBranch = this.prefBranch.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
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
      return this.aConsoleService.logStringMessage(str);
      // return this.aConsoleService.logStringMessage("[mailredirect:" + ++this.number + "] " + str);
    }
  }
}

