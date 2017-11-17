"use strict";

(function() {

const Cc = Components.classes, Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource:///modules/mailServices.js");

const mailredirect_MODE_WRONLY   = 0x02;
const mailredirect_MODE_CREATE   = 0x08;
const mailredirect_MODE_TRUNCATE = 0x20;

window.MailredirectPrefs = {

  onload: function()
  {
    MailredirectPrefs.init();
    MailredirectPrefs.updateDefaultMode();
  },

  init: function()
  {
    var prefService = Cc["@mozilla.org/preferences-service;1"].
                      getService(Ci.nsIPrefService);
    var defaultBranch = prefService.getDefaultBranch("extensions.mailredirect.");
    defaultBranch.setBoolPref("copyToSentMail", true);
    defaultBranch.setIntPref("concurrentConnections", 5);
    defaultBranch.setCharPref("defaultResentTo", "");
    defaultBranch.setCharPref("defaultResentCc", "");
    defaultBranch.setCharPref("defaultResentBcc", "");
    defaultBranch.setCharPref("defaultMode", "addr_to");
    defaultBranch.setBoolPref("debug", false);
    defaultBranch.setIntPref("addresswidget.numRowsShownDefault", 3);
    defaultBranch.setBoolPref("firstrun.button-contacts", false);
  },

  updateDefaultMode: function()
  {
    var defaultResendTo = document.getElementById("defaultResendTo");
    var defaultResendCc = document.getElementById("defaultResendCc");
    var defaultResendBcc = document.getElementById("defaultResendBcc");
    var defaultMode = document.getElementById("defaultMode");
    defaultMode.disabled = !(defaultResendTo.value.match(/^\s*$/) &&
                             defaultResendCc.value.match(/^\s*$/) &&
                             defaultResendBcc.value.match(/^\s*$/));
  },

  saveConsoleContent: function()
  {
    const nsIFilePicker = Ci.nsIFilePicker;

    var strbundle = document.getElementById("bundle_mailredirect-prefs");

    // open filePicker
    var filePicker = Cc["@mozilla.org/filepicker;1"].
                     createInstance(nsIFilePicker);
    filePicker.init(window, strbundle.getString("saveFile2"), nsIFilePicker.modeSave);
    filePicker.appendFilters(nsIFilePicker.filterText);
    filePicker.appendFilters(nsIFilePicker.filterAll);
    filePicker.defaultString = "errorconsole.txt";

    let filePickerCallback = function filePickerCallbackDone(aResult) {
      if (aResult === nsIFilePicker.returnOK || aResult === nsIFilePicker.returnReplace) {
        var file = filePicker.file.QueryInterface(Ci.nsILocalFile);
        var fileStream = Cc["@mozilla.org/network/file-output-stream;1"].
                         createInstance(Ci.nsIFileOutputStream);

        fileStream.init(file, mailredirect_MODE_WRONLY | mailredirect_MODE_CREATE | mailredirect_MODE_TRUNCATE, parseInt("0600", 8), null);

        // for every nsIConsoleMessage save it to file
        var consoleService = Cc["@mozilla.org/consoleservice;1"].
                             getService(Ci.nsIConsoleService);
        var messagesArray = {};
        // Retrieve the message array in a compatible way for both Gecko prior
        // to 19 and Gecko 19 or later
        var messagesArray = consoleService.getMessageArray(messagesArray, {}) || messagesArray.value;
        for (var i = 0; i < messagesArray.length; ++i) {
          var m = messagesArray[i].message;
          m = (i+1) + ". " + m.replace(/^\s*[\n]+|[\n]+\s*$/g, "") + "\n";
          fileStream.write(m, m.length);
        }
        fileStream.close();
      }
    }

    try {
      // Gecko 17+: Open the dialog asynchronously
      filePicker.open(filePickerCallback);
    } catch (ex) {
      // Deprecated since Gecko 17: Display the file picker dialog
      if (filePicker.show() !== Ci.nsIFilePicker.returnCancel) {
        filePickerCallback(nsIFilePicker.returnOK);
      }
    }
  },

  sendViaEmail: function()
  {
    try {
      var tempFile = Cc["@mozilla.org/file/directory_service;1"].
                 getService(Ci.nsIProperties).
                 get("TmpD", Ci.nsIFile);
      tempFile.append("errorconsole.txt");
      tempFile.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, parseInt("0600", 8));
      var tempUri = Services.io.newFileURI(tempFile);
      var fileStream = Cc["@mozilla.org/network/file-output-stream;1"].
                   createInstance(Ci.nsIFileOutputStream);
      fileStream.init(tempFile, mailredirect_MODE_WRONLY | mailredirect_MODE_CREATE | mailredirect_MODE_TRUNCATE, parseInt("0600", 8), 0);
      let dataTxt = "";

      // for every nsIConsoleMessage save it to file
      var consoleService = Cc["@mozilla.org/consoleservice;1"].
                           getService(Ci.nsIConsoleService);
      var messagesArray = {};
      // Retrieve the message array in a compatible way for both Gecko prior
      // to 19 and Gecko 19 or later
      var messagesArray = consoleService.getMessageArray(messagesArray, {}) || messagesArray.value;
      for (var i = 0; i < messagesArray.length; ++i) {
        var m = messagesArray[i].message;
        m = (i+1) + ". " + m.replace(/^\s*[\n]+|[\n]+\s*$/g, "") + "\n";
        fileStream.write(m, m.length);
      }
      fileStream.close();

      // Set up parameters and fields to use for the compose window.
      let params = Cc["@mozilla.org/messengercompose/composeparams;1"].
                   createInstance(Ci.nsIMsgComposeParams);
      params.type = Ci.nsIMsgCompType.New;
      params.format = Ci.nsIMsgCompFormat.Default;

      let fields = Cc["@mozilla.org/messengercompose/composefields;1"]
                     .createInstance(Ci.nsIMsgCompFields);
      fields.forcePlainText = false;
      fields.body = dataTxt;
      // In general we can have non-ASCII characters, and compose's charset
      // detection doesn't seem to work when the HTML part is pure ASCII but the
      // text isn't. So take the easy way out and force UTF-8.
      fields.characterSet = "UTF-8";
      fields.bodyIsAsciiOnly = false;

      let attachment = Cc["@mozilla.org/messengercompose/attachment;1"].
                       createInstance(Ci.nsIMsgAttachment);
      // resolveURI does all the magic around working out what the
      // attachment is, including web pages, and generating the correct uri.
      let commandLine = Cc["@mozilla.org/toolkit/command-line;1"].
                        createInstance();
      let uri = commandLine.resolveURI(tempFile.path);
      // If uri is for a file and it exists set the attachment size.
      if (uri instanceof Ci.nsIFileURL) {
        if (uri.file.exists())
          attachment.size = uri.file.fileSize;
        else
          attachment = null;
      }
      attachment.url = uri.spec;
      fields.addAttachment(attachment);
      params.composeFields = fields;

      // Our params are set up. Now open a compose window.
      MailServices.compose.OpenComposeWindowWithParams(null, params);
    } catch (ex) {
      Components.utils.reportError(ex);
      var PrefsBundle = document.getElementById("bundle_mailredirect-prefs");
      var errorTitle = PrefsBundle.getString("tempFileErrorDlogTitle");
      var errorMsg = PrefsBundle.getString("tempFileErrorDlogMessage");
      Services.prompt.alert(window, errorTitle, errorMsg);
    }
  }
}

})();
