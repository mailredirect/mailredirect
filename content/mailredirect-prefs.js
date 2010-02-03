// need to be global variable
// List of persisted elements (required by seamonkey to save prefs)
var _elementIDs = ["copyToSentMail", "debug", "concurrentConnections"];
    
function initPrefs()
{
  // initialize the default window values...
  for (var i = 0; i < _elementIDs.length; i++) {
    var elementID = _elementIDs[i];
    var element = document.getElementById(elementID);
    if (!element) break;
    var eltType = element.localName;
    if (eltType == "radiogroup") {
      var num = element.childNodes[nsPreferences.getIntPref(element.getAttribute("prefstring"),
          parseInt(element.getAttribute("prefdefval")))];
      element.selectedItem = document.getElementById(elementID + num);
    } else if (eltType == "checkbox") {
      element.checked = nsPreferences.getBoolPref(element.getAttribute("prefstring"),
          parseInt(element.getAttribute("prefdefval")));
    } else if (eltType == "textbox") {
      if (element.getAttribute("preftype") == "int") {
        element.value = nsPreferences.getIntPref(element.getAttribute("prefstring"),
            parseInt(element.getAttribute("prefdefval")));
      }
    }
  }
}

function savePrefs()
{
  for (var i = 0; i < _elementIDs.length; i++) {
    var elementID = _elementIDs[i];

    var element = document.getElementById(elementID);
    if (!element) break;
    var eltType = element.localName;

    if (eltType == "radiogroup") {
      nsPreferences.setIntPref(element.getAttribute("prefstring"), parseInt(element.value));
    } else if (eltType == "checkbox") {
      nsPreferences.setBoolPref(element.getAttribute("prefstring"), element.checked);
    } else if (eltType == "textbox") {
      if (element.getAttribute("preftype") == "int") {
        nsPreferences.setIntPref(element.getAttribute("prefstring"), parseInt(element.value));
      }
    } 
  }
}

function saveConsoleContent()
{
  // open filePicker
  var filePicker = Components.classes["@mozilla.org/filepicker;1"].createInstance()
    .QueryInterface(Components.interfaces.nsIFilePicker);
  filePicker.init(window, "Save JavaScript Console content as", filePicker.modeSave);
  filePicker.appendFilters(filePicker.filterText);
  filePicker.appendFilters(filePicker.filterAll);
  filePicker.defaultString = "jsconsole.txt";

  if (filePicker.show() == filePicker.returnCancel)
    return;

  var file = filePicker.file.QueryInterface(Components.interfaces.nsILocalFile);
  var fileStream = Components.classes["@mozilla.org/network/file-output-stream;1"]
    .createInstance(Components.interfaces.nsIFileOutputStream);
    
  const JS_FILE_NS_WRONLY               = 0x02;
  const JS_FILE_NS_CREATE_FILE          = 0x08;
  const JS_FILE_NS_TRUNCATE             = 0x20;
  fileStream.init(file, JS_FILE_NS_WRONLY | JS_FILE_NS_CREATE_FILE | JS_FILE_NS_TRUNCATE, 0600, null);

  // for every nsIConsoleMessage save it to file
  var aConsoleService = Components.classes["@mozilla.org/consoleservice;1"]
    .getService(Components.interfaces.nsIConsoleService);
  var messagesArray = {};
  var count = {};
  aConsoleService.getMessageArray(messagesArray, count);
  for (var i=0; i<count.value; ++i) {
    var m = messagesArray.value[i].message;
    m = i + '. ' + m.replace(/^\s*[\n]+|[\n]+\s*$/g, "") + '\n';
    fileStream.write(m, m.length);
  }
  fileStream.close();
}

// functions for seamonkey
function initSeamonkey()
{
  parent.initPanel('chrome://mailredirect/content/mailredirect-prefs-moz.xul');
}

function doUninstall()
{
  var bundleSettings = document.getElementById("bundle_mailredirect-prefs");

  if (window.confirm(bundleSettings.getString("confirmUninstall"))) {
    var unreg = new exUnregisterer(
        'chrome://mailredirect/content/contents.rdf',
        'jar:%chromeFolder%mailredirect.jar!/locale/en-US/mailredirect/contents.rdf',
        'jar:%chromeFolder%mailredirect-skin-moz.jar!/skin/classic/mailredirect/contents.rdf',
        'jar:%chromeFolder%mailredirect-skin-moz.jar!/skin/modern/mailredirect/contents.rdf',
        'jar:%chromeFolder%mailredirect-skin.jar!/skin/classic/mailredirect/contents.rdf'
        );
    unreg.unregister();

    if( window.confirm(bundleSettings.getString("confirmDeletePrefs")) ) {
      unreg.removePrefs('extensions.mailredirect');
    }

    var button = document.getElementById("uninstallButton");
    button.setAttribute("label", bundleSettings.getString("uninstalledInfo"));
    button.setAttribute("disabled", "true");

    window.alert(bundleSettings.getString("infoAfterUninstallation"));
    // window.close();
  }
}
