
// 1. Set parameters of package installation
const APP_DISPLAY_NAME = "Mail Redirect";
const APP_NAME = "mailredirect";
const APP_VERSION = "0.7.6.5";

const supported_locales = ["en-US", "de-DE", "fr-FR", "it-IT", "sv-SE", "cs-CZ", "es-ES", "es-AR", "de-AT", "sk-SK", "pl-PL", "ro-RO", "ru-RU", "nl-NL", "pt-BR" ];

const APP_PACKAGE = "/" + APP_NAME;
const APP_JAR_FILE = APP_NAME + ".jar";
const APP_SKIN_JAR_FILE = APP_NAME + "-skin.jar";
const APP_SKIN_MOZ_JAR_FILE = APP_NAME + "-skin-moz.jar";
const APP_CONTENT_FOLDER = "content/";
const APP_LOCALE_FOLDER1 = "locale/";
const APP_SKIN_CLASSIC_FOLDER = "skin/classic/";
const APP_SKIN_MODERN_FOLDER = "skin/modern/";


const INST_TO_PROFILE = "Do you wish to install "+APP_DISPLAY_NAME+" to your profile?\nThis will mean it does not need reinstalling when you update your application.\n(Click Cancel if you want "+APP_DISPLAY_NAME+" installing to the application directory.)";


// 2. Initialise package
initInstall(APP_NAME, APP_PACKAGE, APP_VERSION);

// Get package directories
// profile installs only work since 2003-03-06
var instToProfile = false;
var instToProfile = ((buildID>2003030600 || buildID==0000000000) && confirm(INST_TO_PROFILE));
var chromef = instToProfile ? getFolder("Profile", "chrome") : getFolder("chrome");
setPackageFolder(chromef);

// 2,5. mozilla or thunderbird?
var isTbird = false;
var execFile = 'thunderbird' + (getPlatform() == "win" ? '.exe' : '-bin');
if (File.exists(getFolder(getFolder('Program'), execFile))) {
  isTbird = confirm("Detected installation on Thunderbird. Is this correct?");
} else {
  isTbird = !confirm("Detected installation on Mozilla or Netscape. Is this correct?");
} 

// 3. Flag files/folders to be added
addFile("", "chrome/" + APP_JAR_FILE, chromef, "")
if (isTbird) { 
  addFile("", "chrome/" + APP_SKIN_JAR_FILE, chromef, "")
} else {
  addFile("", "chrome/" + APP_SKIN_MOZ_JAR_FILE, chromef, "")
}

err = getLastError();

// 3,5. add default prefs and don't care about errors
// var prefDir = getFolder("Program", "defaults/pref");
// addFile("", "defaults/preferences/mailredirect.js", prefDir, "");


if (err == SUCCESS) {

  // 4. Register chrome (this is what contents.rdf is used for)
  if(instToProfile) {
    registerChrome(CONTENT | PROFILE_CHROME, getFolder(chromef, APP_JAR_FILE), APP_CONTENT_FOLDER);
    for (var s in supported_locales) {
      registerChrome(LOCALE  | PROFILE_CHROME, getFolder(chromef, APP_JAR_FILE),
        APP_LOCALE_FOLDER1 + supported_locales[s] + "/");
    }
    if (isTbird) {
      registerChrome(SKIN    | PROFILE_CHROME, getFolder(chromef, APP_SKIN_JAR_FILE), APP_SKIN_CLASSIC_FOLDER);
    } else {
      registerChrome(SKIN    | PROFILE_CHROME, getFolder(chromef, APP_SKIN_MOZ_JAR_FILE), APP_SKIN_CLASSIC_FOLDER);
      registerChrome(SKIN    | PROFILE_CHROME, getFolder(chromef, APP_SKIN_MOZ_JAR_FILE), APP_SKIN_MODERN_FOLDER);
    }
  } else {
    registerChrome(CONTENT | DELAYED_CHROME, getFolder(chromef, APP_JAR_FILE), APP_CONTENT_FOLDER);
    for (var s in supported_locales) {
      registerChrome(LOCALE  | DELAYED_CHROME, getFolder(chromef, APP_JAR_FILE),
        APP_LOCALE_FOLDER1 + supported_locales[s] + "/");
    }
    if (isTbird) {
      registerChrome(SKIN    | DELAYED_CHROME, getFolder(chromef, APP_SKIN_JAR_FILE), APP_SKIN_CLASSIC_FOLDER);
    } else {
      registerChrome(SKIN    | DELAYED_CHROME, getFolder(chromef, APP_SKIN_MOZ_JAR_FILE), APP_SKIN_CLASSIC_FOLDER);
      registerChrome(SKIN    | DELAYED_CHROME, getFolder(chromef, APP_SKIN_MOZ_JAR_FILE), APP_SKIN_MODERN_FOLDER);
    }
  }

  // 5. Perform the installation
  err = performInstall();

  // 6. Report on success or otherwise  
  if(err == SUCCESS || err == 999) {
    refreshPlugins();
    alert(APP_DISPLAY_NAME+" "+APP_VERSION+" has been succesfully installed.\nYou need to restart Mozilla " + 
        (isTbird ? "Thunderbird " : "") + "first.");
  } else {
    alert("Install failed. Error code: " + err);
    cancelInstall(err);
  }
} else {
  alert("Failed to create JAR file.\n"
    +"You probably don't have appropriate permissions \n"
    +"(write access to your profile or chrome directory). \n"
    +"_____________________________\nError code:" + err);
  cancelInstall(err);
}

// OS type detection
// which platform?
function getPlatform() {
  var platformStr;
  var platformNode;

  if('platform' in Install) {
    platformStr = new String(Install.platform);

    if (!platformStr.search(/^Macintosh/))
      platformNode = 'mac';
    else if (!platformStr.search(/^Win/))
      platformNode = 'win';
    else
      platformNode = 'unix';
  } else {
    var fOSMac  = getFolder("Mac System");
    var fOSWin  = getFolder("Win System");

    logComment("fOSMac: "  + fOSMac);
    logComment("fOSWin: "  + fOSWin);

    if(fOSMac != null)
      platformNode = 'mac';
    else if(fOSWin != null)
      platformNode = 'win';
    else
      platformNode = 'unix';
  }

  return platformNode;
} 
