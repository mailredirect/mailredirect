#!/bin/bash
# babelzilla
if [ "$(uname)" == "Linux" ]
then
  cd $(dirname .)/..
else
  cd $(dirname $(cygpath -u $(cygpath -m -s "${0}")))/..
fi
[ -d xpi ] || mkdir xpi
cd xpi
rm -fr babelzilla/
rsync -a --exclude-from=../code/make-exclude.txt --exclude 'locale/*' ../code/* babelzilla/
mkdir -p babelzilla/chrome/locale/en-US/
rsync -a ../code/chrome/locale/en-US/* babelzilla/chrome/locale/en-US/
version=`grep em:version ../code/install.rdf | sed -r "s/^[^>]*>//" | sed -r "s/<.*$//"`
cd babelzilla
rm mailredirect-${version}-sm+tb.xpi 2> /dev/null
zip -r -D mailredirect-${version}-sm+tb.xpi install.rdf chrome.manifest chrome/ defaults/ icon.png LICENSE README
cd ..
read -p "Press any key to continue . . . " -n 1
