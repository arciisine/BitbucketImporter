import * as os from 'os';
import * as requestPromise from 'request-promise';

import { Project, Repository, Group, User, Named, PermissionGroup, PermissionUser } from './types';
import { Queue, Provider } from './queue';
import { exec, log, rmdir, request, requestor, Requestor, CacheFile } from './util';

import * as fs from 'fs';
import { QueueSource } from './queue-source';

const TEMP = `${os.tmpdir()}/import`;

try {
  fs.mkdirSync(TEMP);
} catch (e) {
  //Do nothing
}

function isPrivate(v: any) {
  return `${v}`.toLowerCase() !== 'true'
}

type PageHandler = (page: number, size: number) => { [key: string]: number };
type QueueSourceBuilder<T> = (path: string, cache?: boolean) => QueueSource<T>

export class BitbucketImporter {

  private sourceCache: { [pkey: string]: QueueSource<any> } = {};
  private cloudRequest: Requestor<any>;
  private serverRequest: Requestor<any>;
  private serverSource: QueueSourceBuilder<any>;
  private cloudSource: QueueSourceBuilder<any>;
  private cloudRun: <T, U=any>(p: Provider<T, U>) => Promise<void>;
  private serverRun: <T, U=any>(p: Provider<T, U>) => Promise<void>;

  constructor(
    public serverHost: string,
    public serverCredentials: string,
    public cloudOwner: string,
    public cloudCredentials: string,
    public cloudHost: string = 'bitbucket.org'
  ) {
    this.cloudRequest = requestor(`https://api.${cloudHost}/2.0`, cloudCredentials);
    this.serverRequest = requestor(`https://${serverHost}/rest/api/1.0`, serverCredentials, {
      headers: { 'X-Atlassian-Token': 'no-check' }
    });

    this.serverSource = (p, c) => this.getSource(this.serverRequest, p, 100,
      (page, size) => ({ pageSize: size, start: (page - 1) * size }), c);

    this.cloudSource = (p, c) => this.getSource(this.cloudRequest, p, 100,
      (page, size) => ({ pagelen: size, page }), c);

    this.cloudRun = p => Queue.run(p, 3, 2000);
    this.serverRun = p => Queue.run(p, 20);
  }

  getSource<T>(req: Requestor<{ values: T[] }>, path: string, pageSize: number, ph: PageHandler, cache: boolean = true): QueueSource<T> {
    let key = `${req.name}||${path}`;
    let el = this.sourceCache[key];
    if (!cache || !el) {
      let namespace = path.split('/').filter(x => !!x).join(' ');
      el = new QueueSource(
        (chunk: number, size: number) => req(path, { qs: ph(chunk, size) }).then(x => x.values),
        namespace,
        pageSize
      );
      if (cache) {
        this.sourceCache[key] = el;
      }
    }
    return el as QueueSource<T>;
  }

  genCloudSlug(key: string, r: Repository) {
    return `${key}_${r.slug}`.toLowerCase().replace(/-/g, '_');
  }

  async upload(pkey: string, r: Repository) {
    const slug = this.genCloudSlug(pkey, r);

    let path = `${TEMP}/${slug}`;
    try {
      log(`[Cloning] Project ${pkey}: Repository ${r.key}`);
      await exec(`git clone --mirror https://${this.serverCredentials}@${this.serverHost}/scm/${pkey}/${r.key}.git ${path}`);
      log(`[Pushing] Project ${pkey}: Repository ${r.key}`);
      await exec(`git push --mirror https://${this.cloudCredentials}@${this.cloudHost}/${this.cloudOwner}/${slug}.git`, { cwd: path })
    } finally {
      await rmdir(path);
    }
  }

