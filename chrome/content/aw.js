
top.MAX_RECIPIENTS = 1;

var aInputElementType = "";
var aSelectElementType = "";
var selectElementIndexTable = null;

var aNumberOfCols = 0;

var aDragService = Components.classes["@mozilla.org/widget/dragservice;1"].getService()
  .QueryInterface(Components.interfaces.nsIDragService);

var dumper = new myDump();

function awGetMaxRecipients()
{
  return top.MAX_RECIPIENTS;
}

function awGetNumberOfCols()
{
  if (aNumberOfCols == 0)
  {
    var listbox = document.getElementById('addressingWidget');
    var listCols = listbox.getElementsByTagName('listcol');
    aNumberOfCols = listCols.length;
    if (!aNumberOfCols)
      aNumberOfCols = 1;  /* if no cols defined, that means we have only one! */
  }

  return aNumberOfCols;
}


function awInputElementName()
{
    if (aInputElementType == "")
        aInputElementType = document.getElementById("addressCol2#1").localName;
    return aInputElementType;
}

function awSelectElementName()
{
    if (aSelectElementType == "")
        aSelectElementType = document.getElementById("addressCol1#1").localName;
    return aSelectElementType;
}

function awGetSelectItemIndex(itemData)
{
    if (selectElementIndexTable == null)
    {
      selectElementIndexTable = new Object();
      var selectElem = document.getElementById("addressCol1#1");
        for (var i = 0; i < selectElem.childNodes[0].childNodes.length; i ++)
    {
            var aData = selectElem.childNodes[0].childNodes[i].getAttribute("value");
            selectElementIndexTable[aData] = i;
        }
    }
    return selectElementIndexTable[itemData];
}

function awSetInputAndPopupValue(inputElem, inputValue, popupElem, popupValue, rowNumber)
{
  // remove leading spaces
  while (inputValue && inputValue[0] == " " )
    inputValue = inputValue.substring(1, inputValue.length);

  inputElem.setAttribute("value", inputValue);
  inputElem.value = inputValue;

  popupElem.selectedItem = popupElem.childNodes[0].childNodes[awGetSelectItemIndex(popupValue)];

  if (rowNumber >= 0)
  {
    inputElem.setAttribute("id", "addressCol2#" + rowNumber);
    popupElem.setAttribute("id", "addressCol1#" + rowNumber);
  }

  _awSetAutoComplete(popupElem, inputElem);
}

function _awSetInputAndPopup(inputValue, popupValue, parentNode, templateNode)
{
    top.MAX_RECIPIENTS++;

    var newNode = templateNode.cloneNode(true);
    parentNode.appendChild(newNode); // we need to insert the new node before we set the value of the select element!

    var input = newNode.getElementsByTagName(awInputElementName());
    var select = newNode.getElementsByTagName(awSelectElementName());

    if (input && input.length == 1 && select && select.length == 1)
      awSetInputAndPopupValue(input[0], inputValue, select[0], popupValue, top.MAX_RECIPIENTS)
}

// this was broken out of awAddRecipients so it can be re-used...adds a new row matching recipientType and
// drops in the single address.
function awAddRecipient(recipientType, address)
{
  dumper.dump('awAddRecipient('+address+')');
  for (var row = 1; row <= top.MAX_RECIPIENTS; row ++)
  {
    if (awGetInputElement(row).value == "")
      break;
  }

  if (row > top.MAX_RECIPIENTS)
    awAppendNewRow(false);

  awSetInputAndPopupValue(awGetInputElement(row), address, awGetPopupElement(row), recipientType, row);

  /* be sure we still have an empty row left at the end */
  if (row == top.MAX_RECIPIENTS)
  {
    awAppendNewRow(true);
    awSetInputAndPopupValue(awGetInputElement(top.MAX_RECIPIENTS), "", awGetPopupElement(top.MAX_RECIPIENTS), "addr_to", top.MAX_RECIPIENTS);
  }
}

function awCleanupRows()
{
  var maxRecipients = top.MAX_RECIPIENTS;
  var rowID = 1;

  for (var row = 1; row <= maxRecipients; row ++)
  {
    var inputElem = awGetInputElement(row);
    if (inputElem.value == "" && row < maxRecipients)
      awRemoveRow(row);
    else
    {
      inputElem.setAttribute("id", "addressCol2#" + rowID);
      awGetPopupElement(row).setAttribute("id", "addressCol1#" + rowID);
      rowID ++;
    }
  }
}

