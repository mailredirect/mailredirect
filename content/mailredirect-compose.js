// based on https://searchfox.org/comm-central/source/mail/components/compose/content/MsgComposeCommands.js

"use strict";

var { allAccountsSorted } = ChromeUtils.import("resource:///modules/folderUtils.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { Log } = ChromeUtils.import("resource://gre/modules/Log.jsm");
var { fixIterator, toArray } = ChromeUtils.import("resource:///modules/iteratorUtils.jsm");
var { MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm");
var { PluralForm } = ChromeUtils.import("resource://gre/modules/PluralForm.jsm");
var { AddonManager } = ChromeUtils.import("resource://gre/modules/AddonManager.jsm");
var { AppConstants } = ChromeUtils.import("resource://gre/modules/AppConstants.jsm");
var { LightweightThemeManager } = ChromeUtils.import("resource://gre/modules/LightweightThemeManager.jsm");

const Cc = Components.classes, Ci = Components.interfaces;

// Max header length is 32768, but UTF-8 encoded e-mail addresses can be twice
// as long as normal e-mail addresses
const MAX_HEADER_LENGTH = 16384;

// from nsDirPrefs.h
const kPersonalAddressbookUri  = "moz-abmdbdirectory://abook.mab";
const kCollectedAddressbookUri = "moz-abmdbdirectory://history.mab";

const kDateFormatNone = 0;          // do not include the date in the format string
const kDateFormatLong = 1;          // provides the long date format for the given locale
const kDateFormatShort = 2;         // provides the short date format for the given locale
const kDateFormatYearMonth = 3;     // formats using only the year and month
const kDateFormatWeekday = 4;       // week day (e.g. Mon, Tue)

const kTimeFormatNone = 0;          // don't include the time in the format string
const kTimeFormatSeconds = 1;       // provides the time format with seconds in the  given locale
const kTimeFormatNoSeconds = 2;     // provides the time format without seconds in the given locale

const PR_MSEC_PER_SEC = 1000;
const PR_MSEC_PER_DAY = PR_MSEC_PER_SEC * 60 * 60 * 24;

// Global message window object
var msgWindow;
var gMessenger;

// Global variables

var gAppInfoPlatformVersion = null;
var gMsgCompose;
var gWindowLocked;
var gSendLocked;

var gMsgIdentityElement;
var gMsgAddressingWidgetElement;
var gMsgHeadersToolbarElement;
var gAccountManager;
var gCurrentIdentity;
var mailredirectRecipients;
var aSender;

var gAbResultsTree = null;

// redirected mail states..
var mstate = {
  selectedURIs: null,
  selectedURIsProgress: null,
  successfulSent: null,
  statusStrings: null,
  sendOperationInProgress: null,
  msgSendObj: null,
  size: 0
}

function InitializeGlobalVariables()
{
  gMessenger = Cc["@mozilla.org/messenger;1"].createInstance(Ci.nsIMessenger);

  gMsgCompose = null;
  gWindowLocked = false;
  gMsgAddressingWidgetElement = null;
  mailredirectRecipients = null;
  aSender = null;
  msgWindow = Cc["@mozilla.org/messenger/msgwindow;1"].createInstance(Ci.nsIMsgWindow);
  MailServices.mailSession.AddMsgWindow(msgWindow);
}

InitializeGlobalVariables();

function ReleaseGlobalVariables()
{
  gMessenger = null;
  gMsgCompose = null;
  gMsgIdentityElement = null;
  gMsgAddressingWidgetElement = null;
  gAccountManager = null;
  gCurrentIdentity = null;
  mailredirectRecipients = null;
  mstate = null;
  MailServices.mailSession.RemoveMsgWindow(msgWindow);
  msgWindow = null;
}

window.MailredirectPrefs.init();

var dumper = new MailredirectDebug.Dump();

function RemoveValueFromAttribute(el, attr, val)
{
  var orgval = el.getAttribute(attr);
  val = val.replace(/^\s+|\s+$/g, "");
  var regExp = new RegExp("(?:^|\\s+)" + val + "(?:\\s+|$)", "g");
  var newval = orgval.replace(regExp, "");
  if (newval.match(/^\s*$/)) {
    el.removeAttribute(attr);
  } else {
    el.setAttribute(attr, newval);
  }
}

function clearMState()
{
  dumper.dump("clearing mstate");
  mstate.selectedURIsProgress = [];
  mstate.successfulSent = [];
  mstate.statusStrings = [];
  mstate.sendOperationInProgress = [];
  mstate.msgSendObj = [];

  for (var i = 0; i < mstate.size; ++i) {
    mstate.selectedURIsProgress[i] = 0;
    // mstate.successfulSent[i] = true;
    mstate.successfulSent[i] = false;
    mstate.statusStrings[i] = "";
    mstate.sendOperationInProgress[i] = false;
    mstate.msgSendObj[i] = null;
  }

  // clear treeitems status in threadTree
  var treeChildren = document.getElementById("topTreeChildren");
  // dumper.dump("treeChildren=" + treeChildren);
  if (treeChildren) {
    var el = treeChildren.getElementsByTagName("treerow");
    // dumper.dump("el=" + el + "   length=" + el.length);
    if (el) {
      for (var i = 0; i < el.length; ++i) {
        // dumper.dump("el[" + i + "]=" + el[i]);
        RemoveValueFromAttribute(el[i], "properties", "notsent");
        for (var n = 0; n < el[i].childNodes.length; ++n) {
          RemoveValueFromAttribute(el[i].childNodes[n], "properties", "notsent");
        }
        var col = el[i].lastChild;
        if (col) {
          col.setAttribute("mode", "normal");
          col.setAttribute("value", "0");
        }
      }
    }
  }
}

function toOpenWindowByType(inType, uri)
{
  var topWindow = Cc["@mozilla.org/appshell/window-mediator;1"].
                  getService(Ci.nsIWindowMediator).
                  getMostRecentWindow(inType);

  if (topWindow) {
    topWindow.focus();
  } else {
    window.open(uri, "_blank", "chrome,extrachrome,menubar,resizable,scrollbars,status,toolbar");
  }
}

function toMessengerWindow()
{
  toOpenWindowByType("mail:3pane", "chrome://messenger/content/messenger.xul");
}

function toAddressBook()
{
  toOpenWindowByType("mail:addressbook", "chrome://messenger/content/addressbook/addressbook.xul");
}

function onViewToolbarCommand(aEvent)
{
  var toolbar = aEvent.originalTarget.getAttribute("toolbarid");
  if (toolbar) {
    goToggleToolbar(toolbar);
  }
}

/**
 * Disables or restores all toolbar items (menus/buttons) in the window.
 *
 * @param aDisable  true = disable all items. false = restore items to the state
 *                  stored before disabling them.
 */
function updateAllItems(aDisable)
{
  function getDisabledState(aElement) {
    if ("disabled" in aElement) {
      return aElement.disabled;
    } else {
      return aElement.getAttribute("disabled");
    }
  }

  function setDisabledState(aElement, aValue) {
    if ("disabled" in aElement) {
      aElement.disabled = aValue;
    } else {
      aElement.setAttribute("disabled", aValue ? "true" : "false");
    }
  }

  // This array will contain HTMLCollection objects as members.
  let commandItemCollections = [];
  commandItemCollections.push(document.getElementsByTagName("menu"));
  commandItemCollections.push(document.getElementsByTagName("toolbarbutton"));
  commandItemCollections.push(document.querySelectorAll("[command]"));
  commandItemCollections.push(document.querySelectorAll("[oncommand]"));
  for (let itemCollection of commandItemCollections) {
    for (let item = 0; item < itemCollection.length; item++) {
      let commandItem = itemCollection[item];
      if (aDisable) {
        // Any element can appear multiple times in the commandItemCollections
        // list so only act on it if we didn't already set the "stateBeforeSend"
        // attribute on previous visit.
        if (!commandItem.hasAttribute("stateBeforeSend")) {
          commandItem.setAttribute("stateBeforeSend", getDisabledState(commandItem));
          setDisabledState(commandItem, true);
        }
      } else {
        // Any element can appear multiple times in the commandItemCollections
        // list so only act on it if it still has the "stateBeforeSend"
        // attribute.
        if (commandItem.hasAttribute("stateBeforeSend")) {
          setDisabledState(commandItem, commandItem.getAttribute("stateBeforeSend") === "true");
          commandItem.removeAttribute("stateBeforeSend");
        }
      }
    }
  }
}

/**
 * Update all the commands for sending a message to reflect their current state.
 */
function updateSendCommands(aHaveController)
{
  updateSendLock();
  if (aHaveController) {
    goUpdateCommand("cmd_mailredirect_now");
    goUpdateCommand("cmd_mailredirect_withcheck");
  } else {
    goSetCommandEnabled("cmd_mailredirect_now",       MailredirectWindowController.isCommandEnabled("cmd_mailredirect_now"));
    goSetCommandEnabled("cmd_mailredirect_withcheck", MailredirectWindowController.isCommandEnabled("cmd_mailredirect_withcheck"));
  }
}

/**
 * Keep the Send buttons disabled until any recipient is entered.
 */
function updateSendLock()
{
  gSendLocked = true;
  if (!gMsgCompose) {
    return;
  }

  // Enable send buttons if anything was entered into the recipient fields.
  // A more thorough check will be performed when a send button is actually clicked.
  let msgCompFields = gMsgCompose.compFields;
  Recipients2CompFields(msgCompFields);
  gSendLocked = !msgCompFields.hasRecipients;
}

/**
 * Check if the entered addresses are valid and alert the user if they are not.
 *
 * @param aMsgCompFields  A nsIMsgCompFields object containing the fields to check.
 */
function CheckValidEmailAddress(aMsgCompFields)
{
  if (!aMsgCompFields.hasRecipients) {
    let composeMsgsBundle = Services.strings.createBundle("chrome://messenger/locale/messengercompose/composeMsgs.properties");
    let errorTitle = composeMsgsBundle.GetStringFromName("addressInvalidTitle");
    let errorMsg = composeMsgsBundle.GetStringFromName("noRecipients");
    Services.prompt.alert(window, errorTitle, errorMsg);

    return false;
  }

  let invalidStr;
  // Crude check that the to, cc, and bcc fields contain at least one '@'.
  // We could parse each address, but that might be overkill.
  function isInvalidAddress(aAddress) {
    return (aAddress.length > 0 &&
            ((!aAddress.includes("@", 1) && aAddress.toLowerCase() !== "postmaster") ||
              aAddress.endsWith("@")));
  }
  if (isInvalidAddress(aMsgCompFields.to)) {
    invalidStr = aMsgCompFields.to;
  } else if (isInvalidAddress(aMsgCompFields.cc)) {
    invalidStr = aMsgCompFields.cc;
  } else if (isInvalidAddress(aMsgCompFields.bcc)) {
    invalidStr = aMsgCompFields.bcc;
  }

  if (invalidStr) {
    let composeMsgsBundle = Services.strings.createBundle("chrome://messenger/locale/messengercompose/composeMsgs.properties");
    let errorTitle = composeMsgsBundle.GetStringFromName("addressInvalidTitle");
    Services.prompt.alert(window, errorTitle,
                          composeMsgsBundle.formatStringFromName("addressInvalid", [invalidStr], 1));
    return false;
  }

  return true;
}

/**
 * Locks/Unlocks the window widgets while a message is being saved/sent.
 * Locking means to disable all possible items in the window so that
 * the user can't click/activate anything.
 *
 * @param aDisable  true = lock the window. false = unlock the window.
 */
function ToggleWindowLock(aDisable)
{
  gWindowLocked = aDisable;
  updateAllItems(aDisable);
  updateEditableFields(aDisable);
}

function onAddressColCommand(aAddressWidgetId)
{
  awSetAutoComplete(aAddressWidgetId.slice(aAddressWidgetId.lastIndexOf('#') + 1));
  updateSendCommands(true);
}

/**
 * Called if the list of recipients changed in any way.
 *
 * @param aAutomatic  Set to true if the change of recipients was invoked
 *                    programatically and should not be considered a change
 *                    of message content.
 */
function onRecipientsChanged(aAutomatic)
{
  updateSendCommands(true);
}

function FillIdentityList(menulist)
{
  let accounts = allAccountsSorted(true);

  let accountHadSeparator = false;
  let firstAccountWithIdentities = true;
  for (let acc = 0; acc < accounts.length; acc++) {
    let account = accounts[acc];

    let server = account.incomingServer;
    if (!server || server.type === "nntp") {
      continue;
    }

    let identities = toArray(fixIterator(account.identities,
                                         Ci.nsIMsgIdentity));

    if (identities.length === 0) {
      continue;
    }

    let needSeparator = (identities.length > 1);
    if (needSeparator || accountHadSeparator) {
      // Separate identities from this account from the previous
      // account's identities if there is more than 1 in the current
      // or previous account.
      if (!firstAccountWithIdentities) {
        // only if this is not the first account shown
        let separator = document.createXULElement("menuseparator");
        menulist.menupopup.appendChild(separator);
      }
      accountHadSeparator = needSeparator;
    }
    firstAccountWithIdentities = false;

    for (let i = 0; i < identities.length; i++) {
      let identity = identities[i];
      let item = menulist.appendItem(identity.identityName,
                                     identity.fullAddress,
                                     server.prettyName);
      item.setAttribute("identitykey", identity.key);
      item.setAttribute("accountkey", account.key);
      if (i === 0) {
        // Mark the first identity as default.
        item.setAttribute("default", "true");
      }
    }
  }
}

function getCurrentAccountKey()
{
  // Get the account's key
  let identityList = GetMsgIdentityElement();
  return identityList.selectedItem.getAttribute("accountkey");
}

function getCurrentIdentityKey()
{
  // Get the identity key
  let identityList = GetMsgIdentityElement();
  return identityList.selectedItem.getAttribute("identitykey");
}

function setupAutocomplete()
{
  var autoCompleteWidget = document.getElementById("addressCol2#1");

  try {
    // Request that input that isn't matched be highlighted.
    // This element then gets cloned for subsequent rows, so they should
    // honor it as well
    if (getPref("mail.autoComplete.highlightNonMatches")) {
      autoCompleteWidget.highlightNonMatches = true;
    }
    // If the pref is set to turn on the comment column, honor it here.
    if (getPref("mail.autoComplete.commentColumn")) {
      autoCompleteWidget.showCommentColumn = true;
    }
  } catch (ex) {
    // if we can't get these prefs, then don't highlight non-matched input
    // or don't show the comment column
  }
}

function fromKeyPress(event)
{
  if (event.keyCode === KeyEvent.DOM_VK_RETURN) {
    awSetFocusTo(awGetInputElement(1));
  }
}

function LoadIdentity(startup)
{
  let identityElement = GetMsgIdentityElement();
  let prevIdentity = gCurrentIdentity;

  let idKey = null;
  let accountKey = null;
  if (identityElement.selectedItem) {
    // Set the identity key value on the menu list.
    idKey = identityElement.selectedItem.getAttribute("identitykey");
    identityElement.setAttribute("identitykey", idKey);
    gCurrentIdentity = MailServices.accounts.getIdentity(idKey);

    // Set the account key value on the menu list.
    accountKey = identityElement.selectedItem.getAttribute("accountkey");
    identityElement.setAttribute("accountkey", accountKey);

    let maxRecipients = awGetMaxRecipients();
    for (let i = 1; i <= maxRecipients; i++) {
      let params;
      if (typeof awGetInputElement(i).searchParam !== "undefined") {
        params = JSON.parse(awGetInputElement(i).searchParam);
      } else {
        params = JSON.parse("{}");
      }
      params.idKey = idKey;
      params.accountKey = accountKey;
      awGetInputElement(i).searchParam = JSON.stringify(params);
    }

    try {
      gMsgCompose.identity = gCurrentIdentity;
    } catch (ex) {
      dump("### Cannot change the identity: " + ex + "\n");
    }

    if (!startup) {
      if (getPref("mail.autoComplete.highlightNonMatches")) {
        document.getElementById("addressCol2#1").highlightNonMatches = true;
      }
    }
  }
}

function GetMsgHdrForUri(msg_uri)
{
  var messenger = Cc["@mozilla.org/messenger;1"].
                  createInstance(Ci.nsIMessenger);
  var mms = messenger.messageServiceFromURI(msg_uri).
            QueryInterface(Ci.nsIMsgMessageService);
  var hdr = null;

  if (mms) {
    try {
      hdr = mms.messageURIToMsgHdr(msg_uri);
    } catch (ex) { }
    if (!hdr) {
      try {
        var url_o = new Object(); // return container object
        mms.GetUrlForUri(msg_uri, url_o, msgWindow);
        var url = url_o.value.QueryInterface(Ci.nsIMsgMessageUrl);
        hdr = url.messageHeader;
      } catch (ex) { }
    }
  }
  if (!hdr && gDBView && gDBView.msgFolder) {
    try {
      hdr = gDBView.msgFolder.GetMessageHeader(gDBView.getKeyAt(gDBView.currentlyDisplayedMessage));
    } catch (ex) { }
  }

  return hdr;
}

function GetMsgIdentityElement()
{
  if (!gMsgIdentityElement)
    gMsgIdentityElement = document.getElementById("msgIdentity");

  return gMsgIdentityElement;
}

function GetMsgAddressingWidgetElement()
{
  if (!gMsgAddressingWidgetElement) {
    gMsgAddressingWidgetElement = document.getElementById("addressingWidget");
  }

  return gMsgAddressingWidgetElement;
}

function GetMsgHeadersToolbarElement()
{
  if (!gMsgHeadersToolbarElement)
    gMsgHeadersToolbarElement = document.getElementById("MsgHeadersToolbar");

  return gMsgHeadersToolbarElement;
}

function BounceStartup(aParams)
{
  var params = null; // New way to pass parameters to the compose window as a nsIMsgComposeParameters object
  var args = null;   // old way, parameters are passed as a string

  if (aParams) {
    params = aParams;
  } else {
    if (window.arguments && window.arguments[0]) {
      try {
        if (window.arguments[0] instanceof Ci.nsIMsgComposeParams) {
          params = window.arguments[0];
        }
      } catch(ex) {
        dump("ERROR with parameters: " + ex + "\n");
      }

/*
      // if still no dice, try and see if the params is an old fashioned list of string attributes
      // XXX can we get rid of this yet?
      if (!params) {
        args = GetArgs(window.arguments[0]);
      }
*/
    }
  }

  // Set a sane starting width/height for all resolutions on new profiles.
  // Do this before the window loads.
  if (!document.documentElement.hasAttribute("width")) {
    // Prefer 600x350.
    let defaultHeight = Math.min(screen.availHeight, 350);
    let defaultWidth = Math.min(screen.availWidth, 600);

    // On small screens, default to maximized state.
    if (defaultHeight < 350) {
      document.documentElement.setAttribute("sizemode", "maximized");
    }

    document.documentElement.setAttribute("width", defaultWidth);
    document.documentElement.setAttribute("height", defaultHeight);
    // Make sure we're safe at the left/top edge of screen
    document.documentElement.setAttribute("screenX", screen.availLeft);
    document.documentElement.setAttribute("screenY", screen.availTop);
  }

  let identityList = GetMsgIdentityElement();
  if (identityList) {
    FillIdentityList(identityList);
  }

  if (!params) {
    // This code will go away soon as now arguments are passed to the window using a object of type nsMsgComposeParams instead of a string

    params = Cc["@mozilla.org/messengercompose/composeparams;1"].
             createInstance(Ci.nsIMsgComposeParams);
    params.composeFields = Cc["@mozilla.org/messengercompose/composefields;1"].
                           createInstance(Ci.nsIMsgCompFields);

    if (args) {
      //Convert old fashion arguments into params
      var composeFields = params.composeFields;
      if (args.preselectid) {
        params.identity = getIdentityForKey(args.preselectid);
      }
      if (args.from) {
        composeFields.from = args.from;
      }
      if (args.to) {
        composeFields.to = args.to;
      }
      if (args.cc) {
        composeFields.cc = args.cc;
      }
      if (args.bcc) {
        composeFields.bcc = args.bcc;
      }
    }
  }

  // Detect correct identity when missing or mismatched.
  // An identity with no email is likely not valid.
  let from = [];
  if (params.composeFields.from) {
    from = MailServices.headerParser.parseEncodedHeader(
      params.composeFields.from,
      null
    );
  }
  from =
    from.length && from[0] && from[0].email
      ? from[0].email.toLowerCase().trim()
      : null;

  // " <>" is an empty identity, and most likely not valid
  if (!params.identity ||
      !params.identity.email ||
      (from && !emailSimilar(from, params.identity.email))) {
    let identities = MailServices.accounts.allIdentities;
    let suitableCount = 0;

    // Search for a matching identity.
    if (from) {
      for (let ident of identities) {
        if (ident.email && from == ident.email.toLowerCase()) {
          if (suitableCount == 0) {
            params.identity = ident;
          }
          suitableCount++;
          if (suitableCount > 1) {
            // No need to find more, it's already not unique.
            break;
          }
        }
      }
    }

    if (!params.identity || !params.identity.email) {
      let identity = null;
      // No preset identity and no match, so use the default account.
      let defaultAccount = MailServices.accounts.defaultAccount;
      if (defaultAccount) {
        identity = defaultAccount.defaultIdentity;
      }
      if (!identity) {
        // Get the first identity we have in the list.
        let identitykey = identityList
          .getItemAtIndex(0)
          .getAttribute("identitykey");
        identity = MailServices.accounts.getIdentity(identitykey);
      }
      params.identity = identity;
    }
  }

  identityList.selectedItem = identityList.getElementsByAttribute(
    "identitykey",
    params.identity.key
  )[0];

  LoadIdentity(true);

  if (window.arguments) {
    mstate.selectedURIs = window.arguments[0];
    if (mstate.selectedURIs) {
      mstate.size = mstate.selectedURIs.length;
      clearMState();
      var msgHdr = GetMsgHdrForUri(mstate.selectedURIs[0]);
      if (msgHdr) {
        msgSubject = msgHdr.mime2DecodedSubject;
        if (msgSubject) {
          let bounceMsgsBundle = Services.strings.createBundle("chrome://mailredirect/locale/mailredirect-compose.properties");
          document.title = bounceMsgsBundle.GetStringFromName("mailredirectWindowTitlePrefix") + " " + msgSubject;
          //document.title = messenger.i18n.getMessage("mailredirectWindowTitle", msgSubject, "Thunderbird");
        }
      }
    }
  }

  gMsgCompose = MailServices.compose.initCompose(params, window);

  // fill threadTree with information about bounced mails

  if (mstate.selectedURIs) {
    var aTree = document.getElementById("topTreeChildren");

    var messenger = Cc["@mozilla.org/messenger;1"].
                    createInstance(Ci.nsIMessenger);

    var locale = undefined;
    var dateFormatService = undefined;

    var dateFormatDefault  = getPref("mail.ui.display.dateformat.default");
    var dateFormatThisWeek = getPref("mail.ui.display.dateformat.thisweek");
    var dateFormatToday    = getPref("mail.ui.display.dateformat.today");

    if (dateFormatDefault === null) {
      dateFormatDefault = kDateFormatShort;
    }
    if (dateFormatThisWeek === null) {
      dateFormatThisWeek = kDateFormatShort;
    }
    if (dateFormatToday === null) {
      dateFormatToday = kDateFormatNone;
    }

    var today = new Date();

    for (let i = 0; i < mstate.size; ++i) {
      var aRow = document.createXULElement("treerow");
      aRow.setAttribute("messageURI", mstate.selectedURIs[i]);
      aRow.setAttribute("URIidx", i);
      aRow.setAttribute("disableonsend", true);

      dumper.dump("[" + i + "] " + mstate.selectedURIs[i]);
      var msgService = messenger.messageServiceFromURI(mstate.selectedURIs[i]);
      var msgSubject = "";
      var msgAuthor = "";
      var msgDate = null;
      var propertiesString = "";
      var msgHdr = GetMsgHdrForUri(mstate.selectedURIs[i]);
      if (msgHdr) {
        msgSubject = msgHdr.mime2DecodedSubject;
        msgAuthor = msgHdr.mime2DecodedAuthor;
        msgDate = msgHdr.date;
        if (isNewsURI(mstate.selectedURIs[i])) {
          propertiesString += " news";
        }
        if (msgHdr.flags & 0x0001) {
          propertiesString += " read";
        }
        if (msgHdr.flags & 0x0002) {
          propertiesString += " replied";
        }
        if (msgHdr.flags & 0x1000) {
          propertiesString += " forwarded";
        }
        if (msgHdr.flags & 0x10000) {
          propertiesString += " new";
        }
        if (/(?:^| )redirected(?: |$)/.test(msgHdr.getStringProperty("keywords"))) {
          propertiesString += " kw-redirected";
        }
      } else {
        if (currMsgWindow && currMsgWindow.messageHeaderSink) {
          msgHdr = currMsgWindow.messageHeaderSink.dummyMsgHeader;
          if (msgHdr) {
            msgSubject = msgHdr.subject;
            msgAuthor = msgHdr.author;
          }
        }
      }

      var aCell = document.createXULElement("treecell");
      aCell.setAttribute("label", msgSubject);
      aCell.setAttribute("properties", propertiesString);
      aRow.appendChild(aCell);

      aCell = document.createXULElement("treecell");
      aCell.setAttribute("label", msgAuthor);
      aRow.appendChild(aCell);

      aCell = document.createXULElement("treecell");
      var dateString = "";
      if (msgDate) {
        var date = new Date();
        date.setTime(msgDate / 1000);

        var dateFormat = dateFormatDefault;
        if (date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate()) {
          dateFormat = dateFormatToday;
        } else if (today > date) {
          var todaysMilliSeconds = today.getTime() % PR_MSEC_PER_DAY;
          var mostRecentMidnight = today.getTime() - todaysMilliSeconds;
          var mostRecentWeek = mostRecentMidnight - 6*PR_MSEC_PER_DAY;
          // was the message sent during the last week?
          if (date.getTime() >= mostRecentWeek) {
            dateFormat = dateFormatThisWeek;
          }
        }
        if (locale === undefined) {
          var useOSLocales = getPref("intl.regional_prefs.use_os_locales");
          if (useOSLocales) {
            var osprefs = Cc["@mozilla.org/intl/ospreferences;1"].
                          getService(Ci.mozIOSPreferences);
            locale = osprefs.regionalPrefsLocales[0];
          } else {
            locale = null;
          }
        }
        var dateOption = {dateStyle: "short", timeStyle: "short"};
        if (dateFormat === kDateFormatNone) {
          dateOption = {timeStyle: "short"};
        } else if (dateFormat === kDateFormatLong) {
          dateOption = {dateStyle: "long", timeStyle: "short"};
        } else if (dateFormat === kDateFormatShort) {
          dateOption = {dateStyle: "short", timeStyle: "short"};
        } else if (dateFormat === kDateFormatYearMonth) {
          dateOption = {year: "numeric", month: "2-digit", hour: "numeric", minute: "numeric"};
        } else if (dateFormat === kDateFormatWeekday) {
          dateOption = {weekday: "short", hour: "numeric", minute: "numeric"};
        }
        dateString = new Services.intl.DateTimeFormat(locale, dateOption).format(date);
      }
      aCell.setAttribute("label", dateString);
      aRow.appendChild(aCell);

      var aItem = document.createXULElement("treeitem");
      aItem.appendChild(aRow);
      aTree.appendChild(aItem);
    }
  }

  window.controllers.appendController(MailredirectWindowController);

  updateEditableFields(false);
  AdjustFocus();
  setTimeout(function() { awFitDummyRows() }, 0);

  window.onresize = function() {
    // dumper.dump("window.onresize func");
    awFitDummyRows();
  }

  // Before and after callbacks for the customizeToolbar code
  var toolbox = document.getElementById("bounce-toolbox");
  toolbox.customizeDone = function(aEvent) { MailToolboxCustomizeDone(aEvent, "CustomizeMailredirectToolbar"); };

  var toolbarset = document.getElementById("customToolbars");
  toolbox.toolbarset = toolbarset;

  awSetAutoComplete(1); // somehow this doesn't get set otherwise
  awInitializeNumberOfRowsShown();

  var event = document.createEvent("Events");
  event.initEvent("compose-window-init", false, true);
  document.getElementById("msgMailRedirectWindow").dispatchEvent(event);

  // Change the Address Book button to the Contacts button in the toolbar on first run
  let firstRunPref = "extensions.mailredirect.firstrun.button-contacts";
  if (!getPref(firstRunPref)) {
    Services.prefs.setBoolPref(firstRunPref, true);
    var toolbar = document.getElementById("bounceToolbar");
    var before = null;
    let buttonContacts = document.getElementById("button-contacts")
    if (!buttonContacts || buttonContacts.parentNode !== toolbar) {
      let buttonAddressBook = document.getElementById("button-address");
      if (buttonAddressBook && buttonAddressBook.parentNode === toolbar) {
        before = buttonAddressBook.nextElementSibling;
        toolbar.removeChild(buttonAddressBook);
      }
      toolbar.insertItem("button-contacts", before);
      toolbar.setAttribute("currentset", toolbar.currentSet);
      if (typeof Services.xulStore === "object" && typeof Services.xulStore.persist === "function") {
        Services.xulstore.persist(toolbar, "currentset");
      } else {
        document.persist(toolbar.id, "currentset");
      }
    }
  }

  // finally, see if we need to auto open the address sidebar.
  var sideBarBox = document.getElementById("sidebar-box");
  if (sideBarBox.getAttribute("sidebarVisible") === "true") {
    // if we aren't supposed to have the side bar hidden, make sure it is visible
    if (document.getElementById("sidebar").getAttribute("src") === "") {
      setTimeout(toggleAddressPicker, 100);   // do this on a delay so we don't hurt perf. on bringing up a new bounce window
    }
  }

  // Update the status of the redirect button (in case default recipients are specified)
  updateSendCommands(false);
}

function WizCallback(state)
{
  if (state){
    BounceStartup(null);
  } else {
    // The account wizard is still closing so we can't close just yet
    setTimeout(MsgComposeCloseWindow, 0, false); // Don't recycle a bogus window
  }
}

function MsgComposeCloseWindow()
{
  if (gMsgCompose) {
    gMsgCompose.CloseWindow();
  } else {
    window.close();
  }
}

/**
 * Expands mailinglists found in the recipient fields.
 */
function expandRecipients()
{
  gMsgCompose.expandMailingLists();
}

function BounceLoad()
{
  gAccountManager = Cc["@mozilla.org/messenger/account-manager;1"].
                    getService(Ci.nsIMsgAccountManager);
  var windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].
                       getService(Ci.nsIWindowMediator);
  var mail3paneWindow = windowMediator.getMostRecentWindow("mail:3pane");
  var currMsgWindow = windowMediator.getMostRecentWindow("mail:messageWindow");

  var appInfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo);
  gAppInfoPlatformVersion = parseInt(appInfo.platformVersion.replace(/\..*/,''));

  setupAutocomplete();

  try {
    // This will do migration, or create a new account if we need to.
    // We also want to open the account wizard if no identities are found
    var state = verifyAccounts(WizCallback, true);
    if (state) {
      BounceStartup(null);
    }
  } catch (ex) {
    Components.utils.reportError(ex);
    let bounceMsgsBundle = Services.strings.createBundle("chrome://mailredirect/locale/mailredirect-compose.properties");
    let errorTitle = bounceMsgsBundle.GetStringFromName("initErrorDlogTitle");
    let errorMsg = bounceMsgsBundle.GetStringFromName("initErrorDlogMessage");
    Services.prompt.alert(window, errorTitle, errorMsg);
    DoCommandClose();
    return;
  }

  // Check to see if CardBook or TbSync is installed in order to modify autocomplete
  let addonCallback = function(aAddon) {
    if (aAddon !== null) {
      let cardbookExclusive = false;
      if (aAddon.filter(function(e) { return e !== null && e.id === "cardbook@vigneau.philippe" && e.isActive; }).length > 0) {
        var cardbookAutocompletion = getPref("extensions.cardbook.autocompletion");
        if (cardbookAutocompletion) {
          cardbookExclusive = getPref("extensions.cardbook.exclusive");
          var listitem = 1;
          var textbox = document.getElementById("addressCol2#" + listitem);
          while (textbox !== null) {
            // listitems can already be cloned, so we need to adjust them all
            if (cardbookExclusive) {
              textbox.setAttribute("autocompletesearch", "addrbook-cardbook");
            } else {
              var autocompletesearch = textbox.getAttribute("autocompletesearch");
              textbox.setAttribute("autocompletesearch", "addrbook-cardbook " + autocompletesearch);
            }
            listitem++;
            var textbox = document.getElementById("addressCol2#" + listitem);
          }
        }
      }
      if (!cardbookExclusive && aAddon.filter(function(e) { return e != null && e.id === "tbsync@jobisoft.de" && e.isActive; }).length > 0) {
        var listitem = 1;
        var textbox = document.getElementById("addressCol2#" + listitem);
        while (textbox !== null) {
          var autocompletesearch = textbox.getAttribute("autocompletesearch");
          textbox.setAttribute("autocompletesearch", autocompletesearch + " tbSyncAutoCompleteSearch");
          listitem++;
          var textbox = document.getElementById("addressCol2#" + listitem);
        }
      }
    }
  }

  AddonManager.getAddonsByIDs(["cardbook@vigneau.philippe", "tbsync@jobisoft.de"]).then(addon => { addonCallback(addon); });

  // copy toolbar appearance settings from mail3pane
  if (mail3paneWindow) {
    var aBounceToolbar = document.getElementById("bounceToolbar");
    if (aBounceToolbar) {
      var mailBar = mail3paneWindow.document.getElementById("mail-bar");
      if (mailBar) {
        aBounceToolbar.setAttribute("iconsize", mailBar.getAttribute("iconsize"));
        aBounceToolbar.setAttribute("mode", mailBar.getAttribute("mode"));
      }
    }
  }

  awInitializeNumberOfRowsShown();

  // get defaults for Resent-To, Resent-Cc and Resent-Bcc from preferences
  var defaultResentToString  = "";
  var defaultResentCcString  = "";
  var defaultResentBccString = "";
  try {
    defaultResentToString  = Services.prefs.getCharPref("extensions.mailredirect.defaultResentTo").replace(/^\s+|\s+$/g, "");
    defaultResentCcString  = Services.prefs.getCharPref("extensions.mailredirect.defaultResentCc").replace(/^\s+|\s+$/g, "");
    defaultResentBccString = Services.prefs.getCharPref("extensions.mailredirect.defaultResentBcc").replace(/^\s+|\s+$/g, "");
  } catch (ex) {
    // do nothing...
  }

  // set defaults for Resent-To, Resent-Cc and Resent-Bcc in the bounce dialog
  if (!(defaultResentToString.match(/^\s*$/) &&
        defaultResentCcString.match(/^\s*$/) &&
        defaultResentBccString.match(/^\s*$/))) {
    var addr;
    if (defaultResentToString !== "") {
      var defaultResentToArray = defaultResentToString.split(",");
      for (var idx in defaultResentToArray) {
        addr = defaultResentToArray[idx].replace(/^\s+|\s+$/g, "");
        if (addr !== "") {
          awAddRecipient("addr_to", addr);
        }
      }
    }
    if (defaultResentCcString !== "") {
      var defaultResentCcArray = defaultResentCcString.split(",");
      for (var idx in defaultResentCcArray) {
        addr = defaultResentCcArray[idx].replace(/^\s+|\s+$/g, "");
        if (addr !== "") {
          awAddRecipient("addr_cc", addr);
        }
      }
    }
    if (defaultResentBccString !== "") {
      var defaultResentBccArray = defaultResentBccString.split(",");
      for (var idx in defaultResentBccArray) {
        addr = defaultResentBccArray[idx].replace(/^\s+|\s+$/g, "");
        if (addr !== "") {
          awAddRecipient("addr_bcc", addr);
        }
      }
    }
  } else {
    var menulist = document.getElementById("addressCol1#1");
    var defaultMode = getPref("extensions.mailredirect.defaultMode");
    menulist.value = defaultMode;
  }
  awFitDummyRows();

  try {
    // XXX: We used to set commentColumn on the initial auto complete column after the document has loaded
    // inside of setupAutocomplete. But this happens too late for the first widget and it was never showing
    // the comment field. Try to set it before the document finishes loading:
    if (getPref("mail.autoComplete.commentColumn")) {
      document.getElementById("addressCol2#1").showCommentColumn = true;
    }
  } catch (ex) {
    // do nothing...
  }
}

