import * as os from 'os';
import * as requestPromise from 'request-promise';

import { Project, Repository, Group, User, Named, PermissionGroup, PermissionUser } from './types';
import { Queue } from './queue';
import { exec, log, rmdir, request } from './util';

import { mkdirSync } from 'fs';

const TEMP = `${os.tmpdir()}/import`;
const CONCURRENCY = 3
const PAGE_SIZE = 100;

try {
  mkdirSync(TEMP);
} catch (e) {
  //Do nothing
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
    return Queue.run(CONCURRENCY, {
      namespace: (n?: T) => n ? `[Archiving] ${title} ${getName(n)}` : `[Archiving] ${title}s`,
      fetchItems: (page: number) => {
        return this.serverRequest<T>(path, {
          qs: {
            pageSize: PAGE_SIZE,
            start: (page - 1) * PAGE_SIZE
          }
        }).then(x => x.values);
      },
      startItem: async (n: T) => {
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
    return Queue.run(CONCURRENCY, {
      namespace: (r?: Repository) => r ? `[Archiving] Project ${key} Repository ${r.slug}` : `[Archiving] Project ${key} Repositories`,
      fetchItems: (page: number) => {
        return this.serverRequest<Repository>(`projects/${key}/repos`, {
          qs: {
            pageSize: PAGE_SIZE,
            start: (page - 1) * PAGE_SIZE
          }
        })
          .then(x => x.values);
      },
      startItem: async (r: Repository) => {
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

  archiveProjects() {
    return Queue.run(CONCURRENCY, {
      namespace: (p?: Project) => p ? `[Archiving] Project ${p.key}` : `[Archiving] Projects`,
      fetchItems: (page: number) => {
        return this.serverRequest<Project>(`projects`, {
          qs: {
            name: 'college',
            pageSize: PAGE_SIZE,
            start: (page - 1) * PAGE_SIZE
          }
        })
          .then(x => x.values);
      },
      startItem: async (p: Project) => {
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
    return Queue.run(CONCURRENCY, {
      namespace: (r?: Repository) => r ? `[Importing] Project ${key}: Repository ${r.slug}` : `[Importing] Project ${key} Repositories`,
      fetchItems: (page: number) => {
        return this.serverRequest<Repository>(`projects/${key}/repos`, {
          qs: {
            pageSize: PAGE_SIZE,
            start: (page - 1) * PAGE_SIZE
          }
        })
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
        return this.serverRequest<Project>(`projects`, {
          qs: {
            pageSize: PAGE_SIZE,
            start: (page - 1) * PAGE_SIZE
          }
        })
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
        return this.cloudRequest<Repository>(`repositories/${this.cloudOwner}`, {
          qs: {
            pagelen: PAGE_SIZE,
            page
          }
        })
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
        return this.cloudRequest<Project>(`teams/${this.cloudOwner}/projects/`, {
          qs: {
            pagelen: PAGE_SIZE,
            page
          }
        })
          .then(x => x.values);
      },
      startItem: (p: Project) => {
        return this.cloudRequest(`teams/${this.cloudOwner}/projects/${p.key}`, { method: 'DELETE' });
      }
    });
  }
}