function awDeleteRow(rowToDelete)
{
  /* When we delete a row, we must reset the id of others row in order to not break the sequence */
  var maxRecipients = top.MAX_RECIPIENTS;
  awRemoveRow(rowToDelete);

  var numberOfCols = awGetNumberOfCols();
  for (var row = rowToDelete + 1; row <= maxRecipients; row ++)
    for (var col = 1; col <= numberOfCols; col++)
      awGetElementByCol(row, col).setAttribute("id", "addressCol" + (col) + "#" + (row-1));
}

function awClickEmptySpace(target, setFocus)
{
  // dumper.dump('awClickEmptySpace(' + target.localName + ', ' + setFocus);
  if (target == null ||
      (target.localName != "listboxbody" &&
      target.localName != "listcell" &&
      target.localName != "listitem"))
    return;

  var lastInput = awGetInputElement(top.MAX_RECIPIENTS);

  if ( lastInput && lastInput.value ) {
    awAppendNewRow(setFocus);
  } else {
    if (setFocus)
      awSetFocus(top.MAX_RECIPIENTS, lastInput);
  }
}

function awReturnHit(inputElement)
{
  var row = awGetRowByInputElement(inputElement);
  var nextInput = awGetInputElement(row+1);

  if ( !nextInput ) {
    if (inputElement.value) awAppendNewRow(true);
  } else {
    nextInput.select();
    awSetFocus(row+1, nextInput);
  }
}

function awDeleteHit(inputElement)
{
  var row = awGetRowByInputElement(inputElement);

  /* 1. don't delete the row if it's the last one remaining, just reset it! */
  if (top.MAX_RECIPIENTS <= 1)
  {
    inputElement.value = "";
    return;
  }

  /* 2. Set the focus to the previous field if possible */
  if (row > 1)
    awSetFocus(row - 1, awGetInputElement(row - 1))
  else
    awSetFocus(1, awGetInputElement(2))   /* We have to cheat a little bit because the focus will */
                                          /* be set asynchronusly after we delete the current row, */
                                          /* therefore the row number still the same! */

  /* 3. Delete the row */
  awDeleteRow(row);
}

function awAppendNewRow(setFocus)
{
  // dumper.dump("awAppendNewRow(" + top.MAX_RECIPIENTS + ")");
  var listbox = document.getElementById('addressingWidget');
  var listitem1 = awGetListItem(1);

  if ( listbox && listitem1 )
  {
    var lastRecipientType = awGetPopupElement(top.MAX_RECIPIENTS).selectedItem.getAttribute("value");

    var nextDummy = awGetNextDummyRow();
    var newNode = listitem1.cloneNode(true);
    if (nextDummy)
      listbox.replaceChild(newNode, nextDummy);
    else
      listbox.appendChild(newNode);

    top.MAX_RECIPIENTS++;

    var input = newNode.getElementsByTagName(awInputElementName());
    if ( input && input.length == 1 )
    {
      input[0].setAttribute("value", "");
      input[0].setAttribute("id", "addressCol2#" + top.MAX_RECIPIENTS);

      //this copies the autocomplete sessions list from recipient#1

      input[0].syncSessions(document.getElementById('addressCol2#1'));

  	  // also clone the showCommentColumn setting
  	  //
  	  input[0].showCommentColumn =
	      document.getElementById("addressCol2#1").showCommentColumn;

      // We always clone the first row.  The problem is that the first row
      // could be focused.  When we clone that row, we end up with a cloned
      // XUL textbox that has a focused attribute set.  Therefore we think
      // we're focused and don't properly refocus.  The best solution to this
      // would be to clone a template row that didn't really have any presentation,
      // rather than using the real visible first row of the listbox.
      //
      // For now we'll just put in a hack that ensures the focused attribute
      // is never copied when the node is cloned.
      if (input[0].getAttribute('focused') != '')
        input[0].removeAttribute('focused');
    }
    var select = newNode.getElementsByTagName(awSelectElementName());
    if ( select && select.length == 1 )
    {
      select[0].selectedItem = select[0].childNodes[0].childNodes[awGetSelectItemIndex(lastRecipientType)];
      select[0].setAttribute("id", "addressCol1#" + top.MAX_RECIPIENTS);
      if (input)
        _awSetAutoComplete(select[0], input[0]);
    }

    // focus on new input widget
    if (setFocus && input[0] )
      awSetFocus(top.MAX_RECIPIENTS, input[0]);
  }
}