function AdjustFocus()
{
  let element = awGetInputElement(awGetNumberOfRecipients());
  if (element.value === "") {
    awSetFocusTo(element);
  }
}

function BounceUnload()
{
  // dumper.dump("\nBounceUnload\n");

  if (msgWindow) {
    msgWindow.closeWindow();
  }
  ReleaseGlobalVariables();
}

/**
 * Disables or enables editable elements in the window.
 * The elements to operate on are marked with the "disableonsend" attribute.
 * This includes elements like the address list, attachment list, subject
 * and message body.
 *
 * @param aDisable  true = disable items. false = enable items.
 */
function updateEditableFields(aDisable)
{
  let elements = document.querySelectorAll("[disableonsend=\"true\"]");
  for (let i = 0; i < elements.length; i++) {
    elements[i].disabled = aDisable;
  }
}

function ExitFullscreenMode()
{
  // On OS X we need to deliberately exit full screen mode before closing.
  if (AppConstants.platform === "mac") {
    window.fullscreen = false;
  }
}

function DoCommandClose()
{
  window.MeteorsStatus = null;
  window.msgSendListener = null;
  window.msgStatusFeedback = null

  for (var i = 0; i < mstate.size; ++i) {
    if (mstate.sendOperationInProgress[i]) {
      dumper.dump("aborting mail no " + i);
      mstate.msgSendObj[i].abort();
    }
  }
  clearMState();
  ExitFullscreenMode();
  window.close();
  return false;
}

