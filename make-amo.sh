#!/bin/bash
# amo
if [ "$(uname)" == "Linux" ]
then
  cd $(dirname .)/..
else
  cd $(dirname $(cygpath -u $(cygpath -m -s "${0}")))/..
fi
[ -d xpi ] || mkdir xpi
cd xpi
rm -fr amo/
rsync -a --exclude-from=../code/make-exclude.txt ../code/* amo/
cd amo/chrome/locale
for locale in *
do
  if [ "${locale}" != "en-US" ]
  then
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
              sed -r "s/${untranslatedstring//\//\\/}/${line//\//\\/}/" ${file} > ${file}.new
              mv ${file}.new ${file}
            fi
          done < en-US/$(basename ${file})
        fi
      fi
    done
  fi
done
cd ../..
echo install.rdf > mailredirect.txt
echo chrome.manifest >> mailredirect.txt
find chrome -type f | sort >> mailredirect.txt
echo defaults/ >> mailredirect.txt
echo icon.png >> mailredirect.txt
echo LICENSE >> mailredirect.txt
echo README >> mailredirect.txt
grep \<em:update -A 2 install.rdf > make-grep.txt
grep -v -f make-grep.txt ../../code/install.rdf > amo/install.rdf
rm make-grep.txt
version=$(grep em:version install.rdf | sed -r "s/^[^>]*>//" | sed -r "s/<.*$//")
rm mailredirect-${version}-sm+tb.xpi 2> /dev/null
zip -r -D -9 mailredirect-${version}-sm+tb.xpi -@ < mailredirect.txt
rm mailredirect.txt
read -p "Press any key to continue . . . " -n 1
