#!/bin/sh

version=`cat version.txt`

cd ../downloads
sed -e "s/@VERSION@/$version/g" < update.rdf.template > update.rdf

cp mailredirect-cvs.xpi mailredirect.xpi

# create tar.gz
cd ../src
rm -rf mailredirect
mkdir mailredirect
cp -al content locale install.js.template install.rdf.template BUGS Changelog skin skin-moz version.txt 1-cvs.sh 2-release.sh make-lang.sh chrome.manifest mailredirect 
tar cvf - mailredirect | gzip -9c > "../downloads/src/mailredirect-src-$version.tar.gz"
rm -rf mailredirect

cd ../downloads/src
rm -f mailredirect-src-latest.tar.gz
ln -s "mailredirect-src-$version.tar.gz" mailredirect-src-latest.tar.gz