function DoForwardBounceWithCheck()
{
  var warn = getPref("mail.warn_on_send_accel_key");

  if (warn) {
    var checkValue = {value: false};
    let bounceMsgsBundle = Services.strings.createBundle("chrome://mailredirect/locale/mailredirect-compose.properties");
    let pluralRule = bounceMsgsBundle.GetStringFromName("pluralRule");
    let [get, numForms] = PluralForm.makeGetter(pluralRule);
    let selectedCount = mstate.size;
    let textValue = bounceMsgsBundle.GetStringFromName("sendMessageCheckWindowTitleMsgs");
    let windowTitle = PluralForm.get(selectedCount, textValue);
    textValue = bounceMsgsBundle.GetStringFromName("sendMessageCheckLabelMsgs");
    let label = get(selectedCount, textValue);

    var buttonPressed = Services.prompt.confirmEx(window, windowTitle, label,
      (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
      (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1),
      bounceMsgsBundle.GetStringFromName("sendMessageCheckSendButtonLabel"),
      null, null,
      bounceMsgsBundle.GetStringFromName("CheckMsg"),
      checkValue);
    if (buttonPressed !== 0) {
      return;
    }
    if (checkValue.value) {
      Services.prefs.setBoolPref("mail.warn_on_send_accel_key", false);
    }
  }
  DoForwardBounce();
}

function DoForwardBounce()
{
  mailredirectRecipients = null;

  let msgCompFields = gMsgCompose.compFields;
  Recipients2CompFields(msgCompFields);
  if (!msgCompFields.hasRecipients) {
    let bounceMsgsBundle = Services.strings.createBundle("chrome://mailredirect/locale/mailredirect-compose.properties");
    let errorTitle = bounceMsgsBundle.GetStringFromName("noRecipientsTitle");
    let errorMsg = bounceMsgsBundle.GetStringFromName("noRecipientsMessage");
    Services.prompt.alert(window, errorTitle, errorMsg);
    return;
  }
  if (mstate.size === 0) {
    let bounceMsgsBundle = Services.strings.createBundle("chrome://mailredirect/locale/mailredirect-compose.properties");
    let errorTitle = bounceMsgsBundle.GetStringFromName("noMessagesTitle");
    let errorMsg = bounceMsgsBundle.GetStringFromName("noMessagesMessage");
    Services.prompt.alert(window, errorTitle, errorMsg);
    return;
  }
  // clear some variables
  aSender = null;
  clearMState();
  RealBounceMessages();
}

// we can drag and drop addresses and messages into the mailredirect envelope
var mailredirectDragObserver = {

  canHandleMultipleItems: true,

  onDrop: function (aEvent, aData, aDragSession) {
    var aTree = document.getElementById("topTreeChildren");
    if (!aTree.disabled) {
      var dataList = aData.dataList;
      var dataListLength = dataList.length;
      var errorTitle;
      var attachment;
      var errorMsg;

      var locale = undefined;
      var dateFormatService = undefined;

      var dateFormatDefault  = getPref("mail.ui.display.dateformat.default");
      var dateFormatThisWeek = getPref("mail.ui.display.dateformat.thisweek");
      var dateFormatToday    = getPref("mail.ui.display.dateformat.today");

      if (dateFormatDefault === null) {
        dateFormatDefault = kDateFormatShort;
      }
      if (dateFormatThisWeek === null) {
        dateFormatThisWeek = kDateFormatShort;
      }
      if (dateFormatToday === null) {
        dateFormatToday = kDateFormatNone;
      }

      var today = new Date();

      for (var i = 0; i < dataListLength; i++) {
        var item = dataList[i].first;
        var prettyName;
        var size;
        var rawData = item.data;

        if (item.flavour.contentType === "text/x-moz-message") {
          if (mstate.selectedURIs.indexOf(rawData) === -1) {
            var i = mstate.size++;
            mstate.selectedURIs.push(rawData);
            dumper.dump("[" + i + "] " + mstate.selectedURIs[i]);

            var aRow = document.createXULElement("treerow");
            aRow.setAttribute("messageURI", rawData);
            aRow.setAttribute("URIidx", i);
            aRow.setAttribute("disableonsend", true);

            var msgService = gMessenger.messageServiceFromURI(mstate.selectedURIs[i]);
            var msgSubject = "";
            var msgAuthor = "";
            var msgDate = null;
            var propertiesString = "";
            var msgHdr = GetMsgHdrForUri(mstate.selectedURIs[i]);
            if (msgHdr) {
              msgSubject = msgHdr.mime2DecodedSubject;
              msgAuthor = msgHdr.mime2DecodedAuthor;
              msgDate = msgHdr.date;
              if (isNewsURI(mstate.selectedURIs[i])) {
                propertiesString += " news";
              }
              if (msgHdr.flags & 0x0001) {
                propertiesString += " read";
              }
              if (msgHdr.flags & 0x0002) {
                propertiesString += " replied";
              }
              if (msgHdr.flags & 0x1000) {
                propertiesString += " forwarded";
              }
              if (msgHdr.flags & 0x10000) {
                propertiesString += " new";
              }
              if (/(?:^| )redirected(?: |$)/.test(msgHdr.getStringProperty("keywords"))) {
                propertiesString += " kw-redirected";
              }
            } else {
              if (currMsgWindow && currMsgWindow.messageHeaderSink) {
                msgHdr = currMsgWindow.messageHeaderSink.dummyMsgHeader;
                if (msgHdr) {
                  msgSubject = msgHdr.subject;
                  msgAuthor = msgHdr.author;
                }
              }
            }

            var aCell = document.createXULElement("treecell");
            aCell.setAttribute("label", msgSubject);
            aCell.setAttribute("properties", propertiesString);
            aRow.appendChild(aCell);

            aCell = document.createXULElement("treecell");
            aCell.setAttribute("label", msgAuthor);
            aRow.appendChild(aCell);

            aCell = document.createXULElement("treecell");
            var dateString = "";
            if (msgDate) {
              var date = new Date();
              date.setTime(msgDate / 1000);

              var dateFormat = dateFormatDefault;
              if (date.getFullYear() === today.getFullYear() &&
                  date.getMonth() === today.getMonth() &&
                  date.getDate() === today.getDate()) {
                dateFormat = dateFormatToday;
              } else if (today > date) {
                var todaysMilliSeconds = today.getTime() % PR_MSEC_PER_DAY;
                var mostRecentMidnight = today.getTime() - todaysMilliSeconds;
                var mostRecentWeek = mostRecentMidnight - 6*PR_MSEC_PER_DAY;
                // was the message sent during the last week?
                if (date.getTime() >= mostRecentWeek) {
                  dateFormat = dateFormatThisWeek;
                }
              }
              if (locale === undefined) {
                var useOSLocales = getPref("intl.regional_prefs.use_os_locales");
                if (useOSLocales) {
                  var osprefs = Cc["@mozilla.org/intl/ospreferences;1"].
                                getService(Ci.mozIOSPreferences);
                  locale = osprefs.regionalPrefsLocales[0];
                } else {
                  locale = null;
                }
              }
              var dateOption = {dateStyle: "short", timeStyle: "short"};
              if (dateFormat === kDateFormatNone) {
                dateOption = {timeStyle: "short"};
              } else if (dateFormat === kDateFormatLong) {
                dateOption = {dateStyle: "long", timeStyle: "short"};
              } else if (dateFormat === kDateFormatShort) {
                dateOption = {dateStyle: "short", timeStyle: "short"};
              } else if (dateFormat === kDateFormatYearMonth) {
                dateOption = {year: "numeric", month: "2-digit", hour: "numeric", minute: "numeric"};
              } else if (dateFormat === kDateFormatWeekday) {
                dateOption = {weekday: "short", hour: "numeric", minute: "numeric"};
              }
              dateString = new Services.intl.DateTimeFormat(locale, dateOption).format(date);
            }
            aCell.setAttribute("label", dateString);
            aRow.appendChild(aCell);

            var aItem = document.createXULElement("treeitem");
            aItem.appendChild(aRow);
            aTree.appendChild(aItem);
          }
        } else if (item.flavour.contentType === "text/x-moz-address") {
          // process the address
          if (rawData) {
            DropRecipient(aEvent.target, rawData);

            // Since we are now using ondrop (eDrop) instead of previously using
            // ondragdrop (eLegacyDragDrop), we must prevent the default
            // which is dropping the address text into the widget.
            // Note that stopPropagation() is called by our caller in
            // nsDragAndDrop.js.
            aEvent.preventDefault();
          }
        }
      }
    }
  },

  onDragOver: function (aEvent, aFlavour, aDragSession) { },

  onDragExit: function (aEvent, aDragSession) { },

  getSupportedFlavours: function () {
    var flavourSet = new FlavourSet();
    flavourSet.appendFlavour("text/x-moz-address");
    flavourSet.appendFlavour("text/x-moz-message");
    return flavourSet;
  }
};

/**********************************************
  **********************************************/

function createTempFile()
{
  var dirService =  Cc["@mozilla.org/file/directory_service;1"].
                    getService(Ci.nsIProperties)
  var tmpDir = dirService.get("TmpD", Ci.nsIFile)

  var file = Cc["@mozilla.org/file/local;1"].
             createInstance(Ci.nsIFile);
  file.initWithPath(tmpDir.path);
  file.appendRelativePath("mailredirect.tmp");

  try {
    file.createUnique(file.NORMAL_FILE_TYPE, parseInt("0600", 8));
  } catch(ex) {
    return null;
  }

  return file;
}

function FileSpecFromLocalFile(localfile)
{
  var filespec = Cc["@mozilla.org/filespec;1"].createInstance(Ci.nsIFileSpec);
  filespec.nativePath = localfile.path;
  return filespec;
}

function encodeMimePartIIStr_UTF8(aHeader, aFieldNameLen)
{
  return MailServices.mimeConverter.encodeMimePartIIStr_UTF8(aHeader, true, aFieldNameLen,
                                                             Ci.nsIMimeConverter.MIME_ENCODED_WORD_SIZE);
}

function encodeMimeHeader(header)
{
  let fieldNameLen = (header.indexOf(": ") + 2);
  if (header.length <= MAX_HEADER_LENGTH) {
    header = header.replace(/\r\n$/, ""); // Don't encode closing end of line
    return header.substr(0, fieldNameLen) + // and don't encode field name
           encodeMimePartIIStr_UTF8(header.substr(fieldNameLen), fieldNameLen) + "\r\n";
  } else {
    header = header.replace(/\r\n$/, "");
    let fieldName = header.substr(0, fieldNameLen);
    let splitHeader = "";
    let currentLine = "";
    while (header.length > MAX_HEADER_LENGTH - 2) {
      let splitPos = header.substr(0, MAX_HEADER_LENGTH - 2).lastIndexOf(","); // Try to split before MAX_HEADER_LENGTH
      if (splitPos === -1) {
        splitPos = header.indexOf(","); // If that fails, split at first possible position
      }
      if (splitPos === -1) {
        currentLine = header;
        header = "";
      } else {
        currentLine = header.substr(0, splitPos);
        if (header.charAt(splitPos + 1) === " ") {
          header = fieldName + header.substr(splitPos + 2);
        } else {
          header = fieldName + header.substr(splitPos + 1);
        }
      }
      splitHeader += currentLine.substr(0, fieldNameLen) + // Don't encode field name
                     encodeMimePartIIStr_UTF8(currentLine.substr(fieldNameLen), fieldNameLen) + "\r\n";
    }
    splitHeader += header.substr(0, fieldNameLen) + // Don't encode field name
                   encodeMimePartIIStr_UTF8(header.substr(fieldNameLen), fieldNameLen) + "\r\n";
    return(splitHeader);
  }
}

function getSender()
{
  if (!aSender) {
    let addresses = MailServices.headerParser.makeFromDisplayAddress(
      document.getElementById("msgIdentity").value
    );
    try {
      // makeMimeHeader changed in TB71 (bug 1562158)
      aSender = MailServices.headerParser.makeMimeHeader(addresses);
    } catch(ex) {
      aSender = MailServices.headerParser.makeMimeHeader(addresses, 1);
    }
  }
  return aSender;
}

function getRecipients(onlyemails)
{
  if (!mailredirectRecipients) {
    var aRecipients_sep = { resendTo: "", resendCc: "", resendBcc: "" };
    var recipients = { resendTo: "", resendCc: "", resendBcc: "" };
    var i = 1, inputField;
    while ((inputField = awGetInputElement(i))) {
      var fieldValue = inputField.value;

      if (fieldValue === null) {
        fieldValue = inputField.getAttribute("value");
      }
      if (fieldValue !== "") {
        var recipientType = awGetPopupElement(i).selectedItem.getAttribute("value");
        var recipient;

        try {
          recipient = MailServices.headerParser.reformatUnquotedAddresses(fieldValue);
        } catch (ex) {
          recipient = fieldValue;
        }
        var recipientType2;
        switch (recipientType) {
          case "addr_to"  : recipientType2 = "resendTo";  break;
          case "addr_cc"  : recipientType2 = "resendCc";  break;
          case "addr_bcc" : recipientType2 = "resendBcc"; break;
        }
        recipients[recipientType2] += aRecipients_sep[recipientType2] + recipient;
        aRecipients_sep[recipientType2] = ",";
      }
      i++;
    }

    mailredirectRecipients = { resendTo : [], resendCc : [], resendBcc : [] };
    for (var recipType in recipients) {
      var emails = {};
      var names = {};
      var fullnames = {};
      var numAddresses = MailServices.headerParser.parseHeadersWithArray(recipients[recipType], emails, names, fullnames);

      // dumper.dump("numAddresses[" + recipType + "]= " + numAddresses);

      for (var i = 0; i < numAddresses; ++i) {
        mailredirectRecipients[recipType][i] = { email: emails.value[i], name: names.value[i], fullname: fullnames.value[i] };
      }
    }
    ResolveMailLists();
    RemoveDupAddresses();
    for (var recipType in mailredirectRecipients) {
      for (var i in mailredirectRecipients[recipType]) {
        mailredirectRecipients[recipType][i].encname = mailredirectRecipients[recipType][i].name;
      }
    }
  }

  var ret = [];
  for (var recipType in mailredirectRecipients) {
    var count = mailredirectRecipients[recipType].length;
    var tmp = [];
    if (onlyemails === true) {
      for (var i = 0; i < count; ++i) {
        tmp[i] = mailredirectRecipients[recipType][i].email;
      }
    } else {
      for (var i = 0; i < count; ++i) {
          tmp[i] = MailServices.headerParser.
                   makeFullAddress(mailredirectRecipients[recipType][i].encname,
                                   mailredirectRecipients[recipType][i].email);
      }
    }

    ret[recipType] = tmp.join(", ");
    // dumper.dump("getRecipients[" + recipType + "]=" + ret[recipType]);
  }
  return ret;
}

function getResentDate()
{
  var now = new Date();
  var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var now_string = days[now.getDay()] + ", " + now.getDate() + " " +
                   months[now.getMonth()] + " " + now.getFullYear() + " ";

  var h = now.getHours();
  if (h < 10) {
    now_string += "0";
  }
  now_string += h + ":";
  var m = now.getMinutes();
  if (m < 10) {
    now_string += "0";
  }
  now_string += m + ":";
  var s = now.getSeconds();
  if (s < 10) {
    now_string += "0";
  }
  now_string += s + " ";

  var tz = now.getTimezoneOffset();
  if (tz > 0) {
    now_string += "-";
  } else {
    now_string += "+";
    tz *= -1;
  }

  var tzh = Math.floor(tz/60);
  if (tzh < 10) {
    now_string += "0";
  }
  now_string += tzh;
  var tzm = tz % 60;
  if (tzm < 10) {
    now_string += "0";
  }
  now_string += tzm;

  return now_string;
}

function getUserAgent()
{
  var useragent = "";
  var pHTTPHandler = Cc["@mozilla.org/network/protocol;1?name=http"].
                     getService(Ci.nsIHttpProtocolHandler);

  if (pHTTPHandler && pHTTPHandler.userAgent) {
    useragent = pHTTPHandler.userAgent;
  } else {
    useragent = window.navigator.userAgent;
  }

  return useragent;
}

function getResentHeaders()
{
  let msgCompFields = gMsgCompose.compFields;
  var resenthdrs = encodeMimeHeader("Resent-From: " + getSender() + "\r\n");
  if (msgCompFields.to) {
    resenthdrs += encodeMimeHeader("Resent-To: " + msgCompFields.to + "\r\n");
  }
  if (msgCompFields.cc) {
    resenthdrs += encodeMimeHeader("Resent-CC: " + msgCompFields.cc + "\r\n");
  }
  if (!msgCompFields.to && !msgCompFields.cc) {
    let composeMsgsBundle = Services.strings.createBundle("chrome://messenger/locale/messengercompose/composeMsgs.properties");
    let undisclosedRecipients = composeMsgsBundle.GetStringFromName("undisclosedRecipients");
    resenthdrs += encodeMimeHeader("Resent-To: " + undisclosedRecipients + ":;" + "\r\n");
  }
  resenthdrs += "Resent-Date: " + getResentDate() + "\r\n";
  var msgID = Cc["@mozilla.org/messengercompose/computils;1"].
              createInstance(Ci.nsIMsgCompUtils).
              msgGenerateMessageId(gCurrentIdentity);
  if (msgID) {
    resenthdrs += "Resent-Message-ID: " + msgID + "\r\n";
  }
  // The Resent-User-Agent header isn't standard, so don't add it by default
  // but only if this (hidden) pref is set
  if (getPref("extensions.mailredirect.addUserAgent", false) === true) {
    var useragent = getUserAgent();
    if (useragent) {
      resenthdrs += "Resent-User-Agent: " + useragent + "\r\n";
    }
  }
  // dumper.dump("resent-headers\n" + resenthdrs);
  return resenthdrs;
}

var msgCompFields;
var concurrentConnections;

function RealBounceMessages()
{
  msgCompFields = gMsgCompose.compFields;
  msgCompFields.from = getSender();
  Recipients2CompFields(msgCompFields);

  expandRecipients();
  // Check if e-mail addresses are complete, in case user turned off
  // autocomplete to local domain.
  if (!CheckValidEmailAddress(msgCompFields)) {
    return;
  }

  var copyToSentMail = true;
  try {
    copyToSentMail = Services.prefs.getBoolPref("extensions.mailredirect.copyToSentMail");
  } catch(ex) { }

  if (!copyToSentMail) {
    msgCompFields.fcc = "nocopy://";
    msgCompFields.fcc2 = "nocopy://";
  }

  ToggleWindowLock(true);

  window.msgSendListener = [];
  window.msgStatusFeedback = [];
  window.MeteorsStatus = new nsMeteorsStatus();

  concurrentConnections = 5;
  try {
    concurrentConnections = Services.prefs.getIntPref("extensions.mailredirect.concurrentConnections");
  } catch(ex) { }

  if (concurrentConnections === 0) {
    concurrentConnections = mstate.size;
  }

  // dumper.dump("concurrentConnections = " + concurrentConnections);

  for (var i = 0; i < concurrentConnections; ++i) {
    RealBounceMessage(i)
  }
  ToggleWindowLock(false);
}

function RealBounceMessage(idx)
{
  if (idx >= mstate.size) {
    return;
  }

  var uri = mstate.selectedURIs[idx];
  dumper.dump("RealBounceMessage(" + uri + ") [" + idx + "]");

  window.msgSendListener[idx] = new nsMsgSendListener(idx);
  window.msgStatusFeedback[idx] = new nsMsgStatusFeedback(idx);

  var localfile = createTempFile();
  if (localfile === null) {
    // mstate.successfulSent[idx] = false;
    dumper.dump("temp localfile for idx = " + idx + " is null.");
    RealBounceMessage(idx+concurrentConnections);
    return;
  }

  var messenger = Cc["@mozilla.org/messenger;1"].
                  createInstance(Ci.nsIMessenger);

  var aScriptableInputStream = Cc["@mozilla.org/scriptableinputstream;1"].
                               createInstance(Ci.nsIScriptableInputStream);
  var aFileOutputStream = Cc["@mozilla.org/network/file-output-stream;1"].
                          createInstance(Ci.nsIFileOutputStream);

  var inHeader = true;
  var skipping = false;
  var leftovers = "";
  var buf = "";
  var line = "";

  var aCopyListener = {
    onStartRequest: function(aRequest, aContext) {
      // write out Resent-* headers
      var resenthdrs = getResentHeaders();
      aFileOutputStream.write(resenthdrs, resenthdrs.length);
    },

    onStopRequest: function(aRequest, aContext, aStatusCode) {
      // write leftovers
      aFileOutputStream.write(leftovers, leftovers.length);
      aFileOutputStream.close();

      if (aStatusCode) {
        // mstate.successfulSent[idx] = false;
        dumper.dump("aCopyListener.onStopRequest(" + aRequest + ", " + aContext + ", " + aStatusCode + ")");
        return;
      }

      // send a message
      var msgSend = Cc["@mozilla.org/messengercompose/send;1"].
                    createInstance(Ci.nsIMsgSend);
      mstate.msgSendObj[idx] = msgSend;

      try {
        msgSend.sendMessageFile(
          gCurrentIdentity,                // in nsIMsgIdentity       aUserIdentity,
          getCurrentAccountKey(),          // char* accountKey,
          msgCompFields,                   // in nsIMsgCompFields     fields,
          localfile,                       // in nsIFile              sendIFile,
          true,                            // in PRBool               deleteSendFileOnCompletion,
          false,                           // in PRBool               digest_p,
          msgSend.nsMsgDeliverNow,         // in nsMsgDeliverMode     mode,
          null,                            // in nsIMsgDBHdr          msgToReplace,
          window.msgSendListener[idx],     // in nsIMsgSendListener   aListener,
          window.msgStatusFeedback[idx],   // in nsIMsgStatusFeedback aStatusFeedback,
          null                             // in string               password
          );
      } catch(ex) {
        dumper.dump("unhandled exception when sending message:\n" + ex);
      }

      var msgSendReport = msgSend.sendReport;
      if (msgSendReport) {
        //var prompt = msgWindow.promptDialog;
        //msgSendReport.displayReport(prompt, false /* showErrorOnly */, true /* dontShowReportTwice */);
      } else {
        /* If we come here it's because we got an error before we could intialize a
           send report! */
        dumper.dump("msgSendReport is null.");
      }
      // msgSend = null;
      // dumper.dump("abc");
    },

    // onDataAvailable lost its context argument in bug 1525319
    // Syntax function(...args) not available before Thunderbird 17, so shift arguments
    onDataAvailable: function(aRequest, aContext, aInputStream, aOffset, aCount) {
      if (aContext instanceof Ci.nsIInputStream) {
        aCount = aOffset;
        aOffset = aInputStream;
        aInputStream = aContext;
        aContext = undefined;
        //dumper.dump("aCopyListener.onDataAvailable(" + aRequest + ", " + aInputStream + ", " + aOffset + ", " + aCount + ")");
      } else {
        //dumper.dump("aCopyListener.onDataAvailable(" + aRequest + ", " + aContext + ", " + aInputStream + ", " + aOffset + ", " + aCount + ")");
      }
      aScriptableInputStream.init(aInputStream);

      if (inHeader) {
        //dumper.dump("!! inHeader reading new buffer, " + aCount + " bytes");
        buf = leftovers + aScriptableInputStream.read(aCount);
        leftovers = "";

        while (buf.length > 0) {
          // find end of line
          var eol = -1;
          var eol_length = -1;
          var eol_r = buf.indexOf("\r");
          var eol_n = buf.indexOf("\n");
          if (eol_r !== -1 && eol_n !== -1) {
            eol = eol_r < eol_n ? eol_r : eol_n;
          } else if (eol_r !== -1) {
            eol = eol_r;
          } else if (eol_n !== -1) {
            eol = eol_n;
          }

          if (eol === -1) {
            // no end of line character in buffer
            // remember this part for the next time
            leftovers = buf;
            // dumper.dump("leftovers=>>"+leftovers+"<<leftovers_end. length=" + leftovers.length);
            break;
          } else {
            // eol character found. find optional pair (\r\n) (\n\r)
            eol_length = 1;

            // try a pair of eol chars
            // dumper.dump("trying pair. eol="+eol);
            if (eol + 1 < buf.length) {
              if ((buf[eol] === "\r" && buf[eol+1] === "\n") ||
                  (buf[eol] === "\n" && buf[eol+1] === "\r")) {
                ++eol;
                ++eol_length;
                // dumper.dump("pair found. eol="+eol);
              }
            } else {
              // pair couldn't be found because of end of buffer
              // dumper.dump("pair couldn't be found. end of buf. eol="+eol+" buf.length="+buf.length);
              leftovers = buf;
              break;
            }
            // terminate the line with CRLF sign, not native line-endings
            line = buf.substr(0, eol+1-eol_length) + "\r\n";
            buf = buf.substr(eol+1);
            // dumper.dump("line=>>"+line+"<<line_end. length=" + line.length);

            if (line === "\r\n") {
              aFileOutputStream.write(line, line.length);
              inHeader = false;
              leftovers = buf;
              break;
            }
          }

          if (skipping) {
            if (line[0] === " " || line[0] === "\t") {
              // dumper.dump("forbidden line:" + line+"<<");
              // continue;
            } else {
              skipping = false;
            }
          }

          // remove sensitive headers (vide: nsMsgSendPart.cpp)
          // From_ line format - http://www.qmail.org/man/man5/mbox.html
          if (/^[>]*From \S+ /.test(line) ||
              /^bcc: /i.test(line) ||
              /^resent-bcc: /i.test(line) ||
              /^fcc: /i.test(line) ||
              /^content-length: /i.test(line) ||
              /^lines: /i.test(line) ||
              /^status: /i.test(line) ||
              /^x-mozilla-status(?:2)?: /i.test(line) ||
              /^x-mozilla-draft-info: /i.test(line) ||
              /^x-mozilla-newshost: /i.test(line) ||
              /^x-uidl: /i.test(line) ||
              /^x-vm-\S+: /i.test(line) ||
              /^return-path: /i.test(line) ||
              /^delivered-to: /i.test(line) ||

              // for drafts
              /^FCC: /i.test(line) ||
              /^x-identity-key: /i.test(line) ||
              /^x-account-key: /i.test(line)) {
            skipping = true;
            // discard line
            // dumper.dump("forbidden line:" + line+"<<");
          }

          if (!skipping) {
            var ret = aFileOutputStream.write(line, line.length);
            if (ret !== line.length) {
              dumper.dump("!! inHeader write error? line len "+ line.length + ", written "+ ret);
            }
          }
        }

        if (!inHeader && leftovers !== "") {
          // convert all possible line terminations to CRLF (required by RFC822)
          leftovers = leftovers.replace(/\r\n|\n\r|\r|\n/g, "\r\n");
          ret = aFileOutputStream.write(leftovers, leftovers.length);
          if (ret !== leftovers.length) {
            dumper.dump("!! inBody write error? leftovers len " + leftovers.length + ", written " + ret);
          }
          leftovers = "";
        }
      } else {
        // out of header -- read the rest and write to file
        buf = leftovers + aScriptableInputStream.read(aCount);
        leftovers = "";
        // convert all possible line terminations to CRLF (required by RFC822)
        buf = buf.replace(/\r\n|\n\r|\r|\n/g, "\r\n");
        ret = aFileOutputStream.write(buf, buf.length);
        if (ret !== buf.length) {
          dumper.dump("!! inBody write error? buf len " + buf.length + ", written " + ret);
        }
        buf = "";
      }
    }
  }

  var msgService = messenger.messageServiceFromURI(uri);

  try {
    aFileOutputStream.init(localfile, -1, parseInt("0600", 8), 0);
  } catch(ex) {
    dumper.dump("aFileOutputStream.init() failed:" + ex);
    // mstate.successfulSent[idx] = false;
    RealBounceMessage(idx+concurrentConnections);
    return;
  }

  var newURI = {};

  msgService.CopyMessage(
      uri,
      aCopyListener,
      false,     // aMoveMessage
      null,      // aUrlListener,
      msgWindow, // msgWindow,
      newURI);

  // dumper.dump("newURI = " + newURI.value.spec);
  newURI = null;
}

// We're going to implement our status feedback for the mail window in JS now.
// the following contains the implementation of our status feedback object

function nsMsgStatusFeedback(idx)
{
  // dumper.dump("nsMsgStatusFeedback(" + idx + ")");
  this.URIidx = idx;
  this.throbber = document.getElementById("throbber-box");
  this.statusTextFld = document.getElementById("statusText");
  this.statusBar = document.getElementById("bounce-progressmeter");
  var treeChildren = document.getElementById("topTreeChildren");
  if (treeChildren) {
    var el = treeChildren.getElementsByAttribute("URIidx", this.URIidx);
    if (el) {
      if (!this.mailredirectTreeCell) {
        this.mailredirectTreeCell = el[0].lastChild;
      }
    }
  }
}

nsMsgStatusFeedback.prototype = {
  // global variables for status / feedback information....
  throbber: null,
  statusTextFld: null,
  statusBar: null,
  mailredirectTreeCell: null,
  URIidx: -1,

  updateStatusText: function() {
    // if all StatusStrings are equal show this string
    // else don't change currently showing statusstring
    var str = mstate.statusStrings[0];
    for (var i = 1; i < mstate.size; ++i) {
      if (str !== mstate.statusStrings[i]) {
        return;
      }
    }
    // dumper.dump("setting status text to: " + str);
    this.statusTextFld.label = str;
  },

  QueryInterface: function(iid) {
    // dumper.dump("nsMsgStatusFeedback.QueryInterface " + iid);
    if (iid.equals(Ci.nsIMsgStatusFeedback) ||
    //  iid.equals(Ci.nsIProgressEventSink) ||
        iid.equals(Ci.nsIWebProgressListener) ||
        iid.equals(Ci.nsISupportsWeakReference) ||
        iid.equals(Ci.nsISupports)) {
      return this;
    }
    throw Components.results.NS_NOINTERFACE;
  },

  // nsIMsgStatusFeedback implementation.
  showStatusString: function(aStatusText) {
    // dumper.dump("[" + this.URIidx + "] " + " showStatusString(" + aStatusText + ")");
    mstate.statusStrings[this.URIidx] = aStatusText;
    this.updateStatusText();
  },

  startMeteors: function() {
    dumper.dump("[" + this.URIidx + "] " + "startMeteors()");
    mstate.statusStrings[this.URIidx] = "";
    mstate.sendOperationInProgress[this.URIidx] = true;

    window.MeteorsStatus.pendingStartRequests++;
    // if we don't already have a start meteor timeout pending
    // and the meteors aren't spinning, then kick off a start
    if (!window.MeteorsStatus.startTimeoutID && !window.MeteorsStatus.meteorsSpinning) {
      window.MeteorsStatus.startTimeoutID = setTimeout(function() { window.MeteorsStatus._startMeteors() }, 0);
      dumper.dump("[" + this.URIidx + "] " + "window.MeteorsStatus.startTimeoutID=" + window.MeteorsStatus.startTimeoutID);
    }

    // since we are going to start up the throbber no sense in processing
    // a stop timeout...
    if (window.MeteorsStatus.stopTimeoutID) {
      clearTimeout(window.MeteorsStatus.stopTimeoutID);
      window.MeteorsStatus.stopTimeoutID = null;
    }
  },

  stopMeteors: function() {
    dumper.dump("[" + this.URIidx + "] " + "stopMeteors()");
    if (mstate) {
      mstate.sendOperationInProgress[this.URIidx] = false;
    }

    if (this.URIidx+concurrentConnections < mstate.size) {
      RealBounceMessage(this.URIidx+concurrentConnections);
    }

    if (window.MeteorsStatus.pendingStartRequests > 0) {
      window.MeteorsStatus.pendingStartRequests--;
    }
    // if we are going to be starting the meteors, cancel the start
    if (window.MeteorsStatus.pendingStartRequests === 0 && window.MeteorsStatus.startTimeoutID) {
      clearTimeout(window.MeteorsStatus.startTimeoutID);
      window.MeteorsStatus.startTimeoutID = null;
    }

    // if we have no more pending starts and we don't have a stop timeout already in progress
    // AND the meteors are currently running then fire a stop timeout to shut them down.
    if (window.MeteorsStatus.pendingStartRequests === 0 && !window.MeteorsStatus.stopTimeoutID) {
      window.MeteorsStatus.stopTimeoutID = setTimeout(function() { window.MeteorsStatus._stopMeteors() }, 0);
      dumper.dump("[" + this.URIidx + "] " + "window.MeteorsStatus.stopTimeoutID=" + window.MeteorsStatus.stopTimeoutID);
    }
  },

  showProgress: function(percentage) {
    dumper.dump("[" + this.URIidx + "] " + "showProgress(" + percentage +")");
    if (percentage >= 0) {
      this.statusBar.setAttribute("mode", "normal");
      this.statusBar.value = percentage;
      this.statusBar.label = Math.round(percentage) + "%";
    }
  },

  closeWindow: function(percent) {
    // dumper.dump("[" + this.URIidx + "] " + "closeWindow(" + percent +")");
  },

  // nsIProgressEventSink implementation
  /*
  onProgress: function(aRequest, aContext, aProgress, aProgressMax) {
    dumper.dump("statusFeedback.onProgress(" + aRequest + ", " + aContext + ", " + aProgress + ", " + aProgressMax);
  },
  onStatus: function(aRequest, aContext, aStatus, aStatusArg) {
    dumper.dump("statusFeedback.onStatus(" + aRequest + ", " + aContext + ", " + aStatus + ", " + aStatusArg);
  }
  */

  // all progress notifications are done through the nsIWebProgressListener implementation...
  onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus) {
    // dumper.dump("[" + this.URIidx + "] " + ". onStateChange(" + aWebProgress + ", " + aRequest + ", " + aStateFlags + ", " + aStatus + ")");
    if (aStateFlags & Ci.nsIWebProgressListener.STATE_START) {
      // dumper.dump("onStateChange STATE_START");
      mstate.sendOperationInProgress[this.URIidx] = true;
      this.mailredirectTreeCell.setAttribute("mode", "undetermined");
      this.statusBar.setAttribute("mode", "undetermined");
    }

    if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
      // dumper.dump("onStateChange STATE_STOP");
      mstate.sendOperationInProgress[this.URIidx] = false;
      this.statusBar.setAttribute("mode", "normal");
      this.statusBar.setAttribute("value", 0);
      this.mailredirectTreeCell.removeAttribute("mode");
      this.mailredirectTreeCell.removeAttribute("value");
      this.statusTextFld.setAttribute("label", "");
    }
  },

  onProgressChange: function(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress) {
    // dumper.dump("[" + this.URIidx + "] " + ". onProgressChange(" + aWebProgress + ", " + aRequest.name + ", " + aCurSelfProgress + ", " + aMaxSelfProgress + ", " + aCurTotalProgress + ", " + aMaxTotalProgress + ")");

    if (aMaxTotalProgress > 0) {
      var percent = (aCurTotalProgress*100)/aMaxTotalProgress;
      if (percent > 100) {
        percent = 100;
      }
      mstate.selectedURIsProgress[this.URIidx] = percent;

      // dumper.dump("[" + this.URIidx + "] " + ". onProgressChange = " + percent);
      percent = Math.round(percent);

      // this.statusBar.removeAttribute("mode");

      // Advance progress meter.
      this.mailredirectTreeCell.setAttribute("value", percent);
      this.updateStatusBar();
    } else {
      // Progress meter should be barber-pole in this case.
      this.statusBar.setAttribute("mode", "undetermined");
      this.mailredirectTreeCell.removeAttribute("mode");
    }
  },

  onLocationChange: function(aWebProgress, aRequest, aLocation) {
    // dumper.dump("[" + this.URIidx + "] " + "onLocationChange(" + aWebProgress + ", " + aRequest + ", " + aLocation + ")");
  },

  onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) {
    // dumper.dump("[" + this.URIidx + "] " + "onStatusChange(" + aWebProgress + ", " + aRequest + ", " + aStatus + ", " + aMessage + ")");
    // Looks like it's possible that we get call while the document has been already delete!
    // therefore we need to protect ourself by using try/catch
    try {
      this.showStatusString(aMessage);
    } catch (ex) { };
  },

  onSecurityChange: function(aWebProgress, aRequest, state) { },

  updateStatusBar: function() {
    var sum = 0;
    for (var i = 0; i < mstate.size; sum += mstate.selectedURIsProgress[i++]) { }
    var percent = Math.round(sum / mstate.size);
    if (percent > 100) {
      percent = 100;
    }

    this.statusBar.setAttribute("value", percent);
    //dumper.dump("updateStatusBar = " + percent);
  }
}

