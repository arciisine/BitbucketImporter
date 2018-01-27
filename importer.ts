import * as os from 'os';
import * as requestPromise from 'request-promise';

import { Project, Repository, Group, User, Named, PermissionGroup, PermissionUser } from './types';
import { Queue } from './queue';
import { exec, log, rmdir, request } from './util';

import { mkdirSync } from 'fs';
import { QueueSource } from './queue-source';

const TEMP = `${os.tmpdir()}/import`;
const PAGE_SIZE = 100;

try {
  mkdirSync(TEMP);
} catch (e) {
  //Do nothing
}

function isPrivate(v: any) {
  return `${v}`.toLowerCase() !== 'true'
}

type PageHandler = (page: number) => { [key: string]: number };
type Requestor<T> = (url: string, opts?: requestPromise.RequestPromiseOptions) => Promise<{ values: T[] }>

export class BitbucketImporter {

  private sourceCache: { [pkey: string]: QueueSource<any> } = {};

  constructor(
    public serverHost: string,
    public serverCredentials: string,
    public cloudOwner: string,
    public cloudCredentials: string,
    public serverUrl = `https://${serverHost}/rest/api/1.0`,
    public cloudUrl = `https://api.bitbucket.org/2.0`
  ) { }

  getSource<T>(url: string, req: Requestor<T>, ph: PageHandler, cache: boolean = true): QueueSource<T> {
    let key = `${req.name}||${url}`;
    let el = this.sourceCache[key];
    if (!cache || !el) {
      let namespace = url.split('/').filter(x => !!x).join(' ');
      el = new QueueSource((page: number) => {
        return req(url, { qs: ph(page) }).then(x => x.values);
      }, namespace);
      if (cache) {
        this.sourceCache[key] = el;
      }
    }
    return el as QueueSource<T>;
  }

  getServerSource<T>(url: string): QueueSource<T> {
    return this.getSource<T>(url, this.serverRequest, p => ({
      pageSize: PAGE_SIZE,
      start: (p - 1) * PAGE_SIZE
    }));
  }

  getCloudSource<T>(url: string): QueueSource<T> {
    return this.getSource<T>(url, this.cloudRequest, p => ({
      pagelen: PAGE_SIZE,
      page: p
    }));
  }

  genCloudSlug(key: string, r: Repository) {
    return `${key}_${r.slug}`.toLowerCase().replace(/-/g, '_');
  }

  async upload(pkey: string, r: Repository) {
    const slug = this.genCloudSlug(pkey, r);

    let path = `${TEMP}/${slug}`;
    try {
      log(`[Cloning] Project ${pkey}: Repository ${r.key}`);
      await exec(`git clone --mirror https://${this.serverCredentials}@${this.serverHost}/scm/${pkey}/${key}.git ${path}`);
      log(`[Pushing] Project ${pkey}: Repository ${r.key}`);
      await exec(`git push --mirror https://${this.cloudCredentials}@bitbucket.org/${this.cloudOwner}/${slug}.git`, { cwd: path })
    } finally {
      await rmdir(path);
    }
  }

  cloudRequest<T>(path: string, opts?: requestPromise.RequestPromiseOptions) {
    return request<T>(`${this.cloudUrl}/${path}`, this.cloudCredentials, opts);
  }

  serverRequest<T>(path: string, opts?: requestPromise.RequestPromiseOptions) {
    return request<T>(`${this.serverUrl}/${path}`, this.serverCredentials, {
      ...(opts || {}),
      headers: {
        ...((opts || {}).headers || {}),
        'X-Atlassian-Token': 'no-check'
      }
    });
  }

  archiveSubPermissions<T>(path: string, title: string, getName: (e: T) => string) {
    return Queue.run<T>({
      namespace: (n?) => n ? `[Archiving] ${title} ${getName(n)}` : `[Archiving] ${title}s`,
      source: this.getServerSource(path),
      processItem: async n => {
        if (!getName(n)) {
          throw new Error(`Unnamed ${getName(n)}`);
        }
        await this.serverRequest(path, {
          method: 'DELETE',
          qs: { name: getName(n) }
        });
      }
    });
  }

