#!/bin/bash
# amo
DEST=amo
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
rsync -a --exclude-from=../${SRC}/make-exclude.txt ../${SRC}/* ${DEST}/
cd ${DEST}/locale
for locale in *
do
  if [ "${locale}" != "en-US" ]
  then
    for file in ${locale}/*.*
    do
      echo -n -e "                                        \r${file}"
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
          echo -n -e "\n"
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
          echo -n -e "\n"
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
echo -n -e "                                        \r"
cd ..
echo manifest.json > mailredirect.txt
echo schema.json >> mailredirect.txt
echo implementation.js >> mailredirect.txt
echo background.js >> mailredirect.txt
find content -type f | sort >> mailredirect.txt
find locale -type f | sort >> mailredirect.txt
find _locales -type f | sort >> mailredirect.txt
find skin -type f | sort >> mailredirect.txt
echo icon.png >> mailredirect.txt
echo icon64.png >> mailredirect.txt
echo LICENSE >> mailredirect.txt
echo README >> mailredirect.txt
grep -v update_url manifest.json > manifest.tmp
# Remove comma from strict_min_version line, because next line (update_url) has been removed
cat manifest.tmp | sed -e "s/\(\"strict_min_version\".*\),/\1/" > manifest.json
rm manifest.tmp
version=$(grep "\"version\"" manifest.json | sed -r "s/^.*: \"//; s/\".*$//")
zip -r -D -9 mailredirect-${version}-sm+tb.xpi -@ < mailredirect.txt
rm mailredirect.txt
if [ "$(uname)" != "Linux" ]
then
  read -p "Press any key to continue . . . " -n 1
fi
