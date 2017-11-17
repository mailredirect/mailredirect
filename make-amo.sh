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
cd amo
head -n $(grep --line-number '<em:localized>' install.rdf | cut -d : -f 1) install.rdf > install.rdf.head
tail -n +$(grep --line-number '</em:localized>' install.rdf | cut -d : -f 1) install.rdf > install.rdf.tail
cat <<DESCRIPTION > install.rdf.locale
      <Description>
        <em:locale>\$locale</em:locale>
        <em:name>\$name</em:name>
        <em:description>\$description</em:description>
      </Description>
DESCRIPTION
cp install.rdf.head install.rdf
cd chrome/locale
for locale in *
do
  if [ "${locale}" != "en-US" ]
  then
    for file in ${locale}/*.*
    do
      if [ "${file##*/}" == "mailredirect.properties" ]
      then
        name=$(grep "^extensions.{CC3C233D-6668-41bc-AAEB-F3A1D1D594F5}.name=" ${file} | sed -e "s/^.*\.name=//" -e "s/&/\\\\\&amp;/" -e "s/\"/\\\\\&quot;/g" -e "s/</\\\\\&lt;/" -e "s/>/\\\\\&gt;/")
        description=$(grep "^extensions.{CC3C233D-6668-41bc-AAEB-F3A1D1D594F5}.description=" ${file} | sed -e "s/^.*\.description=//" -e "s/&/\\\\\&amp;/" -e "s/\"/\\\\\&quot;/g" -e "s/</\\\\\&lt;/g" -e "s/>/\\\\\&gt;/g")
        if [ "${name}" != "" ] || [ "${description}" != "" ]
        then
          if [ "${name}" == "" ]
          then
            grepinvert="\$name"
          elif [ "${description}" == "" ]
          then
            grepinvert="\$description"
          else
            grepinvert="no invert match"
          fi
          cat ../../install.rdf.locale | grep -v "${grepinvert}" | sed -e "s/\$locale/${locale}/" -e "s/\$name/${name}/" -e "s/\$description/${description}/" >> ../../install.rdf
        fi
        rm ${file}
      else
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
      fi
    done
  fi
done
cat ../../install.rdf.tail >> ../../install.rdf
rm ../../install.rdf.head ../../install.rdf.tail ../../install.rdf.locale
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
zip -r -D mailredirect-${version}-sm+tb.xpi install.rdf chrome.manifest chrome/mailredirect.jar chrome/icons/ icon.png LICENSE README
cd ..
read -p "Press any key to continue . . . " -n 1