// functions for accessing the elements in the addressing widget

function awGetPopupElement(row)
{
    return document.getElementById("addressCol1#" + row);
}

function awGetInputElement(row)
{
  return document.getElementById("addressCol2#" + row);
}

function awGetElementByCol(row, col)
{
  var colID = "addressCol" + col + "#" + row;
  return document.getElementById(colID);
}

function awGetListItem(row)
{
  var listbox = document.getElementById('addressingWidget');

  if ( listbox && row > 0)
  {
    var listitems = listbox.getElementsByTagName('listitem');
    if ( listitems && listitems.length >= row )
      return listitems[row-1];
  }
  return 0;
}

function awGetRowByInputElement(inputElement)
{
  var row = 0;
  if (inputElement) {
    var listitem = inputElement.parentNode.parentNode;
    while (listitem) {
      if (listitem.localName == "listitem")
        ++row;
      listitem = listitem.previousSibling;
    }
  }
  return row;
}

// remove row

function awRemoveRow(row)
{
  var listbox = document.getElementById('addressingWidget');

  awRemoveNodeAndChildren(listbox, awGetListItem(row));
  awFitDummyRows();

  top.MAX_RECIPIENTS --;
}

function awRemoveNodeAndChildren(parent, nodeToRemove)
{
  nodeToRemove.parentNode.removeChild(nodeToRemove);
}

function awSetFocus(row, inputElement)
{
  top.awRow = row;
  top.awInputElement = inputElement;
  top.awFocusRetry = 0;
  setTimeout("_awSetFocus();", 0);
}

function _awSetFocus()
{
  var listbox = document.getElementById('addressingWidget');
  //try
  //{
    var theNewRow = awGetListItem(top.awRow);

    //Warning: firstVisibleRow is zero base but top.awRow is one base!
    var firstVisibleRow = listbox.getIndexOfFirstVisibleRow();
    var numOfVisibleRows = listbox.getNumberOfVisibleRows();

    //Do we need to scroll in order to see the selected row?
    if (top.awRow <= firstVisibleRow)
      listbox.scrollToIndex(top.awRow - 1);
    else
      if (top.awRow - 1 >= (firstVisibleRow + numOfVisibleRows))
        listbox.scrollToIndex(top.awRow - numOfVisibleRows);

    top.awInputElement.focus();
  /*}
  catch(ex)
  {
    top.awFocusRetry ++;
    if (top.awFocusRetry < 3)
    {
      dumper.dump("_awSetFocus failed, try it again...\n");
      setTimeout("_awSetFocus();", 0);
    }
    else
      dumper.dump("_awSetFocus failed, forget about it!\n");
  }*/
}

function awTabFromRecipient(element, event)
{
  //If we are le last element in the listbox, we don't want to create a new row.
  if (element == awGetInputElement(top.MAX_RECIPIENTS))
    top.doNotCreateANewRow = true;

  var row = awGetRowByInputElement(element);
  if (!event.shiftKey && row < top.MAX_RECIPIENTS) {
    var listBoxRow = row - 1; // listbox row indices are 0-based, ours are 1-based.
    var listBox = document.getElementById("addressingWidget");
    listBox.listBoxObject.ensureIndexIsVisible(listBoxRow + 1);
  }
}

function awTabFromMenulist(element, event)
{
  var row = awGetRowByInputElement(element);
  if (event.shiftKey && row > 1) {
    var listBoxRow = row - 1; // listbox row indices are 0-based, ours are 1-based.
    var listBox = document.getElementById("addressingWidget");
    listBox.listBoxObject.ensureIndexIsVisible(listBoxRow - 1);
  }
}

function awGetNumberOfRecipients()
{
    return top.MAX_RECIPIENTS;
}

function DragOverAddressingWidget(event)
{
  var validFlavor = false;
  var dragSession = dragSession = aDragService.getCurrentSession();

  if (dragSession.isDataFlavorSupported("text/x-moz-address"))
    validFlavor = true;

  if (validFlavor)
    dragSession.canDrop = true;
}

