#!/bin/bash
DATA_FOLDER=./data
DATA_FILENAME=keys.json

yarn build

if [ ! -f $DATA_FOLDER/$DATA_FILENAME ]; then
  mkdir -p data
fi
echo "Generating keys with login ...";
yarn -s dockerdata > $DATA_FOLDER/$DATA_FILENAME
if [ $? -eq 0 ]
then
  echo "Successfully generate and register test lollipop keys"
else
  rm -rf $DATA_FOLDER/$DATA_FILENAME
  echo "Error generating the test lollipop keys" >&2
  exit 1
fi

echo "Starting signer service to generate lollipop signatures ...";
yarn -s signer