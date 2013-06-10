#!/bin/bash
# babelzilla
cd $(dirname $(cygpath -u $(cygpath -m -s "${0}")))/..
[ -d xpi ] || mkdir xpi
cd xpi
rm -fr babelzilla/
rsync -a --exclude-from=../code/make-exclude.txt ../code/* babelzilla/
version=`grep em:version ../code/install.rdf | sed -r "s/^[^>]*>//" | sed -r "s/<.*$//"`
cd babelzilla
rm mailredirect-${version}.xpi 2> /dev/null
zip -r -D mailredirect-${version}-sm+tb.xpi install.rdf chrome.manifest chrome/ defaults/ LICENSE
cd ..
read -p "Press any key to continue . . . " -n 1