function DropOnAddressingWidget(event)
{
  var dragSession = aDragService.getCurrentSession();

  var trans = Components.classes["@mozilla.org/widget/transferable;1"].createInstance(Components.interfaces.nsITransferable);
  trans.addDataFlavor("text/x-moz-address");

  for ( var i = 0; i < dragSession.numDropItems; ++i )
  {
    dragSession.getData ( trans, i );
    var dataObj = new Object();
    var bestFlavor = new Object();
    var len = new Object();
    trans.getAnyTransferData ( bestFlavor, dataObj, len );
    if ( dataObj )
      dataObj = dataObj.value.QueryInterface(Components.interfaces.nsISupportsString);
    if ( !dataObj )
      continue;

    // pull the address out of the data object
    var address = dataObj.data.substring(0, len.value);
    if (!address)
      continue;

    DropRecipient(event.target, address);
  }
}

function DropRecipient(target, recipient)
{
  // break down and add each address
  return parseAndAddAddresses(recipient, awGetPopupElement(top.MAX_RECIPIENTS).selectedItem.getAttribute("value"));
}

function _awSetAutoComplete(selectElem, inputElem)
{
  inputElem.disableAutocomplete = false;
}

function awSetAutoComplete(rowNumber)
{
    var inputElem = awGetInputElement(rowNumber);
    var selectElem = awGetPopupElement(rowNumber);
    _awSetAutoComplete(selectElem, inputElem)
}

function awRecipientTextCommand(userAction, element)
{
  if (userAction == "typing" || userAction == "scrolling")
    awReturnHit(element);
}

function awRecipientKeyPress(event, element)
{
  switch(event.keyCode) {
  case KeyEvent.DOM_VK_UP:
    awArrowHit(element, -1);
    break;
  case KeyEvent.DOM_VK_DOWN:
    awArrowHit(element, 1);
    break;
  case KeyEvent.DOM_VK_RETURN:
  case KeyEvent.DOM_VK_TAB:
    // if the user text contains a comma or a line return, ignore
    if (element.value.search(',') != -1)
    {
      var addresses = element.value;
      element.value = ""; // clear out the current line so we don't try to autocomplete it..
      parseAndAddAddresses(addresses, awGetPopupElement(awGetRowByInputElement(element)).selectedItem.getAttribute("value"));
    }
    else if (event.keyCode == KeyEvent.DOM_VK_TAB)
      awTabFromRecipient(element, event);

    break;
  }
}

function awArrowHit(inputElement, direction)
{
  var row = awGetRowByInputElement(inputElement) + direction;
  if (row) {
    var nextInput = awGetInputElement(row);

    if (nextInput)
      awSetFocus(row, nextInput);
    else if (inputElement.value)
      awAppendNewRow(true);
  }
}

function awRecipientKeyDown(event, element)
{
  switch(event.keyCode) {
  case 46:
  case 8:
    /* do not query directly the value of the text field else the autocomplete widget could potentially
       alter it value while doing some internal cleanup, instead, query the value through the first child
    */
    if (!element.value)
      awDeleteHit(element);
    event.preventBubble();  //We need to stop the event else the listbox will receive it and the function
                            //awKeyDown will be executed!
    break;
  }
}

function awKeyDown(event, listboxElement)
{
  switch(event.keyCode) {
  case 46:
  case 8:
    /* Warning, the listboxElement.selectedItems will change everytime we delete a row */
    var selItems = listboxElement.selectedItems;
    var length = listboxElement.selectedItems.length;
    for (var i = 1; i <= length; i++) {
      var inputs = listboxElement.selectedItems[0].getElementsByTagName(awInputElementName());
      if (inputs && inputs.length == 1)
        awDeleteHit(inputs[0]);
    }
    break;
  }
}

function awMenulistKeyPress(event, element)
{
  switch(event.keyCode) {
  case 9:
    awTabFromMenulist(element, event);
    break;
  }
}

/* ::::::::::: addressing widget dummy rows ::::::::::::::::: */

var aAWContentHeight = 0;
var aAWRowHeight = 0;

function awFitDummyRows()
{
  awCalcContentHeight();
  awCreateOrRemoveDummyRows();
}

