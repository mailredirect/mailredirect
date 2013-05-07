"use strict";

(function() {

const mailredirect_MODE_WRONLY   = 0x02;
const mailredirect_MODE_CREATE   = 0x08;
const mailredirect_MODE_TRUNCATE = 0x20;

window.MailredirectPrefs = {

  saveConsoleContent: function()
  {
    const nsIFilePicker = Components.interfaces.nsIFilePicker;

    var strbundle = document.getElementById("bundle_mailredirect-prefs");

    // open filePicker
    var filePicker = Components.classes["@mozilla.org/filepicker;1"].
                                createInstance(nsIFilePicker);
    filePicker.init(window, strbundle.getString("saveFile"), nsIFilePicker.modeSave);
    filePicker.appendFilters(nsIFilePicker.filterText);
    filePicker.appendFilters(nsIFilePicker.filterAll);
    filePicker.defaultString = "jsconsole.txt";

    let filePickerCallback = function filePickerCallbackDone(aResult) {
      if (aResult === nsIFilePicker.returnOK || aResult === nsIFilePicker.returnReplace) {
        var file = filePicker.file.QueryInterface(Components.interfaces.nsILocalFile);
        var fileStream = Components.classes["@mozilla.org/network/file-output-stream;1"].
                                    createInstance(Components.interfaces.nsIFileOutputStream);

        fileStream.init(file, mailredirect_MODE_WRONLY | mailredirect_MODE_CREATE | mailredirect_MODE_TRUNCATE, parseInt("0600", 8), null);
      
        // for every nsIConsoleMessage save it to file
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"].
                                        getService(Components.interfaces.nsIConsoleService);
        var messagesArray = {};
        // Retrieve the message array in a compatible way for both Gecko prior
        // to 19 and Gecko 19 or later 
        var messagesArray = consoleService.getMessageArray(messagesArray, {}) || messagesArray.value;
        for (var i = 0; i < messagesArray.length; ++i) {
          var m = messagesArray[i].message;
          m = i + ". " + m.replace(/^\s*[\n]+|[\n]+\s*$/g, "") + "\n";
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
      if (filePicker.show() !== Components.interfaces.nsIFilePicker.returnCancel)
      {
        filePickerCallback(nsIFilePicker.returnOK);
      }
    }
  }
}

})();