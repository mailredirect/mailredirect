// author: Pawel Krzesniak


var mailredirectIsOffline = Components.classes["@mozilla.org/network/io-service;1"]
  .getService(Components.interfaces.nsIIOService).offline;


var dumper = new myDump();

window.addEventListener("load", SetupMailRedirectController, false);
window.addEventListener("load", installListeners, false);
window.addEventListener("load", delayedMailRedirect_updateCommand, false);
window.addEventListener("load", AddOfflineObserver, false);

window.addEventListener("unload", uninstallListeners, false);
window.addEventListener("unload", RemoveOfflineObserver, false);

/* ************* */


var MailRedirectOfflineObserver = {
  observe: function(subject, topic, state) {
    // sanity checks
    if (topic != "network:offline-status-changed") return;
    if (state == "offline") {
      mailredirectIsOffline = true;
    } else {
      mailredirectIsOffline = false;
    }
    goUpdateCommand('cmd_mailredirect');
  }
}

function AddOfflineObserver()
{
  dumper.dump('in AddOfflineObserver()');
  var observerService = Components.classes["@mozilla.org/observer-service;1"]
    .getService(Components.interfaces.nsIObserverService);
  observerService.addObserver(MailRedirectOfflineObserver, "network:offline-status-changed", false);
}

function RemoveOfflineObserver()
{
  dumper.dump('in RemoveOfflineObserver()');
  var observerService = Components.classes["@mozilla.org/observer-service;1"]
    .getService(Components.interfaces.nsIObserverService);
  observerService.removeObserver(MailRedirectOfflineObserver, "network:offline-status-changed");
}


var MailRedirectController = {
supportsCommand : function(command)
                  {
                    //dumper.dump('supportsCommand(' + command + ')');
                    switch(command) {
                      case "cmd_mailredirect_menu":
                      case "cmd_mailredirect":
                        // return !mailredirectIsOffline;
                        return true;
                      default:
                        return false;
                    }
                  },
isCommandEnabled: function(command)
                  {
                    /* dumper.dump('isCommandEnabled(' + command + ')  = ' +
                        ((!mailredirectIsOffline) && (GetNumSelectedMessages() > 0  && !gFolderDisplay.selectedMessageIsFeed))
                      ); */
		      var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService().QueryInterface(Components.interfaces.nsIWindowMediator);
		      var mail3paneWindow = windowMediator.getMostRecentWindow("mail:3pane");
		      var currMsgWindow = windowMediator.getMostRecentWindow("mail:messageWindow");

                    switch(command) {
			case "cmd_mailredirect_menu":
			case "cmd_mailredirect":
			    if (!mailredirectIsOffline) {
				if (currMsgWindow) {
				    return true;
				} else if (mail3paneWindow) {
				    return GetNumSelectedMessages() > 0 && !gFolderDisplay.selectedMessageIsFeed;
				}
			    }
			    return false;
			default:
			    return false;
                    }
                  },
doCommand: function(command)
           {
             //dumper.dump('doCommand(' + command + ')');

             // if the user invoked a key short cut then it is possible that we got here for a command which is
             // really disabled. kick out if the command should be disabled.
             if (!this.isCommandEnabled(command)) return;

             switch(command) {
               case "cmd_mailredirect_menu":
               case "cmd_mailredirect":
                 openMailRedirectComposeWindow();
                 break;
             }
           },
onEvent: function(event)
         {
           dumper.dump('onEvent(' + event + ')');
         }
};

function SetupMailRedirectController()
{
  top.controllers.appendController(MailRedirectController);
}

function installListeners(event)
{
  var el = document.getElementById("threadTree");
  if (el) el.addEventListener("select", mailRedirect_updateCommand, false);

  el = document.getElementById('mailContext');
  if (el) el.addEventListener("popupshowing", mailRedirect_fillMailContextMenu, false);
}

function uninstallListeners(event)
{
  var el = document.getElementById("threadTree");
  if (el) el.removeEventListener("select", mailRedirect_updateCommand, false);

  el = document.getElementById('mailContext');
  if (el) el.removeEventListener("popupshowing", mailRedirect_fillMailContextMenu, false);
}

function mailRedirect_fillMailContextMenu(event)
{
  mailRedirect_updateCommand(event);

  var item = document.getElementById("mailContext-mailredirect");
  if (item) {
    item.removeAttribute("hidden");
  }

  // don't show mail items for links/images
  var hideMailItems = gContextMenu.onImage || gContextMenu.onLink;
  if (hideMailItems) {
    if (item) item.hidden = "true";
  }
}

function delayedMailRedirect_updateCommand(event)
{
  setTimeout(mailRedirect_updateCommand, 0);
}

function mailRedirect_updateCommand(event)
{
  goUpdateCommand('cmd_mailredirect');
}

function updateMailRedirectMenuCmd()
{
  // dumper.dump('updateMailRedirectMenuCmd');

  var forwardAsMenu = document.getElementById("forwardAsMenu");
  if (forwardAsMenu) {
    var MailRedirectMenuItem = document.getElementById("MailRedirectMenuItem");
    if (! MailRedirectMenuItem) {
      MailRedirectMenuItem = document.createElement("menuitem");
      MailRedirectMenuItem.setAttribute("id", "MailRedirectMenuItem");
      MailRedirectMenuItem.setAttribute("label", "Redirect");
      MailRedirectMenuItem.setAttribute("accesskey", "i");
      var mailContext = document.getElementById("mailContext-mailredirect");
      if (mailContext) {
        MailRedirectMenuItem.setAttribute("label", mailContext.getAttribute("label"));
        MailRedirectMenuItem.setAttribute("accesskey", mailContext.getAttribute("accesskey"));
      }
      MailRedirectMenuItem.setAttribute("key", "key_mailredirect");
      MailRedirectMenuItem.setAttribute("acceltext", "Ctrl+B");
      MailRedirectMenuItem.setAttribute("command", "cmd_mailredirect_menu");
      forwardAsMenu.parentNode.insertBefore(MailRedirectMenuItem, forwardAsMenu.nextSibling);
    }
  }
  goUpdateCommand('cmd_mailredirect_menu');
}

function openMailRedirectComposeWindow()
{
  var selectedURIs;
  var server;
  var folder;
  if (typeof gFolderDisplay !== "undefined") {
      selectedURIs = gFolderDisplay.selectedMessageUris;
      folder = gFolderDisplay.displayedFolder;
  } else {
      var mailWindow = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService()
	  .QueryInterface(Components.interfaces.nsIWindowMediator).getMostRecentWindow("");
      selectedURIs = mailWindow.GetSelectedMessages();
      folder = GetLoadedMsgFolder();
  }
  if (folder) server = folder.server;
  var currentIdentity = {key : null};

  if (server && (server.type == "imap" || server.type == "pop3")) {
    currentIdentity = getIdentityForServer(server);
  }

  window.openDialog('chrome://mailredirect/content/mailredirect-compose.xul','_blank',
      'chrome,extrachrome,menubar,resizable,scrollbars,status,toolbar,center,dialog=no',
      selectedURIs, currentIdentity.key);
}