function awCreateOrRemoveDummyRows()
{
  var listbox = document.getElementById("addressingWidget");
  var listboxHeight = listbox.boxObject.height;

  // dumper.dump('aAWContentHeight = ' + aAWContentHeight + '; listboxHeight = ' + listboxHeight);

  // remove rows to remove scrollbar
  var kids = listbox.childNodes;
  for (var i = kids.length-1; aAWContentHeight > listboxHeight && i >= 0; --i) {
    if (kids[i].hasAttribute("_isDummyRow")) {
      aAWContentHeight -= aAWRowHeight;
      listbox.removeChild(kids[i]);
    }
  }

  // add rows to fill space
  if (aAWRowHeight) {
    while (aAWContentHeight+aAWRowHeight < listboxHeight) {
      awCreateDummyItem(listbox);
      aAWContentHeight += aAWRowHeight;
    }
  }
}

function awCalcContentHeight()
{
  var listbox = document.getElementById("addressingWidget");
  var items = listbox.getElementsByTagName("listitem");

  aAWContentHeight = 0;
  if (items.length > 0) {
    // all rows are forced to a uniform height in xul listboxes, so
    // find the first listitem with a boxObject and use it as precedent
    var i = 0;
    do {
      aAWRowHeight = items[i].boxObject.height;
      ++i;
    } while (i < items.length && !aAWRowHeight);
    aAWContentHeight = aAWRowHeight*items.length;
  }
}

function awCreateDummyItem(aParent)
{
  var titem = document.createElement("listitem");
  titem.setAttribute("_isDummyRow", "true");
  titem.setAttribute("class", "dummy-row");

  for (var i = awGetNumberOfCols(); i > 0; i--)
    awCreateDummyCell(titem);

  if (aParent)
    aParent.appendChild(titem);

  return titem;
}

function awCreateDummyCell(aParent)
{
  var cell = document.createElement("listcell");
  cell.setAttribute("class", "addressingWidgetCell dummy-row-cell");
  if (aParent)
    aParent.appendChild(cell);

  return cell;
}

function awGetNextDummyRow()
{
  // gets the next row from the top down
  var listbox = document.getElementById("addressingWidget");
  var kids = listbox.childNodes;
  for (var i = 0; i < kids.length; ++i) {
    if (kids[i].hasAttribute("_isDummyRow"))
      return kids[i];
  }
  return null;
}

function awSizerListen()
{
  // when splitter is clicked, fill in necessary dummy rows each time the mouse is moved
  awCalcContentHeight(); // precalculate
  document.addEventListener("mousemove", awSizerMouseMove, true);
  document.addEventListener("mouseup", awSizerMouseUp, false);
}

function awSizerMouseMove()
{
  awCreateOrRemoveDummyRows();
}

function awSizerMouseUp()
{
  document.removeEventListener("mousemove", awSizerMouseMove, true);
  document.removeEventListener("mouseup", awSizerMouseUp, false);
}

// Given an arbitrary block of text like a comma delimited list of names or a names separated by spaces,
// we will try to autocomplete each of the names and then take the FIRST match for each name, adding it the
// addressing widget on the compose window.

var aAutomatedAutoCompleteListener = null;

function parseAndAddAddresses(addressText, recipientType)
{
  // strip any leading >> characters inserted by the autocomplete widget
  var strippedAddresses = addressText.replace(/.* >> /, "");

  var hdrParser = Components.classes["@mozilla.org/messenger/headerparser;1"]
    .getService(Components.interfaces.nsIMsgHeaderParser);
  var addresses = {};
  var names = {};
  var fullNames = {};
  var numAddresses = hdrParser.parseHeadersWithArray(strippedAddresses, addresses, names, fullNames);

  if (numAddresses > 0)
  {
    // we need to set up our own autocomplete session and search for results

    setupAutocomplete(); // be safe, make sure we are setup
    if (!aAutomatedAutoCompleteListener)
      aAutomatedAutoCompleteListener = new AutomatedAutoCompleteHandler();

    aAutomatedAutoCompleteListener.init(fullNames.value, numAddresses, recipientType);
  }
}

function AutomatedAutoCompleteHandler()
{
}

// state driven self contained object which will autocomplete a block of addresses without any UI.
// force picks the first match and adds it to the addressing widget, then goes on to the next
// name to complete.

