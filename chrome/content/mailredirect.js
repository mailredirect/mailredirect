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
            // Extra check for issue #9 (Init error in TB24 on Mac breaking the status bar)
            if (gFolderDisplay)
            {
              var windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].
                                   getService(Ci.nsIWindowMediator);
              var currWindow = windowMediator.getMostRecentWindow("");
              var currWindowType = currWindow.document.documentElement.getAttribute("windowtype");
              if (currWindowType === "mail:messageWindow")
                return true;
              else if (currWindowType === "mail:3pane")
                return (GetNumSelectedMessages() > 0 && !gFolderDisplay.selectedMessageIsFeed);
            }
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
    setTimeout(function() { MailredirectExtension.UpdateCommand() }, 0);
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

  MultimessageClick: function(event)
  {
    if (event.button === 0)
      goDoCommand('cmd_mailredirect')
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
      newEl.setAttribute("type", "text/css");
      newEl.setAttribute("href", "chrome://mailredirect-os/skin/messageHeader.css");
      head.appendChild(newEl);

      var hdrMailredirectButton = document.getElementById("hdrMailredirectButton");
      if (hdrMailredirectButton === null)
      {
        // The CompactHeader extension can hide the hdrMailredirectButton and add a copy of
        // the mailredirect-toolbarbutton button from the Mail toolbar to the msgHeaderViewDeck
        hdrMailredirectButton = document.getElementById("msgHeaderViewDeck").getElementsByClassName("customize-header-toolbar-mailredirect-toolbarbutton").item(0);
      }
      var disabled = hdrMailredirectButton.getAttribute("disabled");
      var label = hdrMailredirectButton.getAttribute("label");
      var image = window.getComputedStyle(hdrMailredirectButton, null).getPropertyValue("list-style-image");
      var region = window.getComputedStyle(hdrMailredirectButton, null).getPropertyValue("-moz-image-region");
      if (disabled && region !== "auto")
      {
        // Calculate the right region...
        // Disabled: -moz-image-region: rect(32px, 16px, 48px, 0px);
        // Normal: -moz-image-region: rect(16px, 16px, 32px, 0px);
        // Normal is always the rect above Disabled
        let coords = region.replace("rect(", "").replace("px)", "").replace("px", "", "g").split(", ");
        if (coords[0] !== "0") {
          coords[0] = coords[0].toString() - coords[1].toString();
          coords[2] = coords[2].toString() - coords[1].toString();
          region = "rect(" + coords[0] + "px, " + coords[1] + "px, " + coords[2] + "px, " + coords[3] + "px)";
        }
      }
      // headingwrapper was renamed to heading_wrapper in tb32 (bug 942638 patch part 5 v5)
      el = el.contentDocument.getElementById("heading_wrapper") || el.contentDocument.getElementById("headingwrapper");
      var parentEl = el.getElementsByTagName("toolbar").item(0); // header-view-toolbar
      var oldEl = el.getElementsByTagName("toolbarbutton").item(0); // hdrArchiveButton
      if (parentEl !== null && oldEl !== null)
      {
        // Thunderbird 10+
        var newEl = document.createElement("toolbarbutton");
        newEl.setAttribute("id", "hdrMailredirectButton");
        newEl.setAttribute("class", "toolbarbutton-1 msgHeaderView-button hdrMailredirectButton");
        newEl.setAttribute("style", "list-style-image: " + image + "; -moz-image-region: " + region + ";");
        newEl.setAttribute("label", label);
        newEl.addEventListener("click", MailredirectExtension.MultimessageClick, false);
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
          newEl.setAttribute("style", "list-style-image: " + image + "; -moz-image-region: " + region + ";");
          newEl.setAttribute("label", label);
          newEl.addEventListener("click", MailredirectExtension.MultimessageClick, false);
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

    el = document.getElementById("multimessage");
    if (el !== null) {
      el = el.contentDocument.getElementById("hdrMailredirectButton");
      if (el !== null)
        el.removeEventListener("click", MailredirectExtension.MultimessageClick, false);
    }
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
