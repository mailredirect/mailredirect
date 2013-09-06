// based on http://mxr.mozilla.org/comm-central/source/mail/components/compose/content/MsgComposeCommands.js

"use strict";

const THUNDERBIRD_ID = "{3550f703-e582-4d05-9a08-453d09bdfdc6}";
const SEAMONKEY_ID = "{92650c4d-4b8e-4d2a-b7eb-24ecf4f6b63a}";

Components.utils.import("resource:///modules/folderUtils.jsm"); // Gecko 19+
Components.utils.import("resource://gre/modules/Services.jsm"); // Gecko 2+ (TB3.3)
Components.utils.import("resource:///modules/mailServices.js"); // Gecko 5+ (TB5)
Components.utils.import("resource://gre/modules/PluralForm.jsm");

const Cc = Components.classes, Ci = Components.interfaces;

const MODE_RDONLY   = 0x01;
const MODE_WRONLY   = 0x02;
const MODE_RDWR     = 0x04;
const MODE_CREATE   = 0x08;
const MODE_APPEND   = 0x10;
const MODE_TRUNCATE = 0x20;
const MODE_SYNC     = 0x40;
const MODE_EXCL     = 0x80;

// from nsDirPrefs.h
const kPersonalAddressbookUri  = "moz-abmdbdirectory://abook.mab";
const kCollectedAddressbookUri = "moz-abmdbdirectory://history.mab";

var gAccountManager;
var gSessionAdded;
var gCurrentAutocompleteDirectory;
var gCurrentIdentity;
var gSetupLdapAutocomplete = false;
var gLDAPSession;
var mimeHeaderParser;
var mailredirectRecipients = null;
var aSender = null;

// redirected mail states..
var mstate = {
  selectedURIs: null,
  selectedURIsProgress: null,
  successfulSent: null,
  statusStrings: null,
  sendOperationInProgress: null,
  msgSendObj: null,
  size: 0
};

var msgWindow = Cc["@mozilla.org/messenger/msgwindow;1"].
                createInstance(Ci.nsIMsgWindow);

var gMessenger = Cc["@mozilla.org/messenger;1"].
                 createInstance(Ci.nsIMessenger)

var dumper = new MailredirectDebug.Dump();

