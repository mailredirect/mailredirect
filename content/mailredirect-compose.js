// author: Pawel Krzesniak
// based on: mail.jar/MsgComposeCommands.js

/* vim: set sw=2 noexpandtab softtabstop=2: */

/*
   file creation flags
 */
const JS_FILE_NS_RDONLY               = 0x01;
const JS_FILE_NS_WRONLY               = 0x02;
const JS_FILE_NS_RDWR                 = 0x04;
const JS_FILE_NS_CREATE_FILE          = 0x08;
const JS_FILE_NS_APPEND               = 0x10;
const JS_FILE_NS_TRUNCATE             = 0x20;
const JS_FILE_NS_SYNC                 = 0x40;
const JS_FILE_NS_EXCL                 = 0x80; 

// from nsDirPrefs.h
const kAllDirectoryRoot        = "moz-abdirectory://";
const kMDBDirectoryRoot        = "moz-abmdbdirectory://";
const kLDAPDirectoryRoot       = "moz-abldapdirectory://";

const kPersonalAddressbookUri  = "moz-abmdbdirectory://abook.mab";
const kCollectedAddressbookUri = "moz-abmdbdirectory://history.mab";


var aPrefs = null;
var aPrefBranchInternal = null;

var aAccountManager;
var aPromptService;
var aCurrentAutocompleteDirectory;
var aCurrentIdentity;
var aSetupLdapAutocomplete = false;
var aLDAPSession;
var mailredirectIsOffline = false;
var mimeHeaderParser; 
var mailredirectRecipients = null;
var aSender = null;
  
// redirected mail states..
var mstate = {
  selectedURIs : null,
  selectedURIsProgress : null,
  successfulSent : null,
  statusStrings : null,
  sendOperationInProgress : null,
  msgSendObj : null,
  size : 0
};
  

var msgWindow = Components.classes["@mozilla.org/messenger/msgwindow;1"].createInstance()
  .QueryInterface(Components.interfaces.nsIMsgWindow);

var dumper = new myDump();


/* ************** */

function HeaderParserMakeFullAddressMR(parser, name, email)
{
  try {
    return parser.makeFullAddress(name, email);
  } catch (e) {
    return parser.makeFullAddressWString(name, email);
  }
}

function clearMState()
{
  dumper.dump('clearing mstate');
  mstate.selectedURIsProgress = [];
  mstate.successfulSent = [];
  mstate.statusStrings = [];
  mstate.sendOperationInProgress = [];
  mstate.msgSendObj = [];

  for (var i=0; i<mstate.size; ++i) {
    mstate.selectedURIsProgress[i] = 0;
    // mstate.successfulSent[i] = true;
    mstate.successfulSent[i] = false;
    mstate.statusStrings[i] = "";
    mstate.sendOperationInProgress[i] = false;
    mstate.msgSendObj[i] = null;
  }
     
  // clear treeitems status in bounceTree
  var treeChildren = document.getElementById("topTreeChildren");
  // dumper.dump('treeChildren=' + treeChildren);
  if (treeChildren) {
    var el = treeChildren.getElementsByTagName("treerow"); 
    // dumper.dump('el=' + el + '   length=' + el.length);
    if (el) {
      for (var i=0; i<el.length; ++i) {
	// dumper.dump('el[' + i + ']=' + el[i]);
        RemoveValueFromAttribute(el[i], "properties", "notsent");
	var col = el[i].lastChild;
	if (col) {
	  col.setAttribute("mode", "normal");
	  col.setAttribute("value", "0");
	}
      }
    }
  }
}

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

function loadThrobberUrl(urlPref)
{
  var url;
  try {
    url = aPrefs.getComplexValue(urlPref, Components.interfaces.nsIPrefLocalizedString).data;
    var messenger = Components.classes["@mozilla.org/messenger;1"].createInstance()
      .QueryInterface(Components.interfaces.nsIMessenger);
    messenger.launchExternalURL(url);
  } catch (ex) {}
} 

function toOpenWindowByType( inType, uri )
{
  var topWindow =
    Components.classes['@mozilla.org/appshell/window-mediator;1'].getService()
    .QueryInterface(Components.interfaces.nsIWindowMediator).getMostRecentWindow( inType );
	
  if ( topWindow ) {
    topWindow.focus();
  } else {
    window.open(uri, "_blank", "chrome,extrachrome,menubar,resizable,scrollbars,status,toolbar");
  }
}

function toAddressBook() 
{
  toOpenWindowByType("mail:addressbook", "chrome://messenger/content/addressbook/addressbook.xul");
}

function toMessengerWindow()
{
  toOpenWindowByType("mail:3pane", "chrome://messenger/content/messenger.xul");
} 

