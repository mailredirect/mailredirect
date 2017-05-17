#!/bin/bash
# sourceforge
if [ "$(uname)" == "Linux" ]
then
  cd $(dirname .)/..
else
  cd $(dirname $(cygpath -u $(cygpath -m -s "${0}")))/..
fi
[ -d xpi ] || mkdir xpi
cd xpi
rm -fr sourceforge/
rsync -a --exclude-from=../code/make-exclude.txt ../code/* sourceforge/
cd sourceforge/chrome/locale
for locale in *
do
  for file in ${locale}/*.*
  do
    echo ${file}
    if [ "${file##*.}" == "properties" ]
    then
      # Add missing strings as empty string
      diff --suppress-common-lines <(cat ${file} | sed -e "s/=.*$/=/") <(cat en-US/$(basename ${file}) | sed -e "s/=.*$/=/") > ${file}.patch
      patch ${file} ${file}.patch > /dev/null
      rm ${file}.patch

      # Use original string for empty strings
      grep -q '=$' ${file}      # Check if file has untranslated strings
      if [ $? -eq 0 ]
      then
        while read line
        do
          if expr index "${line}" '=' > /dev/null
          then
            untranslatedstring="^${line%%=*}=$"
            untranslatedstring="${untranslatedstring//\{/\\\{}"
            untranslatedstring="${untranslatedstring//\}/\\\}}"
            untranslatedstring="${untranslatedstring//\./\\\.}"
            sed -r "s/${untranslatedstring//\//\\/}/${line//\//\\/}/" ${file} > ${file}.new
            mv ${file}.new ${file}
          fi
        done < en-US/$(basename ${file})
      fi
    fi
    if [ "${file##*.}" == "dtd" ]
    then
      # Add missing strings as empty string
      diff --suppress-common-lines <(cat ${file} | sed -e "s/\".*\"/\"\"/") <(cat en-US/$(basename ${file}) | sed -e "s/\".*\"/\"\"/") > ${file}.patch
      patch ${file} ${file}.patch > /dev/null
      rm ${file}.patch

      # Use original string for empty strings
      grep -q '""' ${file}      # Check if file has untranslated strings
      if [ $? -eq 0 ]
      then
        while read line
        do
          if expr match "${line}" '<!ENTITY' > /dev/null
          then
            untranslatedstring="${line%%\"*}\"\">"
            echo ${line}, ${untranslatedstring//\//\\/}
            sed -r "s/${untranslatedstring//\//\\/}/${line//\//\\/}/" ${file} > ${file}.new
            mv ${file}.new ${file}
          fi
        done < en-US/$(basename ${file})
      fi
    fi
  done
done
cd ..
zip -r -D -0 mailredirect.jar content/ locale/ skin/
cd ../..
sed -r "s/chrome\//jar:chrome\/mailredirect.jar!\//" ../code/chrome.manifest > sourceforge/chrome.manifest
version=$(grep em:version ../code/install.rdf | sed -r "s/^[^>]*>//" | sed -r "s/<.*$//")
cd sourceforge
rm mailredirect-${version}-sm+tb.xpi 2> /dev/null
zip -r -D mailredirect-${version}-sm+tb.xpi install.rdf chrome.manifest chrome/mailredirect.jar chrome/icons/ defaults/ LICENSE
cd ..
read -p "Press any key to continue . . . " -n 1
