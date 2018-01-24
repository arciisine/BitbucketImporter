import * as requestPromise from 'request-promise';
import * as minimist from 'minimist';
import * as os from 'os';

import { Project, Repository } from './types';
import { Queue } from './queue';
import { exec, log, rmdir } from './util';

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

export class BitbucketImporter {
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
      log(`Cloning Project ${pkey} Repository ${key}`);
      await exec(`git clone --mirror https://${this.serverCredentials}@${this.serverHost}/scm/${pkey}/${key}.git ${path}`);
      log(`Pushing Project ${pkey} Repository ${key}`);
      await exec(`git push --mirror https://${this.cloudCredentials}@bitbucket.org/${this.cloudOwner}/${slug}.git`, { cwd: path })
    } finally {
      await rmdir(path);
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

  async importRepositories(key: string) {
    return new Queue<Repository, any>(PAGE_SIZE, {
      namespace: (r?: Repository) => r ? `[Importing] Project ${key}: Repository ${r.slug}` : `[Importing] Project ${key}`,
      gatherItems: async () => {
        let repos = await this.serverRequest(`projects/${key}/repos?pageSize=150`);
        return repos.values as Repository[];
      },
      startItem: async (r: Repository) => {
        const slug = `${key}_${r.key}`.toLowerCase().replace(/-/g, '_');
        let qualName = `${key}-${r.name}`

        let req = await this.cloudRequest(`repositories/${this.cloudOwner}/${slug}`, {
          method: 'POST',
          json: {
            scm: 'git',
            name: qualName,
            key: r.key,
            description: r.name,
            is_private: isPrivate(r.public),
            fork_policy: 'no_public_forks',
            has_issues: true,
            has_wiki: true,
            project: {
              key
            }
          }
        });
        await this.upload(key, r.slug, slug);
        return;
      }
    }).run();
  }

  importProjects(start: number = 0) {
    return new Queue<Project, any>(PAGE_SIZE, {
      namespace: (p?: Project) => p ? `[Importing] Project ${p.key}` : `[Importing] Projects`,
      gatherItems: async () => {
        return (await this.serverRequest(`projects?pageSize=150`)).values as Project[];
      },
      startItem: async (p: Project) => {
        await this.cloudRequest(`teams/${this.cloudOwner}/projects/`, {
          method: 'POST',
          json: {
            name: p.name,
            key: p.key,
            description: p.name,
            is_private: isPrivate(p.public)
          }
        });
        await this.importRepositories(p.key);
        return;
      }
    }).run();
  }
  deleteRepositories() {
    return new Queue<string>(PAGE_SIZE, {
      namespace: (key?: string) => key ? `[Removing] Repository ${key}` : `[Removing] Repositories`,
      gatherItems: async () => {
        let repos = await this.cloudRequest(`repositories/${this.cloudOwner}`)
        return repos.values.map((r: any) => r.slug) as string[];
      },
      startItem: async (slug: string) => {
        let req = this.cloudRequest(`repositories/${this.cloudOwner}/${slug}`, {
          method: 'DELETE'
        });
        return req;
      }
    }).run();
  }

  deleteProjects() {
    return new Queue<string>(PAGE_SIZE, {
      namespace: (key?: string) => key ? `[Removing] Project ${key}` : `[Removing] Projects`,
      gatherItems: async () => {
        let projects = await this.cloudRequest(`teams/${this.cloudOwner}/proejcts/`)
        return projects.values.map((p: any) => p.key) as string[];
      },
      startItem: async (key: string) => {
        let req = this.cloudRequest(`teams/${this.cloudOwner}/projects/${key}`, {
          method: 'DELETE'
        });
        return req;
      }
    }).run();
  }

  async run() {
    log('Starting');
    await this.deleteRepositories();
    await this.deleteProjects();
    await this.importProjects();
  }
}

let args = minimist(process.argv, {});

new BitbucketImporter(args.sHost, args.sCreds, args.cOwner, args.cCreds)
  .run()
  .then(
  () => log('DONE!'),
  e => log('FAILED!', e)
  );