import type { AgentSkillConfig } from '../runtime/types';

// Skill file can have multiple skills defined
export interface SkillFile {
  version: string;  // e.g., "1.0"
  skills: AgentSkillConfig[];
}

// Skill file metadata
export interface LoadedSkill {
  skill: AgentSkillConfig;
  source: 'file' | 'database';
  filePath?: string;
  loadedAt: Date;
}
