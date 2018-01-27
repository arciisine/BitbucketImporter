export interface Named {
  name: string;
}

export interface Project extends Named {
  id: string;
  key: string;
  description?: string;
  public: boolean;
}

export interface Repository extends Named {
  id: string;
  key: string;
  slug: string;
  public: boolean;
}

export interface PermissionGroup {
  group: Group,
  permission: string
}

export interface PermissionUser {
  user: User,
  permission: string
}

export interface Group extends Named { }

export interface User extends Named { }
