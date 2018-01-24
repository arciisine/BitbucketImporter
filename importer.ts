import * as requestPromise from 'request-promise';
import * as os from 'os';

import { Project, Repository } from './types';
import { Queue } from './queue';
import { exec, log, rmdir } from './util';

import { mkdirSync } from 'fs';

const TEMP = `${os.tmpdir()}/import`;
const CONCURRENCY = 3
const PAGE_SIZE = 100;

mkdirSync(TEMP);

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
      log(`[Cloning] Project ${pkey}: Repository ${key}`);
      await exec(`git clone --mirror https://${this.serverCredentials}@${this.serverHost}/scm/${pkey}/${key}.git ${path}`);
      log(`[Pushing] Project ${pkey}: Repository ${key}`);
      await exec(`git push --mirror https://${this.cloudCredentials}@bitbucket.org/${this.cloudOwner}/${slug}.git`, { cwd: path })
    } finally {
      await rmdir(path);
    }
  }

  request<U>(url: string, cred: string, opts?: requestPromise.RequestPromiseOptions) {
    let [user, password] = cred.split(':');
    //log(`[Request] [${(opts && opts.method) || 'GET'}] ${url}`);
    opts = opts || { json: true };
    return requestPromise(url, {
      auth: { user, password },
      headers: HEADERS,
      ...opts
    }) as any as Promise<{ values: U[] }>;
  }

  cloudRequest<T>(path: string, opts?: requestPromise.RequestPromiseOptions) {
    return this.request<T>(`${this.cloudUrl}/${path}`, this.cloudCredentials, opts);
  }

  serverRequest<T>(path: string, opts?: requestPromise.RequestPromiseOptions) {
    return this.request<T>(`${this.serverUrl}/${path}`, this.serverCredentials, opts);
  }

  importRepositories(key: string) {
    return Queue.run(CONCURRENCY, {
      namespace: (r?: Repository) => r ? `[Importing] Project ${key}: Repository ${r.slug}` : `[Importing] Project ${key}`,
      fetchItems: (page: number) => {
        return this.serverRequest<Repository>(`projects/${key}/repos?pageSize=${PAGE_SIZE}&start=${(page - 1) * PAGE_SIZE}`)
          .then(x => x.values)
      },
      startItem: async (r: Repository) => {
        const slug = `${key}_${r.slug}`.toLowerCase().replace(/-/g, '_');
        let qualName = `${key}-${r.name}`

        await this.cloudRequest(`repositories/${this.cloudOwner}/${slug}`, {
          method: 'POST',
          json: {
            scm: 'git',
            name: qualName,
            description: r.name,
            is_private: isPrivate(r.public),
            fork_policy: 'no_public_forks',
            has_issues: true,
            has_wiki: true,
            project: { key }
          }
        });
        await this.upload(key, r.slug, slug);
      }
    });
  }

  importProjects(start: number = 0) {
    return Queue.run(CONCURRENCY, {
      namespace: (p?: Project) => p ? `[Importing] Project ${p.key}` : `[Importing] Projects`,
      fetchItems: (page: number) => {
        return this.serverRequest<Project>(`projects?pageSize=${PAGE_SIZE}&start=${(page - 1) * PAGE_SIZE}`)
          .then(x => x.values);
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
      }
    });
  }

  deleteRepositories() {
    return Queue.run(CONCURRENCY, {
      namespace: (r?: Repository) => r ? `[Removing] Repository ${r.slug}` : `[Removing] Repositories`,
      fetchItems: (page: number) => {
        return this.cloudRequest<Repository>(`repositories/${this.cloudOwner}?pagelen=${PAGE_SIZE}&page=${page}`)
          .then(x => x.values);
      },
      startItem: (r: Repository) => {
        return this.cloudRequest(`repositories/${this.cloudOwner}/${r.slug}`, { method: 'DELETE' });
      }
    })
  }

  deleteProjects() {
    return Queue.run(CONCURRENCY, {
      namespace: (p?: Project) => p ? `[Removing] Project ${p.key}` : `[Removing] Projects`,
      fetchItems: (page: number) => {
        return this.cloudRequest<Project>(`teams/${this.cloudOwner}/projects/?pagelen=${PAGE_SIZE}&page=${page}`)
          .then(x => x.values);
      },
      startItem: (p: Project) => {
        return this.cloudRequest(`teams/${this.cloudOwner}/projects/${p.key}`, { method: 'DELETE' });
      }
    });
  }
}