function onViewToolbarCommand(aToolbarId, aMenuItemId)
{
  var toolbar = document.getElementById(aToolbarId);
  var menuItem = document.getElementById(aMenuItemId);

  if (!toolbar || !menuItem) return;

  var toolbarCollapsed = toolbar.collapsed;
  
  // toggle the checkbox
  menuItem.setAttribute('checked', toolbarCollapsed);
  
  // toggle visibility of the toolbar
  toolbar.collapsed = !toolbarCollapsed;   

  document.persist(aToolbarId, 'collapsed');
  document.persist(aMenuItemId, 'checked');
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

function AddDirectoryServerObserver(flag) {
  if (flag) {
    aPrefBranchInternal.addObserver("ldap_2.autoComplete.useDirectory",
                                    directoryServerObserver, false);
    aPrefBranchInternal.addObserver("ldap_2.autoComplete.directoryServer",
                                    directoryServerObserver, false);
  } else {
    var prefstring = "mail.identity." + aCurrentIdentity.key + ".overrideGlobal_Pref";
    aPrefBranchInternal.addObserver(prefstring, directoryServerObserver, false);
    prefstring = "mail.identity." + aCurrentIdentity.key + ".directoryServer";
    aPrefBranchInternal.addObserver(prefstring, directoryServerObserver, false);
  }
}

function RemoveDirectoryServerObserver(prefstring)
{
  if (!prefstring) {
    aPrefBranchInternal.removeObserver("ldap_2.autoComplete.useDirectory", directoryServerObserver);
    aPrefBranchInternal.removeObserver("ldap_2.autoComplete.directoryServer", directoryServerObserver);
  } else {
    var str = prefstring + ".overrideGlobal_Pref";
    aPrefBranchInternal.removeObserver(str, directoryServerObserver);
    str = prefstring + ".directoryServer";
    aPrefBranchInternal.removeObserver(str, directoryServerObserver);
  }
}

function AddDirectorySettingsObserver()
{
  aPrefBranchInternal.addObserver(aCurrentAutocompleteDirectory, directoryServerObserver, false);
}

function RemoveDirectorySettingsObserver(prefstring)
{
  aPrefBranchInternal.removeObserver(prefstring, directoryServerObserver);
}

function setupLdapAutocompleteSession()
{
    var autocompleteLdap = false;
    var autocompleteDirectory = null;
    var prevAutocompleteDirectory = aCurrentAutocompleteDirectory;
    var i;
    var aSessionAdded = false;

    autocompleteLdap = getPref("ldap_2.autoComplete.useDirectory");
    if (autocompleteLdap)
        autocompleteDirectory = getPref("ldap_2.autoComplete.directoryServer");

    if(aCurrentIdentity.overrideGlobalPref) {
        autocompleteDirectory = aCurrentIdentity.directoryServer;
    }

    // use a temporary to do the setup so that we don't overwrite the
    // global, then have some problem and throw an exception, and leave the
    // global with a partially setup session.  we'll assign the temp
    // into the global after we're done setting up the session
    //
    var LDAPSession;
    if (aLDAPSession) {
        LDAPSession = aLDAPSession;
    } else {
        LDAPSession = Components
            .classes["@mozilla.org/autocompleteSession;1?type=ldap"];
        if (LDAPSession) {
          try {
            LDAPSession = LDAPSession.createInstance()
                .QueryInterface(Components.interfaces.nsILDAPAutoCompleteSession);
          } catch (ex) {dumper.dump ("ERROR: Cannot get the LDAP autocomplete session\n" + ex + "\n");}
        }
    }
            
    if (autocompleteDirectory && !mailredirectIsOffline) { 
        // Add observer on the directory server we are autocompleting against
        // only if current server is different from previous.
        // Remove observer if current server is different from previous       
        aCurrentAutocompleteDirectory = autocompleteDirectory;
        if (prevAutocompleteDirectory) {
          if (prevAutocompleteDirectory != aCurrentAutocompleteDirectory) { 
            RemoveDirectorySettingsObserver(prevAutocompleteDirectory);
            AddDirectorySettingsObserver();
          }
        } else {
          AddDirectorySettingsObserver();
        }
        
        if (LDAPSession) {
	    let url = getPref(autocompleteDirectory + ".uri", true);

	    LDAPSession.serverURL =
              Components.classes["@mozilla.org/network/io-service;1"]
                        .getService(Components.interfaces.nsIIOService)
                        .newURI(url, null, null)
                        .QueryInterface(Components.interfaces.nsILDAPURL);

	    // get the login to authenticate as, if there is one
            //
            try {
                LDAPSession.login = getPref(autocompleteDirectory + ".auth.dn", true);
            } catch (ex) {
                // if we don't have this pref, no big deal
            }

            try {
                 LDAPSession.saslMechanism = getPref(autocompleteDirectory +
		    ".auth.saslmech", true);
            } catch (ex) {
                // don't care if we don't have this pref
            }

            // set the LDAP protocol version correctly
            var protocolVersion;
            try { 
	        protocolVersion = getPref(autocompleteDirectory +
                                          ".protocolVersion");
            } catch (ex) {
                // if we don't have this pref, no big deal
            }
            if (protocolVersion == "2") {
                LDAPSession.version = 
                    Components.interfaces.nsILDAPConnection.VERSION2;
            }

	    // don't search on non-CJK strings shorter than this
            //
            try {
                LDAPSession.minStringLength = getPref(
                    autocompleteDirectory + ".autoComplete.minStringLength");
            } catch (ex) {
                // if this pref isn't there, no big deal.  just let
                // nsLDAPAutoCompleteSession use its default.
            }

            // don't search on CJK strings shorter than this
            //
            try {
                LDAPSession.cjkMinStringLength = getPref(
                  autocompleteDirectory + ".autoComplete.cjkMinStringLength");
            } catch (ex) {
                // if this pref isn't there, no big deal.  just let
                // nsLDAPAutoCompleteSession use its default.
            }

            // we don't try/catch here, because if this fails, we're outta luck
            //
            var ldapFormatter = Components.classes[
                "@mozilla.org/ldap-autocomplete-formatter;1?type=addrbook"]
                .createInstance().QueryInterface(
                    Components.interfaces.nsIAbLDAPAutoCompFormatter);

            // override autocomplete name format?
            //
	    try {
                ldapFormatter.nameFormat = getPref(autocompleteDirectory +
                                                   ".autoComplete.nameFormat",
                                                   true);
            } catch (ex) {
                // if this pref isn't there, no big deal.  just let
                // nsAbLDAPAutoCompFormatter use its default.
            }

	    // override autocomplete mail address format?
            //
            try {
                ldapFormatter.addressFormat = getPref(autocompleteDirectory +
                                                      ".autoComplete.addressFormat",
                                                      true);
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
		    ldapFormatter.commentFormat = getPref(
                        autocompleteDirectory + ".description", true);
                    break;

                case 2:
		    // override ldap-specific autocomplete entry?
                    //
                    try {
                        ldapFormatter.commentFormat =
                            getPref(autocompleteDirectory +
                                    ".autoComplete.commentFormat", true);
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
	        LDAPSession.outputFormat = getPref(autocompleteDirectory +
                                                   ".autoComplete.outputFormat",
                                                   true);

            } catch (ex) {
                // if this pref isn't there, no big deal.  just let
                // nsLDAPAutoCompleteSession use its default.
            }

            // override default search filter template?
            //
            try { 
	        LDAPSession.filterTemplate = getPref(
                    autocompleteDirectory + ".autoComplete.filterTemplate",
                    true);

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

            if (!aSessionAdded) {
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
                aSessionAdded = true;
            }
        }
    } else {
      if (aCurrentAutocompleteDirectory) {
        // Remove observer on the directory server since we are not doing Ldap
        // autocompletion.
        RemoveDirectorySettingsObserver(aCurrentAutocompleteDirectory);
        aCurrentAutocompleteDirectory = null;
      }
      if (aLDAPSession && aSessionAdded) {
        for (i=1; i <= awGetMaxRecipients(); i++) 
          document.getElementById("addressCol2#" + i).
              removeSession(aLDAPSession);
        aSessionAdded = false;
      }
    }

    aLDAPSession = LDAPSession;
    aSetupLdapAutocomplete = true;
}










function queryISupportsArray(supportsArray, iid) {
    var result = new Array;
    if (!supportsArray) return result;
    for (var i=0; i<supportsArray.Count(); i++) {
      // dumper.dump(i + "," + result[i] + "\n");
      result[i] = supportsArray.QueryElementAt(i, iid);
    }
    return result;
}

function compareAccountSortOrder(account1, account2)
{
  var sortValue1, sortValue2;

  try {
    var res1 = sRDF.GetResource(account1.incomingServer.serverURI);
    sortValue1 = sAccountManagerDataSource.GetTarget(res1, sNameProperty, true).QueryInterface(Components.interfaces.nsIRDFLiteral).Value;
  }
  catch (ex) {
    dumper.dump("XXX ex ");
    if (account1 && account1.incomingServer && account1.incomingServer.serverURI)
      dumper.dump(account1.incomingServer.serverURI + ",");
    dumper.dump(ex + "\n");
    sortValue1 = "";
  }

  try {
    var res2 = sRDF.GetResource(account2.incomingServer.serverURI);
    sortValue2 = sAccountManagerDataSource.GetTarget(res2, sNameProperty, true).QueryInterface(Components.interfaces.nsIRDFLiteral).Value;
  }
  catch (ex) {
    dumper.dump("XXX ex ");
    if (account2 && account2.incomingServer && account2.incomingServer.serverURI)
      dumper.dump(account2.incomingServer.serverURI + ",");
    dumper.dump(ex + "\n");
    sortValue2 = "";
  }

  if (sortValue1 < sortValue2)
    return -1;
  else if (sortValue1 > sortValue2)
    return 1;
  else 
    return 0;
}

function FillIdentityListPopup(popup)
{
  var accounts = queryISupportsArray(aAccountManager.accounts, Components.interfaces.nsIMsgAccount);
  accounts.sort(compareAccountSortOrder);

  for (var i in accounts) {
    var server = accounts[i].incomingServer;
    if (!server || server.type == "nntp")
       continue;
    var identites = queryISupportsArray(accounts[i].identities, Components.interfaces.nsIMsgIdentity);
    for (var j in identites) {
      var identity = identites[j];
      var item = document.createElement("menuitem");
      item.className = "identity-popup-item";
      item.setAttribute("label", identity.identityName);
      item.setAttribute("value", identity.key);
      item.setAttribute("accountkey", accounts[i].key);
      item.setAttribute("accountname", " - " + server.prettyName);
      popup.appendChild(item);
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
  if (!aCurrentIdentity.autocompleteToMyDomain)
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

  if (!aSetupLdapAutocomplete)
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
    var prevIdentity = aCurrentIdentity;
    
    if (identityElement) {
        var idKey = identityElement.value;
        aCurrentIdentity = aAccountManager.getIdentity(idKey);

        // set the  account name on the menu list value.
        var accountName = identityElement.selectedItem.getAttribute('accountname');
        identityElement.setAttribute('accountname', accountName);

        if (!startup && prevIdentity && idKey != prevIdentity.key)
        {
          var prefstring = "mail.identity." + prevIdentity.key;
          RemoveDirectoryServerObserver(prefstring);
        }
      
        AddDirectoryServerObserver(false);
        if (!startup) {
	  if (getPref("mail.autoComplete.highlightNonMatches"))
	    document.getElementById('addressCol2#1').highlightNonMatches = true;

	  try {
	    setupLdapAutocompleteSession();
	  } catch (ex) {
	    // catch the exception and ignore it, so that if LDAP setup
	    // fails, the entire compose window doesn't end up horked
  	  }
	}
    }
}

function GetMsgHdrForUri (msg_uri) {
  var messenger = Components.classes["@mozilla.org/messenger;1"].createInstance()
    .QueryInterface(Components.interfaces.nsIMessenger);
  var mms = messenger.messageServiceFromURI(msg_uri)
    .QueryInterface(Components.interfaces.nsIMsgMessageService);
  var hdr = null;

  if (mms) {
    try {
      hdr = mms.messageURIToMsgHdr(msg_uri);
    } catch (ex) { }
    if (!hdr) {
      try {
	var url_o = new Object(); // return container object
	mms.GetUrlForUri(msg_uri, url_o, msgWindow);
	var url = url_o.value.QueryInterface
	  (Components.interfaces.nsIMsgMessageUrl);
	hdr = url.messageHeader;
      } catch (ex) { }
    }
  }
  if (!hdr && gDBView && gDBView.msgFolder) {
    try {
      hdr = gDBView.msgFolder.GetMessageHeader
	(gDBView.getKeyAt(gDBView.currentlyDisplayedMessage));
    } catch (ex) { }
  }

  return hdr;
}

function BounceLoad()
{
  aAccountManager = Components.classes["@mozilla.org/messenger/account-manager;1"]
    .getService(Components.interfaces.nsIMsgAccountManager);
  aPromptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
    .getService(Components.interfaces.nsIPromptService);
  mimeHeaderParser = Components.classes["@mozilla.org/messenger/headerparser;1"]
    .getService(Components.interfaces.nsIMsgHeaderParser);
  var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService().QueryInterface(Components.interfaces.nsIWindowMediator)
  var mail3paneWindow = windowMediator.getMostRecentWindow("mail:3pane");
  var currMsgWindow = windowMediator.getMostRecentWindow("mail:messageWindow");

  // First get the preferences service
  try {
    var prefService = Components.classes["@mozilla.org/preferences-service;1"]
      .getService(Components.interfaces.nsIPrefService);
    aPrefs = prefService.getBranch(null);
    aPrefBranchInternal = aPrefs.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
  }
  catch (ex) {
    dumper.dump("failed to preferences services\n");
  }

  // copy toolbar appearance settings from mail3pane
  if (mail3paneWindow) {
    var aBounceToolbar = document.getElementById('bounceToolbar');
    if (aBounceToolbar) {
      var mailBar = mail3paneWindow.document.getElementById('mail-bar');
      if (mailBar) {
	aBounceToolbar.setAttribute("iconsize", mailBar.getAttribute("iconsize"));
	aBounceToolbar.setAttribute("mode", mailBar.getAttribute("mode"));
      }
    }
  }

  try {
    sAccountManagerDataSource = Components.classes["@mozilla.org/rdf/datasource;1?name=msgaccountmanager"]
      .createInstance(Components.interfaces.nsIRDFDataSource);
    sRDF = Components.classes['@mozilla.org/rdf/rdf-service;1'].getService(Components.interfaces.nsIRDFService);
    sNameProperty = sRDF.GetResource("http://home.netscape.com/NC-rdf#Name?sort=true");
  }
  catch (ex) {
    dumper.dump("failed to get RDF\n");
  }

  AddDirectoryServerObserver(true);

  try {
    // XXX: We used to set commentColumn on the initial auto complete column after the document has loaded 
    // inside of setupAutocomplete. But this happens too late for the first widget and it was never showing
    // the comment field. Try to set it before the document finishes loading:
    if (aPrefs.getIntPref("mail.autoComplete.commentColumn"))             
      document.getElementById('addressCol2#1').showCommentColumn = true;
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
    if (aPromptService) {
      aPromptService.alert(window, errorTitle, errorMsg);
    } else {
      window.alert(errorMsg);
    }

    DoCommandClose();
    return;
  }

  // identity list
  var identityList = document.getElementById("msgIdentity");
  var identityListPopup = document.getElementById("msgIdentityPopup");

  if (identityListPopup)
    FillIdentityListPopup(identityListPopup);

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
    var identities = aAccountManager.defaultAccount.identities;
    if (identities.Count() == 0)
      identities = aAccountManager.allIdentities;
    identityList.value = identities.QueryElementAt(0, Components.interfaces.nsIMsgIdentity).key;
  } else {
    identityList.value = preSelectedIdentityKey;
  }
  LoadIdentity(true);

  // fill bounceTree with information about bounced mails

  if (mstate.selectedURIs) {
    var aTree = document.getElementById("topTreeChildren");

    var messenger = Components.classes["@mozilla.org/messenger;1"].createInstance()
     .QueryInterface(Components.interfaces.nsIMessenger);

    var dateFormatService = Components.classes["@mozilla.org/intl/scriptabledateformat;1"]
      .getService(Components.interfaces.nsIScriptableDateFormat);
    
    for (var i=0; i<mstate.size; ++i) {
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

  AddOfflineObserver();
  window.controllers.appendController(MailRedirectWindowController);

  enableEditableFields();
  AdjustFocus();
  setTimeout(awFitDummyRows, 0);

  window.onresize = function() {
    // dumper.dump('window.onresize func');
    awFitDummyRows();
  }
}

function AdjustFocus()
{
  var numOfRecipients = awGetNumberOfRecipients();
  var element = document.getElementById("addressCol2#" + numOfRecipients);
  if (element.value == "") {
    awSetFocus(numOfRecipients, element);
  }
}

function BounceUnload()
{
  // dumper.dump("\nBounceUnload from XUL\n");

  RemoveDirectoryServerObserver(null);
  RemoveOfflineObserver();
  if (aCurrentIdentity)
    RemoveDirectoryServerObserver("mail.identity." + aCurrentIdentity.key);
  if (aCurrentAutocompleteDirectory)
    RemoveDirectorySettingsObserver(aCurrentAutocompleteDirectory);
}

function disableEditableFields()
{
  var disableElements = document.getElementsByAttribute("disableonsend", "true");
  for (i=0; i<disableElements.length; i++) {
    disableElements[i].setAttribute('disabled', 'true');
  }
}

function enableEditableFields()
{
  var enableElements = document.getElementsByAttribute("disableonsend", "true");
  for (i=0; i<enableElements.length; i++) {
    enableElements[i].removeAttribute('disabled');
  }
}

function DoCommandClose()
{
  window.MeteorsStatus = null;
  window.MsgStatusFeedback = null
  window.msgSendListener = null;

  for (var i=0; i<mstate.size; ++i) {
    if (mstate.sendOperationInProgress[i]) {
      dumper.dump('aborting mail no ' + i);
      mstate.msgSendObj[i].abort();
    }
  }
  clearMState();
  window.close();
}

function DoForwardBounceWithCheck()
{
  var warn = aPrefs.getBoolPref("mail.warn_on_send_accel_key");

  if (warn) {
    var checkValue = {value:false};
    var BounceMsgsBundle = document.getElementById("bundle_mailredirect");
    var buttonPressed = aPromptService.confirmEx(window, 
        ( (mstate.size> 1) ? BounceMsgsBundle.getString('sendMessagesCheckWindowTitle') : 
        BounceMsgsBundle.getString('sendMessageCheckWindowTitle') ), 
        ( (mstate.size> 1) ?  BounceMsgsBundle.getString('sendMessagesCheckLabel') :
        BounceMsgsBundle.getString('sendMessageCheckLabel') ),
        (aPromptService.BUTTON_TITLE_IS_STRING * aPromptService.BUTTON_POS_0) +
        (aPromptService.BUTTON_TITLE_CANCEL * aPromptService.BUTTON_POS_1),
        BounceMsgsBundle.getString('sendMessageCheckSendButtonLabel'),
        null, null,
        BounceMsgsBundle.getString('CheckMsg'), 
        checkValue);
    if (buttonPressed != 0) {
      return;
    }
    if (checkValue.value) {
      aPrefs.setBoolPref("mail.warn_on_send_accel_key", false);
    }
  }
  DoForwardBounce();
}

function DoForwardBounce()
{
  mailredirectRecipients = null;
  var rec = getRecipients(true);
  if (rec.to.match(/^\s*$/) &&
      rec.cc.match(/^\s*$/) &&
      rec.bcc.match(/^\s*$/)) {
    var BounceMsgsBundle = document.getElementById("bundle_mailredirect");
    var errorTitle = BounceMsgsBundle.getString("noRecipientsTitle");
    var errorMsg = BounceMsgsBundle.getFormattedString("noRecipientsMessage", [""]);
    if (aPromptService) {
      aPromptService.alert(window, errorTitle, errorMsg);
    } else {
      window.alert(errorMsg);
    }
    return;
  } else {
    // clear some variables
    aSender = null;
    clearMState();
    RealBounceMessages();
  }
}

// we can drag and drop addresses, files, messages and urls into the compose envelope
var envelopeDragObserver = {

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
        
        if (item.flavour.contentType == "text/x-moz-address")
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
      flavourSet.appendFlavour("text/x-moz-address");      
      return flavourSet;
    }
};

/********************************************** 
  **********************************************/

  

function createTempFile()
{
  var dirService =  Components.classes["@mozilla.org/file/directory_service;1"]
    .getService(Components.interfaces.nsIProperties)
  var tmpDir = dirService.get("TmpD", Components.interfaces.nsIFile)

  var localfile = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
  localfile.initWithPath(tmpDir.path);
  localfile.appendRelativePath("mailredirect.tmp");

  try {
    localfile.createUnique(localfile.NORMAL_FILE_TYPE, 0600);
  } catch(ex) { return null; }

  return localfile;
}

function FileSpecFromLocalFile(localfile)
{
  var filespec = Components.classes["@mozilla.org/filespec;1"].createInstance(Components.interfaces.nsIFileSpec);
  filespec.nativePath = localfile.path;
  return filespec;
}

function getResentDate()
{
  var now = new Date();
  var days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  var now_string = days[now.getDay()] + ", " +
    now.getDate() + " " + months[now.getMonth()] + " " + now.getFullYear() + " ";
                      
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

  tz = tz/60;
  if (tz < 10) now_string += "0";
  now_string += tz + "00";

  return now_string;
}

// ported from /mailnews/compose/src/nsMsgCompUtils.cpp#475
function getUserAgent()
{
  var useragent = "";
  var pHTTPHandler = Components.classes["@mozilla.org/network/protocol;1?name=http"]
    .getService(Components.interfaces.nsIHttpProtocolHandler);

  if (pHTTPHandler) {
    // dumper.dump('appname = ' + pHTTPHandler.appName);
    // dumper.dump('useragent = ' + pHTTPHandler.userAgent);
    // dumper.dump('vendor = ' + pHTTPHandler.vendor);
    if (/^thunderbird$/i.test(pHTTPHandler.vendor)) {
      var pref = Components.classes["@mozilla.org/preferences-service;1"]
        .getService(Components.interfaces.nsIPrefBranch);
      var userAgentOverride;
      try {
        var userAgentOverride = pref.getCharPref("general.useragent.override");
      } catch (ex) {}

      // allow a user to override the default UA
      if (!userAgentOverride) {
        var brandStringBundle = document.getElementById("bundle_brand");
        var brandName = brandStringBundle.getString("brandShortName");

        useragent = brandName + ' ' + pHTTPHandler.vendorSub + ' (' +
            pHTTPHandler.platform + '/' + pHTTPHandler.productSub + ')';
      } else {
        useragent = userAgentOverride;
      }
    } else {
      useragent = pHTTPHandler.userAgent;
    }
  }

  return useragent;
}

// quoted-printable encoding 
function QPencode(str)
{
  // after write&try method it works..

  var mimeEncoder;
  var out;

  // in stable thunderbird 0.7.3 nsIMimeConverter interface was not implemented yet -- detect it
  try { 
    mimeEncoder = Components.classes["@mozilla.org/messenger/mimeconverter;1"]
      .getService(Components.interfaces.nsIMimeConverter);
  } catch(ex) {
    mimeEncoder = null;
  }

  if (mimeEncoder) {
    var uConv = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
      .getService(Components.interfaces.nsIScriptableUnicodeConverter);
    uConv.charset = "UTF-8";

    var msgCompFields = Components.classes["@mozilla.org/messengercompose/composefields;1"]
      .createInstance(Components.interfaces.nsIMsgCompFields);

    out = mimeEncoder.encodeMimePartIIStr_UTF8(uConv.ConvertFromUnicode(str), 
        false, msgCompFields.characterSet, 0, 72);
  } else {
    out = "";
  }

  return out;
}

function getSender()
{
  if (! aSender) {
    var hdrParser = Components.classes["@mozilla.org/messenger/headerparser;1"]
      .getService(Components.interfaces.nsIMsgHeaderParser);
    aSender = HeaderParserMakeFullAddressMR(hdrParser, QPencode(aCurrentIdentity.fullName), aCurrentIdentity.email);
  }
  return aSender;
}

function getResentHeaders()
{
  var resenthdrs = "Resent-From: " + getSender() + "\r\n";
  var recipientsStrings = getRecipients(false);
  if (recipientsStrings.to) resenthdrs += "Resent-To: " + recipientsStrings.to + "\r\n";
  if (recipientsStrings.cc) resenthdrs += "Resent-Cc: " + recipientsStrings.cc + "\r\n";
  // if (recipientsStrings.bcc) resenthdrs += "Resent-Bcc: " + recipientsStrings.bcc + "\r\n";
  resenthdrs += "Resent-Date: " + getResentDate() + "\r\n";
  var msgID = Components.classes["@mozilla.org/messengercompose/computils;1"]
    .createInstance(Components.interfaces.nsIMsgCompUtils)
    .msgGenerateMessageId(aCurrentIdentity);
  if (msgID) resenthdrs += "Resent-Message-Id: " + msgID + "\r\n";
  var useragent = getUserAgent();
  if (useragent) resenthdrs += "Resent-User-Agent: " + useragent + "\r\n";

  // dumper.dump('resent-headers\n' + resenthdrs);
  return resenthdrs;
}

function getRecipients(onlyemails)
{
  if (! mailredirectRecipients) {
    var aRecipients_sep = { to : "", cc : "", bcc : "" };
    var recipients = { to : "", cc : "", bcc : "" };
    var i = 1;
    while (inputField = awGetInputElement(i)) {
      fieldValue = inputField.value;

      if (fieldValue == null)
        fieldValue = inputField.getAttribute("value");
     
      if (fieldValue != "") { 
        var recipientType = awGetPopupElement(i).selectedItem.getAttribute("value");

        try { 
          recipient = mimeHeaderParser.reformatUnquotedAddresses(fieldValue);
        } catch (ex) {recipient = fieldValue;}
        var recipientType2;
        switch (recipientType) {
          case "addr_to"  : recipientType2 = "to";  break;
          case "addr_cc"  : recipientType2 = "cc";  break;
          case "addr_bcc" : recipientType2 = "bcc"; break;
        }
        recipients[recipientType2] += aRecipients_sep[recipientType2] + recipient;
        aRecipients_sep[recipientType2] = ",";
      }
      i++;
    }

    mailredirectRecipients = { to : [], cc : [], bcc : [] };
    for (var recipType in recipients) {
      var emails = {};
      var names = {};
      var fullnames = {};
      var numAddresses = mimeHeaderParser.parseHeadersWithArray(recipients[recipType], emails, names, fullnames);

      //dumper.dump('numAddresses[' + recipType + ']= ' + numAddresses);

      for (var i=0; i<numAddresses; ++i) {
        mailredirectRecipients[recipType][i] = { email : emails.value[i],
          name : names.value[i], fullname : fullnames.value[i] };
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
    if (onlyemails == true) {
      for (var i=0; i<count; ++i) {
        tmp[i] = mailredirectRecipients[recipType][i].email;
      }
    } else {
      for (var i=0; i<count; ++i) {
        tmp[i] = HeaderParserMakeFullAddressMR(mimeHeaderParser,
	    mailredirectRecipients[recipType][i].encname,
            mailredirectRecipients[recipType][i].email);
      }
    }

    ret[recipType] = tmp.join(', ');
    // dumper.dump('getRecipients[' + recipType + ']=' + ret[recipType]);
  }
  return ret;
}

  
var msgCompFields;
var concurrentConnections;
function RealBounceMessages()
{
  msgCompFields = Components.classes["@mozilla.org/messengercompose/composefields;1"]
    .createInstance(Components.interfaces.nsIMsgCompFields);

  msgCompFields.from = getSender();
  var recipientsStrings = getRecipients(true);
  msgCompFields.to = recipientsStrings.to;
  msgCompFields.cc = recipientsStrings.cc;
  msgCompFields.bcc = recipientsStrings.bcc;

  var pref = Components.classes["@mozilla.org/preferences-service;1"]
    .getService(Components.interfaces.nsIPrefBranch);
  var copyToSentMail = true;
  try {
    copyToSentMail = pref.getBoolPref("extensions.mailredirect.copyToSentMail");
  } catch(ex) { }

  if ( ! copyToSentMail ) {
    msgCompFields.fcc = "nocopy://";
    msgCompFields.fcc2 = "nocopy://";
  }

  disableEditableFields();

  window.MsgStatusFeedback = [];
  window.msgSendListener = [];
  window.MeteorsStatus = new nsMeteorsStatus();

  concurrentConnections = 5;
  try {
    concurrentConnections = pref.getIntPref("extensions.mailredirect.concurrentConnections");
  } catch(ex) { }

  if (concurrentConnections == 0) concurrentConnections = mstate.size;

  // dumper.dump('concurrentConnections = ' + concurrentConnections);

  for (var i = 0; i < concurrentConnections; ++i) {
    RealBounceMessage(i)
  }
  enableEditableFields();
}

function RealBounceMessage(idx)
{
  if (idx>=mstate.size) return;

  var uri = mstate.selectedURIs[idx];
  dumper.dump('RealBounceMessage(' + uri + ') [' + idx + ']');

  window.msgSendListener[idx] = new nsMsgSendListener(idx);
  window.MsgStatusFeedback[idx] = new nsMsgStatusFeedback(idx);

  var localfile = createTempFile();
  if (localfile == null) {
    // mstate.successfulSent[idx] = false;
    dumper.dump('temp localfile for idx = ' + idx + ' is null.');
    RealBounceMessage(idx+concurrentConnections);
    return;
  }

  var messenger = Components.classes["@mozilla.org/messenger;1"].createInstance()
    .QueryInterface(Components.interfaces.nsIMessenger); 
  
  var aScriptableInputStream = Components.classes["@mozilla.org/scriptableinputstream;1"]
    .createInstance(Components.interfaces.nsIScriptableInputStream);
  var aFileOutputStream = Components.classes["@mozilla.org/network/file-output-stream;1"]
    .createInstance(Components.interfaces.nsIFileOutputStream);

  var inHeader = true;
  var leftovers = "";
  var buf = "";

  var aCopyListener = {
    onStartRequest: function(aRequest, aContext) {
                      // write out Resent-* headers 
                      resenthdrs = getResentHeaders();
                      ret = aFileOutputStream.write(resenthdrs, resenthdrs.length);
                    },

    onStopRequest: function(aRequest, aContext, aStatusCode) {
                     // write leftovers
                     ret = aFileOutputStream.write(leftovers, leftovers.length);
                     aFileOutputStream.close();

                     if (aStatusCode) {
                       // mstate.successfulSent[idx] = false;
                       dumper.dump('aCopyListener.onStopRequest: aStatusCode=' + aStatusCode);
                       return;
                     }

                     // send a message 
                     var msgSend = Components.classes["@mozilla.org/messengercompose/send;1"]
                       .createInstance(Components.interfaces.nsIMsgSend);
                     mstate.msgSendObj[idx] = msgSend;

                     try {
                       msgSend.sendMessageFile(
                           aCurrentIdentity,                // in nsIMsgIdentity       aUserIdentity,
                           getCurrentAccountKey(),          // char* accountKey,
                           msgCompFields,                   // in nsIMsgCompFields     fields,
                           localfile,                        // in nsIFile          sendIFile,
                           true,                            // in PRBool               deleteSendFileOnCompletion,
                           false,                           // in PRBool               digest_p,
                           msgSend.nsMsgDeliverNow,         // in nsMsgDeliverMode     mode,
                           null,                            // in nsIMsgDBHdr          msgToReplace,
                           window.msgSendListener[idx],     // in nsIMsgSendListener   aListener,
                           window.MsgStatusFeedback[idx],   // in nsIMsgStatusFeedback aStatusFeedback,
                           null                             // in string               password
                           ); 
                     } catch(ex) {
                       switch (ex.result) {
                         // in mozilla 1.6 function has different declaration
                         case Components.results.NS_ERROR_XPC_BAD_CONVERT_JS:
                           msgSend.sendMessageFile(
                               aCurrentIdentity,                // in nsIMsgIdentity       aUserIdentity,
                               // getCurrentAccountKey(),          // char* accountKey,
                               msgCompFields,                   // in nsIMsgCompFields     fields,
                               localfile,                        // in nsIFile          sendIFile,
                               true,                            // in PRBool               deleteSendFileOnCompletion,
                               false,                           // in PRBool               digest_p,
                               msgSend.nsMsgDeliverNow,         // in nsMsgDeliverMode     mode,
                               null,                            // in nsIMsgDBHdr          msgToReplace,
                               window.msgSendListener[idx],     // in nsIMsgSendListener   aListener,
                               window.MsgStatusFeedback[idx],   // in nsIMsgStatusFeedback aStatusFeedback,
                               null                             // in string               password
                               ); 
                           break;
                         default:
                           dumper.dump('unhandled exception:\n' + ex);
                           break;
                       }
                     }

                     var msgSendReport = msgSend.sendReport;
		     if (msgSendReport) {
		       //var prompt = msgWindow.promptDialog;
		       //msgSendReport.displayReport(prompt, false /* showErrorOnly */, true /* dontShowReportTwice */);
		     } else {
		       /* If we come here it's because we got an error before we could intialize a
			  send report! */
		       dumper.dump('msgSendReport is null.');
		     }

                     // msgSend = null;
                     // dumper.dump("abc");
                   },
       
    onDataAvailable: function(aRequest, aContext, aInputStream, aOffset, aCount) {
                       // dumper.dump("ondataavail req=" + aRequest + ",contxt=" + aContext + ",input="+aInputStream + ",off=" + aOffset + ",cnt=" + aCount);
                       aScriptableInputStream.init(aInputStream);
                       var available = 0;
		       while (true) {
			 try {
			   available = aScriptableInputStream.available();
			 } catch (ex) {available = 0;}

			 if (available == 0 || !inHeader) {
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
                             if (eol_r != -1 && eol_n != -1) {
                               eol = eol_r<eol_n ? eol_r : eol_n;
                             } else if (eol_r != -1) {
                               eol = eol_r;
                             } else if (eol_n != -1) {
                               eol = eol_n;
                             }

                             if (eol == -1) {
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
                                 if ( (buf[eol] == "\r" && buf[eol+1] == "\n") ||
                                     (buf[eol] == "\n" && buf[eol+1] == "\r") ) {
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
                               // dumper.dump("line=>>"+line+"<<line_end.\nline.length=" + line.length);

                               if (line == "\r\n") {
				 ret = aFileOutputStream.write(line, line.length);
                                 inHeader = false;
				 leftovers = buf;
				 break;
                               }
                             }

                             // remove sensitive headers (vide: nsMsgSendPart.cpp)
                             // From_ line format - http://www.qmail.org/man/man5/mbox.html
                             if ( inHeader && 
                                 (/^[>]*From \S+ /.test(line) ||
                                  /^bcc: /i.test(line) ||
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
                                  0)
                                  ) {
                               // discard line 
                               //dumper.dump("forbidden line:" + line+"<<");
                             } else {
                               ret = aFileOutputStream.write(line, line.length);
                               //dumper.dump("write ret = " + ret);
                             }
                           }
                         }
		       }
		       if (!inHeader) {
		       	 // out of header -- read the rest and write to file

		     	 // convert all possible line terminations to CRLF (required by RFC822)
		   	 leftovers = leftovers.replace(/\r\n|\n\r|\r|\n/g, "\r\n");
		 	 ret = aFileOutputStream.write(leftovers, leftovers.length);
	       		 //dumper.dump("leflovers=" + leftovers+"<<end\nret=" + ret);
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
    aFileOutputStream.init(localfile, JS_FILE_NS_WRONLY | JS_FILE_NS_CREATE_FILE | JS_FILE_NS_TRUNCATE, 0600, null);
  } catch(ex) {
    dumper.dump('aFileOutputStream.init() failed.\n' + ex);
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
  statusTextFld : null,
  statusBar     : null,
  throbber      : null,
  URIidx : -1,

  ensureStatusFields : function()
    {
      // dumper.dump('ensureStatusFields');
      if (!this.statusTextFld ) this.statusTextFld = document.getElementById("statusText");
      if (!this.statusBar) this.statusBar = document.getElementById("bounce-progressmeter");
      if (!this.throbber)   this.throbber = document.getElementById("navigator-throbber");
    },

  updateStatusText : function()
  {
    // if all StatusStrings are equal show this string
    // else don't change currently showing statusstrign
    var str = mstate.statusStrings[0];
    for (var i=1; i<mstate.size; ++i) {
      if (str != mstate.statusStrings[i]) return;
    }
    // dumper.dump('setting status text to: ' + str);
    this.ensureStatusFields();
    this.statusTextFld.label = str;
  },

  QueryInterface : function(iid)
    {
     // dumper.dump('nsMsgStatusFeedback.QueryInterface ' + iid);
      if (iid.equals(Components.interfaces.nsIMsgStatusFeedback) ||
      //    iid.equals(Components.interfaces.nsIProgressEventSink) ||
          iid.equals(Components.interfaces.nsIWebProgressListener) ||
          iid.equals(Components.interfaces.nsISupportsWeakReference) ||
          iid.equals(Components.interfaces.nsISupports))
        return this;
      throw Components.results.NS_NOINTERFACE;
    },

  // nsIMsgStatusFeedback implementation.
  showStatusString : function(statusText)
    {
      // dumper.dump(this.URIidx + '. showStatusString(' + statusText + ')');
      mstate.statusStrings[this.URIidx] = statusText;
      this.updateStatusText();
  },
  startMeteors : function()
    {
      dumper.dump('startMeteors');
      mstate.statusStrings[this.URIidx] = "";
      mstate.sendOperationInProgress[this.URIidx] = true;

      window.MeteorsStatus.pendingStartRequests++;
      // if we don't already have a start meteor timeout pending
      // and the meteors aren't spinning, then kick off a start
      if (!window.MeteorsStatus.startTimeoutID && !window.MeteorsStatus.meteorsSpinning) {
        window.MeteorsStatus.startTimeoutID = setTimeout('window.MeteorsStatus._startMeteors();', 0);
	dumper.dump('[' + this .URIidx + '] ' + 'window.MeteorsStatus.startTimeoutID=' + window.MeteorsStatus.startTimeoutID);
      }

      // since we are going to start up the throbber no sense in processing
      // a stop timeout...
      if (window.MeteorsStatus.stopTimeoutID) {
        clearTimeout(window.MeteorsStatus.stopTimeoutID);
        window.MeteorsStatus.stopTimeoutID = null;
      }
    },
  stopMeteors : function()
    {
      dumper.dump('stopMeteors');
      if (mstate) mstate.sendOperationInProgress[this.URIidx] = false;

      RealBounceMessage(this.URIidx+concurrentConnections);

      if (window.MeteorsStatus.pendingStartRequests > 0)
        window.MeteorsStatus.pendingStartRequests--;
     
      // if we are going to be starting the meteors, cancel the start
      if (window.MeteorsStatus.pendingStartRequests == 0 && window.MeteorsStatus.startTimeoutID) {
        clearTimeout(window.MeteorsStatus.startTimeoutID);
        window.MeteorsStatus.startTimeoutID = null;
      }

      // if we have no more pending starts and we don't have a stop timeout already in progress
      // AND the meteors are currently running then fire a stop timeout to shut them down.
      if (window.MeteorsStatus.pendingStartRequests == 0 && !window.MeteorsStatus.stopTimeoutID) {
        window.MeteorsStatus.stopTimeoutID = setTimeout('window.MeteorsStatus._stopMeteors();', 0);
	dumper.dump('[' + this .URIidx + '] ' + 'window.MeteorsStatus.stopTimeoutID=' + window.MeteorsStatus.stopTimeoutID);
      }
  },
  showProgress : function(percentage)
    {
      // dumper.dump('showProgress(' + percentage +')');
      this.ensureStatusFields();
      if (percentage >= 0)
      {
        this.statusBar.setAttribute("mode", "normal");
        this.statusBar.value = percentage;
        this.statusBar.label = Math.round(percentage) + "%";
      }
    },
  closeWindow : function(percent)
  {
      // dumper.dump('closeWindow(' + percent +')');
  },

  // nsIProgressEventSink implementation
  /*
  onProgress : function(aRequest, aContext, aProgress, aProgressMax)
  {
    dumper.dump('statusFeedback.onProgress(' + aRequest + ', ' + aContext + ', ' + aProgress + ', ' + aProgressMax);
  },
  onStatus : function(aRequest, aContext, aStatus, aStatusArg)
  {
    dumper.dump('statusFeedback.onStatus(' + aRequest + ', ' + aContext + ', ' + aStatus + ', ' + aStatusArg);
  }
  */

  // all progress notifications are done through the nsIWebProgressListener implementation...
  onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus)
  {
    // dumper.dump(this.URIidx + '. onStateChange(' + aWebProgress + ', ' + aRequest + ', ' + aStateFlags + ', ' + aStatus + ')');
    if (aStateFlags & Components.interfaces.nsIWebProgressListener.STATE_START) {
      // dumper.dump('onStateChange STATE_START');
      mstate.sendOperationInProgress[this.URIidx] = true;
      this.ensureStatusFields();
      this.mailredirectTreeCell.setAttribute("mode", "undetermined");
      this.statusBar.setAttribute( "mode", "undetermined" );
    }
  
    if (aStateFlags & Components.interfaces.nsIWebProgressListener.STATE_STOP) {
      // dumper.dump('onStateChange STATE_STOP');
      mstate.sendOperationInProgress[this.URIidx] = false;
      this.ensureStatusFields();
      this.statusBar.setAttribute( "mode", "normal" );
      this.statusBar.setAttribute( "value", 0 );
      this.mailredirectTreeCell.removeAttribute("mode");
      this.mailredirectTreeCell.removeAttribute("value");
      this.statusTextFld.setAttribute('label', "");
    }
  },
    
  onProgressChange: function(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress)
  {
    // dumper.dump(this.URIidx + '. onProgressChange(' + aWebProgress + ', ' + aRequest.name + ', ' + aCurSelfProgress + ', ' + aMaxSelfProgress + ', ' + aCurTotalProgress + ', ' + aMaxTotalProgress + ')');

    this.ensureStatusFields();
    if ( aMaxTotalProgress > 0 ) {
      var percent = (aCurTotalProgress*100)/aMaxTotalProgress;
      if ( percent > 100 ) percent = 100;
      mstate.selectedURIsProgress[this.URIidx] = percent;
      
      // dumper.dump(this.URIidx + '. onProgressChange = ' + percent);
      percent = Math.round(percent);

      // this.statusBar.removeAttribute("mode");
      
      // Advance progress meter.
      this.mailredirectTreeCell.setAttribute("value", percent);
      this.updateStatusBar();
    } else {
      // Progress meter should be barber-pole in this case.
      this.statusBar.setAttribute( "mode", "undetermined" );
      this.mailredirectTreeCell.removeAttribute("mode");
    }
  },

  onLocationChange: function(aWebProgress, aRequest, aLocation)
  { },

  onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage)
  {
    // dumper.dump('onStatusChange(' + aWebProgress + ', ' + aRequest + ', ' + aStatus + ', ' + aMessage + ')');
    // Looks like it's possible that we get call while the document has been already delete!
    // therefore we need to protect ourself by using try/catch
    try {
      this.ensureStatusFields();
      this.showStatusString(aMessage);
    } catch (ex) {};
  },

  onSecurityChange: function(aWebProgress, aRequest, state)
  { },

  updateStatusBar : function()
  {
    var sum = 0;
    for (var i=0; i < mstate.size; sum += mstate.selectedURIsProgress[i++]) {} 
    var percent = Math.round(sum / mstate.size);
    if (percent > 100) percent = 100;

    this.statusBar.setAttribute( "value", percent);
    // dumper.dump('updateStatusBar = ' + percent);
  }
};

function nsMeteorsStatus() 
{
}

nsMeteorsStatus.prototype = {
  pendingStartRequests : 0,
  startTimeoutID : null,
  stopTimeoutID  : null,
  meteorsSpinning : false,
  statusTextFld : null,
  statusBar     : null,
  throbber      : null,

  ensureStatusFields : function()
    {
      // dumper.dump('ensureStatusFields');
      if (!this.statusTextFld ) this.statusTextFld = document.getElementById("statusText");
      if (!this.statusBar) this.statusBar = document.getElementById("bounce-progressmeter");
      if (!this.throbber)   this.throbber = document.getElementById("navigator-throbber");
    },

  _startMeteors : function()
    {
      dumper.dump('_startMeteors');

      this.ensureStatusFields();
      this.meteorsSpinning = true;
      this.startTimeoutID = null;

      // Turn progress meter on.
      this.statusBar.setAttribute("mode", "undetermined");

      // start the throbber
      if (this.throbber) this.throbber.setAttribute("busy", true);
    },

   _stopMeteors : function()
    {
      dumper.dump('_stopMeteors');

      var BounceMsgsBundle = document.getElementById("bundle_mailredirect");

      // if all mails successfully
      var success = true;
      for (var i=0; success && i<mstate.size; ++i) {
        success &= mstate.successfulSent[i];
      }

      dumper.dump('_stopMeteors: successfuly sent all messages? ' + success);
        
      var msg;
      if (success) {
        (mstate.size > 1 ) ?
          msg = BounceMsgsBundle.getString("sendMessagesSuccessful") :
          msg = BounceMsgsBundle.getString("sendMessageSuccessful");
      } else {
        (mstate.size > 1) ? 
          msg = BounceMsgsBundle.getString("sendMessagesFailed") :
          msg = BounceMsgsBundle.getString("sendMessageFailed");
      }
      this.ensureStatusFields();
      this.statusTextFld.label = msg;

      // stop the throbber
      if (this.throbber) this.throbber.setAttribute("busy", false);

      // Turn progress meter off.
      this.statusBar.setAttribute("mode","normal");
      this.statusBar.value = 0;  // be sure to clear the progress bar
      this.statusBar.label = "";

      this.meteorsSpinning = false;
      this.stopTimeoutID = null;

      if (success) {
        goDoCommand('cmd_mailredirect_close');
      } else {
        var treeChildren = document.getElementById("topTreeChildren");
        if (treeChildren) {
          var el = treeChildren.getElementsByAttribute("mode", "normal");
          for (var i=0; i<el.length; ++i) {
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
  URIidx : -1,
  mailredirectTreeRow : null,
  mailredirectTreeCell : null,

  ensureStatusFields : function() {
      // dumper.dump('msgsendlistener.ensureStatusFields');
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
  QueryInterface : function(iid) {
     // dumper.dump('nsMsgSendListener.QueryInterface ' + iid);
     if (iid.equals(Components.interfaces.nsIMsgSendListener) ||
         iid.equals(Components.interfaces.nsIMsgCopyServiceListener) ||
         iid.equals(Components.interfaces.nsISupports))
       return this;
     throw Components.results.NS_NOINTERFACE;
       },
                   
       // nsIMsgSendListener
  onStartSending : function(aMsgID, aMsgSize) {
     // dumper.dump('onStartSending(' + aMsgID + ', ' + aMsgSize);
       },
  onProgress : function(aMsgID, aProgress, aProgressMax) {
     // dumper.dump('msgSendListener.onProgress(' + aMsgID + ', ' + aProgress + ', ' + aProgressMax);
       },
  onStatus : function(aMsgID, aMsg) {
     // dumper.dump('msgSendListener.onStatus('+aMsgID+', '+aMsg);
       },
  onStopSending : function(aMsgID, aStatus, aMsg, returnFileSpec) {
     // dumper.dump(this.URIidx + '. onStopSending('+aMsgID+', '+aStatus +', '+aMsg+', '+returnFileSpec);
       
     this.ensureStatusFields();
     mstate.selectedURIsProgress[this.URIidx] = 100;
     if (aStatus) {
       this.mailredirectTreeCell.removeAttribute("mode");
       // mstate.successfulSent[this.URIidx] = false;
       this.mailredirectTreeRow.setAttribute("properties", "notsent");
       for (var i=0; i<this.mailredirectTreeRow.childNodes.length; ++i) {
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
       var messenger = Components.classes["@mozilla.org/messenger;1"].createInstance()
         .QueryInterface(Components.interfaces.nsIMessenger);
       var msgService = messenger.messageServiceFromURI(mstate.selectedURIs[this.URIidx]);
       var msgHdr = msgService.messageURIToMsgHdr(mstate.selectedURIs[this.URIidx]);
       /*
	* redirected status bug
	*
	* var keywords = msgHdr.getStringProperty("keywords");
       if (keywords.length != 0) {
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

       var msg = Components.classes["@mozilla.org/array;1"]
	 .createInstance(Components.interfaces.nsIMutableArray);
       msg.appendElement(msgHdr, false);
       try {
         msgHdr.folder.addKeywordsToMessages(msg, "redirected");
       } catch(e) {
	 dumper.dump(e);
       }
       /* End of bugfix */

     }
       },
  onSendNotPerformed : function(aMsgID, aStatus) {
     // dumper.dump(this.URIidx + '. onStopSending('+aMsgID+', '+aStatus +')');
       },
  onGetDraftFolderURI : function(aFolderURI) {
     // dumper.dump('onGetDraftFolderURI('+aFolderURI +')');
       },
       // nsIMsgCopyServiceListener
  OnStartCopy : function() {
     // dumper.dump('OnStartCopy()');
       },
  OnProgress : function(aProgress, aProgressMax) {
     // dumper.dump('OnProgress(' + aProgress + ', ' + aProgressMax + ')');
       },
  OnStopCopy : function(aStatus) {
     // dumper.dump('OnStopCopy(' + aStatus + ')');
     /*
     if (aStatus) {
       // mstate.successfulSent[this.URIidx] = false; 
     } else {
       mstate.selectedURIsProgress[this.URIidx] = 100;
     }
     */
       }
};

var MailRedirectWindowController = {
supportsCommand : function(command)
                  {
                    //dumper.dump('supportsCommand(' + command + ')');
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
                    //dumper.dump('isCommandEnabled(' + command + ') = ' + ((!mailredirectIsOffline) && (mstate.selectedURIs != null)));
                    switch(command) {
                      case "cmd_mailredirect_now":
                      case "cmd_mailredirect_withcheck":
                        return ((!mailredirectIsOffline) && (mstate.selectedURIs != null));
                      case "cmd_mailredirect_close":
                        return true;
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
           //dumper.dump('onEvent(' + event + ')');
         }
};

var MailRedirectWindowOfflineObserver = {
  observe: function(subject, topic, state) {
    // sanity checks
    if (topic != "network:offline-status-changed") return;
    if (state == "offline") {
      mailredirectIsOffline = true;
    } else {
      mailredirectIsOffline = false;
    }
    goUpdateCommand('cmd_mailredirect_now');
    goUpdateCommand('cmd_mailredirect_withcheck');
  }
}

function AddOfflineObserver()
{
  // dumper.dump('in AddOfflineObserver()');
  var observerService = Components.classes["@mozilla.org/observer-service;1"]
    .getService(Components.interfaces.nsIObserverService);
  observerService.addObserver(MailRedirectWindowOfflineObserver, "network:offline-status-changed", false);
}

function RemoveOfflineObserver()
{
  // dumper.dump('in RemoveOfflineObserver()');
  var observerService = Components.classes["@mozilla.org/observer-service;1"]
    .getService(Components.interfaces.nsIObserverService);
  observerService.removeObserver(MailRedirectWindowOfflineObserver, "network:offline-status-changed");
}

function RemoveDupAddresses()
{
  for (var recipType in mailredirectRecipients) {
    var array = [];
    for (var i in mailredirectRecipients[recipType]) {
      var recipient = mailredirectRecipients[recipType][i];
      var found = false;
      for (var j=0; j<i; ++j) {
        if (recipient.fullname.toLowerCase() == mailredirectRecipients[recipType][j].fullname.toLowerCase()) {
          // dumper.dump('found duplicate "' + recipient.fullname + '" at positions ' + i + ' and ' + j);
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

  if (top.document.commandDispatcher.focusedWindow == content)
    return content;

  var currentNode = top.document.commandDispatcher.focusedElement;
  while (currentNode)
  {
    if (currentNode == msgIdentityElement ||
        currentNode == msgAddressingWidgetTreeElement)
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

  if (focusedElement == addressingWidget) {
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
 * ported from nsMsgCompose.cpp:3904 (nsMsgCompose::CheckAndPopulateRecipients)
 */

    
var mailListArray;
var processedMailLists;
var stillNeedToSearch;

function ResolveMailLists()
{
  stillNeedToSearch = true;

  var addrbookDirArray = GetABDirectories(kAllDirectoryRoot);
  var nbrAddressbook = addrbookDirArray.length;
  for (var k=0; k<nbrAddressbook && stillNeedToSearch; ++k) {
    processedMailLists = [];
    var item = addrbookDirArray[k];
    var abDirectory = item.QueryInterface(Components.interfaces.nsIAbDirectory);
    var source = abDirectory.QueryInterface(Components.interfaces.nsIRDFResource);
    var uri = source.ValueUTF8;
    if (!abDirectory.supportsMailingLists) continue;
    mailListArray = BuildMailListArray(abDirectory);
    stillNeedToSearch = false;
    for (var recipType in mailredirectRecipients) {
      var nbrRecipients = mailredirectRecipients[recipType].length;
      var tmpRecipients = [];
      for (var m=0; m<nbrRecipients; ++m) {
        tmpRecipients = tmpRecipients.concat(ResolveMailListAddress(mailredirectRecipients[recipType][m]));
      }
      mailredirectRecipients[recipType] = tmpRecipients;
    }
  }
}

function ResolveMailListAddress(item)
{
  var result = [];
  result.push(item);

  for (var j=result.length-1; j<result.length; ++j) {
    var recipient = result[j];
    var mailListAddresses = GetMailListAddresses(recipient.fullname, mailListArray);
    var existingCards;
    if (typeof mailListAddresses.length !== "undefined") {
      existingCards = new Array(mailListAddresses.length);
      for (var cardIdx = 0; cardIdx < existingCards.length; ++cardIdx) {
	existingCards[cardIdx] = mailListAddresses.queryElementAt(cardIdx, Components.interfaces.nsIAbCard);
      }
    } else {
      existingCards = queryISupportsArray(mailListAddresses, Components.interfaces.nsIAbCard);
    }

    /* check if it's a mailing list */
    if (existingCards[0]) {
      // pop maillist address
      result.pop();
      // mark this maillist as processed to avoid possible infinitive loop
      processedMailLists[recipient.fullname] = 1;
      for (var nbrAddresses=0; nbrAddresses<existingCards.length; ++nbrAddresses) {
        var existingCard = existingCards[nbrAddresses];
        var email;
        if (existingCard.isMailList) {
          email = existingCard.notes;
        } else {
          email = existingCard.primaryEmail;
        }
        var fullNameStr = HeaderParserMakeFullAddressMR(mimeHeaderParser, existingCard.displayName, email);
        if (!fullNameStr) continue;

        /* Now we need to insert the new address into the list of recipient */
        var newRecipient = { email : email, name : existingCard.displayName, fullname : fullNameStr };
        if (existingCard.isMailList) {
          stillNeedToSearch = true;
        } else {
          // if address wasn't already processed resolve it
          if (!processedMailLists[fullNameStr]) {
            result = result.concat(ResolveMailListAddress(newRecipient));
          }
        }
      }
    }
  }
  return result;
}

var directoriesArray;
var collectedADdressbook;
function GetABDirectories(dirUri)
{
  directoriesArray = [];
  collectedAddressbook = null;

  recursiveGetABDirectories(dirUri);
  if (collectedAddressbook) directoriesArray.push(collectedAddressbook);
  return directoriesArray;
}

function recursiveGetABDirectories(dirUri)
{
  var rdfService = Components.classes["@mozilla.org/rdf/rdf-service;1"]
    .getService(Components.interfaces.nsIRDFService);
  var resource = rdfService.GetResource(dirUri);

  var directory = resource.QueryInterface(Components.interfaces.nsIAbDirectory);
  var subDirectories = directory.childNodes;
  while (subDirectories.hasMoreElements()) {
    var item = subDirectories.getNext();
    directory = item.QueryInterface(Components.interfaces.nsIAbDirectory);
    if (directory.isMailList) continue;
    var source = directory.QueryInterface(Components.interfaces.nsIRDFResource);
    var uri = source.ValueUTF8;
    if (uri == kPersonalAddressbookUri) {
      directoriesArray.unshift(directory);
    } else {
      if (uri == kCollectedAddressbookUri) {
        if (dirUri == kMDBDirectoryRoot) {
          directoriesArray.push(directory);
        } else {
          collectedAddressbook = directory;
        }
      } else {
        directoriesArray.push(directory);
      }
    }
    recursiveGetABDirectories(uri);
  }
}

function BuildMailListArray(parentDir)
{
  var array = [];
  var subDirectories = parentDir.childNodes;
  while (subDirectories.hasMoreElements()) {
    var item = subDirectories.getNext();
    var directory = item.QueryInterface(Components.interfaces.nsIAbDirectory);
    if (directory.isMailList) {
      var listName = directory.dirName;
      var listDescription = directory.description;

      // from nsMsgMailList constructor
      var email = !listDescription ? listName : listDescription;
      var parser = Components.classes["@mozilla.org/messenger/headerparser;1"]
        .getService(Components.interfaces.nsIMsgHeaderParser);
      var fullAddress = HeaderParserMakeFullAddressMR(parser, listName, email);

      var list = { fullName : fullAddress, directory : directory };
      array.push(list);
    }
  }
  return array;
}

function GetMailListAddresses(name, mailListArray)
{
  for (var i=0; i<mailListArray.length; ++i) {
    if (name.toLowerCase() == mailListArray[i].fullName.toLowerCase()) {
      var addressesArray = mailListArray[i].directory.addressLists;
      return addressesArray;
    }
  }
  return new Array();
}

function getPref(aPrefName, aIsComplex) {
  const Ci = Components.interfaces;
  const prefB = Components.classes["@mozilla.org/preferences-service;1"]
                          .getService(Ci.nsIPrefBranch);
  if (aIsComplex) {
      return prefB.getComplexValue(aPrefName, Ci.nsISupportsString).data;
  }
  switch (prefB.getPrefType(aPrefName)) {
    case Ci.nsIPrefBranch.PREF_BOOL:
      return prefB.getBoolPref(aPrefName);
    case Ci.nsIPrefBranch.PREF_INT:
      return prefB.getIntPref(aPrefName);
    case Ci.nsIPrefBranch.PREF_STRING:
      return prefB.getCharPref(aPrefName);
    default: // includes nsIPrefBranch.PREF_INVALID
      return null;
  }
}
