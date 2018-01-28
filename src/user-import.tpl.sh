#!/bin/bash
SERVER_HOST=%%SERVER_HOST%%
CLOUD_HOST=%%CLOUD_HOST%%
TEMP_DIR=%%TEMP_DIR%%

REQ_FAIL=0
VERBOSE=0
DEBUG=0
DRYRUN_FLAG=0
COMMENT=0
CODE_ROOT=$HOME
KEY_CACHE="$TEMP_DIR/existing.ssh.json"

function read_params() {
  POSITIONAL=()
  while [[ $# -gt 0 ]]
  do
  key="$1"

  case $key in
      --verbose|-v)
      VERBOSE=1;shift
      ;;
      --debug|-d)
      DEBUG=1;shift
      ;;
      --server-user|--su)
      SERVER_USER="$2"; shift; shift
      ;;
      --server-pass|--sp)
      SERVER_PASS="$2"; shift; shift
      ;;
      --cloud-user|--cu)
      CLOUD_USER="$2"; shift; shift
      ;;
      --cloud-pass|--cp)
      CLOUD_PASS="$2"; shift; shift
      ;;
      --code-root|--cr)
      CODE_ROOT="$2"; shift; shift
      ;;
      *)    # unknown option
      ACTION=$1
      shift # past argument
      ;;
  esac
  done

  [[ -z "$CLOUD_USER" ]] && read -p "${CLOUD_HOST} Username: " CLOUD_USER && echo
  [[ -z "$CLOUD_PASS" ]] && read -s -p "${CLOUD_HOST} Password: " CLOUD_PASS && echo
  [[ -z "$SERVER_USER" ]] && read -p "${SERVER_HOST} Username: " SERVER_USER && echo
  [[ -z "$SERVER_PASS" ]] && read -s -p "${SERVER_HOST} Password: " SERVER_PASS && echo

  if !([[ "$ACTION" == 'apply' ]] || [[ "$ACTION" == 'test' ]]) || \
     [[ -z "$CLOUD_USER" ]] || [[ -z "$CLOUD_PASS" ]] || \
     [[ -z "$SERVER_USER" ]] || [[ -z "$SERVER_PASS" ]];
  then
    SELF=`basename $0`
    echo "Usage $SELF [--server-user|--su <user>] [--server-pass|--sp <pw>] [--cloud-user|--cu <user>] [--cloud-pw|--cp <pw>] [--code-root|--cr <Code workspace|$HOME> ] [-v|--verbose] [-d|--debug] (apply|test)"
    exit 1
  fi 

  [[ "$ACTION" == 'test' ]] && DRYRUN_FLAG=1

  ([ $DEBUG -eq 1 ] || [ $DRYRUN_FLAG -eq 1 ]) && COMMENT=1 || COMMENT=0

  if [ $VERBOSE -eq 1 ]; then
    set -x
    CURL_OPTS='-v'
    GIT_OPTS=''
  else
    CURL_OPTS='-s'
    GIT_OPTS='-q'
  fi

  [ $DRYRUN_FLAG -eq 1 ] && DRYRUN=log || DRYRUN=""
}

function quit() {
  echo $1; exit $2
}

function clean_name() {
  echo $1 | sed -r -e 's|[^A-Za-z0-9]+|_|g';
}

function header() {
  if [ $COMMENT -eq 0 ];then 
    echo -n "$1 ... "
  else
    echo "$1"
  fi  
}

function log() {
  [ $COMMENT -eq 1 ] && echo ""${@}
}

function check_req() {
  [ $REQ_FAIL -eq 0 ] && echo $1 || $2 "$3"
}

function server_req() {
  REQ_FAIL=0
  log curl "https://"$SERVER_HOST${@} 1>&2
  if ! curl $CURL_OPTS -f -H 'Accepts: application/json' -H 'X-Atlassian-Token:no-check' \
    -u "${SERVER_USER}:${SERVER_PASS}" "https://$SERVER_HOST"${@};
  then
    REQ_FAIL=1
  fi  
}

function cloud_req() {
  REQ_FAIL=0
  log curl "https://api.$CLOUD_HOST"${@} 1>&2
  if ! curl $CURL_OPTS -f -H 'Accepts: application/json' \
    -u "${CLOUD_USER}:${CLOUD_PASS}" "https://api.$CLOUD_HOST"${@};
  then
    REQ_FAIL=1
  fi    
}

function create_ssh() {
  LABEL="${1:-default}"
  KEY="$2"

  if [ ! -e "$KEY_CACHE" ]; then 
    cloud_req "/1.0/users/${CLOUD_USER}/ssh-keys" | jq -r '.[] | (.pk|tostring)+"++"+.label' > $KEY_CACHE
  fi

  for EXISTING in `cat $KEY_CACHE`; 
  do
    CLABEL=`echo $EXISTING | awk -F '++' '{ print $2 }'`
    CPK=`echo $EXISTING | awk -F '++' '{ print $1 }'`
    if [ "$CLABEL" == "$LABEL" ]; then
      header "  * Deleting existing key ${LABEL} from ${CLOUD_HOST}"
      cloud_req "/1.0/users/${CLOUD_USER}/ssh-keys/${CPK}" -XDELETE > /dev/null
      check_req "done" echo "failed"            
    fi
  done

  header "  * Migrating key ${LABEL} to ${CLOUD_HOST}: ${KEY:0:20}"

  $DRYRUN cloud_req "/1.0/users/${CLOUD_USER}/ssh-keys" \
    -d "label=$LABEL" \
    --data-urlencode "key=$KEY" > /dev/null

  check_req "done" echo "failed"
}

