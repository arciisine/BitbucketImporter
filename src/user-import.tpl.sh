#!/bin/bash
([[ -n "$DEBUG" ]] || [[ -n "$DRYRUN" ]]) && COMMENT=1 || COMMENT=0
([[ "$DEBUG" -eq 1 ]]) && VERBOSE=1 || VERBOSE=0

if [ $VERBOSE -eq 1 ]; then
  set -x
  CURL_OPTS='-v'
  GIT_OPTS=''
else
  CURL_OPTS='-s'
  GIT_OPTS='-q'
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

DRYRUN=`echo $DRYRUN | sed -r -e 's|.+|log|'`
REQ_FAIL=0

SERVER_HOST=%%SERVER_HOST%%
CLOUD_HOST=%%CLOUD_HOST%%
TEMP_DIR=%%TEMP_DIR%%

function quit() {
  echo $1; exit $2
}

function clean_name() {
  echo $1 | sed -r -e 's|[^A-Za-z0-9]+|_|g';
}

function log() {
  [ $COMMENT -eq 1 ] && (echo && echo ""${@})
}

function check_req() {
  [ $REQ_FAIL -eq 0 ] && echo $1 || $2 "$3"
}

function server_req() {
  REQ_FAIL=0
  [ $COMMENT -eq 1 ] && log curl "https://"$SERVER_HOST${@} 1>&2
  if ! curl $CURL_OPTS -f -H 'Accepts: application/json' -H 'X-Atlassian-Token:no-check' \
    -u "${SERVER_USERNAME}:${SERVER_PASSWORD}" "https://$SERVER_HOST"${@};
  then
    REQ_FAIL=1
  fi  
}

function cloud_req() {
  REQ_FAIL=0
  [ $COMMENT -eq 1 ] && log curl "https://api.$CLOUD_HOST"${@} 1>&2
  if ! curl $CURL_OPTS -f -H 'Accepts: application/json' \
    -u "${CLOUD_USERNAME}:${CLOUD_PASSWORD}" "https://api.$CLOUD_HOST"${@};
  then
    REQ_FAIL=1
  fi    
}

#Verify user session
echo
echo "Initializing"
echo -n "  * Validating ${CLOUD_HOST} credentials... "
cloud_req '/2.0/user' > /dev/null
check_req "success" quit "${CLOUD_HOST} credentials invalid"

echo -n "  * Validating ${SERVER_HOST} credentials... "
server_req "/rest/api/1.0/users/$SERVER_USERNAME" > /dev/null
check_req "success" quit "${SERVER_HOST} credentials invalid"

#Update all repos from current location
echo
echo "Converting local git repo configs"
for REPO in `find $PWD -name '.git' -type d`; do
  echo -n "  * Updating $REPO/config... "
  TEMP_CONF=$TEMP_DIR/git.`clean_name $REPO`.config;

  cat $REPO/config | sed -r \
    %%SED_EXPRESSIONS%%
    > $TEMP_CONF

  (diff --suppress-common-line -y $REPO/config $TEMP_CONF > $TEMP_CONF.diff) && CHANGED=0 || CHANGED=1
  [ $COMMENT -eq 1 ] && echo && cat $TEMP_CONF.diff

  if [[ $CHANGED -eq 1 ]]; then
    $DRYRUN cp $REPO/config $REPO/config.bak
    $DRYRUN cp $TEMP_CONF $REPO/config
  fi

  [ $CHANGED -eq 1 ] && echo 'changed' || echo 'unmodified'
  rm $TEMP_CONF*
done

#Migrate SSH Keys
echo
echo "Migrating Personal SSH Keys"
for ROW in `server_req '/rest/ssh/1.0/keys' | jq '.values[] | .label+"\t"+.text' -r`; 
do  
  LABEL=`echo $ROW | awk -F '\t' '{ print $1 }'`
  LABEL=${LABEL:-default}
  KEY=`echo $ROW | awk -F '\t' '{ print $2 }'`

  echo -n "  * Migrating key ${LABEL} to ${CLOUD_HOST}: ${KEY:0:20} ..."
  $DRYRUN cloud_req "/1.0/users/${CLOUD_USERNAME}/ssh-keys" \
    -d "label=$LABEL" \
    --data-urlencode "key=$KEY" > /dev/null

  check_req "done" echo "failed"
done

#Migrate Personal Repos
echo
echo "Migrating personal repositories"
for REPO in `server_req '/rest/api/1.0/users/'${SERVER_USERNAME}'/repos' | jq -r '.values[].slug'`; 
do  
  echo "  * Moving ${REPO} to ${CLOUD_HOST}"
  TEMP_PROJ=$TEMP_DIR/project.`clean_name $REPO`.json

  echo -n "    - Creating Repository ${REPO} in ${CLOUD_HOST}... "
  echo '{
  "scm": "git",
  "name": "'${REPO}'",
  "description": "'${REPO}'",
  "is_private": true,
  "fork_policy": "no_public_forks"
}' > $TEMP_PROJ

  $DRYRUN cloud_req  "/2.0/repositories/${CLOUD_USERNAME}/${REPO}" -H 'Content-type: application/json' -d "@$TEMP_PROJ" > /dev/null
  check_req "done" echo "failed"

  if [ $REQ_FAIL -eq 0 ]; then
    GIT_DIR=$TEMP_DIR/$REPO

    rm -rf $GIT_DIR 2> /dev/null

    echo -n "    - Cloning from ${SERVER_HOST} ... "
    $DRYRUN git clone $GIT_OPTS --mirror https://$SERVER_USERNAME:$SERVER_PASSWORD@$SERVER_HOST/scm/~$SERVER_USERNAME/$REPO.git $GIT_DIR
    [ $? -eq 0 ] && echo "done" || echo "failed"

    $DRYRUN pushd $GIT_DIR > /dev/null
    echo -n "    - Pushing to ${CLOUD_HOST} ... "
    $DRYRUN git push $GIT_OPTS --mirror https://$CLOUD_USERNAME:$CLOUD_PASSWORD@$CLOUD_HOST/$CLOUD_USERNAME/$REPO.git 
    [ $? -eq 0 ] && echo "done" || echo "failed"
   
    $DRYRUN popd > /dev/null

    $DRYRUN rm -rf $GIT_DIR 2> /dev/null
  fi  

  rm $TEMP_PROJ
done

IFS="$OLDIFS"
