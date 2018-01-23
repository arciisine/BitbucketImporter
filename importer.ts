import * as requestPromise from 'request-promise';
import * as minimist from 'minimist';
import * as childProcess from 'child_process';
import * as os from 'os';
import * as rimraf from 'rimraf';
import * as util from 'util';

const TEMP = os.tmpdir();
const PAGE_SIZE = 3
const PAGE_WAIT = 2000
const HEADERS = {
  'Content-Type': 'application/json',
  'Accepts': 'application/json'
}

function isPrivate(v: any) {
  return `${v}`.toLowerCase() !== 'true'
}

function sleep(num: number) {
  return new Promise(resolve => setTimeout(resolve, num));
}

function exec(command: string, opts: childProcess.ExecOptions = {}) {
  let child = childProcess.exec(command, opts);
  return new Promise((resolve, reject) => {
    child.addListener("error", reject);
    child.addListener('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject();
      }
    });
  });
}

class BitbucketImporter {
  constructor(
    public serverHost: string,
    public serverCredentials: string,
    public cloudOwner: string,
    public cloudCredentials: string,
    public serverUrl = `https://${serverHost}/rest/api/1.0`,
    public cloudUrl = `https://api.bitbucket.org/2.0`
  ) { }

  async upload(pkey: string, key: string, slug: string) {
    let path = `${TEMP}/${slug}`;
    try {
      await exec(`git clone --mirror https://${this.serverCredentials}@${this.serverHost}/scm/${pkey}/${key}.git ${path}`);
      await exec(`git push --mirror https://${this.cloudCredentials}@bitbucket.org/${this.cloudOwner}/${slug}.git`, { cwd: path })
    } finally {
      await util.promisify(rimraf);
    }
  }

  cloudRequest(path: string, opts: requestPromise.RequestPromiseOptions = { json: true }) {
    let [user, password] = this.cloudCredentials.split(':');
    return requestPromise(`${this.cloudUrl}/${path}`, {
      auth: { user, password },
      headers: HEADERS,
      ...opts
    });
  }

  serverRequest(path: string, opts: requestPromise.RequestPromiseOptions = { json: true }) {
    let [user, password] = this.serverCredentials.split(':');
    return requestPromise(`${this.serverUrl}/${path}`, {
      auth: { user, password },
      headers: HEADERS,
      ...opts
    });
  }

  async processRequest(action: string, req: requestPromise.RequestPromise) {
    try {
      let response = await req;
      if (response.type !== 'error') {
        console.log(`${action} ... done`);
        return response;
      } else {
        throw new Error('Failed');
      }
    } catch (e) {
      console.log(`${action} ... failed - ${e.message}`);
      throw e;
    }
  }

  async importRepository(pkey: string, id: string, name: string, key: string, priv: boolean) {
    let qualName = `${pkey}-${name}`

    const slug = `${pkey}_${key}`.toLowerCase().replace(/-/g, '_');

    let req = this.cloudRequest(`repositories/${this.cloudOwner}/${slug}`, {
      method: 'POST',
      json: {
        scm: 'git',
        name: qualName,
        key: key,
        description: name,
        is_private: priv,
        fork_policy: 'no_public_forks',
        has_issues: true,
        has_wiki: true,
        project: {
          key: pkey
        }
      }
    });

    let res = await this.processRequest(`Creating Project ${pkey} repository ${slug}`, req);

    await this.upload(pkey, key, slug);
  }

  async importRepositories(key: string, start: number = 0) {
    let repos = await this.serverRequest(`projects/${key}/repos?pageSize=${PAGE_SIZE}&start=${start}`);

    let all = [];

    for (let repo of repos.values) {
      let prom = this.importRepository(key, repo.id, repo.name, repo.slug, isPrivate(repo.public));
      all.push(prom);
    }

    await Promise.all(all);

    if (!!repos.nextPageStart) {
      await this.importRepositories(key, repos.nextPageStart);
    }
  }

  async importProject(id: string, key: string, name: string, priv: boolean) {

    let cReq = this.cloudRequest(`teams/${this.cloudOwner}/projects/`, {
      method: 'POST',
      json: {
        name,
        key,
        description: name,
        is_private: priv
      }
    });

    let created = await this.processRequest(`Creating Project ${key}`, cReq);

    await this.importRepositories(key);
  }

  async importProjects(start: number = 0) {
    let projects = await this.serverRequest(`projects?pageSize=${PAGE_SIZE}&start=${start}`);

    let all = [];

    for (let project of projects.values) {
      let imp = this.importProject(project.id, project.key, project.name, isPrivate(project.public));
      all.push(imp);
    }

    await Promise.all(all);

    if (!!projects.nextPageStart) {
      await this.importProjects(projects.nextPageStart)
    }
  }

  async deleteRepository(slug: string) {
    let req = this.cloudRequest(`repositories/${this.cloudOwner}/${slug}`, {
      method: 'DELETE'
    });

    await this.processRequest(`Removing Repository ${slug}`, req);
  }

  async deleteRepositories() {
    let repos = await this.cloudRequest(`repositories/${this.cloudOwner}?pagelen=${PAGE_SIZE}`)
    let all = repos.values.map((repo: any) => this.deleteRepository(repo.slug));
    await Promise.all(all);

    if (!!repos.next) {
      await sleep(PAGE_WAIT);
      await this.deleteRepositories();
    }
  }

  async deleteProject(key: string) {
    let req = this.cloudRequest(`teams/${this.cloudOwner}/projects/${key}`, {
      method: 'DELETE'
    });

    let response = await this.processRequest(`Removing Project ${key}`, req);
  }

  async deleteProjects() {
    let projects = await this.cloudRequest(`teams/${this.cloudOwner}/projects/?pagelen=${PAGE_SIZE}`);
    let all = projects.values.map((project: any) => this.deleteProject(project.key));

    await Promise.all(all);

    if (!!projects.next) {
      await sleep(PAGE_WAIT);
      await this.deleteProjects();
    }
  }

  async run() {
    await this.deleteRepositories();
    await this.deleteProjects();
    await this.importProjects();
  }
}

let args = minimist(process.argv, {});

new BitbucketImporter(args.sHost, args.sCreds, args.cOwner, args.cCreds)
  .run()
  .then(() => {
    console.log('DONE!');
  }, (e) => {
    console.log('FAILED!', e);
  })