export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string;
  public: boolean;
}

export interface Repository {
  id: string;
  key: string;
  name: string;
  slug: string;
  public: boolean;
}