function nsMeteorsStatus()
{
  dumper.dump("nsMeteorsStatus");
  this.throbber = document.getElementById("throbber-box");
  this.statusTextFld = document.getElementById("statusText");
  this.statusBar = document.getElementById("bounce-progressmeter");
  this.progressBarContainer = document.getElementById("statusbar-progresspanel");
}

nsMeteorsStatus.prototype = {
  pendingStartRequests: 0,
  startTimeoutID: null,
  stopTimeoutID: null,
  meteorsSpinning: false,
  throbber: null,
  statusTextFld: null,
  statusBar: null,
  progressBarContainer: null,

  _startMeteors: function() {
    dumper.dump("_startMeteors");

    this.meteorsSpinning = true;
    this.startTimeoutID = null;

    // Turn progress meter on.
    if (this.statusBar) {
      this.statusBar.setAttribute("mode", "undetermined");
      this.progressBarContainer.removeAttribute("collapsed");
    }

    // start the throbber
    if (this.throbber) {
      this.throbber.setAttribute("busy", true);
    }
  },

  _stopMeteors: function() {
    dumper.dump("_stopMeteors");

    let bounceMsgsBundle = Services.strings.createBundle("chrome://mailredirect/locale/mailredirect-compose.properties");

    // if all mails successfully
    var success = true;
    for (var i = 0; success && i < mstate.size; ++i) {
      success &= mstate.successfulSent[i];
    }

    dumper.dump("_stopMeteors: successfully sent all messages? " + success);

    let numMessages = mstate.size;
    let pluralRule = bounceMsgsBundle.GetStringFromName("pluralRule");
    let [get, numForms] = PluralForm.makeGetter(pluralRule);
    var msg;
    if (success) {
      msg = get(numMessages, bounceMsgsBundle.GetStringFromName("sendMessageSuccessfulMsgs"));
    } else {
      msg = get(numMessages, bounceMsgsBundle.GetStringFromName("sendMessageFailedMsgs"));
    }
    this.statusTextFld.label = msg;

    // stop the throbber
    if (this.throbber) {
      this.throbber.setAttribute("busy", false);
    }

    // Turn progress meter off.
    if (this.statusBar) {
      this.progressBarContainer.setAttribute("collapsed", "true");
      this.statusBar.setAttribute("mode", "normal");
      this.statusBar.value = 0;  // be sure to clear the progress bar
      this.statusBar.label = "";
    }

    this.meteorsSpinning = false;
    this.stopTimeoutID = null;

    if (success) {
      goDoCommand("cmd_mailredirect_close");
    } else {
      var treeChildren = document.getElementById("topTreeChildren");
      if (treeChildren) {
        var el = treeChildren.getElementsByAttribute("mode", "normal");
        for (var i = 0; i < el.length; ++i) {
          try {
            el.removeAttribute("mode");
          } catch(ex) { }
        }
      }
    }
  }
}

