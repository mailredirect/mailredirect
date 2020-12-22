#!/bin/bash
# babelzilla
DEST=babelzilla
if [ "$(uname)" == "Linux" ]
then
  SRC=$(basename "$(dirname "$(readlink -f "${0}")")")
  cd $(dirname .)/..
else
  SRC=$(basename "$(dirname "$(cygpath -u $(cygpath -m -s "${0}"))")")
  cd $(dirname $(cygpath -u $(cygpath -m -s "${0}")))/..
fi
[ -d xpi ] || mkdir xpi
cd xpi
rm -fr ${DEST}/
rsync -a --exclude-from=../${SRC}/make-exclude.txt --exclude '_locales/*' --exclude 'locale/*' ../${SRC}/* ${DEST}/
mkdir -p ${DEST}/_locales/en-US/
rsync -a ../${SRC}/_locales/en-US/* ${DEST}/_locales/en-US/
mkdir -p ${DEST}/locale/en-US/
rsync -a ../${SRC}/locale/en-US/* ${DEST}/locale/en-US/
cd ${DEST}
echo manifest.json > mailredirect.txt
echo schema.json >> mailredirect.txt
echo implementation.js >> mailredirect.txt
echo background.js >> mailredirect.txt
find content -type f | sort >> mailredirect.txt
find locale -type f | sort >> mailredirect.txt
find _locales -type f | sort >> mailredirect.txt
find skin -type f | sort >> mailredirect.txt
echo defaults/ >> mailredirect.txt
echo icon.png >> mailredirect.txt
echo icon64.png >> mailredirect.txt
echo LICENSE >> mailredirect.txt
echo README >> mailredirect.txt
version=$(grep "\"version\"" manifest.json | sed -r "s/^.*: \"//; s/\".*$//")
zip -r -D -9 mailredirect-${version}-sm+tb.xpi -@ < mailredirect.txt
rm mailredirect.txt
if [ "$(uname)" != "Linux" ]
then
  read -p "Press any key to continue . . . " -n 1
fi
