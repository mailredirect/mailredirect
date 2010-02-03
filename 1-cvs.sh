#!/bin/sh

set -x

# set to 1 when you want to copy JARs to your home directories
# and generated xpi's in "convenient" place
QUICKINSTALL=0
if [ -f .quickinstall ]; then
  QUICKINSTALL=1
fi

version=`cat version.txt`
system=`uname -s`

rm -f mailredirect.jar mailredirect-skin.jar mailredirect-skin-moz.jar
zip -9r mailredirect.jar content locale -x \*/CVS/\*
zip -9r mailredirect-skin.jar skin -x \*/CVS/\*

rm -rf xpi
mkdir xpi
cp -ar skin-moz xpi/skin
cd xpi
zip -9r ../mailredirect-skin-moz.jar skin -x \*/CVS/\*
cd ..

if [ "$QUICKINSTALL" -eq 1 ]; then
  if [ "$system" == "Linux" ]; then
    cp mailredirect.jar /home/knoppix/.mozilla/knoppix/*/chrome
    # under KNOPPIX mozilla mail
    cp mailredirect-skin-moz.jar /home/knoppix/.mozilla/knoppix/*/chrome
  else
    cp mailredirect.jar "/cygdrive/c/Documents and Settings/imo/Application Data/Thunderbird/Profiles"/*/extensions/{CC3C233D-6668-41bc-AAEB-F3A1D1D594F5}/chrome/
    cp mailredirect-skin.jar "/cygdrive/c/Documents and Settings/imo/Application Data/Thunderbird/Profiles"/*/extensions/{CC3C233D-6668-41bc-AAEB-F3A1D1D594F5}/chrome/
  
    # and for mozilla mail
    cp mailredirect.jar "/cygdrive/c/Program Files/mozilla.org/Mozilla/chrome"
    cp mailredirect-skin-moz.jar "/cygdrive/c/Program Files/mozilla.org/Mozilla/chrome"
  fi
fi

rm -rf xpi
mkdir xpi
cd xpi
mkdir chrome

cp ../mailredirect.jar chrome
cp ../mailredirect-skin.jar chrome
cp ../mailredirect-skin-moz.jar chrome
# cp -r ../defaults .
cp ../BUGS .
cp ../Changelog .
cp ../chrome.manifest .

sed -e "s/@VERSION@/$version/g" < ../install.rdf.template > install.rdf
sed -e "s/@VERSION@/$version/g" < ../install.js.template > install.js

zip -9r mailredirect-cvs.xpi chrome install.rdf install.js chrome.manifest -x \*/CVS/\*

if [ "$QUICKINSTALL" -eq 1 ]; then
  if [ "$system" == "Linux" ]; then
    # KNOPPIX
    cp mailredirect-cvs.xpi /tmp
  else
    cp mailredirect-cvs.xpi "/cygdrive/c/Documents and Settings/imo/Desktop"
  fi
fi
cp mailredirect-cvs.xpi "../../downloads"

cd ..
rm -rf xpi

rm -f mailredirect.jar mailredirect-skin.jar mailredirect-skin-moz.jar

