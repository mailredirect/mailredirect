#!/bin/bash
# mozdev
cd $(dirname $(cygpath -u $(cygpath -m -s "${0}")))/..
[ -d xpi ] || mkdir xpi
cd xpi
rm -fr mozdev/
rsync -a --exclude-from=../src-tb3/make-exclude.txt ../src-tb3/* mozdev/
cd mozdev/chrome/locale
for locale in *
do
  for file in ${locale}/*.properties
  do
    echo ${locale}/${file}
    grep -q '=$' ${file}      # Check if file has untranslated strings
    if [ $? -eq 0 ]
    then
      while read line
      do
        if expr index "${line}" '=' > /dev/null
        then
          untranslatedstring="#${line%%=*}=$"
          untranslatedstring="${untranslatedstring/\#\#/\#}"
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
    echo ${locale}/${file}
    grep -q '""' ${file}      # Check if file has untranslated strings
    if [ $? -eq 0 ]
    then
      while read line
      do
        if expr index "${line}" '!ENTITY' > /dev/null
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
zip -r -D -0 mailredirect.jar content/ locale/ skin/ skin-moz/
cd ../..
grep -v em:unpack ../src-tb3/install.rdf > mozdev/install.rdf
sed -r "s/chrome\//jar:chrome\/mailredirect.jar!\//" ../src-tb3/chrome.manifest > mozdev/chrome.manifest
version=`grep em:version ../src-tb3/install.rdf | sed -r "s/^[^>]*>//" | sed -r "s/<.*$//"`
cd mozdev
rm mailredirect-${version}.xpi 2> /dev/null
zip -r -D mailredirect-${version}.xpi install.rdf chrome.manifest chrome/forward.jar chrome/icons/ defaults/ LICENSE
cd ..
read -p "Press any key to continue . . . " -n 1