function nsMsgSendListener(idx)
{
  this.URIidx = idx;
}

nsMsgSendListener.prototype = {
  URIidx: -1,
  mailredirectTreeRow: null,
  mailredirectTreeCell: null,

  ensureStatusFields: function() {
    // dumper.dump("msgSendListener.ensureStatusFields");
    if (!this.mailredirectTreeRow || !this.mailredirectTreeCell) {
      var treeChildren = document.getElementById("topTreeChildren");
      if (treeChildren) {
        var el = treeChildren.getElementsByAttribute("URIidx", this.URIidx);
        if (el) {
          if (!this.mailredirectTreeRow) {
            this.mailredirectTreeRow = el[0];
          }
          if (!this.mailredirectTreeCell) {
            this.mailredirectTreeCell = el[0].lastChild;
          }
        }
      }
    }
  },

  QueryInterface: function(iid) {
    // dumper.dump("nsMsgSendListener.QueryInterface " + iid);
    if (iid.equals(Ci.nsIMsgSendListener) ||
        iid.equals(Ci.nsIMsgCopyServiceListener) ||
        iid.equals(Ci.nsISupports)) {
      return this;
    }
    throw Components.results.NS_NOINTERFACE;
  },

  // nsIMsgSendListener
  onStartSending: function(aMsgID, aMsgSize) {
    // dumper.dump("[" + this.URIidx + "] " + "msgSendListener.onStartSending(" + aMsgID + ", " + aMsgSize + ")");
  },

  onProgress: function(aMsgID, aProgress, aProgressMax) {
    // dumper.dump("[" + this.URIidx + "] " + "msgSendListener.onProgress(" + aMsgID + ", " + aProgress + ", " + aProgressMax + ")");
  },

  onStatus: function(aMsgID, aMsg) {
    // dumper.dump("[" + this.URIidx + "] " + "msgSendListener.onStatus("+aMsgID+", "+aMsg + ")");
  },

  onStopSending: function(aMsgID, aStatus, aMsg, returnFileSpec) {
    // dumper.dump("[" + this.URIidx + "] " + "msgSendListener.onStopSending("+aMsgID+", "+aStatus +", "+aMsg+", "+returnFileSpec + ")");
    this.ensureStatusFields();
    mstate.selectedURIsProgress[this.URIidx] = 100;
    if (aStatus) {
      this.mailredirectTreeCell.removeAttribute("mode");
      // mstate.successfulSent[this.URIidx] = false;
      this.mailredirectTreeRow.setAttribute("properties", "notsent");
      for (var i = 0; i < this.mailredirectTreeRow.childNodes.length; ++i) {
        var child = this.mailredirectTreeRow.childNodes[i];
        if (child.hasAttribute("properties")) {
          var prop = child.getAttribute("properties");
          child.setAttribute("properties", prop + " notsent");
        } else {
          child.setAttribute("properties", "notsent");
        }
      }
    } else {
      this.mailredirectTreeCell.setAttribute("value", "100");
      mstate.successfulSent[this.URIidx] = true;

      // mark message as 'redirected'
      var messenger = Cc["@mozilla.org/messenger;1"].
                      createInstance(Ci.nsIMessenger);
      var msgService = messenger.messageServiceFromURI(mstate.selectedURIs[this.URIidx]);
      var msgHdr = msgService.messageURIToMsgHdr(mstate.selectedURIs[this.URIidx]);
      var msg = Cc["@mozilla.org/array;1"].
                createInstance(Ci.nsIMutableArray);
      msg.appendElement(msgHdr, false);
      try {
        msgHdr.folder.addKeywordsToMessages(msg, "redirected");
      } catch(e) {
        dumper.dump(e);
      }
    }
  },

  onGetDraftFolderURI: function(aFolderURI) {
    // dumper.dump("[" + this.URIidx + "] " + "msgSendListener.onGetDraftFolderURI("+aFolderURI +")");
  },

  onSendNotPerformed: function(aMsgID, aStatus) {
    // dumper.dump("[" + this.URIidx + "] " + "msgSendListener.onSendNotPerformed("+aMsgID+", "+aStatus +")");
  },

  // nsIMsgCopyServiceListener
  OnStartCopy: function() {
    // dumper.dump("[" + this.URIidx + "] " + "(msgCopyServiceListener) msgSendListener.OnStartCopy()");
  },

  OnProgress: function(aProgress, aProgressMax) {
    // dumper.dump("[" + this.URIidx + "] " + "(msgCopyServiceListener) msgSendListener.OnProgress(" + aProgress + ", " + aProgressMax + ")");
  },

  SetMessageKey: function(aKey) {
    // dumper.dump("[" + this.URIidx + "] " + "(msgCopyServiceListener) msgSendListener.SetMessageKey(" + aKey + ")");
  },

  SetMessageId: function(aMessageId) {
    // dumper.dump("[" + this.URIidx + "] " + "(msgCopyServiceListener) msgSendListener.SetMessageId(" + aMessageId +")");
  },

  OnStopCopy: function(aStatus) {
    // dumper.dump("[" + this.URIidx + "] " + "(msgCopyServiceListener) msgSendListener.OnStopCopy(" + aStatus + ")");
    /*
    if (aStatus) {
      // mstate.successfulSent[this.URIidx] = false;
    } else {
      mstate.selectedURIsProgress[this.URIidx] = 100;
    }
    */
  }
}

