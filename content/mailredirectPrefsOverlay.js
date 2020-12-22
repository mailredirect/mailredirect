"use strict";

const Cc = Components.classes, Ci = Components.interfaces;

const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { Log } = ChromeUtils.import("resource://gre/modules/Log.jsm");

// Load additional JavaScript files
Services.scriptloader.loadSubScript("chrome://mailredirect/content/mailredirect-prefs.js", window, "UTF-8");
Services.scriptloader.loadSubScript("chrome://mailredirect/content/mailredirect-incontent-prefs.js", window, "UTF-8");

function onLoad(activatedWhileWindowOpen) {
  WL.injectCSS("resource://mailredirect-shared/mailredirect-incontent-prefs.css");

  let versionChecker = Cc["@mozilla.org/xpcom/version-comparator;1"]
                       .getService(Ci.nsIVersionComparator);
  if (versionChecker.compare(Services.appinfo.version, "70.0a1") >= 0) {
    console.log("version >= 70.0a1");
    WL.injectElements(`
  `,
    ["chrome://mailredirect/locale/mailredirect-prefs.dtd"]);
  } else {
    console.log("version < 70.0a1");
    WL.injectElements(`
    <preftab id="MailPreferences">
      <hbox id="paneDeck">

        <prefpane id="paneRedirect"
                  insertafter="paneCompose"
                  label="&mailredirectSettings.label2;"
                  onpaneload="MailredirectPrefs.onpaneload();">

          <hbox>
            <groupbox>
              <label><html:h2>&mailredirectSettings.label2;</html:h2></label>
              <vbox>
                <checkbox id="copyToSentMail" preference="extensions.mailredirect.copyToSentMail"
                          label="&copyToSentMails.label;"
                          accesskey="&copyToSentMails.accesskey;"
                          tooltip="xToolTip" xtooltiptext="&copyToSentMails.tooltip;"/>

                <separator id="addToForwardAsSeparator" class="thin"/>

                <checkbox id="addToForwardAs" preference="extensions.mailredirect.addToForwardAs"
                          label="&addToForwardAs.label;"
                          accesskey="&addToForwardAs.accesskey;"
                          oncommand="MailredirectPrefs.updateHideMenuitems();"
                          tooltip="xToolTip" xtooltiptext="&addToForwardAs.tooltip;"/>

                <separator id="hideRedirectMenuitemsSeparator" class="thin"/>

                <checkbox id="hideRedirectMenuitems" preference="extensions.mailredirect.hideRedirectMenuitems"
                          label="&hideRedirectMenuitems.label;"
                          accesskey="&hideRedirectMenuitems.accesskey;"
                          tooltip="xToolTip" xtooltiptext="&hideRedirectMenuitems.tooltip;"
                          class="indent"/>

                <separator class="thin"/>

                <hbox align="center">
                  <label control="concurrentConnections"
                         value="&concurrentConnections.label;"
                         accesskey="&concurrentConnections.accesskey;"
                         tooltip="xToolTip" xtooltiptext="&concurrentConnections.tooltip;"/>
                  <textbox id="concurrentConnections"
                           preference="extensions.mailredirect.concurrentConnections"
                           size="3"
                           tooltip="xToolTip" xtooltiptext="&concurrentConnections.tooltip;"/>
                </hbox>

                <separator class="thin"/>

                <groupbox>
                  <label><html:h2>&defaultRecipientsGroup.label;</html:h2></label>
                  <grid>
                    <columns>
                      <column/>
                      <column/>
                    </columns>
                    <rows>
                      <row align="center">
                        <label control="defaultResendTo"
                               value="&defaultResendTo.label;"
                               accesskey="&defaultResendTo.accesskey;"
                               tooltip="xToolTip" xtooltiptext="&defaultResendTo.tooltip;"/>
                        <textbox id="defaultResendTo"
                                 preference="extensions.mailredirect.defaultResentTo"
                                 size="48"
                                 onchange="MailredirectPrefs.updateDefaultMode();"
                                 tooltip="xToolTip" xtooltiptext="&defaultResendTo.tooltip;"/>
                      </row>

                      <row align="center">
                        <label control="defaultResendCc"
                               value="&defaultResendCc.label;"
                               accesskey="&defaultResendCc.accesskey;"
                               tooltip="xToolTip" xtooltiptext="&defaultResendCc.tooltip;"/>
                        <textbox id="defaultResendCc"
                                 preference="extensions.mailredirect.defaultResentCc"
                                 size="48"
                                 onchange="MailredirectPrefs.updateDefaultMode();"
                                 tooltip="xToolTip" xtooltiptext="&defaultResendCc.tooltip;"/>
                      </row>

                      <row align="center">
                        <label control="defaultResendBcc"
                               value="&defaultResendBcc.label;"
                               accesskey="&defaultResendBcc.accesskey;"
                               tooltip="xToolTip" xtooltiptext="&defaultResendBcc.tooltip;"/>
                        <textbox id="defaultResendBcc"
                                 preference="extensions.mailredirect.defaultResentBcc"
                                 size="48"
                                 onchange="MailredirectPrefs.updateDefaultMode();"
                                 tooltip="xToolTip" xtooltiptext="&defaultResendBcc.tooltip;"/>
                      </row>
                    </rows>
                  </grid>
                </groupbox>

                <separator class="thin"/>

                <hbox align="center">
                  <label control="defaultMode"
                         value="&defaultMode.label;"
                         accesskey="&defaultMode.accesskey;"
                         tooltip="xToolTip" xtooltiptext="&defaultMode.tooltip;"/>
                  <menulist id="defaultMode"
                            preference="extensions.mailredirect.defaultMode"
                            tooltip="xToolTip" xtooltiptext="&defaultMode.tooltip;">
                    <menupopup>
                      <menuitem value="addr_to" label="&defaultModeResendTo.label;"/>
                      <menuitem value="addr_cc" label="&defaultModeResendCc.label;"/>
                      <menuitem value="addr_bcc" label="&defaultModeResendBcc.label;"/>
                    </menupopup>
                  </menulist>
                </hbox>

                <separator class="thick"/>

                <hbox align="center">
                  <checkbox preference="extensions.mailredirect.debug" id="debug"
                            label="&debug.label;"
                            accesskey="&debug.accesskey;"
                            tooltip="xToolTip" xtooltiptext="&debug.tooltip;"/>
                  <button id="saveConsoleContent"
                          class="dialog"
                          accesskey="&saveConsoleContent.accesskey2;"
                          label="&saveConsoleContent.label2;"
                          oncommand="MailredirectPrefs.saveConsoleContent();"/>
                  <button id="sendViaEmail"
                          class="dialog"
                          accesskey="&sendViaEmail.accesskey;"
                          label="&sendViaEmail.label;"
                          oncommand="MailredirectPrefs.sendViaEmail();"/>
                </hbox>
              </vbox>
              <vbox flex="1"/>
            </groupbox>
          </hbox>

        </prefpane>

      </hbox>
    </preftab>
    `,
      ["chrome://mailredirect/locale/mailredirect-prefs.dtd"]);
  }

/*
        <tooltip id="xToolTip" noautohide="true"
                 onpopupshowing="this.label=document.tooltipNode.getAttribute('xtooltiptext');"/>
*/

  window.MailredirectPrefs.init();

  window.MailredirectIncontentPrefs.onload();
}

function onUnload(deactivatedWhileWindowOpen) {
}
