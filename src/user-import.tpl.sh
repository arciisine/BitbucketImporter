#!/bin/bash
CURL_OPTS='-s'
if [[ -n "$DEBUG" ]]; then
  if [[ $DEBUG -gt 1 ]]; then
    set -x
    CURL_OPTS='-v'
  fi  
fi

CLOUD_USERNAME=$1
CLOUD_PASSWORD=$2
SERVER_USERNAME=$3
SERVER_PASSWORD=$4

[[ -z "$CLOUD_USERNAME" ]] && read -p "${CLOUD_HOST} Username: " CLOUD_USERNAME && echo
[[ -z "$CLOUD_PASSWORD" ]] && read -s -p "${CLOUD_HOST} Password: " CLOUD_PASSWORD && echo
[[ -z "$SERVER_USERNAME" ]] && read -p "${SERVER_HOST} Username: " SERVER_USERNAME && echo
[[ -z "$SERVER_PASSWORD" ]] && read -s -p "${SERVER_HOST} Password: " SERVER_PASSWORD && echo

#Handle spaces in file names
OLDIFS="$IFS"
IFS='
'

DRYRUN=`echo $DRYRUN | sed -e 's|.*|log|'`
REQ_FAIL=0

SERVER_HOST=%%SERVER_HOST%%
CLOUD_HOST=%%CLOUD_HOST%%
TEMP_DIR=%%TEMP_DIR%%

function quit() {
  echo $1; exit $2
}

function log() {
  echo
  echo "#DRY_RUN#" ${@}
}

function serverReq() {
  REQ_FAIL=0
  [[ -n "$DRYRUN" ]] && log curl "https://"$SERVER_HOST${@} 1>&2
  curl $CURL_OPTS -H 'Accepts: application/json' -H 'X-Atlassian-Token:no-check' \
    -u "${SERVER_USERNAME}:${SERVER_PASSWORD}" "https://$SERVER_HOST"${@}
  if [ $? -gt 0 ]; then
    REQ_FAIL=1
  fi    
}

function cloudReq() {
  REQ_FAIL=0
  [[ -n "$DRYRUN" ]] && log curl "https://api"$CLOUD_HOST${@} 1>&2
  curl $CURL_OPTS -H 'Accepts: application/json' \
    -u "${CLOUD_USERNAME}:${CLOUD_PASSWORD}" "https://api.$CLOUD_HOST"${@}

  if [ $? -gt 0 ]; then
    REQ_FAIL=1
  fi    
}

#Verify user session
echo
echo "Initializing"
echo -n "  * Validating ${CLOUD_HOST} credentials... "
cloudReq '/2.0/user' -f > /dev/null
[ $REQ_FAIL -eq 0 ] && echo "done" || quit "${CLOUD_HOST} credentials invalid"

echo -n "  * Validating ${SERVER_HOST} credentials... "
serverReq "/rest/api/1.0/users/$SERVER_USERNAME" -f > /dev/null
[ $REQ_FAIL -eq 0 ] && echo "done" || quit "${SERVER_HOST} credentials invalid"


#Update all repos from current location
echo
echo "Converting local git repo configs"
for REPO in `find $PWD -name '.git' -type d`; do
  echo "  * Updating $REPO/config"

  if [[ -n "$DRYRUN" ]]; then
    $DRYRUN sed -i.bak -r \
      SED_EXPRESSIONS \
      $REPO/config
  else 
    sed -i.bak -r \
      %%SED_EXPRESSIONS%%
      $REPO/config    
  fi   
done

#Migrate SSH Keys
echo
echo "Migrating Personal SSH Keys"
for ROW in `serverReq '/rest/ssh/1.0/keys' | jq '.values[] | .label+"\t"+.text' -r`; 
do  
  LABEL=`echo $ROW | awk -F '\t' '{ print $1 }'`
  LABEL=${LABEL:-default}
  KEY=`echo $ROW | awk -F '\t' '{ print $2 }'`
  echo -n "  * Migrating key to ${CLOUD_HOST}: label=${LABEL}, key=${KEY:0:10}..."
  $DRYRUN cloudReq "/1.0/users/${CLOUD_USERNAME}/ssh-keys" -G \
    --data-urlencode "label=$LABEL" \
    --data-urlencode "key=$KEY"
  [ $REQ_FAIL -eq 1 ] && echo 'failed' || echo 'success' 
done

#Migrate Personal Repos
echo
echo "Migrating personal repositories"
for REPO in `serverReq '/rest/api/1.0/users/'${SERVER_USERNAME}'/repos' | jq -r '.values[].slug'`; 
do  
  echo "  * Moving ${REPO} to ${CLOUD_HOST}"

  echo -n "    - Creating Repository ${REPO} in ${CLOUD_HOST}"
  $DRYRUN cloudReq "/2.0/repositories/${CLOUD_USERNAME}/${REPO}" -d '{
  "scm": "git",
  "name": "'${REPO}'",
  "description": "'${REPO}'",
  "is_private": true,
  "fork_policy": "no_public_forks"
}' > /dev/null
  [ $REQ_FAIL -eq 1 ] && echo 'failed' || echo 'success'

  GIT_DIR=$TEMP_DIR/$REPO
  echo -n "    - Cloning from ${SERVER_HOST} ... "
  $DRYRUN git clone --mirror https://$SERVER_USERNAME:$SERVER_PASSWORD@$SERVER_HOST/scm/~$SERVER_USERNAME/$REPO.git 
  [ $? -eq 0 ] && echo "done" || echo "failed"

  $DRYRUN pushd $GIT_DIR > /dev/null
  echo -n "    - Pushing to ${CLOUD_HOST} ... "
  $DRYRUN git push --mirror https://$CLOUD_USERNAME:$CLOUD_PASSWORD@$CLOUD_HOST/$CLOUD_USERNAME/$REPO.git
  [ $? -eq 0 ] && echo "done" || echo "failed"
 
  $DRYRUN popd > /dev/null
done

IFS="$OLDIFS"

echo Done