function convert_local_repo_config() {
  REPO=$1
  header "  * Updating $REPO/config"
  
  TEMP_CONF=$TEMP_DIR/git.`clean_name $REPO`.config;

  cat $REPO/config | sed -r \
    %%SED_EXPRESSIONS%%
    -e 's|(ssh://)?git@'$SERVER_HOST'[:/]~'$SERVER_USER'/(.*)$|git@'$CLOUD_HOST':'$CLOUD_USER'/\2|' \
    -e 's|https://('$SERVER_USER'@)?'$SERVER_HOST'/scm/~'$SERVER_USER'/(.*)$|https://'$CLOUD_USER'@'$CLOUD_HOST'/'$CLOUD_USER'/\2|' \
    > $TEMP_CONF

  (diff --suppress-common-line -y $REPO/config $TEMP_CONF > $TEMP_CONF.diff) && CHANGED=0 || CHANGED=1
  [ $COMMENT -eq 1 ] && echo && cat $TEMP_CONF.diff

  if [[ $CHANGED -eq 1 ]]; then
    $DRYRUN cp $REPO/config $REPO/config.bak
    $DRYRUN cp $TEMP_CONF $REPO/config
  fi

  [ $CHANGED -eq 1 ] && echo 'changed' || echo 'unmodified'
  rm $TEMP_CONF*
}

function migrate_personal_repo() {
  REPO=$1

  echo "  * Moving ${REPO} to ${CLOUD_HOST}"
  TEMP_PROJ=$TEMP_DIR/project.`clean_name $REPO`.json

  header "    - Attempting to Delete ${REPO} in ${CLOUD_HOST}"
  $DRYRUN cloud_req  "/2.0/repositories/${CLOUD_USER}/${REPO}" -XDELETE > /dev/null
  check_req "done" echo "failed"

  header "    - Creating Repository ${REPO} in ${CLOUD_HOST}"
  echo '{
  "scm": "git",
  "name": "'${REPO}'",
  "description": "'${REPO}'",
  "is_private": true,
  "fork_policy": "no_public_forks"
}' > $TEMP_PROJ

  $DRYRUN cloud_req  "/2.0/repositories/${CLOUD_USER}/${REPO}" -H 'Content-type: application/json' -d "@$TEMP_PROJ" > /dev/null
  check_req "done" echo "failed"

  if [ $REQ_FAIL -eq 0 ]; then
    GIT_DIR=$TEMP_DIR/$REPO

    rm -rf $GIT_DIR 2> /dev/null    

    header "    - Cloning from ${SERVER_HOST}"
    $DRYRUN git clone $GIT_OPTS --mirror https://$SERVER_USER:$SERVER_PASS@$SERVER_HOST/scm/~$SERVER_USER/$REPO.git $GIT_DIR
    [ $? -eq 0 ] && echo "done" || echo "failed"

    $DRYRUN pushd $GIT_DIR > /dev/null
    header "    - Pushing to ${CLOUD_HOST}"
    $DRYRUN git push $GIT_OPTS --mirror https://$CLOUD_USER:$CLOUD_PASS@$CLOUD_HOST/$CLOUD_USER/$REPO.git 
    [ $? -eq 0 ] && echo "done" || echo "failed"
   
    $DRYRUN popd > /dev/null

    $DRYRUN rm -rf $GIT_DIR 2> /dev/null
  fi  

  rm $TEMP_PROJ
}

#Handle spaces in file names
OLDIFS="$IFS"
IFS='
'

read_params ${@}

mkdirp - $TEMP_DIR

#Verify user session
echo -e "\nInitializing"
header "  * Validating ${CLOUD_HOST} credentials"
cloud_req '/2.0/user' > /dev/null
check_req "success" quit "${CLOUD_HOST} credentials invalid"

header "  * Validating ${SERVER_HOST} credentials"
server_req "/rest/api/1.0/users/$SERVER_USER" > /dev/null
check_req "success" quit "${SERVER_HOST} credentials invalid"

#Update all repos from current location
echo -e "\nConverting local git repo configs"
for REPO in `find $CODE_ROOT -name '.git' -type d 2> /dev/null`; do
  if grep 'git.eaiti.com' $REPO/config > /dev/null; then
    convert_local_repo_config $REPO
  fi  
done

#Remove
rm -rf $KEY_CACHE 2>&1 > /dev/null

#Migrate SSH Keys
echo -e "\nMigrating Bitbucket Server Personal SSH Keys"
for ROW in `server_req '/rest/ssh/1.0/keys' | jq '.values[] | .label+"\t"+.text' -r`; 
do  
  LABEL=`echo $ROW | awk -F '\t' '{ print $1 }'`
  KEY=`echo $ROW | awk -F '\t' '{ print $2 }'`

  create_ssh "$LABEL" "$KEY"
done

#Personal, local ssh key
PUBKEY="$HOME/.ssh/id_rsa.pub"
if [ -e $PUBKEY ]; then
  echo -e "\nMigrating Local SSH Keys" 
  LABEL=`cat $PUBKEY | awk '{print $3}'`
  KEY=`cat $PUBKEY`

  create_ssh "$LABEL" "$KEY"
fi

#Migrate Personal Repos
echo -e "\nMigrating personal repositories"
for REPO in `server_req '/rest/api/1.0/users/'${SERVER_USER}'/repos' | jq -r '.values[].slug'`; 
do  
  migrate_personal_repo "$REPO"
done

IFS="$OLDIFS"
