// author: Pawel Krzesniak

"use strict";

(function() {

const THUNDERBIRD_ID = "{3550f703-e582-4d05-9a08-453d09bdfdc6}";
const SEAMONKEY_ID = "{92650c4d-4b8e-4d2a-b7eb-24ecf4f6b63a}";

const Cc = Components.classes, Ci = Components.interfaces;

window.MailredirectExtension = {

  isOffline: Cc["@mozilla.org/network/io-service;1"].
             getService(Ci.nsIIOService).
             offline,

  OpenMailredirectComposeWindow: function()
  {
    var selectedURIs;
    var server;
    var folder;
    if (typeof gFolderDisplay !== "undefined")
    {
      selectedURIs = gFolderDisplay.selectedMessageUris;
      folder = gFolderDisplay.displayedFolder;
    }
    else
    {
      var mailWindow = Cc["@mozilla.org/appshell/window-mediator;1"].
                       getService(Ci.nsIWindowMediator).getMostRecentWindow("");
      selectedURIs = mailWindow.GetSelectedMessages();
      folder = GetLoadedMsgFolder();
    }
    if (folder)
      server = folder.server;

    var currentIdentity = {key: null};
    if (server && (server.type === "imap" || server.type === "pop3"))
      currentIdentity = getIdentityForServer(server);

    var appInfo = Cc["@mozilla.org/xre/app-info;1"].
                  getService(Ci.nsIXULAppInfo);

    if (appInfo.ID === THUNDERBIRD_ID)
      window.openDialog("chrome://mailredirect/content/mailredirect-compose-thunderbird.xul", "_blank",
          "chrome,extrachrome,menubar,resizable,scrollbars,status,toolbar,center,dialog=no",
          selectedURIs, currentIdentity.key);
    else if (appInfo.ID === SEAMONKEY_ID)
      window.openDialog("chrome://mailredirect/content/mailredirect-compose-seamonkey.xul", "_blank",
          "chrome,extrachrome,menubar,resizable,scrollbars,status,toolbar,center,dialog=no",
          selectedURIs, currentIdentity.key);
  },

  MailredirectController : {
    supportsCommand : function(command)
    {
      switch(command)
      {
        case "cmd_mailredirect":
          return true;
        default:
          return false;
      }
    },
    isCommandEnabled: function(command)
    {
      switch(command)
      {
        case "cmd_mailredirect":
          if (!MailredirectExtension.isOffline)
          {
            var windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].
                                 getService(Ci.nsIWindowMediator);
            var currMsgWindow = windowMediator.getMostRecentWindow("mail:messageWindow");
            var mail3paneWindow = windowMediator.getMostRecentWindow("mail:3pane");
            if (currMsgWindow !== null)
              return true;
            else if (mail3paneWindow !== null)
              return (GetNumSelectedMessages() > 0 && !gFolderDisplay.selectedMessageIsFeed);
          }
          return false;
        default:
          return false;
      }
    },
    doCommand: function(command)
    {
      // if the user invoked a key short cut then it is possible that we got here for a command which is
      // really disabled. kick out if the command should be disabled.
      if (!this.isCommandEnabled(command))
        return;

      switch(command)
      {
        case "cmd_mailredirect":
          MailredirectExtension.OpenMailredirectComposeWindow();
          break;
      }
    }
  },

  SetupController: function()
  {
    top.controllers.appendController(MailredirectExtension.MailredirectController);
    goUpdateCommand("cmd_mailredirect");
  },

  OfflineObserver: {
    observe: function(subject, topic, state)
    {
      // Sanity check
      if (topic !== "network:offline-status-changed")
        return;
      MailredirectExtension.isOffline = (state === "offline");
      goUpdateCommand("cmd_mailredirect");
    }
  },

  UpdateCommand: function(event)
  {
    goUpdateCommand("cmd_mailredirect");
  },

  DelayedUpdateCommand: function(event)
  {
    setTimeout(MailredirectExtension.UpdateCommand, 0);
  },

  FillMailContextMenu: function(event)
  {
    MailredirectExtension.UpdateCommand(event);

    var item = document.getElementById("mailContext-mailredirect");
    if (item !== null)
    {
      item.removeAttribute("hidden");

      // don't show mail items for links/images
      var hideMailItems = gContextMenu.onImage || gContextMenu.onLink;
      if (hideMailItems)
        item.hidden = "true";
    }
  },

  InstallListeners: function(event)
  {
    var el = document.getElementById("threadTree");
    if (el !== null)
      el.addEventListener("select", MailredirectExtension.UpdateCommand, false);

    el = document.getElementById("mailContext");
    if (el !== null)
      el.addEventListener("popupshowing", MailredirectExtension.FillMailContextMenu, false);

    // I've got to perform some tricks for multimessage redirect button, because it is in an iframe 
    el = document.getElementById("multimessage");
    if (el !== null)
    {
      var head = el.contentDocument.getElementsByTagName("head").item(0);
      var newEl = document.createElement("link");
      newEl.setAttribute("rel", "stylesheet");
      newEl.setAttribute("media", "screen");
      newEl.setAttribute("type", "text/css");
      newEl.setAttribute("href", "chrome://mailredirect-os/skin/messageheader.css");
      head.appendChild(newEl);

      var label = document.getElementById("hdrMailredirectButton").getAttribute("label");
      el = el.contentDocument.getElementById("headingwrapper");
      var parentEl = el.getElementsByTagName("toolbar").item(0); // header-view-toolbar
      var oldEl = el.getElementsByTagName("toolbarbutton").item(0); // hdrArchiveButton
      if (parentEl !== null && oldEl !== null)
      {
        // Thunderbird 10+
        var newEl = document.createElement("toolbarbutton");
        newEl.setAttribute("id", "hdrMailredirectButton");
        newEl.setAttribute("class", "toolbarbutton-1 msgHeaderView-button hdrMailredirectButton");
        newEl.setAttribute("style", "list-style-image: url('chrome://mailredirect-os/skin/mailredirect.png')");
        newEl.setAttribute("label", label);
        newEl.addEventListener("click", function(event) { if (event.button === 0) goDoCommand('cmd_mailredirect') }, false);
        parentEl.insertBefore(newEl, oldEl);
      }
      else
      {
        // Thunderbird 10-
        var parentEl = el.getElementsByTagName("hbox").item(0); // buttonhbox
        var oldEl = el.getElementsByTagName("button").item(0); // archive
        if (parentEl !== null && oldEl !== null)
        {
          var newEl = document.createElement("button");
          newEl.setAttribute("id", "hdrMailredirectButton");
          newEl.setAttribute("class", "toolbarbutton-1 msgHeaderView-button hdrMailredirectButton");
          newEl.setAttribute("style", "list-style-image: url('chrome://mailredirect-os/skin/mailredirect.png')");
          newEl.setAttribute("label", label);
          newEl.addEventListener("click", function(event) { if (event.button === 0) goDoCommand('cmd_mailredirect') }, false);
          parentEl.insertBefore(newEl, oldEl);
        }
      }
    }

  },

  UninstallListeners: function(event)
  {
    var el = document.getElementById("threadTree");
    if (el !== null)
      el.removeEventListener("select", MailredirectExtension.UpdateCommand, false);

    el = document.getElementById("mailContext");
    if (el !== null)
      el.removeEventListener("popupshowing", MailredirectExtension.FillMailContextMenu, false);
  },

  AddOfflineObserver: function()
  {
    var observerService = Cc["@mozilla.org/observer-service;1"].
                          getService(Ci.nsIObserverService);
    observerService.addObserver(MailredirectExtension.OfflineObserver, "network:offline-status-changed", false);
  },

  RemoveOfflineObserver: function()
  {
    var observerService = Cc["@mozilla.org/observer-service;1"].
                          getService(Ci.nsIObserverService);
    observerService.removeObserver(MailredirectExtension.OfflineObserver, "network:offline-status-changed");
  },
};

window.addEventListener("load", MailredirectExtension.SetupController, false);
window.addEventListener("load", MailredirectExtension.DelayedUpdateCommand, false);
window.addEventListener("load", MailredirectExtension.InstallListeners, false);
window.addEventListener("load", MailredirectExtension.AddOfflineObserver, false);

window.addEventListener("unload", MailredirectExtension.UninstallListeners, false);
window.addEventListener("unload", MailredirectExtension.RemoveOfflineObserver, false);

})();