var MailredirectWindowController = {
  supportsCommand: function(command) {
    // dumper.dump("supportsCommand(" + command + ")");
    switch(command) {
      case "cmd_mailredirect_now":
      case "cmd_mailredirect_withcheck":
      case "cmd_mailredirect_close":
      case "cmd_mailredirect_delete":
        return true;
      default:
        return false;
    }
  },

  isCommandEnabled: function(command) {
    switch(command) {
      case "cmd_mailredirect_now":
      case "cmd_mailredirect_withcheck":
        return ((!Services.io.offline) && (mstate.selectedURIs !== null)) && !gSendLocked;
      case "cmd_mailredirect_close":
        return true;
      case "cmd_mailredirect_delete":
        var tree = document.getElementById("threadTree");
        var treeChildren = document.getElementById("topTreeChildren");
        return tree && !treeChildren.disabled && tree.view.selection.getRangeCount();
      default:
        return false;
    }
  },

  doCommand: function(command) {
    // dumper.dump("doCommand(" + command + ")");

    // if the user invoked a key short cut then it is possible that we got here for a command which is
    // really disabled. kick out if the command should be disabled.
    if (!this.isCommandEnabled(command)) {
      return;
    }

    switch(command) {
      case "cmd_mailredirect_now":
        DoForwardBounce();
        break;
      case "cmd_mailredirect_withcheck":
        DoForwardBounceWithCheck();
        break;
      case "cmd_mailredirect_close":
        DoCommandClose();
        break;
      case "cmd_mailredirect_delete":
        var start = {}, end = {};
        var tree = document.getElementById("threadTree");
        var treeChildren = document.getElementById("topTreeChildren");
        var numRanges = tree.view.selection.getRangeCount();
        for (var t = numRanges; t > 0; t--) {
          tree.view.selection.getRangeAt(t-1, start, end);
          for (var v = end.value; v >= start.value; v--) {
            mstate.selectedURIs.splice(v, 1);
            mstate.size--;
            var treerows = treeChildren.getElementsByAttribute("URIidx", v);
            var treeitem = treerows[0].parentNode;
            treeitem.parentNode.removeChild(treeitem);
          }
        }
        if (treeChildren.hasChildNodes) {
          var treerows = treeChildren.childNodes;
          for (var i = 0; i < treerows.length; i++) {
            treerows[i].firstChild.setAttribute("URIidx", i);
          }
        }
    }
  },

  onEvent: function(event) {
    // dumper.dump("onEvent(" + event + ")");
  }
}

