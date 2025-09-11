import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ToolResponse } from '../interfaces/tool-response.interface.js';
import {
  SimpleReplyValidator,
  MathValidator,
  SqlValidator,
  ParameterValidator,
  QueryStructureValidator
} from './validation.dto.js';

@Injectable()
export class ToolsService {
  constructor(private readonly dataSource: DataSource) {}

  // Enhanced simple reply with validation
  async simpleReply(message: string): Promise<ToolResponse> {
    try {
      // Validate input
      const validation = SimpleReplyValidator.validate(message);
      if (!validation.isValid) {
        return this.createErrorResponse('simple_reply', `Validation failed: ${validation.errors.join('; ')}`, { message });
      }

      const sanitizedMessage = validation.sanitizedValue;
      const lowerMessage = sanitizedMessage.toLowerCase();
      let responseText: string;

      // Handle common greetings
      if (
        lowerMessage === 'hi' ||
        lowerMessage === 'hello' ||
        lowerMessage === 'hey'
      ) {
        responseText = 'Hello! How can I help you today?';
      } else if (lowerMessage === 'goodbye' || lowerMessage === 'bye') {
        responseText = 'Goodbye! Have a great day!';
      } else if (lowerMessage === 'thank you' || lowerMessage === 'thanks') {
        responseText = "You're welcome!";
      } else if (
        lowerMessage === 'how are you' ||
        lowerMessage === 'how are you?'
      ) {
        responseText = "I'm doing well, thank you for asking!";
      } else {
        // Default response for other messages
        responseText = `I received your message: "${sanitizedMessage}". How can I assist you further?`;
      }

      return {
        success: true,
        data: {
          result: responseText,
          details: { originalMessage: message, sanitizedMessage, validated: true },
        },
        message: 'Simple reply generated successfully',
        toolName: 'simple_reply',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return this.createErrorResponse('simple_reply', 'Unexpected error in simple reply', { message, error: error.message });
    }
  }

  // Enhanced sum with validation
  async sum({ a, b }: { a: number; b: number }): Promise<ToolResponse> {
    try {
      // Validate input
      const validation = MathValidator.validate(a, b);
      if (!validation.isValid) {
        return this.createErrorResponse('sum', `Validation failed: ${validation.errors.join('; ')}`, { a, b });
      }

      const { a: validA, b: validB } = validation.sanitizedValue;
      const result = validA + validB;

      return {
        success: true,
        data: {
          result: result,
          details: { operands: { a: validA, b: validB }, operation: 'addition', validated: true },
        },
        message: `Successfully calculated sum of ${validA} and ${validB}`,
        toolName: 'sum',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return this.createErrorResponse('sum', 'Unexpected error in sum calculation', { a, b, error: error.message });
    }
  }

  // Enhanced sub with validation
  async sub({ a, b }: { a: number; b: number }): Promise<ToolResponse> {
    try {
      // Validate input
      const validation = MathValidator.validate(a, b);
      if (!validation.isValid) {
        return this.createErrorResponse('sub', `Validation failed: ${validation.errors.join('; ')}`, { a, b });
      }

      const { a: validA, b: validB } = validation.sanitizedValue;
      const result = validA - validB;

      return {
        success: true,
        data: {
          result: result,
          details: { operands: { a: validA, b: validB }, operation: 'subtraction', validated: true },
        },
        message: `Successfully calculated difference of ${validA} and ${validB}`,
        toolName: 'sub',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return this.createErrorResponse('sub', 'Unexpected error in subtraction', { a, b, error: error.message });
    }
  }

  // Enhanced executeRawQuery with comprehensive validation
  async executeRawQuery(sql: string, params: any = []): Promise<ToolResponse> {
    try {
      // Phase 1: SQL validation
      const sqlValidation = SqlValidator.validateSql(sql);
      if (!sqlValidation.isValid) {
        // If the error is about modification access, return only the message, not as an error
        const errMsg = sqlValidation.errors[0];
        if (errMsg.startsWith('Sorry, I do not have delete or modification access')) {
          // Return as a simple reply instead of a table result
          return {
            toolName: 'simple_reply',
            success: true,
            data: {
              result: errMsg || 'Sorry, I do not have delete or modification access. I can only fetch data. If you need any valid data, I can provide it.',
              details: {
                infoType: 'readOnlyNotice'
              }
            },
            message: errMsg || 'Sorry, I do not have delete or modification access. I can only fetch data. If you need any valid data, I can provide it.',
            timestamp: new Date().toISOString(),
          };
        }
        return this.createErrorResponse('executeRawQuery',
          `SQL validation failed: ${sqlValidation.errors.join('; ')}`,
          { sql, params }
        );
      }

      // Phase 2: Parameter validation and sanitization
      const paramValidation = ParameterValidator.validate(params);
      if (!paramValidation.isValid) {
        return this.createErrorResponse('executeRawQuery',
          `Parameter validation failed: ${paramValidation.errors.join('; ')}`,
          { sql, params }
        );
      }

      // Phase 3: Query structure validation
      const sanitizedSql = sqlValidation.sanitizedValue;
      const sanitizedParams = paramValidation.sanitizedValue;
      const structureValidation = QueryStructureValidator.validate(sanitizedSql, sanitizedParams);

      if (!structureValidation.isValid) {
        return this.createErrorResponse('executeRawQuery',
          `Query structure validation failed: ${structureValidation.errors.join('; ')}`,
          { sql, params }
        );
      }

      // Phase 4: Execute the validated and sanitized query
      let index = 0;
      const converted = sanitizedSql.replace(/\?/g, () => `$${++index}`);

      const result = await this.dataSource.query(converted, sanitizedParams);

      return {
        success: true,
        data: {
          result: result,
          details: {
            rowCount: Array.isArray(result) ? result.length : 1,
            query: sanitizedSql,
            parameters: sanitizedParams,
            validationPassed: true,
            securityChecked: true,
          },
        },
        message: `Query executed successfully. Returned ${Array.isArray(result) ? result.length : 1} row(s)`,
        toolName: 'executeRawQuery',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('❌ Error executing raw query:', error);
      return this.createErrorResponse('executeRawQuery', 'Database execution failed', { sql, params, error: error.message });
    }
  }

  // Helper method for creating consistent error responses
  private createErrorResponse(toolName: string, message: string, details: any): ToolResponse {
    return {
      success: false,
      data: {
        result: null,
        details,
      },
      message,
      toolName,
      timestamp: new Date().toISOString(),
      error: message,
    };
  }
}
