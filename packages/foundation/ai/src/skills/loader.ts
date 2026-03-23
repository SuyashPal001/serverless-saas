import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import type { AgentSkillConfig } from '../runtime/types';
import type { SkillFile, LoadedSkill } from './types';
import { validateSkillFile, validateSkillConfig } from './validator';

export class SkillLoader {
  /**
   * Load skills from a YAML or JSON file
   */
  async loadFromFile(filePath: string): Promise<LoadedSkill[]> {
    const content = await readFile(filePath, 'utf-8');

    let parsed: unknown;
    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      parsed = parseYaml(content);
    } else if (filePath.endsWith('.json')) {
      parsed = JSON.parse(content);
    } else {
      throw new Error(`Unsupported file format: ${filePath}. Use .yaml, .yml, or .json`);
    }

    const validation = validateSkillFile(parsed);
    if (!validation.valid) {
      throw new Error(`Invalid skill file: ${validation.errors.join(', ')}`);
    }

    const skillFile = parsed as SkillFile;

    return skillFile.skills.map(skill => ({
      skill,
      source: 'file' as const,
      filePath,
      loadedAt: new Date(),
    }));
  }

  /**
   * Load a single skill from a config object (e.g., from database)
   */
  loadFromConfig(config: AgentSkillConfig, source: 'database' | 'file' = 'database'): LoadedSkill {
    const validation = validateSkillConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid skill config: ${validation.errors.join(', ')}`);
    }

    return {
      skill: config,
      source,
      loadedAt: new Date(),
    };
  }

  /**
   * Parse skill config from raw YAML string
   */
  parseYaml(content: string): AgentSkillConfig[] {
    const parsed = parseYaml(content);
    const validation = validateSkillFile(parsed);
    if (!validation.valid) {
      throw new Error(`Invalid skill YAML: ${validation.errors.join(', ')}`);
    }
    return (parsed as SkillFile).skills;
  }

  /**
   * Parse skill config from raw JSON string
   */
  parseJson(content: string): AgentSkillConfig[] {
    const parsed = JSON.parse(content);
    const validation = validateSkillFile(parsed);
    if (!validation.valid) {
      throw new Error(`Invalid skill JSON: ${validation.errors.join(', ')}`);
    }
    return (parsed as SkillFile).skills;
  }
}

// Singleton instance
export const skillLoader = new SkillLoader();
