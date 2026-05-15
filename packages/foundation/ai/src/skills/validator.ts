export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Validate a single skill config
export function validateSkillConfig(skill: unknown): ValidationResult {
  const errors: string[] = [];

  if (!skill || typeof skill !== 'object') {
    return { valid: false, errors: ['Skill must be an object'] };
  }

  const s = skill as Record<string, unknown>;

  if (!s.name || typeof s.name !== 'string') {
    errors.push('Skill name is required and must be a string');
  }

  if (!s.systemPrompt || typeof s.systemPrompt !== 'string') {
    errors.push('systemPrompt is required and must be a string');
  }

  if (!Array.isArray(s.tools)) {
    errors.push('tools must be an array');
  } else if (!s.tools.every((t: unknown) => typeof t === 'string')) {
    errors.push('tools must be an array of strings');
  }

  if (s.config !== undefined && (typeof s.config !== 'object' || s.config === null)) {
    errors.push('config must be an object if provided');
  }

  return { valid: errors.length === 0, errors };
}

// Validate entire skill file
export function validateSkillFile(file: unknown): ValidationResult {
  const errors: string[] = [];

  if (!file || typeof file !== 'object') {
    return { valid: false, errors: ['Skill file must be an object'] };
  }

  const f = file as Record<string, unknown>;

  if (!f.version || typeof f.version !== 'string') {
    errors.push('version is required');
  }

  if (!Array.isArray(f.skills)) {
    errors.push('skills must be an array');
  } else {
    f.skills.forEach((skill, index) => {
      const result = validateSkillConfig(skill);
      if (!result.valid) {
        errors.push(...result.errors.map(e => `skills[${index}]: ${e}`));
      }
    });
  }

  return { valid: errors.length === 0, errors };
}
