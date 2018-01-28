# BitbucketImporter

This is a tool to migrate from a Bitbucket Server installation to Bitbucket.org.  

The tool provides the following features:
* Set server to read only (by removing all user permissions as this seems to be the only way)
  * _WARNING_: All users will lose specific permissions and be given read only access to entire code base
* Migrate code to Bitbucket.org
  * _WARNING_: Will delete everything in Bitbucket.org under the team and do a fresh import
  * Migrate all projects to Bitbucket.org
  * Migrate all repositories to Bitbucket.org
    * Bitbucket.org handles the hierarchy of project/repo a little differently
    * Repositories cannot have the same name as all repositories live at the same level (vs under a project in Server)
    * All repository slugs will be renamed to be prefixed with the project key
* Produces a user migration script
  * Handles SSH keys
  * Handles Personal Repositories
  * Will rewrite local .git/config files to point to new urls in Bitbucket.org 

What is needed:
* A Bitbucket Server admin account, username and password
* A Bitbucket.org Team Administrator account, for whatever team you want to migrate to

How to run:
* npm install (first time only)
* `[USAGE] ./importer.sh --sh|--server-host <Server Host> --su|--server-user <Server User> --sp|--server-pass <Server Password> --ct|--cloud-team <Cloud Team> --cu|--cloud-user <Cloud User> --cp|--cloud-pass <Cloud Password> [archive|import|userscript]`
