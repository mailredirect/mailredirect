#!/bin/bash
# amo
cd $(dirname $(cygpath -u $(cygpath -m -s "${0}")))/..
[ -d xpi ] || mkdir xpi
cd xpi
rm -fr amo/
rsync -a --exclude-from=../code/make-exclude.txt ../code/* amo/
cd amo/chrome/locale
for locale in *
do
  for file in ${locale}/*.properties
  do
    echo ${file}
    grep -q '=$' ${file}      # Check if file has untranslated strings
    if [ $? -eq 0 ]
    then
      while read line
      do
        if expr index "${line}" '=' > /dev/null
        then
          untranslatedstring="^#${line%%=*}=$"
          untranslatedstring="${untranslatedstring/\#\#/#}"
          untranslatedstring="${untranslatedstring/\{/\\{}"
          untranslatedstring="${untranslatedstring/\}/\}}"
          sed -r "s/${untranslatedstring//\//\\/}/${line//\//\\/}/" ${file} > ${file}.new
          mv ${file}.new ${file}
        fi
      done < en-US/$(basename ${file})
    fi
  done
done
for locale in *
do
  for file in ${locale}/*.dtd
  do
    echo ${file}
    grep -q '""' ${file}      # Check if file has untranslated strings
    if [ $? -eq 0 ]
    then
      while read line
      do
        if expr match "${line}" '<!ENTITY' > /dev/null
        then
          untranslatedstring="${line%%\"*}\"\" -->"
          untranslatedstring="${untranslatedstring/ENTITY/-- ENTITY}"
          sed -r "s/${untranslatedstring//\//\\/}/${line//\//\\/}/" ${file} > ${file}.new
          mv ${file}.new ${file}
        fi
      done < en-US/$(basename ${file})
    fi
  done
done
cd ..
zip -r -D -0 mailredirect.jar content/ locale/ skin/
cd ../..
grep \<em:update -A 2 ../code/install.rdf > make-grep.txt
grep -v -f make-grep.txt ../code/install.rdf > amo/install.rdf
rm make-grep.txt
sed -r "s/chrome\//jar:chrome\/mailredirect.jar!\//" ../code/chrome.manifest > amo/chrome.manifest
version=$(grep em:version ../code/install.rdf | sed -r "s/^[^>]*>//" | sed -r "s/<.*$//")
cd amo
rm mailredirect-${version}-sm+tb.xpi 2> /dev/null
zip -r -D mailredirect-${version}-sm+tb.xpi install.rdf chrome.manifest chrome/mailredirect.jar chrome/icons/ defaults/ LICENSE
cd ..
read -p "Press any key to continue . . . " -n 1