function RemoveDupAddresses()
{
  for (var recipType in mailredirectRecipients) {
    var array = [];
    for (var i in mailredirectRecipients[recipType]) {
      var recipient = mailredirectRecipients[recipType][i];
      var found = false;
      for (var j = 0; j < i; ++j) {
        if (recipient.fullname.toLowerCase() === mailredirectRecipients[recipType][j].fullname.toLowerCase()) {
          // dumper.dump("found duplicate \"" + recipient.fullname + "\" at positions " + i + " and " + j);
          found = true;
          break;
        }
      }
      if (!found) {
        array.push(recipient);
      }
    }
    mailredirectRecipients[recipType] = array;
  }
}

function WhichElementHasFocus()
{
  var msgIdentityElement = GetMsgIdentityElement();
  var msgAddressingWidgetElement = GetMsgAddressingWidgetElement();

  let currentNode = top.document.commandDispatcher.focusedElement;

  // Special-case Contacts Side Bar's peopleSearchInput so that iteration on
  // currentNode.parentNode doesn't get stuck on Shadow Root of anonymous input.
  let peopleSearchInput = sidebarDocumentGetElementById(
    "peopleSearchInput",
    "abContactsPanel"
  );
  if (currentNode.flattenedTreeParentNode &&
      currentNode.flattenedTreeParentNode === peopleSearchInput) {
    currentNode = peopleSearchInput;
  }

  while (currentNode) {
    if (currentNode === msgIdentityElement ||
        currentNode === msgAddressingWidgetElement) {
      return currentNode;
    }

    currentNode = currentNode.parentNode;
  }

  return null;
}

