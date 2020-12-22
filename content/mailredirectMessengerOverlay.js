"use strict";

const Cc = Components.classes, Ci = Components.interfaces;

const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

// Load additional JavaScript files
Services.scriptloader.loadSubScript("chrome://global/content/globalOverlay.js", window, "UTF-8");
Services.scriptloader.loadSubScript("chrome://mailredirect/content/mailredirect-prefs.js", window, "UTF-8");
Services.scriptloader.loadSubScript("chrome://mailredirect/content/mailredirect-debug.js", window, "UTF-8");
Services.scriptloader.loadSubScript("chrome://mailredirect/content/mailredirect.js", window, "UTF-8");

function onLoad(activatedWhileWindowOpen) {
  WL.injectCSS("resource://mailredirect-os/mailredirect.css");
  WL.injectCSS("chrome://mailredirect-skin/content/mailredirect-subjectCol.css");

  WL.injectElements(`
    <panelview id="appMenu-messageView">
      <toolbarbutton id="appmenu_mailredirect"
                     class="subviewbutton subviewbutton-iconic"
                     label="&bounceCommand.label;"
                     key="key_mailredirect"
                     insertafter="appmenu_forwardAsMenu"
                     observes="cmd_mailredirect" />
    </panelview>

    <panelview id="appMenu-messageForwardAsView">
      <toolbarbutton id="appmenu_forwardAsMailredirect"
                     class="subviewbutton subviewbutton-iconic"
                     label="&forwardAsRedirect.label;"
                     insertafter="appmenu_forwardAsAttachment"
                     observes="cmd_mailredirect" />
    </panelview>

    <commandset id="mailToolbarItems">
      <command id="cmd_mailredirect" oncommand="goDoCommand('cmd_mailredirect')" />
    </commandset>

    <keyset id="mailKeys">
      <key id="key_mailredirect" key="&bounceMsgCmd.key;" modifiers="&bounceMsgCmd.modifiers;"
        oncommand="goDoCommand('cmd_mailredirect')" />
    </keyset>

    <menupopup id="messageMenuPopup">
      <menuitem id="MailredirectMenuItem"
        label="&bounceCommand.label;"
        accesskey="&bounceCommand.accesskey;"
        insertafter="forwardAsMenu"
        key="key_mailredirect"
        command="cmd_mailredirect" />
    </menupopup>

    <menupopup id="menu_forwardAsPopup">
      <menuitem id="menu_forwardAsRedirect"
        label="&forwardAsRedirect.label;"
        accesskey="&forwardAsRedirect.accesskey;"
        insertafter="menu_forwardAsAttachment"
        command="cmd_mailredirect" />
    </menupopup>

    <toolbarpalette id="MailToolbarPalette">
      <toolbarbutton id="mailredirect-toolbarbutton" class="toolbarbutton-1" label="&bounceCommand.label;"
        tooltiptext="&bounceCommand.tooltip;" observes="cmd_mailredirect" insertafter="button-forward" />
    </toolbarpalette>

    <menupopup id="button-ForwardPopup">
      <menuitem id="button-ForwardAsRedirect"
        label="&forwardAsRedirect.label;"
        tooltiptext="&forwardAsRedirect.tooltip;"
        insertafter="button-ForwardAsAttachmentMenu"
        command="cmd_mailredirect" />
    </menupopup>

    <menupopup id="mailContext">
      <menuitem id="mailContext-mailredirect"
        label="&bounceCommand.label;"
        accesskey="&bounceCommand.accesskey;"
        insertafter="mailContext-forwardAsMenu,mailContext-forward"
        insertbefore="mailContext-multiForwardAsAttachment"
        command="cmd_mailredirect" />
      <menuitem id="mailContext-multiMailredirect"
        label="&bounceCommand.label;"
        accesskey="&bounceCommand.accesskey;"
        insertafter="mailContext-multiForwardAsAttachment"
        insertbefore="mailContext-editAsNew"
        command="cmd_mailredirect" />
    </menupopup>

    <menupopup id="mailContext-forwardAsPopup">
      <menuitem id="mailContext-forwardAsMailredirect" insertafter="mailContext-forwardAsAttachment"
        label="&forwardAsRedirect.label;" accesskey="&forwardAsRedirect.accesskey;"
        command="cmd_mailredirect" />
    </menupopup>

    <toolbarpalette id="header-view-toolbar-palette">
      <toolbarbutton id="hdrMailredirectButton"
                     label="&hdrMailredirectButton.label;"
                     tooltiptext="&hdrMailredirectButton.tooltip;"
                     oncommand="cmd_mailredirect(event);RestoreFocusAfterHdrButton();"
                     observes="cmd_mailredirect"
                     class="toolbarbutton-1 msgHeaderView-button hdrMailredirectButton" />
    </toolbarpalette>

    <menupopup id="hdrForwardDropdown">
      <menuitem id="hdrForwardAsRedirectMenu"
                label="&bounceCommand.label;"
                tooltiptext="&forwardAsRedirect.tooltip;"
                insertafter="hdrForwardAsAttachmentMenu"
                command="cmd_mailredirect"/>
    </menupopup>

    <toolbar id="header-view-toolbar"
             defaultset="hdrReplyToSenderButton,hdrSmartReplyButton,hdrForwardButton,hdrMailredirectButton,hdrArchiveButton,hdrJunkButton,hdrTrashButton,otherActionsButton"/>
  `,
    ["chrome://mailredirect/locale/mailredirect.dtd"]);

  window.MailredirectPrefs.init();

  window.MailredirectExtension.InstallListeners();
  window.MailredirectExtension.AddObservers();
  window.MailredirectExtension.SetupController();
  window.addEventListener("DOMFrameContentLoaded", window.MailredirectExtension.addButtonToMultimessageView, true);

  // Starting in Thunderbird 60 add-ons aren't unpacked anymore
  window.MailredirectPrefs.unpackIcon();

}

function onUnload(deactivatedWhileWindowOpen) {
  // window.mailredirct.unload();
  // delete window.mailredirect;

  window.MailredirectExtension.UninstallListeners();
  window.MailredirectExtension.RemoveObservers();
}