  archiveSubPermissions<T>(path: string, title: string, getName: (e: T) => string) {
    return this.serverRun<T>({
      namespace: (n?) => n ? `[Archiving] ${title} ${getName(n)}` : `[Archiving] ${title}s`,
      source: this.serverSource(path),
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
    return this.serverRun<Repository>({
      namespace: (r?) => r ? `[Archiving] Project ${key} Repository ${r.slug}` : `[Archiving] Project ${key} Repositories`,
      source: this.serverSource(`/projects/${key}/repos`),
      processItem: async r => {
        await this.archiveSubPermissions<PermissionGroup>(
          `/projects/${key}/permissions/groups`,
          `Project ${key} Repository ${r.slug} Group`,
          p => p.group.name
        );
        await this.archiveSubPermissions<PermissionUser>(
          `/projects/${key}/permissions/users`,
          `Project ${key} Repository ${r.slug} User`,
          p => p.user.name
        );
      }
    });
  }

  archiveServerProjects() {
    return this.serverRun<Project>({
      namespace: (p?) => p ? `[Archiving] Project ${p.key}` : `[Archiving] Projects`,
      source: this.serverSource('/projects'),
      processItem: async p => {
        await this.archiveRepositories(p.key);

        await this.archiveSubPermissions<PermissionGroup>(
          `/projects/${p.key}/permissions/groups`,
          `Project ${p.key} Group`,
          p => p.group.name
        );

        await this.archiveSubPermissions<PermissionUser>(
          `/projects/${p.key}/permissions/users`,
          `Project ${p.key} User`,
          p => p.user.name
        );

        await this.serverRequest(`/projects/${p.key}`, { method: 'PUT', json: { ...p, public: false } });
        await this.serverRequest(`/projects/${p.key}/permissions/PROJECT_ADMIN/all`, { method: 'POST', qs: { allow: false } });
        await this.serverRequest(`/projects/${p.key}/permissions/PROJECT_WRITE/all`, { method: 'POST', qs: { allow: false } });
        await this.serverRequest(`/projects/${p.key}/permissions/PROJECT_READ/all`, { method: 'POST', qs: { allow: true } });
      }
    });
  }

  importRepositories(key: string) {
    return this.serverRun<Repository>({
      namespace: (r?) => r ? `[Importing] Project ${key}: Repository ${r.slug}` : `[Importing] Project ${key} Repositories`,
      source: this.serverSource(`/projects/${key}/repos`),
      processItem: async r => {
        const slug = this.genCloudSlug(key, r);

        let qualName = `${key}-${r.name}`

        await this.cloudRequest(`/repositories/${this.cloudOwner}/${slug}`, {
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
    return this.serverRun<Project>({
      namespace: (p?) => p ? `[Importing] Project ${p.key}` : `[Importing] Projects`,
      source: this.serverSource(`/projects`),
      processItem: async p => {
        await this.cloudRequest(`/teams/${this.cloudOwner}/projects/`, {
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
    return this.cloudRun<Repository>({
      namespace: (r?) => r ? `[Removing] Repository ${r.slug}` : `[Removing] Repositories`,
      source: this.cloudSource(`/repositories/${this.cloudOwner}`),
      processItem: r => {
        return this.cloudRequest(`/repositories/${this.cloudOwner}/${r.slug}`, { method: 'DELETE' });
      }
    })
  }

  deleteCloudProjects() {
    return this.cloudRun<Project>({
      namespace: (p?) => p ? `[Removing] Project ${p.key}` : `[Removing] Projects`,
      source: this.cloudSource(`/teams/${this.cloudOwner}/projects/`),
      processItem: p => {
        return this.cloudRequest(`/teams/${this.cloudOwner}/projects/${p.key}`, { method: 'DELETE' });
      }
    });
  }

  @CacheFile(`${TEMP}/mapping.json`)
  async generateRepoMapping() {
    const out: { http: [string, string][], ssh: [string, string][] } = { http: [], ssh: [] };
    await this.serverRun<Project>({
      namespace: (p?) => p ? `[Mapping] Project ${p.key}` : `[Mapping] Projects`,
      source: this.serverSource(`/projects`),
      processItem: async p => {
        let key = p.key;

        //Read repos
        await this.serverRun<Repository>({
          namespace: (r?) => r ? `[Mapping] Project ${key}: Repository ${r.slug}` : `[Mapping] Project ${key} Repositories`,
          source: this.serverSource(`/projects/${key}/repos`),
          processItem: async r => {
            const slug = this.genCloudSlug(key, r);
            out.http.push(
              [`${this.serverHost}/scm/${key}/${r.slug}.git`,
              `${this.cloudHost}/${this.cloudOwner}/${slug}.git`])  //http
            out.ssh.push(
              [`${this.serverHost}/${key}/${r.slug}.git`,
              `${this.cloudHost}:${this.cloudOwner}/${this.cloudOwner}/${slug}.git`], //ssh,
            )
          }
        });
      }
    });

    return out;
  }

  async generateUserMigrationScript() {
    let mapping = await this.generateRepoMapping();

    let httpConfigs = mapping.http.map(x => [
      `https://(\'$SERVER_USERNAME\'@)?${x[0]}`,
      `https://\'$CLOUD_USERNAME\'@${x[1]}`
    ]);

    let sshConfigs = mapping.ssh.map(x => [
      `(ssh://)?git@${x[0]}`,
      `ssh://git@${x[1]}`
    ]);

    let configs = (httpConfigs.concat(sshConfigs)).sort((a, b) => (b[0].length - a[0].length));

    const sedExpressions = configs.map(r => `      -e 's|${r[0]}|${r[1]}|' \\`).join('\n');

    const params: { [key: string]: any } = {
      SED_EXPRESSIONS: sedExpressions,
      SERVER_HOST: this.serverHost,
      CLOUD_HOST: this.cloudHost,
      TEMP_DIR: TEMP
    };

    const tpl = fs.readFileSync(__dirname + '/user-import.tpl.sh').toString();
    return tpl.replace(/%%([^%]+)%%/g, (a, k) => params[k]);
  }
}