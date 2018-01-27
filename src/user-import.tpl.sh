#!/bin/bash
SERVER_HOST=%%SERVER_HOST%%
CLOUD_HOST=%%CLOUD_HOST%%

CLOUD_USERNAME=$1
CLOUD_PASSWORD=$2
SERVER_USERNAME=$3
SERVER_PASSWORD=$4

function serverReq() {
  curl -s -H 'Accepts: application/json' -H 'X-Atlassian-Token:no-check' \
    -u "${SERVER_USERNAME}:${SERVER_PASSWORD}" "https://$SERVER_HOST"${@}
}

function cloudReq() {
  curl -s -H 'Accepts: application/json' \
    -u "${CLOUD_USERNAME}:${CLOUD_PASSWORD}" "https://$CLOUD_HOST"'${@}
}

if [[ -n "DRYRUN" ]]; then
  DRYRUN="echo " 
  set -x
else
  set -e  
fi

if [[ -z "$CLOUD_USERNAME" ]]; then
  read -p "Bitbucket.org Username: " CLOUD_USERNAME
fi

if [[ -z "$CLOUD_PASSWORD" ]]; then
  read -s -p "Bitbucket.org Password: " CLOUD_PASSWORD
  echo
fi

if [[ -z "$SERVER_USERNAME" ]]; then
  read -p "git.eaiti.com Username: " SERVER_USERNAME
fi

if [[ -z "$SERVER_PASSWORD" ]]; then
  read -s -p "git.eaiti.com Password: " SERVER_PASSWORD
  echo
fi

serverReq "/rest/api/1.0/users/$SERVER_USERNAME" -f
cloudReq '/2.0/user' -f

#Update all repos from current location
for REPO in $(find . -name '.git' -type d); do
    $DRYRUN sed -i.bak \
      %%SED_EXPRESSIONS%%
      $REPO/.config
done

#Migrate SSH Keys
OLDIFS="$IFS"
IFS='
'
for ROW in `serverReq '/rest/ssh/1.0/keys' | jq '.values[] | .label+"\t"+.text' -r`; 
do
    LABEL=$(echo $ROW | awk -F '\t' '{ print $1 }')
    LABEL=${LABEL:-default}
    KEY=$(echo $ROW | awk -F '\t' '{ print $2 }')
    $DRYRUN $LABEL $KEY
done

#Migrate Personal Repos

IFS="$OLDIFS"