AutomatedAutoCompleteHandler.prototype =
{
  param: this,
  sessionName: null,
  namesToComplete: {},
  numNamesToComplete: 0,
  indexIntoNames: 0,

  numSessionsToSearch: 0,
  numSessionsSearched: 0,
  recipientType: null,
  searchResults: null,

  init:function(namesToComplete, numNamesToComplete, recipientType)
  {
    this.indexIntoNames = 0;
    this.numNamesToComplete = numNamesToComplete;
    this.namesToComplete = namesToComplete;

    this.recipientType = recipientType;

    // set up the auto complete sessions to use
    setupAutocomplete();
    this.autoCompleteNextAddress();
  },

  autoCompleteNextAddress:function()
  {
    this.numSessionsToSearch = 0;
    this.numSessionsSearched = 0;
    this.searchResults = new Array;

    if (this.indexIntoNames < this.numNamesToComplete && this.namesToComplete[this.indexIntoNames])
    {
	/* XXX This is used to work, until switching to the new toolkit broke it
         We should fix it see bug 456550.
      if (this.namesToComplete[this.indexIntoNames].search('@') == -1) // don't autocomplete if address has an @ sign in it
      {
        // make sure total session count is updated before we kick off ANY actual searches
        if (aAutocompleteSession)
          this.numSessionsToSearch++;

        if (aLDAPSession && aCurrentAutocompleteDirectory)
          this.numSessionsToSearch++;

        if (aAutocompleteSession)
        {
           aAutocompleteSession.onAutoComplete(this.namesToComplete[this.indexIntoNames], null, this);
           // AB searches are actually synchronous. So by the time we get here we have already looked up results.

           // if we WERE going to also do an LDAP lookup, then check to see if we have a valid match in the AB, if we do
           // don't bother with the LDAP search too just return

           if (aLDAPSession && aCurrentAutocompleteDirectory && this.searchResults[0] && this.searchResults[0].defaultItemIndex != -1)
           {
             this.processAllResults();
             return;
           }
        }

        if (aLDAPSession && aCurrentAutocompleteDirectory)
          aLDAPSession.onStartLookup(this.namesToComplete[this.indexIntoNames], null, this);
      }*/

      if (!this.numSessionsToSearch)
        this.processAllResults(); // ldap and ab are turned off, so leave text alone
    }
  },

  onStatus:function(aStatus)
  {
    return;
  },

  onAutoComplete: function(aResults, aStatus)
  {
    // store the results until all sessions are done and have reported in
    if (aResults)
      this.searchResults[this.numSessionsSearched] = aResults;

    this.numSessionsSearched++; // bump our counter

    if (this.numSessionsToSearch <= this.numSessionsSearched)
      setTimeout('aAutomatedAutoCompleteListener.processAllResults()', 0); // we are all done
  },

  processAllResults: function()
  {
    // Take the first result and add it to the compose window
    var addressToAdd;

    // loop through the results looking for the non default case (default case is the address book with only one match, the default domain)
    var sessionIndex;

    var searchResultsForSession;

    for (sessionIndex in this.searchResults)
    {
      searchResultsForSession = this.searchResults[sessionIndex];
      if (searchResultsForSession && searchResultsForSession.defaultItemIndex > -1)
      {
        addressToAdd = searchResultsForSession.items.QueryElementAt(searchResultsForSession.defaultItemIndex, Components.interfaces.nsIAutoCompleteItem).value;
        break;
      }
    }

    // still no match? loop through looking for the -1 default index
    if (!addressToAdd)
    {
      for (sessionIndex in this.searchResults)
      {
        searchResultsForSession = this.searchResults[sessionIndex];
        if (searchResultsForSession && searchResultsForSession.defaultItemIndex == -1)
        {
          addressToAdd = searchResultsForSession.items.QueryElementAt(0, Components.interfaces.nsIAutoCompleteItem).value;
          break;
        }
      }
    }

    // no matches anywhere...just use what we were given
    if (!addressToAdd)
      addressToAdd = this.namesToComplete[this.indexIntoNames];

    // that will automatically set the focus on a new available row, and make sure it is visible
    awAddRecipient(this.recipientType ? this.recipientType : "addr_to", addressToAdd);

    this.indexIntoNames++;
    this.autoCompleteNextAddress();
  },

  QueryInterface : function(iid)
  {
      if (iid.equals(Components.interfaces.nsIAutoCompleteListener) ||
          iid.equals(Components.interfaces.nsISupports))
        return this;
      throw Components.results.NS_NOINTERFACE;
  }
}