// Function that performs the logic of switching focus from
// one element to another in the mail compose window.
// The default element to switch to when going in either
// direction (shift or no shift key pressed), is the
// AddressingWidgetElement.
//
// The only exception is when the MsgHeadersToolbar is
// collapsed, then the focus will always be on the body of
// the message.
function SwitchElementFocus(event)
{
  if (!event) {
    return;
  }

  var focusedElement = WhichElementHasFocus();
  var msgIdentityElement = GetMsgIdentityElement();
  var addressingWidget = GetMsgAddressingWidgetElement();
  var threadTree = document.getElementById("threadTree");

  if (event.shiftKey) {
    if (focusedElement === msgIdentityElement) {
      threadTree.focus();
    } else if (focusedElement === addressingWidget) {
      msgIdentityElement.focus();
    } else {
      awSetFocusTo(awGetInputElement(awGetNumberOfRecipients()));
    }
  } else {
    if (focusedElement === msgIdentityElement) {
      awSetFocusTo(awGetInputElement(awGetNumberOfRecipients()));
    } else if (focusedElement === addressingWidget) {
      threadTree.focus();
    } else {
      msgIdentityElement.focus();
    }
  }
}

function sidebarCloseButtonOnCommand()
{
  toggleAddressPicker();
}

function toggleAddressPicker()
{
  var sidebarBox = document.getElementById("sidebar-box");
  var sidebarSplitter = document.getElementById("sidebar-splitter");
  var el = document.getElementById("viewAddressPicker");
  if (sidebarBox.hidden) {
    sidebarBox.hidden = false;
    sidebarSplitter.hidden = false;
    el.setAttribute("checked","true");

    var sidebar = document.getElementById("sidebar");
    var sidebarUrl = sidebar.getAttribute("src");
    // if we have yet to initialize the src url on the sidebar then go ahead and do so now...
    // we do this lazily here, so we don't spend time when bringing up the redirect window loading the address book
    // data sources. Only when the user opens the address picker do we set the src url for the sidebar...
    if (sidebarUrl === "") {
      // CardBook contact sidebar
      if (getPref("extensions.cardbook.autocompletion", false) === true) {
        if (gAppInfoPlatformVersion < 73) {
          sidebar.setAttribute("src", "chrome://cardbook/content/contactsSidebar/wdw_cardbookContactsSidebar.xul");
        } else {
          sidebar.setAttribute("src", "chrome://cardbook/content/contactsSidebar/wdw_cardbookContactsSidebar.xhtml");
        }
      } else {
        if (gAppInfoPlatformVersion < 73) {
          sidebar.setAttribute("src", "chrome://messenger/content/addressbook/abContactsPanel.xul");
        } else {
          sidebar.setAttribute("src", "chrome://messenger/content/addressbook/abContactsPanel.xhtml");
        }
      }
      setTimeout(function() { renameToToResendTo() }, 100);
    }

    sidebarBox.setAttribute("sidebarVisible", "true");
  } else {
    sidebarBox.hidden = true;
    sidebarSplitter.hidden = true;
    sidebarBox.setAttribute("sidebarVisible", "false");
    el.removeAttribute("checked");
  }
}

// public method called by add-ons.
function AddRecipient(recipientType, address)
{
  awAddRecipient(recipientType, address);
}

// public method called by the contacts sidebar.
function AddRecipientsArray(aRecipientType, aAddressArray)
{
  awAddRecipientsArray(aRecipientType, aAddressArray);
}

function renameToToResendTo()
{
  var el = document.getElementById("sidebar");
  if (el === null) {
    setTimeout(function() { renameToToResendTo() }, 100);
  } else {
    let bounceMsgsBundle = Services.strings.createBundle("chrome://mailredirect/locale/mailredirect-compose.properties");
    var cardProperties = el.contentDocument.getElementById("cardProperties");
    if (cardProperties === null) {
      setTimeout(function() { renameToToResendTo() }, 100);
    } else {
      var offset = 0;
      // Add-on sniffing by checking for id that is used by CardBook
      var menuitem = el.contentDocument.getElementById("replytoEmail");
      if (menuitem !== null) {
        menuitem.setAttribute("hidden", true);
        menuitem = el.contentDocument.getElementById("replytoButton");
        menuitem.setAttribute("hidden", true);
      }
      var menuitems = cardProperties.getElementsByTagName("menuitem");
      menuitems.item(offset).setAttribute("label", bounceMsgsBundle.GetStringFromName("resendToContextMenuLabelTB"));
      menuitems.item(offset).setAttribute("accesskey", bounceMsgsBundle.GetStringFromName("resendToContextMenuAccesskeyTB"));
      menuitems.item(offset).setAttribute("oncommand", "addSelectedAddresses(\"addr_to\");");
      menuitems.item(offset+1).setAttribute("label", bounceMsgsBundle.GetStringFromName("resendCcContextMenuLabelTB"));
      menuitems.item(offset+1).setAttribute("accesskey", bounceMsgsBundle.GetStringFromName("resendCcContextMenuAccesskeyTB"));
      menuitems.item(offset+1).setAttribute("oncommand", "addSelectedAddresses(\"addr_cc\");");
      menuitems.item(offset+2).setAttribute("label", bounceMsgsBundle.GetStringFromName("resendBccContextMenuLabelTB"));
      menuitems.item(offset+2).setAttribute("accesskey", bounceMsgsBundle.GetStringFromName("resendBccContextMenuAccesskeyTB"));
      menuitems.item(offset+2).setAttribute("oncommand", "addSelectedAddresses(\"addr_bcc\");");

      var button = el.contentDocument.getElementById("toButton");
      button.setAttribute("label", bounceMsgsBundle.GetStringFromName("resendToButtonLabel"));
      button.setAttribute("accesskey", bounceMsgsBundle.GetStringFromName("resendToButtonAccesskey"));
      button.setAttribute("oncommand", "addSelectedAddresses(\"addr_to\");");
      button = el.contentDocument.getElementById("ccButton");
      button.setAttribute("label", bounceMsgsBundle.GetStringFromName("resendCcButtonLabel"));
      button.setAttribute("accesskey", bounceMsgsBundle.GetStringFromName("resendCcButtonAccesskey"));
      button.setAttribute("oncommand", "addSelectedAddresses(\"addr_cc\");");
      button = el.contentDocument.getElementById("bccButton");
      button.setAttribute("label", bounceMsgsBundle.GetStringFromName("resendBccButtonLabel"));
      button.setAttribute("crop", "center");
      button.setAttribute("accesskey", bounceMsgsBundle.GetStringFromName("resendBccButtonAccesskey"));
      button.setAttribute("oncommand", "addSelectedAddresses(\"addr_bcc\");");
    }
  }
}

function getBounceToolbox()
{
  return document.getElementById("bounce-toolbox");
}

function BounceToolboxCustomizeInit()
{
  if (document.commandDispatcher.focusedWindow === content) {
    window.focus();
  }
  updateEditableFields(true);
  GetMsgHeadersToolbarElement().setAttribute("moz-collapsed", true);
  document.getElementById("bounce-toolbar-sizer").setAttribute("moz-collapsed", true);
  document.getElementById("appcontent").setAttribute("moz-collapsed", true);
  toolboxCustomizeInit("mail-menubar");
}

function BounceToolboxCustomizeDone(aToolboxChanged)
{
  toolboxCustomizeDone("mail-menubar", getBounceToolbox(), aToolboxChanged);
  GetMsgHeadersToolbarElement().removeAttribute("moz-collapsed");
  document.getElementById("bounce-toolbar-sizer").removeAttribute("moz-collapsed");
  document.getElementById("appcontent").removeAttribute("moz-collapsed");
  updateEditableFields(false);
  SetMsgBodyFrameFocus();
}

function BounceToolboxCustomizeChange(aEvent)
{
  toolboxCustomizeChange(getBounceToolbox(), aEvent);
}

function getPref(aPrefName, aIsComplex)
{
  if (aIsComplex) {
    return Services.prefs.getComplexValue(aPrefName, Ci.nsISupportsString).data;
  }
  switch (Services.prefs.getPrefType(aPrefName)) {
    case Ci.nsIPrefBranch.PREF_BOOL:
      return Services.prefs.getBoolPref(aPrefName);
    case Ci.nsIPrefBranch.PREF_INT:
      return Services.prefs.getIntPref(aPrefName);
    case Ci.nsIPrefBranch.PREF_STRING:
      return Services.prefs.getCharPref(aPrefName);
    default: // includes nsIPrefBranch.PREF_INVALID
      return null;
  }
}

function toRedirectOptions()
{
  if (gAppInfoPlatformVersion < 70) {
    openOptionsDialog("paneRedirect");
  } else {
    openOptionsDialog("paneCompose", "redirectCategory");
  }
}
