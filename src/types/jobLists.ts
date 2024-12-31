export interface Job {
  index: number;
  value: string;
  label: string;
}

interface LangOption extends Job {
  id: number;
  lang: string;
  version: string;
}