function RemoveValueFromAttribute(el, atr, val)
{
  var orgval = el.getAttribute(atr);
  val = val.replace(/^\s+|\s+$/g, "")
  var regExp = new RegExp("(?:^|\\s+)" + val + "(?:\\s+|$)", "g");
  var newval = orgval.replace(regExp, "");
  if (newval.match(/^\s*$/)) {
    el.removeAttribute(atr);
  } else {
    el.setAttribute(atr, newval);
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

  // clear treeitems status in bounceTree
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
  if (toolbar)
    goToggleToolbar(toolbar);
}

var directoryServerObserver = {
  observe: function(subject, topic, value) {
    try {
      setupLdapAutocompleteSession();
    } catch (ex) {
      // catch the exception and ignore it, so that if LDAP setup
      // fails, the entire compose window doesn't get horked
    }
  }
}

function AddDirectoryServerObserver(flag)
{
  if (flag) {
    Services.prefs.addObserver("ldap_2.autoComplete.useDirectory",
                               directoryServerObserver, false);
    Services.prefs.addObserver("ldap_2.autoComplete.directoryServer",
                               directoryServerObserver, false);
  }
  else
  {
    var prefstring = "mail.identity." + gCurrentIdentity.key + ".overrideGlobal_Pref";
    Services.prefs.addObserver(prefstring, directoryServerObserver, false);
    prefstring = "mail.identity." + gCurrentIdentity.key + ".directoryServer";
    Services.prefs.addObserver(prefstring, directoryServerObserver, false);
  }
}

function RemoveDirectoryServerObserver(prefstring)
{
  if (!prefstring) {
    Services.prefs.removeObserver("ldap_2.autoComplete.useDirectory", directoryServerObserver);
    Services.prefs.removeObserver("ldap_2.autoComplete.directoryServer", directoryServerObserver);
  }
  else
  {
    var str = prefstring + ".overrideGlobal_Pref";
    Services.prefs.removeObserver(str, directoryServerObserver);
    str = prefstring + ".directoryServer";
    Services.prefs.removeObserver(str, directoryServerObserver);
  }
}

function AddDirectorySettingsObserver()
{
  Services.prefs.addObserver(gCurrentAutocompleteDirectory, directoryServerObserver, false);
}

function RemoveDirectorySettingsObserver(prefstring)
{
  Services.prefs.removeObserver(prefstring, directoryServerObserver);
}

function setupLdapAutocompleteSession()
{
  var autocompleteLdap = false;
  var autocompleteDirectory = null;
  var prevAutocompleteDirectory = gCurrentAutocompleteDirectory;

  autocompleteLdap = getPref("ldap_2.autoComplete.useDirectory");
  if (autocompleteLdap)
    autocompleteDirectory = getPref("ldap_2.autoComplete.directoryServer");

  if (gCurrentIdentity.overrideGlobalPref) {
    autocompleteDirectory = gCurrentIdentity.directoryServer;
  }

  // use a temporary to do the setup so that we don't overwrite the
  // global, then have some problem and throw an exception, and leave the
  // global with a partially setup session.  we'll assign the temp
  // into the global after we're done setting up the session
  //
  var LDAPSession;
  if (gLDAPSession) {
    LDAPSession = gLDAPSession;
  } else {
    LDAPSession = Cc["@mozilla.org/autocompleteSession;1?type=ldap"];
    if (LDAPSession) {
      try {
        LDAPSession = LDAPSession.createInstance(Ci.nsILDAPAutoCompleteSession);
      } catch (ex) {
        dumper.dump ("ERROR: Cannot get the LDAP autocomplete session\n" + ex);}
    }
  }

  if (autocompleteDirectory && !Services.io.offline) {
    // Add observer on the directory server we are autocompleting against
    // only if current server is different from previous.
    // Remove observer if current server is different from previous
    gCurrentAutocompleteDirectory = autocompleteDirectory;
    if (prevAutocompleteDirectory) {
      if (prevAutocompleteDirectory !== gCurrentAutocompleteDirectory) {
        RemoveDirectorySettingsObserver(prevAutocompleteDirectory);
        AddDirectorySettingsObserver();
      }
    }
    else
      AddDirectorySettingsObserver();

    // fill in the session params if there is a session
    //
    if (LDAPSession) {
      let url = getPref(autocompleteDirectory + ".uri", true);

      LDAPSession.serverURL = Services.io.
                                       newURI(url, null, null).
                                       QueryInterface(Ci.nsILDAPURL);

      // get the login to authenticate as, if there is one
      //
      try {
        LDAPSession.login = getPref(autocompleteDirectory + ".auth.dn", true);
      } catch (ex) {
        // if we don't have this pref, no big deal
      }

      try {
        LDAPSession.saslMechanism = getPref(autocompleteDirectory + ".auth.saslmech", true);
      } catch (ex) {
        // don't care if we don't have this pref
      }

      // set the LDAP protocol version correctly
      var protocolVersion;
      try {
        protocolVersion = getPref(autocompleteDirectory + ".protocolVersion");
      } catch (ex) {
        // if we don't have this pref, no big deal
      }
      if (protocolVersion === "2") {
        LDAPSession.version = Ci.nsILDAPConnection.VERSION2;
      }

      // don't search on non-CJK strings shorter than this
      //
      try {
        LDAPSession.minStringLength = getPref(autocompleteDirectory + ".autoComplete.minStringLength");
      } catch (ex) {
        // if this pref isn't there, no big deal.  just let
        // nsLDAPAutoCompleteSession use its default.
      }

      // don't search on CJK strings shorter than this
      //
      try {
        LDAPSession.cjkMinStringLength = getPref(autocompleteDirectory + ".autoComplete.cjkMinStringLength");
      } catch (ex) {
        // if this pref isn't there, no big deal.  just let
        // nsLDAPAutoCompleteSession use its default.
      }

      // we don't try/catch here, because if this fails, we're outta luck
      //
      var ldapFormatter = Cc["@mozilla.org/ldap-autocomplete-formatter;1?type=addrbook"].
                          createInstance(Ci.nsIAbLDAPAutoCompFormatter);

      // override autocomplete name format?
      //
      try {
        ldapFormatter.nameFormat = getPref(autocompleteDirectory + ".autoComplete.nameFormat", true);
      } catch (ex) {
        // if this pref isn't there, no big deal.  just let
        // nsAbLDAPAutoCompFormatter use its default.
      }

      // override autocomplete mail address format?
      //
      try {
        ldapFormatter.addressFormat = getPref(autocompleteDirectory + ".autoComplete.addressFormat", true);
      } catch (ex) {
        // if this pref isn't there, no big deal.  just let
        // nsAbLDAPAutoCompFormatter use its default.
      }

      try {
        // figure out what goes in the comment column, if anything
        //
        // 0 = none
        // 1 = name of addressbook this card came from
        // 2 = other per-addressbook format
        //
        var showComments = getPref("mail.autoComplete.commentColumn");

        switch (showComments) {
          case 1:
            // use the name of this directory
            //
            ldapFormatter.commentFormat = getPref(autocompleteDirectory + ".description", true);
            break;

          case 2:
            // override ldap-specific autocomplete entry?
            //
            try {
              ldapFormatter.commentFormat = getPref(autocompleteDirectory + ".autoComplete.commentFormat", true);
            } catch (innerException) {
              // if nothing has been specified, use the ldap
              // organization field
              ldapFormatter.commentFormat = "[o]";
            }
            break;

          case 0:
          default:
            // do nothing
        }
      } catch (ex) {
        // if something went wrong while setting up comments, try and
        // proceed anyway
      }

      // set the session's formatter, which also happens to
      // force a call to the formatter's getAttributes() method
      // -- which is why this needs to happen after we've set the
      // various formats
      //
      LDAPSession.formatter = ldapFormatter;

      // override autocomplete entry formatting?
      //
      try {
        LDAPSession.outputFormat = getPref(autocompleteDirectory + ".autoComplete.outputFormat", true);
      } catch (ex) {
        // if this pref isn't there, no big deal.  just let
        // nsLDAPAutoCompleteSession use its default.
      }

      // override default search filter template?
      //
      try {
        LDAPSession.filterTemplate = getPref(autocompleteDirectory + ".autoComplete.filterTemplate", true);
      } catch (ex) {
        // if this pref isn't there, no big deal.  just let
        // nsLDAPAutoCompleteSession use its default
      }

      // override default maxHits (currently 100)
      //
      try {
        // XXXdmose should really use .autocomplete.maxHits,
        // but there's no UI for that yet
        //
        LDAPSession.maxHits = getPref(autocompleteDirectory + ".maxHits");
      } catch (ex) {
        // if this pref isn't there, or is out of range, no big deal.
        // just let nsLDAPAutoCompleteSession use its default.
      }

      if (!gSessionAdded) {
        // if we make it here, we know that session initialization has
        // succeeded; add the session for all recipients, and
        // remember that we've done so
        let maxRecipients = awGetMaxRecipients();
        for (let i = 1; i <= maxRecipients; i++)
        {
          let autoCompleteWidget = document.getElementById("addressCol2#" + i);
          if (autoCompleteWidget)
          {
            autoCompleteWidget.addSession(LDAPSession);
            // ldap searches don't insert a default entry with the default domain appended to it
            // so reduce the minimum results for a popup to 2 in this case.
            autoCompleteWidget.minResultsForPopup = 2;
          }
         }
        gSessionAdded = true;
      }
    }
  } else {
    if (gCurrentAutocompleteDirectory) {
      // Remove observer on the directory server since we are not doing Ldap
      // autocompletion.
      RemoveDirectorySettingsObserver(gCurrentAutocompleteDirectory);
      gCurrentAutocompleteDirectory = null;
    }
    if (gLDAPSession && gSessionAdded) {
      let maxRecipients = awGetMaxRecipients();
      for (let i = 1; i <= maxRecipients; i++)
        document.getElementById("addressCol2#" + i).
                 removeSession(gLDAPSession);
      gSessionAdded = false;
    }
  }

  gLDAPSession = LDAPSession;
  gSetupLdapAutocomplete = true;
}

function queryIArray(aArray, iid)
{
  var result = new Array;
  if (!aArray) return result;
  if (aArray.queryElementAt) {
    // nsIArray
    for (let i = 0; i < aArray.length; i++) {
      result[i] = aArray.queryElementAt(i, iid);
    }
  }
  else {
    // nsISupportsArray
    for (let i = 0; i < aArray.Count(); i++) {
      result[i] = aArray.QueryElementAt(i, iid);
    }
  }
  return result;
}

function FillIdentityList(menulist)
{
  var accounts;
  try {
    // Function is new to Thunderbird 19
    accounts = allAccountsSorted(true);
  } catch (ex) {
    accounts = queryIArray(gAccountManager.accounts, Ci.nsIMsgAccount);
  }

  let accountHadSeparator = false;
  let firstAccountWithIdentities = true;
  for (let acc = 0; acc < accounts.length; acc++) {
    let account = accounts[acc];

    let server = account.incomingServer;
    if (!server || server.type === "nntp")
       continue;

    let identities = toArray(fixIterator(account.identities,
                                         Ci.nsIMsgIdentity));

    if (identities.length === 0)
      continue;

    let needSeparator = (identities.length > 1);
    if (needSeparator || accountHadSeparator) {
      // Separate identities from this account from the previous
      // account's identities if there is more than 1 in the current
      // or previous account.
      if (!firstAccountWithIdentities) {
        // only if this is not the first account shown
        let separator = document.createElement("menuseparator");
        menulist.menupopup.appendChild(separator);
      }
      accountHadSeparator = needSeparator;
    }
    firstAccountWithIdentities = false;

    for (let i = 0; i < identities.length; i++) {
      let identity = identities[i];
      let item = menulist.appendItem(identity.identityName, identity.key,
                                     server.prettyName);
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
  // get the accounts key
  var identityList = document.getElementById("msgIdentity");
  return identityList.selectedItem.getAttribute("accountkey");
}

function setupAutocomplete()
{
  var autoCompleteWidget = document.getElementById("addressCol2#1");
  // When autocompleteToMyDomain is off there is no default entry with the domain
  // appended so reduce the minimum results for a popup to 2 in this case.
  if (!gCurrentIdentity.autocompleteToMyDomain)
    autoCompleteWidget.minResultsForPopup = 2;

  // if the pref is set to turn on the comment column, honor it here.
  // this element then gets cloned for subsequent rows, so they should
  // honor it as well
  //
  try
  {
    if (getPref("mail.autoComplete.highlightNonMatches"))
      autoCompleteWidget.highlightNonMatches = true;

    if (getPref("mail.autoComplete.commentColumn"))
      autoCompleteWidget.showCommentColumn = true;
  } catch (ex)
  {
    // if we can't get this pref, then don't show the columns (which is
    // what the XUL defaults to)
  }

  if (!gSetupLdapAutocomplete)
  {
    try
    {
      setupLdapAutocompleteSession();
    } catch (ex)
    {
      // catch the exception and ignore it, so that if LDAP setup
      // fails, the entire compose window doesn't end up horked
    }
  }
}

function LoadIdentity(startup)
{
  var identityElement = document.getElementById("msgIdentity");
  var prevIdentity = gCurrentIdentity;

  if (identityElement)
  {
    var idKey = identityElement.value;
    gCurrentIdentity = gAccountManager.getIdentity(idKey);

    // set the  account name on the menu list value.
    if (identityElement.selectedItem)
      identityElement.setAttribute("accountname", identityElement.selectedItem.getAttribute("accountname"));

    let maxRecipients = awGetMaxRecipients();
    for (let i = 1; i <= maxRecipients; i++)
      awGetInputElement(i).setAttribute("autocompletesearchparam", idKey);

    if (!startup && prevIdentity && idKey !== prevIdentity.key)
    {
      var prefstring = "mail.identity." + prevIdentity.key;
      RemoveDirectoryServerObserver(prefstring);
    }

    AddDirectoryServerObserver(false);
    if (!startup)
    {
      if (getPref("mail.autoComplete.highlightNonMatches"))
        document.getElementById("addressCol2#1").highlightNonMatches = true;

      try {
        setupLdapAutocompleteSession();
      } catch (ex) {
        // catch the exception and ignore it, so that if LDAP setup
        // fails, the entire compose window doesn't end up horked
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

function BounceLoad()
{
  gAccountManager = Cc["@mozilla.org/messenger/account-manager;1"].
                    getService(Ci.nsIMsgAccountManager);
  mimeHeaderParser = Cc["@mozilla.org/messenger/headerparser;1"].
                     getService(Ci.nsIMsgHeaderParser);
  var windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].
                       getService(Ci.nsIWindowMediator);
  var mail3paneWindow = windowMediator.getMostRecentWindow("mail:3pane");
  var currMsgWindow = windowMediator.getMostRecentWindow("mail:messageWindow");

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

  // get defaults for Resent-To, Resent-Cc and Resent-Bcc from preferences
  var defaultResentToString  = "";
  var defaultResentCcString  = "";
  var defaultResentBccString = "";
  try {
    defaultResentToString  = Services.prefs.getCharPref("extensions.mailredirect.defaultResentTo").replace(/^\s+|\s+$/g, "");
    defaultResentCcString  = Services.prefs.getCharPref("extensions.mailredirect.defaultResentCc").replace(/^\s+|\s+$/g, "");
    defaultResentBccString = Services.prefs.getCharPref("extensions.mailredirect.defaultResentBcc").replace(/^\s+|\s+$/g, "");
  }
  catch (ex) {
    // do nothing...
  }

  // set defaults for Resent-To, Resent-Cc and Resent-Bcc in the bounce dialog
  var addr;
  if (defaultResentToString !== "") {
    var defaultResentToArray = defaultResentToString.split(",");
    for (var idx in defaultResentToArray) {
      addr = defaultResentToArray[idx].replace(/^\s+|\s+$/g, "");
      if (addr !== "") awAddRecipient("addr_resendTo", addr);
    }
  }
  if (defaultResentCcString !== "") {
    var defaultResentCcArray = defaultResentCcString.split(",");
    for (var idx in defaultResentCcArray) {
      addr = defaultResentCcArray[idx].replace(/^\s+|\s+$/g, "");
      if (addr !== "") awAddRecipient("addr_resendCc", addr);
    }
  }
  if (defaultResentBccString !== "") {
    var defaultResentBccArray = defaultResentBccString.split(",");
    for (var idx in defaultResentBccArray) {
      addr = defaultResentBccArray[idx].replace(/^\s+|\s+$/g, "");
      if (addr !== "") awAddRecipient("addr_resendBcc", addr);
    }
  }

  AddDirectoryServerObserver(true);

  try {
    // XXX: We used to set commentColumn on the initial auto complete column after the document has loaded
    // inside of setupAutocomplete. But this happens too late for the first widget and it was never showing
    // the comment field. Try to set it before the document finishes loading:
    if (getPref("mail.autoComplete.commentColumn"))
      document.getElementById("addressCol2#1").showCommentColumn = true;
  }
  catch (ex) {
    // do nothing...
  }

  try {
    var wizardcallback = true;
    var state = verifyAccounts(wizardcallback); // this will do migration, or create a new account if we need to.
  }
  catch (ex) {
    dumper.dump("EX: = " + ex + "\n");
    var BounceMsgsBundle = document.getElementById("bundle_mailredirect");
    var errorTitle = BounceMsgsBundle.getString("initErrorDlogTitle");
    var errorMsg = BounceMsgsBundle.getFormattedString("initErrorDlogMessage", [""]);
    Services.prompt.alert(window, errorTitle, errorMsg);
    DoCommandClose();
    return;
  }

  var identityList = document.getElementById("msgIdentity");

  if (identityList)
    FillIdentityList(identityList);

  var preSelectedIdentityKey = null;
  if (window.arguments) {
    mstate.selectedURIs = window.arguments[0];
    if (mstate.selectedURIs) {
      mstate.size = mstate.selectedURIs.length;
      clearMState();
    }
    preSelectedIdentityKey = window.arguments[1];
  }

  if (!preSelectedIdentityKey) {
    // no pre selected identity, so use the default account
    var identities = gAccountManager.defaultAccount.identities;
    if ((typeof identities.length !== "undefined" && identities.length === 0) ||
        (typeof identities.Count !== "undefined" && identities.Count() === 0))
      identities = gAccountManager.allIdentities;
    if (identities.queryElementAt)
      preSelectedIdentityKey = identities.queryElementAt(0, Ci.nsIMsgIdentity).key;
    else
      preSelectedIdentityKey = identities.QueryElementAt(0, Ci.nsIMsgIdentity).key;
  }

  identityList.value = preSelectedIdentityKey;
  LoadIdentity(true);

  // fill bounceTree with information about bounced mails

  if (mstate.selectedURIs) {
    var aTree = document.getElementById("topTreeChildren");

    var messenger = Cc["@mozilla.org/messenger;1"].
                    createInstance(Ci.nsIMessenger);

    var dateFormatService = Cc["@mozilla.org/intl/scriptabledateformat;1"].
                            getService(Ci.nsIScriptableDateFormat);

    for (let i = 0; i < mstate.size; ++i) {
      var aRow = document.createElement("treerow");
      aRow.setAttribute("messageURI", mstate.selectedURIs[i]);
      aRow.setAttribute("URIidx", i);

      dumper.dump(mstate.selectedURIs[i]);
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
        if (isNewsURI(mstate.selectedURIs[i])) propertiesString += " news";
        if (msgHdr.flags & 0x0001)  propertiesString += " read";
        if (msgHdr.flags & 0x0002)  propertiesString += " replied";
        if (msgHdr.flags & 0x1000)  propertiesString += " forwarded";
        if (msgHdr.flags & 0x10000) propertiesString += " new";
        if (/(?:^| )redirected(?: |$)/.test(msgHdr.getStringProperty("keywords"))) propertiesString += " kw-redirected";
      } else if (currMsgWindow && currMsgWindow.messageHeaderSink) {
        msgHdr = currMsgWindow.messageHeaderSink.dummyMsgHeader;
        if (msgHdr) {
          msgSubject = msgHdr.subject;
          msgAuthor = msgHdr.author;
        }
      }

      var aCell = document.createElement("treecell");
      aCell.setAttribute("label", msgSubject);
      aCell.setAttribute("properties", propertiesString);
      aRow.appendChild(aCell);

      var aCell = document.createElement("treecell");
      aCell.setAttribute("label", msgAuthor);
      aRow.appendChild(aCell);

      var aCell = document.createElement("treecell");
      var dateString = "";
      if (msgDate) {
        var date = new Date();
        date.setTime(msgDate / 1000);
        dateString = dateFormatService.FormatDateTime("",
          dateFormatService.dateFormatShort, dateFormatService.timeFormatNoSeconds,
          date.getFullYear(), date.getMonth()+1, date.getDate(),
          date.getHours(), date.getMinutes(), date.getSeconds());
      }
      aCell.setAttribute("label", dateString);
      aRow.appendChild(aCell);

      var aItem = document.createElement("treeitem");
      aItem.appendChild(aRow);
      aTree.appendChild(aItem);
    }
  }

  window.controllers.appendController(MailredirectWindowController);

  updateEditableFields(false);
  AdjustFocus();
  setTimeout(function() { awFitDummyRows() }, 0);

  window.onresize = function()
  {
    // dumper.dump("window.onresize func");
    awFitDummyRows();
  }

  // Before and after callbacks for the customizeToolbar code
  var toolbox = document.getElementById("bounce-toolbox");
  var appInfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo);
  if (appInfo.ID === THUNDERBIRD_ID) {
    toolbox.customizeDone = function(aEvent) { MailToolboxCustomizeDone(aEvent, "CustomizeMailredirectToolbar"); };
  }
  else if (appInfo.ID === SEAMONKEY_ID) {
    toolbox.customizeInit = BounceToolboxCustomizeInit;
    toolbox.customizeDone = BounceToolboxCustomizeDone;
    toolbox.customizeChange = BounceToolboxCustomizeChange;
  }

  var appInfo = Cc["@mozilla.org/xre/app-info;1"].
                getService(Ci.nsIXULAppInfo);
  if (appInfo.ID === SEAMONKEY_ID) {
    toolbox.customizeInit = MailToolboxCustomizeInit;
    // toolbox.customizeDone = MailToolboxCustomizeDone;
    toolbox.customizeChange = MailToolboxCustomizeChange;
  }

  var toolbarset = document.getElementById("customToolbars");
  toolbox.toolbarset = toolbarset;

  // Prevent resizing the subject and format toolbar over the addressswidget.
  var headerToolbar = document.getElementById("addressingToolbar");
  headerToolbar.minHeight = headerToolbar.boxObject.height;
}

function AdjustFocus()
{
  var numOfRecipients = awGetNumberOfRecipients();
  var element = document.getElementById("addressCol2#" + numOfRecipients);
  if (element.value === "") {
    awSetFocus(numOfRecipients, element);
  }
}

function BounceUnload()
{
  // dumper.dump("\nBounceUnload from XUL\n");

  RemoveDirectoryServerObserver(null);
  if (gCurrentIdentity)
    RemoveDirectoryServerObserver("mail.identity." + gCurrentIdentity.key);
  if (gCurrentAutocompleteDirectory)
    RemoveDirectorySettingsObserver(gCurrentAutocompleteDirectory);
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
  let elements = document.querySelectorAll('[disableonsend="true"]');
  for (let i = 0; i < elements.length; i++)
    elements[i].disabled = aDisable;
}

function DoCommandClose()
{
  window.MeteorsStatus = null;
  window.MsgStatusFeedback = null
  window.msgSendListener = null;

  for (var i = 0; i < mstate.size; ++i) {
    if (mstate.sendOperationInProgress[i]) {
      dumper.dump("aborting mail no " + i);
      mstate.msgSendObj[i].abort();
    }
  }
  clearMState();
  window.close();
}

function DoForwardBounceWithCheck()
{
  var warn = getPref("mail.warn_on_send_accel_key");

  if (warn) {
    var checkValue = {value: false};
    let BounceMsgsBundle = document.getElementById("bundle_mailredirect");
    let pluralRule = BounceMsgsBundle.getString("pluralRule");
    let [get, numForms] = PluralForm.makeGetter(pluralRule);
    let selectedCount = mstate.size;
    let textValue = BounceMsgsBundle.getString("sendMessageCheckWindowTitleMsgs");
    let windowTitle = PluralForm.get(selectedCount, textValue);
    textValue = BounceMsgsBundle.getString("sendMessageCheckLabelMsgs");
    let label = get(selectedCount, textValue);
    
    var buttonPressed = Services.prompt.confirmEx(window, windowTitle, label,
      (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
      (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1),
      BounceMsgsBundle.getString("sendMessageCheckSendButtonLabel"),
      null, null,
      BounceMsgsBundle.getString("CheckMsg"),
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
  var rec = getRecipients(true);
  if (rec.resendTo.match(/^\s*$/) &&
      rec.resendCc.match(/^\s*$/) &&
      rec.resendBcc.match(/^\s*$/)) {
    var BounceMsgsBundle = document.getElementById("bundle_mailredirect");
    var errorTitle = BounceMsgsBundle.getString("noRecipientsTitle");
    var errorMsg = BounceMsgsBundle.getFormattedString("noRecipientsMessage", [""]);
    Services.prompt.alert(window, errorTitle, errorMsg);
    return;
  } else {
    // clear some variables
    aSender = null;
    clearMState();
    RealBounceMessages();
  }
}

// we can drag and drop addresses and messages into the mailredirect envelope
var mailredirectDragObserver = {

  canHandleMultipleItems: true,

  onDrop: function (aEvent, aData, aDragSession)
  {
    var dataList = aData.dataList;
    var dataListLength = dataList.length;
    var errorTitle;
    var attachment;
    var errorMsg;

    for (var i = 0; i < dataListLength; i++)
    {
      var item = dataList[i].first;
      var prettyName;
      var rawData = item.data;

      if (item.flavour.contentType === "text/x-moz-message")
      {
        if (mstate.selectedURIs.indexOf(rawData) === -1) {
          var i = mstate.size++;
          mstate.selectedURIs.push(rawData);

          var aTree = document.getElementById("topTreeChildren");
          var aRow = document.createElement("treerow");
          aRow.setAttribute("messageURI", rawData);
          aRow.setAttribute("URIidx", i);

          dumper.dump(mstate.selectedURIs[i]);
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
            if (isNewsURI(mstate.selectedURIs[i])) propertiesString += " news";
            if (msgHdr.flags & 0x0001)  propertiesString += " read";
            if (msgHdr.flags & 0x0002)  propertiesString += " replied";
            if (msgHdr.flags & 0x1000)  propertiesString += " forwarded";
            if (msgHdr.flags & 0x10000) propertiesString += " new";
            if (/(?:^| )redirected(?: |$)/.test(msgHdr.getStringProperty("keywords"))) propertiesString += " kw-redirected";
          } else if (currMsgWindow && currMsgWindow.messageHeaderSink) {
            msgHdr = currMsgWindow.messageHeaderSink.dummyMsgHeader;
            if (msgHdr) {
              msgSubject = msgHdr.subject;
              msgAuthor = msgHdr.author;
            }
          }

          var aCell = document.createElement("treecell");
          aCell.setAttribute("label", msgSubject);
          aCell.setAttribute("properties", propertiesString);
          aRow.appendChild(aCell);

          var aCell = document.createElement("treecell");
          aCell.setAttribute("label", msgAuthor);
          aRow.appendChild(aCell);

          var aCell = document.createElement("treecell");
          var dateString = "";
          if (msgDate) {
            var dateFormatService = Cc["@mozilla.org/intl/scriptabledateformat;1"].
                                    getService(Ci.nsIScriptableDateFormat);
            var date = new Date();
            date.setTime(msgDate / 1000);
            dateString = dateFormatService.FormatDateTime("",
              dateFormatService.dateFormatShort, dateFormatService.timeFormatNoSeconds,
              date.getFullYear(), date.getMonth()+1, date.getDate(),
              date.getHours(), date.getMinutes(), date.getSeconds());
          }
          aCell.setAttribute("label", dateString);
          aRow.appendChild(aCell);

          var aItem = document.createElement("treeitem");
          aItem.appendChild(aRow);
          aTree.appendChild(aItem);
        }
      }
      else if (item.flavour.contentType === "text/x-moz-address")
      {
        // process the address
        if (rawData)
          DropRecipient(aEvent.target, rawData);
      }
    }
  },

  onDragOver: function (aEvent, aFlavour, aDragSession)
  { },

  onDragExit: function (aEvent, aDragSession)
  { },

  getSupportedFlavours: function ()
  {
    var flavourSet = new FlavourSet();
    flavourSet.appendFlavour("text/x-moz-message");
    flavourSet.appendFlavour("text/x-moz-address");
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

  // Starting with Gecko 14, `nsILocalFile` inherits all functions and attributes from `nsIFile`
  var localfile = Cc["@mozilla.org/file/local;1"].
                  createInstance(Ci.nsILocalFile);
  localfile.initWithPath(tmpDir.path);
  localfile.appendRelativePath("mailredirect.tmp");

  try {
    localfile.createUnique(localfile.NORMAL_FILE_TYPE, parseInt("0600", 8));
  } catch(ex) {
    return null;
  }

  return localfile;
}

function FileSpecFromLocalFile(localfile)
{
  var filespec = Cc["@mozilla.org/filespec;1"].createInstance(Ci.nsIFileSpec);
  filespec.nativePath = localfile.path;
  return filespec;
}

function encodeMimeHeader(header)
{
  let fieldNameLen = (header.indexOf(": ") + 2);
  if (header.length <= 1000) {
    return MailServices.mimeConverter.
                        encodeMimePartIIStr_UTF8(header,
                                                 false,
                                                 "UTF-8",
                                                 fieldNameLen,
                                                 Ci.nsIMimeConverter.MIME_ENCODED_WORD_SIZE);
  }
  else
  {
    let fieldName = header.substr(0, fieldNameLen);
    let splitHeader = "";
    let currentLine = "";
    while (header.length > 998)
    {
      let splitPos = header.substr(0, 998).lastIndexOf(","); // Try to split before column 998
      if (splitPos === -1)
        splitPos = header.indexOf(","); // If that fails, split at first possible position
      if (splitPos === -1)
      {
        currentLine = header;
        header = "";
      } 
      else
      {
        currentLine = header.substr(0, splitPos - 1) + "\r\n";
        if (header.charAt(splitPos + 1) === " ")
          header = fieldName + header.substr(splitPos + 2);
        else
          header = fieldName + header.substr(splitPos + 1);
      }
      splitHeader += MailServices.mimeConverter.
                                  encodeMimePartIIStr_UTF8(currentLine,
                                                           false,
                                                           "UTF-8",
                                                           fieldNameLen,
                                                           Ci.nsIMimeConverter.MIME_ENCODED_WORD_SIZE);
    }
    splitHeader += MailServices.mimeConverter.
                                encodeMimePartIIStr_UTF8(header,
                                                         false,
                                                         "UTF-8",
                                                         fieldNameLen,
                                                         Ci.nsIMimeConverter.MIME_ENCODED_WORD_SIZE);
    return(splitHeader);
  }
}

// quoted-printable encoding
function QPencode(str)
{
  var uConv = Cc["@mozilla.org/intl/scriptableunicodeconverter"].
              getService(Ci.nsIScriptableUnicodeConverter);
  uConv.charset = "UTF-8";

  return MailServices.mimeConverter.
                      encodeMimePartIIStr_UTF8(uConv.ConvertFromUnicode(str),
                                               false,
                                               "UTF-8",
                                               0,
                                               72);
}

function getSender()
{
  if (!aSender) {
    aSender = mimeHeaderParser.
              makeFullAddress(QPencode(gCurrentIdentity.fullName),
                              gCurrentIdentity.email);
  }
  return aSender;
}

function getRecipients(onlyemails)
{
  if (!mailredirectRecipients) {
    var aRecipients_sep = { resendTo : "", resendCc : "", resendBcc : "" };
    var recipients = { resendTo : "", resendCc : "", resendBcc : "" };
    var i = 1, inputField;
    while ((inputField = awGetInputElement(i))) {
      var fieldValue = inputField.value;

      if (fieldValue === null)
        fieldValue = inputField.getAttribute("value");

      if (fieldValue !== "") {
        var recipientType = awGetPopupElement(i).selectedItem.getAttribute("value");
        var recipient;

        try {
          recipient = mimeHeaderParser.reformatUnquotedAddresses(fieldValue);
        } catch (ex) {
          recipient = fieldValue;
        }
        var recipientType2;
        switch (recipientType) {
          case "addr_resendTo"  : recipientType2 = "resendTo";  break;
          case "addr_resendCc"  : recipientType2 = "resendCc";  break;
          case "addr_resendBcc" : recipientType2 = "resendBcc"; break;
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
      var numAddresses = mimeHeaderParser.parseHeadersWithArray(recipients[recipType], emails, names, fullnames);

      //dumper.dump("numAddresses[" + recipType + "]= " + numAddresses);

      for (var i = 0; i < numAddresses; ++i) {
        mailredirectRecipients[recipType][i] =
        {
          email: emails.value[i],
          name: names.value[i],
          fullname: fullnames.value[i]
        };
      }
    }
    ResolveMailLists();
    RemoveDupAddresses();
    for (var recipType in mailredirectRecipients) {
      for (var i in mailredirectRecipients[recipType]) {
        mailredirectRecipients[recipType][i].encname = QPencode(mailredirectRecipients[recipType][i].name);
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
        tmp[i] = mimeHeaderParser.
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

  var h = now.getHours(); if (h < 10) now_string += "0";
  now_string += h + ":";
  var m = now.getMinutes(); if (m < 10) now_string += "0";
  now_string += m + ":";
  var s = now.getSeconds(); if (s < 10) now_string += "0";
  now_string += s + " ";

  var tz = now.getTimezoneOffset();
  if (tz > 0) {
    now_string += "-";
  } else {
    now_string += "+";
    tz *= -1;
  }

  var tzh = Math.floor(tz/60); if (tzh < 10) now_string += "0";
  now_string += tzh;
  var tzm = tz % 60; if (tzm < 10) now_string += "0";
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
  var resenthdrs = "Resent-From: " + getSender() + "\r\n";
  var recipientsStrings = getRecipients(false);
  if (recipientsStrings.resendTo) resenthdrs += encodeMimeHeader("Resent-To: " + recipientsStrings.resendTo + "\r\n");
  if (recipientsStrings.resendCc) resenthdrs += encodeMimeHeader("Resent-CC: " + recipientsStrings.resendCc + "\r\n");
  // if (recipientsStrings.resendBcc) resenthdrs += encodeMimeHeader("Resent-BCC: " + recipientsStrings.resendBcc + "\r\n");
  resenthdrs += "Resent-Date: " + getResentDate() + "\r\n";
  var msgID = Cc["@mozilla.org/messengercompose/computils;1"].
              createInstance(Ci.nsIMsgCompUtils).
              msgGenerateMessageId(gCurrentIdentity);
  if (msgID) resenthdrs += "Resent-Message-ID: " + msgID + "\r\n";
  var useragent = getUserAgent();
  if (useragent) resenthdrs += "Resent-User-Agent: " + useragent + "\r\n";
  //dumper.dump('resent-headers\n' + resenthdrs);
  return resenthdrs;
}

var msgCompFields;
var concurrentConnections;

function RealBounceMessages()
{
  msgCompFields = Cc["@mozilla.org/messengercompose/composefields;1"].
                  createInstance(Ci.nsIMsgCompFields);

  msgCompFields.from = getSender();
  var recipientsStrings = getRecipients(true);
  msgCompFields.to = recipientsStrings.resendTo;
  msgCompFields.cc = recipientsStrings.resendCc;
  msgCompFields.bcc = recipientsStrings.resendBcc;

  var copyToSentMail = true;
  try {
    copyToSentMail = Services.prefs.getBoolPref("extensions.mailredirect.copyToSentMail");
  } catch(ex) { }

  if (!copyToSentMail) {
    msgCompFields.fcc = "nocopy://";
    msgCompFields.fcc2 = "nocopy://";
  }

  updateEditableFields(true);

  window.MsgStatusFeedback = [];
  window.msgSendListener = [];
  window.MeteorsStatus = new nsMeteorsStatus();

  concurrentConnections = 5;
  try {
    concurrentConnections = Services.prefs.getIntPref("extensions.mailredirect.concurrentConnections");
  } catch(ex) { }

  if (concurrentConnections === 0) concurrentConnections = mstate.size;

  // dumper.dump("concurrentConnections = " + concurrentConnections);

  for (var i = 0; i < concurrentConnections; ++i) {
    RealBounceMessage(i)
  }
  updateEditableFields(false);
}

function RealBounceMessage(idx)
{
  if (idx >= mstate.size) return;

  var uri = mstate.selectedURIs[idx];
  dumper.dump("RealBounceMessage(" + uri + ") [" + idx + "]");

  window.msgSendListener[idx] = new nsMsgSendListener(idx);
  window.MsgStatusFeedback[idx] = new nsMsgStatusFeedback(idx);

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
  var leftovers = "";
  var buf = "";
  var line = "";

  var aCopyListener = {
    onStartRequest: function(aRequest, aContext)
    {
      // write out Resent-* headers
      var resenthdrs = getResentHeaders();
      aFileOutputStream.write(resenthdrs, resenthdrs.length);
    },

    onStopRequest: function(aRequest, aContext, aStatusCode)
    {
      // write leftovers
      aFileOutputStream.write(leftovers, leftovers.length);
      aFileOutputStream.close();

      if (aStatusCode) {
        // mstate.successfulSent[idx] = false;
        dumper.dump("aCopyListener.onStopRequest: aStatusCode=" + aStatusCode);
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
          window.MsgStatusFeedback[idx],   // in nsIMsgStatusFeedback aStatusFeedback,
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

    onDataAvailable: function(aRequest, aContext, aInputStream, aOffset, aCount)
    {
      // dumper.dump("ondataavail req=" + aRequest + ",contxt=" + aContext + ",input="+aInputStream + ",off=" + aOffset + "1nt=" + aCount);
      aScriptableInputStream.init(aInputStream);
      var available = 0;
      while (true) {
        try {
          available = aScriptableInputStream.available();
        } catch (ex) {
          available = 0;
        }

        if (available === 0 || !inHeader) {
          break;
        }

        if (inHeader) {
          // dumper.dump("!! reading new buffer  -- leftovers.length="+leftovers.length);
          buf = leftovers + aScriptableInputStream.read(1024);
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
              //dumper.dump("leftovers="+leftovers);
              break;
            } else {
              // eol character found. find optional pair (\r\n) (\n\r)
              eol_length = 1;

              // try a pair of eol chars
              //dumper.dump("trying pair. eol="+eol);
              if (eol + 1 < buf.length) {
                if ((buf[eol] === "\r" && buf[eol+1] === "\n") ||
                    (buf[eol] === "\n" && buf[eol+1] === "\r")) {
                  ++eol;
                  ++eol_length;
                  //dumper.dump("pair found. eol="+eol);
                }
              } else {
                // pair couldn't be found because of end of buffer
                //dumper.dump("pair couldnt be found. end of buf. eol="+eol+"   buf.length="+buf.length);
                leftovers = buf;
                break;
              }
              // terminate the line with CRLF sign, not native line-endings
              line = buf.substr(0, eol+1-eol_length) + "\r\n";
              buf = buf.substr(eol+1);
              //dumper.dump("line=>>"+line+"<<line_end.\nline.length=" + line.length);

              if (line === "\r\n") {
                aFileOutputStream.write(line, line.length);
                inHeader = false;
                leftovers = buf;
                break;
              }
            }

            // remove sensitive headers (vide: nsMsgSendPart.cpp)
            // From_ line format - http://www.qmail.org/man/man5/mbox.html
            if (inHeader &&
                (/^[>]*From \S+ /.test(line) ||
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
                 /^x-account-key: /i.test(line) ||
                 0)) {
              // discard line
              //dumper.dump("forbidden line:" + line+"<<");
            } else {
              var ret = aFileOutputStream.write(line, line.length);
              //dumper.dump("write ret = " + ret);
            }
          }
        }
      }
      if (!inHeader) {
        // out of header -- read the rest and write to file

        // convert all possible line terminations to CRLF (required by RFC822)
        leftovers = leftovers.replace(/\r\n|\n\r|\r|\n/g, "\r\n");
        var ret = aFileOutputStream.write(leftovers, leftovers.length);
        //dumper.dump("leftlovers=" + leftovers+"<<end\nret=" + ret);
        leftovers = "";
        if (available) {
          var str = aScriptableInputStream.read(available);
          // convert all possible line terminations to CRLF (required by RFC822)
          str = str.replace(/\r\n|\n\r|\r|\n/g, "\r\n");
          ret = aFileOutputStream.write(str, str.length);
          //dumper.dump("rest write ret = " + ret);
        }
      }
    }
  };

  var msgService = messenger.messageServiceFromURI(uri);

  try {
    aFileOutputStream.init(localfile, MODE_WRONLY | MODE_CREATE | MODE_TRUNCATE, parseInt("0600", 8), null);
  } catch(ex) {
    dumper.dump("aFileOutputStream.init() failed.\n" + ex);
    // mstate.successfulSent[idx] = false;
    RealBounceMessage(idx+concurrentConnections);
    return;
  }

  var newURI = {};

  msgService.CopyMessage(
      uri,
      aCopyListener,
      false,      //aMoveMessage
      null, // aUrlListener,
      msgWindow, // msgWindow,
      newURI);

  // dumper.dump("newURI = " + newURI);
  // dumper.dump("newURI = " + newURI.value.spec);
  newURI = null;
}

// We're going to implement our status feedback for the mail window in JS now.
// the following contains the implementation of our status feedback object

function nsMsgStatusFeedback(idx)
{
  this.URIidx = idx;
}

nsMsgStatusFeedback.prototype =
{
  // global variables for status / feedback information....
  statusTextFld: null,
  statusBar: null,
  throbber: null,
  mailredirectTreeCell: null,
  URIidx: -1,

  ensureStatusFields: function()
  {
    //dumper.dump("ensureStatusFields");
    if (!this.statusTextFld ) this.statusTextFld = document.getElementById("statusText");
    if (!this.statusBar) this.statusBar = document.getElementById("bounce-progressmeter");
    if (!this.throbber) {
      var appInfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo);
      if (appInfo.ID === THUNDERBIRD_ID) {
        this.throbber = document.getElementById("throbber-box");
      }
      else if (appInfo.ID === SEAMONKEY_ID) {
        this.throbber = document.getElementById("navigator-throbber");
      }
    }
    if (!this.mailredirectTreeCell) {
      var treeChildren = document.getElementById("topTreeChildren");
      if (treeChildren) {
        var el = treeChildren.getElementsByAttribute("URIidx", this.URIidx);
        if (el) {
          if (!this.mailredirectTreeCell) this.mailredirectTreeCell = el[0].lastChild;
        }
      }
    }
  },

  updateStatusText: function()
  {
    // if all StatusStrings are equal show this string
    // else don't change currently showing statusstring
    var str = mstate.statusStrings[0];
    for (var i = 1; i < mstate.size; ++i) {
      if (str !== mstate.statusStrings[i]) return;
    }
    // dumper.dump("setting status text to: " + str);
    this.ensureStatusFields();
    this.statusTextFld.label = str;
  },

  QueryInterface: function(iid)
  {
    // dumper.dump("nsMsgStatusFeedback.QueryInterface " + iid);
    if (iid.equals(Ci.nsIMsgStatusFeedback) ||
    //  iid.equals(Ci.nsIProgressEventSink) ||
        iid.equals(Ci.nsIWebProgressListener) ||
        iid.equals(Ci.nsISupportsWeakReference) ||
        iid.equals(Ci.nsISupports))
      return this;
    throw Components.results.NS_NOINTERFACE;
  },

  // nsIMsgStatusFeedback implementation.
  showStatusString: function(statusText)
  {
    // dumper.dump(this.URIidx + ". showStatusString(" + statusText + ")");
    mstate.statusStrings[this.URIidx] = statusText;
    this.updateStatusText();
  },

  startMeteors: function()
  {
    dumper.dump("startMeteors");
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

  stopMeteors: function()
  {
    dumper.dump("stopMeteors");
    if (mstate) mstate.sendOperationInProgress[this.URIidx] = false;

    RealBounceMessage(this.URIidx+concurrentConnections);

    if (window.MeteorsStatus.pendingStartRequests > 0)
      window.MeteorsStatus.pendingStartRequests--;
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

  showProgress: function(percentage)
  {
    // dumper.dump("showProgress(" + percentage +")");
    this.ensureStatusFields();
    if (percentage >= 0)
    {
      this.statusBar.setAttribute("mode", "normal");
      this.statusBar.value = percentage;
      this.statusBar.label = Math.round(percentage) + "%";
    }
  },

  closeWindow: function(percent)
  {
    // dumper.dump("closeWindow(" + percent +")");
  },

  // nsIProgressEventSink implementation
  /*
  onProgress: function(aRequest, aContext, aProgress, aProgressMax)
  {
    dumper.dump("statusFeedback.onProgress(" + aRequest + ", " + aContext + ", " + aProgress + ", " + aProgressMax);
  },
  onStatus: function(aRequest, aContext, aStatus, aStatusArg)
  {
    dumper.dump("statusFeedback.onStatus(" + aRequest + ", " + aContext + ", " + aStatus + ", " + aStatusArg);
  }
  */

  // all progress notifications are done through the nsIWebProgressListener implementation...
  onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus)
  {
    // dumper.dump(this.URIidx + ". onStateChange(" + aWebProgress + ", " + aRequest + ", " + aStateFlags + ", " + aStatus + ")");
    if (aStateFlags & Ci.nsIWebProgressListener.STATE_START) {
      // dumper.dump("onStateChange STATE_START");
      mstate.sendOperationInProgress[this.URIidx] = true;
      this.ensureStatusFields();
      this.mailredirectTreeCell.setAttribute("mode", "undetermined");
      this.statusBar.setAttribute("mode", "undetermined");
    }

    if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
      // dumper.dump("onStateChange STATE_STOP");
      mstate.sendOperationInProgress[this.URIidx] = false;
      this.ensureStatusFields();
      this.statusBar.setAttribute("mode", "normal");
      this.statusBar.setAttribute("value", 0);
      this.mailredirectTreeCell.removeAttribute("mode");
      this.mailredirectTreeCell.removeAttribute("value");
      this.statusTextFld.setAttribute("label", "");
    }
  },

  onProgressChange: function(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress)
  {
    // dumper.dump(this.URIidx + ". onProgressChange(" + aWebProgress + ", " + aRequest.name + ", " + aCurSelfProgress + ", " + aMaxSelfProgress + ", " + aCurTotalProgress + ", " + aMaxTotalProgress + ")");

    this.ensureStatusFields();
    if (aMaxTotalProgress > 0) {
      var percent = (aCurTotalProgress*100)/aMaxTotalProgress;
      if (percent > 100) percent = 100;
      mstate.selectedURIsProgress[this.URIidx] = percent;

      // dumper.dump(this.URIidx + ". onProgressChange = " + percent);
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

  onLocationChange: function(aWebProgress, aRequest, aLocation)
  { },

  onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage)
  {
    // dumper.dump("onStatusChange(" + aWebProgress + ", " + aRequest + ", " + aStatus + ", " + aMessage + ")");
    // Looks like it's possible that we get call while the document has been already delete!
    // therefore we need to protect ourself by using try/catch
    try {
      this.ensureStatusFields();
      this.showStatusString(aMessage);
    } catch (ex) { };
  },

  onSecurityChange: function(aWebProgress, aRequest, state)
  { },

  updateStatusBar: function()
  {
    var sum = 0;
    for (var i = 0; i < mstate.size; sum += mstate.selectedURIsProgress[i++]) { }
    var percent = Math.round(sum / mstate.size);
    if (percent > 100) percent = 100;

    this.statusBar.setAttribute("value", percent);
    // dumper.dump("updateStatusBar = " + percent);
  }
};

function nsMeteorsStatus()
{
}

nsMeteorsStatus.prototype = {
  pendingStartRequests: 0,
  startTimeoutID: null,
  stopTimeoutID: null,
  meteorsSpinning: false,
  statusTextFld: null,
  statusBar: null,
  throbber: null,

  ensureStatusFields: function()
  {
    // dumper.dump("ensureStatusFields");
    if (!this.statusTextFld ) this.statusTextFld = document.getElementById("statusText");
    if (!this.statusBar) this.statusBar = document.getElementById("bounce-progressmeter");
    if (!this.throbber) {
      var appInfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo);
      if (appInfo.ID === THUNDERBIRD_ID) {
        this.throbber = document.getElementById("throbber-box");
      }
      else if (appInfo.ID === SEAMONKEY_ID) {
        this.throbber = document.getElementById("navigator-throbber");
      }
    }
  },

  _startMeteors: function()
  {
    dumper.dump("_startMeteors");

    this.ensureStatusFields();
    this.meteorsSpinning = true;
    this.startTimeoutID = null;

    // Turn progress meter on.
    this.statusBar.setAttribute("mode", "undetermined");
    this.statusBar.setAttribute("collapsed", false);

    // start the throbber
    if (this.throbber) this.throbber.setAttribute("busy", true);
  },

  _stopMeteors: function()
  {
    dumper.dump("_stopMeteors");

    var BounceMsgsBundle = document.getElementById("bundle_mailredirect");

    // if all mails successfully
    var success = true;
    for (var i = 0; success && i < mstate.size; ++i) {
      success &= mstate.successfulSent[i];
    }

    dumper.dump("_stopMeteors: successfuly sent all messages? " + success);

    let BounceMsgsBundle = document.getElementById("bundle_mailredirect");
    let numMessages = mstate.size;
    let pluralRule = BounceMsgsBundle.getString("pluralRule");
    let [get, numForms] = PluralForm.makeGetter(pluralRule);
    var msg;
    if (success)
      msg = get(numMessages, BounceMsgsBundle.getString("sendMessageSuccessfulMsgs"));
    else
      msg = get(numMessages, BounceMsgsBundle.getString("sendMessageFailedMsgs"));
    this.ensureStatusFields();
    this.statusTextFld.label = msg;

    // stop the throbber
    if (this.throbber) this.throbber.setAttribute("busy", false);

    // Turn progress meter off.
    this.statusBar.setAttribute("collapsed", true);
    this.statusBar.setAttribute("mode", "normal");
    this.statusBar.value = 0;  // be sure to clear the progress bar
    this.statusBar.label = "";

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
          } catch(ex) {}
        }
      }
    }
  }
};

function nsMsgSendListener(idx)
{
  this.URIidx = idx;
}

nsMsgSendListener.prototype =
{
  URIidx: -1,
  mailredirectTreeRow: null,
  mailredirectTreeCell: null,

  ensureStatusFields: function()
  {
    dumper.dump("msgSendListener.ensureStatusFields");
    if (!this.mailredirectTreeRow || !this.mailredirectTreeCell) {
      var treeChildren = document.getElementById("topTreeChildren");
      if (treeChildren) {
        var el = treeChildren.getElementsByAttribute("URIidx", this.URIidx);
        if (el) {
          if (!this.mailredirectTreeRow) this.mailredirectTreeRow = el[0];
          if (!this.mailredirectTreeCell) this.mailredirectTreeCell = el[0].lastChild;
        }
      }
    }
  },

  QueryInterface: function(iid)
  {
    // dumper.dump("nsMsgSendListener.QueryInterface " + iid);
    if (iid.equals(Ci.nsIMsgSendListener) ||
        iid.equals(Ci.nsIMsgCopyServiceListener) ||
        iid.equals(Ci.nsISupports))
      return this;
    throw Components.results.NS_NOINTERFACE;
  },

  // nsIMsgSendListener
  onStartSending: function(aMsgID, aMsgSize)
  {
    // dumper.dump("onStartSending(" + aMsgID + ", " + aMsgSize + ")");
  },

  onProgress: function(aMsgID, aProgress, aProgressMax)
  {
    // dumper.dump("msgSendListener.onProgress(" + aMsgID + ", " + aProgress + ", " + aProgressMax + ")");
  },

  onStatus: function(aMsgID, aMsg)
  {
    // dumper.dump("msgSendListener.onStatus("+aMsgID+", "+aMsg + ")");
  },

  onStopSending: function(aMsgID, aStatus, aMsg, returnFileSpec)
  {
    // dumper.dump(this.URIidx + ". onStopSending("+aMsgID+", "+aStatus +", "+aMsg+", "+returnFileSpec + ")");
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
      /*
       * redirected status bug
       *
       * var keywords = msgHdr.getStringProperty("keywords");
      if (keywords.length !== 0) {
        if (! /(?:^| )redirected(?: |$)/.test(keywords)) {
          keywords += " redirected";
        }
      } else {
        keywords = "redirected";
      }
      msgHdr.setStringProperty("keywords", keywords);
      var msgDb = msgHdr.folder.msgDatabase;
      msgDb.Commit(1); // msgDb.Commit(MSG_DB_LARGE_COMMIT);
       */

      var msg = Cc["@mozilla.org/array;1"].
                createInstance(Ci.nsIMutableArray);
      msg.appendElement(msgHdr, false);
      try {
        msgHdr.folder.addKeywordsToMessages(msg, "redirected");
      } catch(e) {
        dumper.dump(e);
      }
      /* End of bugfix */

    }
  },

  onSendNotPerformed: function(aMsgID, aStatus)
  {
    // dumper.dump(this.URIidx + ". onStopSending("+aMsgID+", "+aStatus +")");
  },

  onGetDraftFolderURI: function(aFolderURI)
  {
    // dumper.dump("onGetDraftFolderURI("+aFolderURI +")");
  },

  // nsIMsgCopyServiceListener
  OnStartCopy: function()
  {
    // dumper.dump("OnStartCopy()");
  },

  OnProgress: function(aProgress, aProgressMax)
  {
    // dumper.dump("OnProgress(" + aProgress + ", " + aProgressMax + ")");
  },

  OnStopCopy: function(aStatus)
  {
    // dumper.dump("OnStopCopy(" + aStatus + ")");
    /*
    if (aStatus) {
      // mstate.successfulSent[this.URIidx] = false;
    } else {
      mstate.selectedURIsProgress[this.URIidx] = 100;
    }
    */
  }
};

var MailredirectWindowController = {
  supportsCommand: function(command)
  {
    //dumper.dump("supportsCommand(" + command + ")");
    switch(command) {
      case "cmd_mailredirect_now":
      case "cmd_mailredirect_withcheck":
      case "cmd_mailredirect_close":
        return true;
      default:
        return false;
    }
  },

  isCommandEnabled: function(command)
  {
    //dumper.dump("isCommandEnabled(" + command + ") = " + ((!Services.io.offline) && (mstate.selectedURIs !== null)));
    switch(command) {
      case "cmd_mailredirect_now":
      case "cmd_mailredirect_withcheck":
        return ((!Services.io.offline) && (mstate.selectedURIs !== null));
      case "cmd_mailredirect_close":
        return true;
      default:
        return false;
    }
  },

  doCommand: function(command)
  {
    //dumper.dump("doCommand(" + command + ")");

    // if the user invoked a key short cut then it is possible that we got here for a command which is
    // really disabled. kick out if the command should be disabled.
    if (!this.isCommandEnabled(command)) return;

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
    }
  },

  onEvent: function(event)
  {
    //dumper.dump("onEvent(" + event + ")");
  }
};

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
      if (!found) array.push(recipient);
    }
    mailredirectRecipients[recipType] = array;
  }
}

function WhichElementHasFocus()
{
  var msgIdentityElement             = document.getElementById("msgIdentity");
  var msgAddressingWidgetTreeElement = document.getElementById("addressingWidget");

  if (top.document.commandDispatcher.focusedWindow === content)
    return content;

  var currentNode = top.document.commandDispatcher.focusedElement;
  while (currentNode)
  {
    if (currentNode === msgIdentityElement ||
        currentNode === msgAddressingWidgetTreeElement)
      return currentNode;

    currentNode = currentNode.parentNode;
  }

  return null;
}

// Function that performs the logic of switching focus from
// one element to another in the mail compose window.
// The default element to switch to when going in either
// direction (shift or no shift key pressed), is the
// AddressingWidgetTreeElement.
//
// The only exception is when the MsgHeadersToolbar is
// collapsed, then the focus will always be on the body of
// the message.
function SwitchElementFocus(event)
{
  if (!event) return;

  var focusedElement = WhichElementHasFocus();
  var addressingWidget = document.getElementById("addressingWidget");

  if (focusedElement === addressingWidget) {
    document.getElementById("msgIdentity").focus();
  } else {
    // addressingWidget.focus();
    var element = document.getElementById("addressCol2#" + awGetNumberOfRecipients());
    awSetFocus(awGetNumberOfRecipients(), element);
  }
}

/*
 * maillists
 *
 * ported from http://mxr.mozilla.org/comm-central/source/mailnews/compose/src/nsMsgCompose.cpp#4671
 * (nsMsgCompose::CheckAndPopulateRecipients)
 */

// var mailListArray;
var processedMailLists;

function ResolveMailLists()
{
  var stillNeedToSearch = true;
  var abDirectory;
  var existingCard;
  var mailListAddresses;
  var mailListArray;
  var addrbookDirArray = GetABDirectories();
  var nbrAddressbook = addrbookDirArray.length;

  for (var k = 0; k < nbrAddressbook && stillNeedToSearch; ++k) {
    // Avoid recursive mailing lists
    if (abDirectory && (addrbookDirArray[k] === abDirectory)) {
      stillNeedToSearch = false;
      break;
    }
    abDirectory = addrbookDirArray[k].QueryInterface(Ci.nsIAbDirectory);
    if (!abDirectory.supportsMailingLists)
      continue;

    // Collect all mailing lists defined in this address book
    mailListArray = BuildMailListArray(abDirectory);

    for (var recipType in mailredirectRecipients) {
      for (var j = 0; j < mailredirectRecipients[recipType].length; ++j) {
        var recipient = mailredirectRecipients[recipType][j];
        recipient.mProcessed = false;
      }
    }
    
    stillNeedToSearch = false;
    for (var recipType in mailredirectRecipients) {
      // Note: We check this each time to allow for length changes.
      for (var j = 0; j < mailredirectRecipients[recipType].length; ++j) {
        var recipient = mailredirectRecipients[recipType][j];
        if (!recipient.mProcessed)
        {
          // First check if it's a mailing list
          var mailListAddresses = GetMailListAddresses(recipient.fullname, mailListArray);
          if (mailListAddresses)
          {
            // Always populate
            for (var nbrAddresses = mailListAddresses.length; nbrAddresses > 0; nbrAddresses--)
            {
              existingCard = mailListAddresses.queryElementAt(nbrAddresses - 1, Ci.nsIAbCard);
              
              var newRecipient;
              var bIsMailList = existingCard.isMailList;
              var pDisplayName = existingCard.displayName;
              
              var email;
              if (bIsMailList)
                email = existingCard.notes;
              else
                email = existingCard.primaryEmail;
              var mAddress = mimeHeaderParser.makeFullAddress(existingCard.displayName, email);
              if (!mAddress)
              {
                // Oops, parser problem! I will try to do my best...
                mAddress = pDisplayName + " <";
                if (bIsMailList)
                  if (email)
                    mAddress += email;
                  else
                    mAddress += pDisplayName;
                else
                  mAddress += email;
                mAddress += ">";
              }
  
              if (!mAddress)
                continue;
  
              // Now we need to insert the new address into the list of recipient
              if (bIsMailList)
                stillNeedToSearch = true;
              else
              {
                var newRecipient = { email : email, name : pDisplayName, fullname : mAddress };
                newRecipient.mProcessed = true;
              }
              mailredirectRecipients[recipType].splice(j + 1, 0, newRecipient);
            }
            mailredirectRecipients[recipType].splice(j, 1);
            --j;
            continue;
          }

          if (!abDirectory)
          {
            stillNeedToSearch = true;
            continue;
          }
          
          // find a card that contains this e-mail address
          existingCard = abDirectory.cardForEmailAddress(recipient.email);
          if (existingCard)
          {
            recipient.mProcessed = true;
            if (!abDirectory.readOnly)
            {
              var popularityValue = existingCard.getProperty("PopularityIndex", "0");
              var popularityIndex = parseInt(popularityValue);
              
              if (isNaN(popularityIndex))
              {
                // TB 2 wrote the popularity value as hex, so if we get here,
                // then we've probably got a hex value. We'll convert it back
                // to decimal, as that's the best we can do.
                popularityIndex = parseInt(popularityValue, 16);
                
                // If its still NaN, just give up, we shouldn't ever get here.
                if (isNaN(popularityIndex))
                  popularityIndex = 0;
              }

              existingCard.setProperty("PopularityIndex", ++popularityIndex);
              try {
                abDirectory.modifyCard(existingCard);
              }
              catch(ex) {
                Components.utils.reportError(ex);
              }
            }
          }
          else
            stillNeedToSearch = true;
        }
      }
    }
  }
}

function GetABDirectories()
{
  var abManager = Cc["@mozilla.org/abmanager;1"].
                  getService(Ci.nsIAbManager);
  var directoriesArray = [];
  var collectedAddressbook = null;

  var directories = abManager.directories;
  while (directories.hasMoreElements()) {
    var item = directories.getNext();
    var directory = item.QueryInterface(Ci.nsIAbDirectory);
    if (directory.isMailList) continue;
    var uri = item.URI;
    if (uri === kPersonalAddressbookUri) {
      directoriesArray.unshift(directory);
    } else {
      if (uri === kCollectedAddressbookUri) {
        collectedAddressbook = directory;
      } else {
        directoriesArray.push(directory);
      }
    }
  }
  if (collectedAddressbook) directoriesArray.push(collectedAddressbook);
  return directoriesArray;
}

function BuildMailListArray(parentDir)
{
  var array = [];
  var subDirectories = parentDir.childNodes;
  while (subDirectories.hasMoreElements()) {
    var item = subDirectories.getNext();
    var directory = item.QueryInterface(Ci.nsIAbDirectory);
    if (directory.isMailList) {
      var listName = directory.dirName;
      var listDescription = directory.description;

      // from nsMsgMailList constructor
      var email = !listDescription ? listName : listDescription;
      var fullAddress = mimeHeaderParser.makeFullAddress(listName, email);

      var list = { fullName : fullAddress, directory : directory };
      array.push(list);
    }
  }
  return array;
}

function GetMailListAddresses(name, mailListArray)
{
  for (var i = 0; i < mailListArray.length; ++i) {
    if (name.toLowerCase() === mailListArray[i].fullName.toLowerCase()) {
      return mailListArray[i].directory.addressLists;
    }
  }
  return undefined;
}

function BounceToolboxCustomizeInit()
{
  if (document.commandDispatcher.focusedWindow === content)
    window.focus();
  updateEditableFields(true);
  GetMsgHeadersToolbarElement().setAttribute("moz-collapsed", true);
  document.getElementById("compose-toolbar-sizer").setAttribute("moz-collapsed", true);
  document.getElementById("content-frame").setAttribute("moz-collapsed", true);
  toolboxCustomizeInit("mail-menubar");
}

function BounceToolboxCustomizeDone(aToolboxChanged)
{
  toolboxCustomizeDone("mail-menubar", getMailToolbox(), aToolboxChanged);
  GetMsgHeadersToolbarElement().removeAttribute("moz-collapsed");
  document.getElementById("compose-toolbar-sizer").removeAttribute("moz-collapsed");
  document.getElementById("content-frame").removeAttribute("moz-collapsed");
  updateEditableFields(false);
  SetMsgBodyFrameFocus();
}

function BounceToolboxCustomizeChange(aEvent)
{
  toolboxCustomizeChange(getMailToolbox(), aEvent);
}

function getPref(aPrefName, aIsComplex) {
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
