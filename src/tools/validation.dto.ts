// Built-in validation system - no external dependencies required
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedValue?: any;
}

// Base validation utilities
class ValidationUtils {
  static isString(value: any): boolean {
    return typeof value === 'string';
  }

  static isNumber(value: any): boolean {
    return typeof value === 'number' && !isNaN(value) && isFinite(value);
  }

  static isValidLength(str: string, min: number, max: number): boolean {
    return str.length >= min && str.length <= max;
  }

  static sanitizeString(str: string): string {
    return str.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  static isValidNumber(num: number, min: number, max: number): boolean {
    return num >= min && num <= max;
  }
}

// Simple reply validation
export class SimpleReplyValidator {
  static validate(message: any): ValidationResult {
    const errors: string[] = [];

    if (!ValidationUtils.isString(message)) {
      errors.push('Message must be a string');
      return { isValid: false, errors };
    }

    if (!ValidationUtils.isValidLength(message, 1, 1000)) {
      errors.push('Message must be between 1 and 1000 characters');
    }

    const sanitized = ValidationUtils.sanitizeString(message);
    if (sanitized.length === 0) {
      errors.push('Message cannot be empty after sanitization');
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitizedValue: sanitized
    };
  }
}

// Math operation validation
export class MathValidator {
  static validate(a: any, b: any): ValidationResult {
    const errors: string[] = [];

    if (!ValidationUtils.isNumber(a)) {
      errors.push('First operand must be a valid number');
    } else if (!ValidationUtils.isValidNumber(a, -1000000, 1000000)) {
      errors.push('First operand is out of allowed range (-1000000 to 1000000)');
    }

    if (!ValidationUtils.isNumber(b)) {
      errors.push('Second operand must be a valid number');
    } else if (!ValidationUtils.isValidNumber(b, -1000000, 1000000)) {
      errors.push('Second operand is out of allowed range (-1000000 to 1000000)');
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitizedValue: { a: Number(a), b: Number(b) }
    };
  }
}

// SQL query validation
export class SqlValidator {
  private static readonly DANGEROUS_PATTERNS = [
    /;\s*(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\s+/i,
    /UNION\s+ALL\s+SELECT/i,
    /\/\*[\s\S]*?\*\//g, // Block comments
    /--[^\r\n]*/g, // Line comments
    /xp_cmdshell/i,
    /sp_executesql/i,
    /EXEC\s*\(/i,
    /EXECUTE\s*\(/i,
  ];

  private static readonly ALLOWED_TABLES = [
    'emails', 'jobs', 'email_files', 'email_replies', 'users', 'rule_details', 
    'rule_templates', 'plans', 'tasks', 'job_rules', 'cost_summary_rules', 
    'billable_items', 'job_activity', 'job_activity_logs', 'conditions',
    'cost_summary_rule_tasks', 'cost_summary_rules_task_list_tasks',
    'order_cost_summary_rules', 'package_cost_summary_rules', 'packages',
    'pricing', 'additional_cost_summary_rules', 'external_cost_summaries',
    'ai_models', 'ai_model_versions', 'ai_model_version_change_history',
    'client_view', 'roles', 'user_requests', 'user_roles', 'tcc_attachments',
    'tcc_job_sales_persons', 'tcc_languages', 'tcc_master_data', 'tcc_projects',
    'tcc_sync_details', 'tcc_task_attachments', 'tcc_translation_tasks',
    'tcc_type_settings_tasks', 'tcc_users', 'task_types', 'sub_task_types'
  ];

  static validateSql(sql: any): ValidationResult {
    const errors: string[] = [];

    if (!ValidationUtils.isString(sql)) {
      errors.push('SQL must be a string');
      return { isValid: false, errors };
    }

    if (!ValidationUtils.isValidLength(sql, 1, 10000)) {
      errors.push('SQL query must be between 1 and 10000 characters');
    }

    const trimmedSql = sql.trim();

    // Check for allowed statement types
    if (!trimmedSql.match(/^(SELECT|WITH|EXPLAIN)\s+/i)) {
      // Only push this error and return immediately for modification attempts
      return {
        isValid: false,
        errors: ['Sorry, I do not have delete or modification access. I can only fetch data. If you need any valid data, I can provide it.'],
        sanitizedValue: trimmedSql
      };
    }

    // Check for dangerous patterns
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(trimmedSql)) {
        errors.push(`Potentially dangerous SQL pattern detected: ${pattern.source}`);
      }
    }

    // Check table access
    const tableMatches = trimmedSql.match(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi);
    if (tableMatches) {
      for (const match of tableMatches) {
        const tableName = match.split(/\s+/)[1].toLowerCase();
        if (!this.ALLOWED_TABLES.includes(tableName)) {
          errors.push(`Access to table '${tableName}' is not allowed`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitizedValue: trimmedSql
    };
  }
}

// Parameter validation
export class ParameterValidator {
  static validate(params: any): ValidationResult {
    const errors: string[] = [];
    const sanitized: any[] = [];

    // Handle string JSON parsing
    if (typeof params === 'string') {
      try {
        params = JSON.parse(params);
      } catch {
        params = [];
      }
    }

    if (!Array.isArray(params)) {
      return { isValid: false, errors: ['Parameters must be an array'], sanitizedValue: [] };
    }

    // If params is [""] (single empty string), treat as empty array
    if (params.length === 1 && params[0] === "") {
      return {
        isValid: true,
        errors: [],
        sanitizedValue: []
      };
    }

    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      
      if (param === null || param === undefined) {
        errors.push(`Parameter ${i + 1} cannot be null or undefined`);
        continue;
      }

      if (typeof param === 'string') {
        let trimmed = param.trim();

        // Remove brackets if wrapped
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          trimmed = trimmed.slice(1, -1).trim();
        }

        // Handle special placeholder patterns that should be rejected
        const invalidPlaceholders = [
          '%s', '%d', '%c', '%f', // C-style format specifiers
          '?', // Generic placeholder
          'undefined', 'null', 'NaN', // Invalid literals
          '$1', '$2', '$3', '$4', '$5' // SQL placeholders (shouldn't be in params)
        ];

        if (invalidPlaceholders.includes(trimmed)) {
          errors.push(`Parameter ${i + 1} contains invalid placeholder '${trimmed}' - provide actual value instead`);
          continue;
        }

        // Check for SQL injection patterns
        const injectionPatterns = [
          /['";][\s]*((OR|AND)[\s]+[\d]+[\s]*=[\s]*[\d]+|DROP|DELETE|INSERT|UPDATE)/i,
          /UNION[\s]+(ALL[\s]+)?SELECT/i,
          /\bEXEC\b|\bEXECUTE\b/i
        ];

        for (const pattern of injectionPatterns) {
          if (pattern.test(trimmed)) {
            errors.push(`Parameter ${i + 1} contains potentially malicious content`);
            break;
          }
        }

        if (trimmed.length > 1000) {
          errors.push(`Parameter ${i + 1} is too long (max 1000 characters)`);
        }

        if (trimmed.length > 0) {
          sanitized.push(trimmed);
        } else {
          errors.push(`Parameter ${i + 1} is empty after sanitization`);
        }
      } else if (typeof param === 'number') {
        if (!ValidationUtils.isValidNumber(param, -1000000, 1000000)) {
          errors.push(`Parameter ${i + 1} is out of allowed range`);
        } else {
          sanitized.push(param);
        }
      } else if (typeof param === 'boolean') {
        sanitized.push(param);
      } else {
        const stringified = String(param);
        if (stringified.length <= 1000) {
          sanitized.push(stringified);
        } else {
          errors.push(`Parameter ${i + 1} is too long when converted to string`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitizedValue: sanitized
    };
  }
}

// Query structure validation
export class QueryStructureValidator {
  static validate(sql: string, params: any[]): ValidationResult {
    const errors: string[] = [];

    // Check parameter placeholder count vs actual parameters
    const placeholderMatches = sql.match(/\$\d+|\?/g);
    const expectedParamCount = placeholderMatches ? placeholderMatches.length : 0;

    if (expectedParamCount === 0 && params.length > 0) {
      // Query has no placeholders but parameters were provided
      // This is acceptable - we'll just ignore the extra parameters
      return {
        isValid: true,
        errors: [],
        sanitizedValue: { sql, params: [] } // Return empty params array
      };
    }

    if (expectedParamCount > 0 && params.length !== expectedParamCount) {
      errors.push(`Parameter count mismatch: expected ${expectedParamCount}, got ${params.length}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitizedValue: { sql, params }
    };
  }
}
