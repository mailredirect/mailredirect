"use strict";

const MODE_WRONLY   = 0x02;
const MODE_CREATE   = 0x08;
const MODE_TRUNCATE = 0x20;

function saveConsoleContent()
{
  var strbundle = document.getElementById('bundle_mailredirect-prefs');

  // open filePicker
  var filePicker = Components.classes["@mozilla.org/filepicker;1"].
                              createInstance(Components.interfaces.nsIFilePicker);
  filePicker.init(window, strbundle.getString("saveFile"), Components.interfaces.nsIFilePicker.modeSave);
  filePicker.appendFilters(Components.interfaces.nsIFilePicker.filterText);
  filePicker.appendFilters(Components.interfaces.nsIFilePicker.filterAll);
  filePicker.defaultString = "jsconsole.txt";

  if (filePicker.show() == Components.interfaces.nsIFilePicker.returnCancel)
    return;

  var file = filePicker.file.QueryInterface(Components.interfaces.nsILocalFile);
  var fileStream = Components.classes["@mozilla.org/network/file-output-stream;1"].
                              createInstance(Components.interfaces.nsIFileOutputStream);

  fileStream.init(file, MODE_WRONLY | MODE_CREATE | MODE_TRUNCATE, parseInt("0600", 8), null);

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