  archiveRepositories(key: string) {
    return Queue.run<Repository>({
      namespace: (r?) => r ? `[Archiving] Project ${key} Repository ${r.slug}` : `[Archiving] Project ${key} Repositories`,
      source: this.getServerSource(`projects/${key}`),
      processItem: async r => {
        await this.archiveSubPermissions<PermissionGroup>(
          `projects/${key}/permissions/groups`,
          `Project ${key} Repository ${r.slug} Group`,
          p => p.group.name
        );
        await this.archiveSubPermissions<PermissionUser>(
          `projects/${key}/permissions/users`,
          `Project ${key} Repository ${r.slug} User`,
          p => p.user.name
        );
      }
    });
  }

  archiveServerProjects() {
    return Queue.run<Project>({
      namespace: (p?) => p ? `[Archiving] Project ${p.key}` : `[Archiving] Projects`,
      source: this.getServerSource('projects'),
      processItem: async p => {
        await this.archiveRepositories(p.key);

        await this.archiveSubPermissions<PermissionGroup>(
          `projects/${p.key}/permissions/groups`,
          `Project ${p.key} Group`,
          p => p.group.name
        );

        await this.archiveSubPermissions<PermissionUser>(
          `projects/${p.key}/permissions/users`,
          `Project ${p.key} User`,
          p => p.user.name
        );

        await this.serverRequest(`projects/${p.key}`, { method: 'PUT', json: { ...p, public: false } });
        await this.serverRequest(`projects/${p.key}/permissions/PROJECT_ADMIN/all`, { method: 'POST', qs: { allow: false } });
        await this.serverRequest(`projects/${p.key}/permissions/PROJECT_WRITE/all`, { method: 'POST', qs: { allow: false } });
        await this.serverRequest(`projects/${p.key}/permissions/PROJECT_READ/all`, { method: 'POST', qs: { allow: true } });
      }
    });
  }

  importRepositories(key: string) {
    return Queue.run<Repository>({
      namespace: (r?) => r ? `[Importing] Project ${key}: Repository ${r.slug}` : `[Importing] Project ${key} Repositories`,
      source: this.getServerSource(`projects/${key}`),
      processItem: async r => {
        const slug = this.genCloudSlug(key, r);

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

        await this.upload(key, r);
      }
    });
  }

  importServerProjects(start: number = 0) {
    return Queue.run<Project>({
      namespace: (p?) => p ? `[Importing] Project ${p.key}` : `[Importing] Projects`,
      source: this.getServerSource(`projects`),
      processItem: async p => {
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

  deleteCloudRepositories() {
    return Queue.run<Repository>({
      namespace: (r?) => r ? `[Removing] Repository ${r.slug}` : `[Removing] Repositories`,
      source: this.getCloudSource(`repositories/${this.cloudOwner}`),
      processItem: r => {
        return this.cloudRequest(`repositories/${this.cloudOwner}/${r.slug}`, { method: 'DELETE' });
      }
    })
  }

  deleteCloudProjects() {
    return Queue.run<Project>({
      namespace: (p?) => p ? `[Removing] Project ${p.key}` : `[Removing] Projects`,
      source: this.getCloudSource(`teams/${this.cloudOwner}/projects/`),
      processItem: p => {
        return this.cloudRequest(`teams/${this.cloudOwner}/projects/${p.key}`, { method: 'DELETE' });
      }
    });
  }

  async generateRepoMapping() {
    const out: [string, string][] = [];
    await Queue.run<Project>({
      namespace: (p?) => p ? `[Mapping] Project ${p.key}` : `[Mapping] Projects`,
      source: this.getServerSource(`projects`),
      processItem: async p => {
        let key = p.key;

        //Read repos
        await Queue.run<Repository>({
          namespace: (r?) => r ? `[Mapping] Project ${key}: Repository ${r.slug}` : `[Mapping] Project ${key} Repositories`,
          source: this.getServerSource(`projects/${key}`),
          processItem: async r => {
            const slug = this.genCloudSlug(key, r);
            out.push(
              [`${this.serverHost}/scm/${key}/${r.key}.git`, `bitbucket.org/${this.cloudOwner}/${slug}.git`], //http,
              [`${this.serverHost}/${key}/${r.key}.git`, `bitbucket.org:${this.cloudOwner}/${this.cloudOwner}/${slug}.git`], //ssh,
            )
          }
        });

        console.log(
          out.sort((a, b) => (b[0].length + b[1].length) - (a[0].length + a[1].length))
            .map(x => x.join('\t')).join('\n'));
      }
    });
  }
}