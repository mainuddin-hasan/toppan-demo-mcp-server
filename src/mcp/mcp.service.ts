import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { queryExecutorJSON, simpleReplyJSON, subJSON, sumJSON } from '../tools/tools.schema.js';
import { ToolsService } from '../tools/tools.service.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TableContext } from './table-contexts/index.js';


@Injectable()
export class McpService {
  private readonly server: Server;

  constructor(
    private readonly httpService: HttpService,
    private readonly toolsService: ToolsService,
  ) {
    this.server = new Server(
      {
        name: 'nest-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );
    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'simple_reply',
          description:
            'Provides simple text replies for basic interactions like greetings',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'The message to respond to',
              },
            },
            required: ['message'],
          },
        },
        {
          name: 'sum',
          description: 'Add two numbers',
          inputSchema: {
            type: 'object',
            properties: {
              a: { type: 'number', description: 'First number' },
              b: { type: 'number', description: 'Second number' },
            },
            required: ['a', 'b'],
          },
        },
        {
          name: 'sub',
          description: 'Subtract two numbers',
          inputSchema: {
            type: 'object',
            properties: {
              a: { type: 'number', description: 'First number' },
              b: { type: 'number', description: 'Second number' },
            },
            required: ['a', 'b'],
          },
        },
        {
          name: 'execute_raw_query',
          description: 'Execute a raw SQL query against the database',
          inputSchema: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: 'SQL query to execute' },
              params: {
                type: 'array',
                description: 'Query parameters',
                items: { type: 'any' },
              },
            },
            required: ['sql'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (!args) {
          throw new Error('No arguments provided');
        }

        let toolResponse;

        switch (name) {
          case 'simple_reply':
            toolResponse = this.toolsService.simpleReply(args.message as string);
            break;

          case 'sum':
            toolResponse = this.toolsService.sum({
              a: args.a as number,
              b: args.b as number,
            });
            break;

          case 'sub':
            toolResponse = this.toolsService.sub({
              a: args.a as number,
              b: args.b as number,
            });
            break;

          case 'execute_raw_query':
            toolResponse = await this.toolsService.executeRawQuery(
              args.sql as string,
              args.params as any[],
            );
            break;

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        // Return standardized response format
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(toolResponse, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                data: null,
                message: 'Tool execution failed',
                toolName: name,
                timestamp: new Date().toISOString(),
                error: error.message,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('🚀 MCP Server started');
  }

  getServer() {
    return this.server;
  }

  async queryLLM(prompt: string, retryCount = 0): Promise<any> {
    const tools = this.getTools();

    try {
      const response = await this.sendPromptToLLM(prompt, tools);
      const data = response.data;
      console.log('LLM Response: ' + JSON.stringify(data.message));

      if (data.message?.tool_calls?.length) {
        // Get the first tool call (assuming single tool execution)
        const toolCall = data.message.tool_calls[0];

        try {
          let toolResponse;

          if (toolCall.function.name === 'simple_reply') {
            const { message } = toolCall.function.arguments;
            toolResponse = this.toolsService.simpleReply(message);
          } else if (toolCall.function.name === 'sum') {
            const { a, b } = toolCall.function.arguments;
            toolResponse = this.toolsService.sum({ a, b });
          } else if (toolCall.function.name === 'sub') {
            const { a, b } = toolCall.function.arguments;
            toolResponse = this.toolsService.sub({ a, b });
          } else if (toolCall.function.name === 'executeRawQuery') {
            const { sql, params } = toolCall.function.arguments;
            toolResponse = await this.toolsService.executeRawQuery(sql, params);
          }

          // Return the direct tool response without wrapper
          return toolResponse;

        } catch (toolError) {
          console.warn(
            `❗ Tool execution failed for ${toolCall.function.name}:`,
            toolError.message || toolError,
          );

          if (retryCount < 10) {
            const retryPrompt = `An error occurred while executing the tool "${toolCall.function.name}": ${toolError.message || toolError}. Please try again or suggest an alternative.`;
            return this.queryLLM(`${retryPrompt}. Original Prompt: ${prompt}`);
          } else {
            return {
              success: false,
              data: {
                result: null,
                details: { originalPrompt: prompt },
              },
              message: `Failed after retrying tool "${toolCall.function.name}"`,
              toolName: toolCall.function.name,
              timestamp: new Date().toISOString(),
              error: toolError.message || toolError.toString(),
            };
          }
        }
      }

      return {
        success: true,
        data: {
          result: data.message?.content || 'No response from LLM',
          details: { prompt },
        },
        message: 'Direct LLM response',
        toolName: 'llm_response',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error querying LLM:', error);
      return {
        success: false,
        data: {
          result: null,
          details: { prompt },
        },
        message: 'Failed to query LLM',
        toolName: 'llm_query',
        timestamp: new Date().toISOString(),
        error: error.message || error.toString(),
      };
    }
  }

  // Utility: Extract relevant table names from prompt
  private extractTableNamesFromPrompt(prompt: string): string[] {
    // List of all table names (keys from contextMap)
    const allTableNames = [
      'emails', 'jobs', 'email_files', 'email_replies', 'users', 'rule_details', 'rule_templates', 'plans', 'tasks', 'job_rules', 'cost_summary_rules', 'billable_items', 'job_activity', 'job_activity_logs', 'conditions', 'cost_summary_rule_tasks', 'cost_summary_rules_task_list_tasks', 'order_cost_summary_rules', 'package_cost_summary_rules', 'packages', 'pricing', 'additional_cost_summary_rules', 'external_cost_summaries', 'ai_models', 'ai_model_versions', 'ai_model_version_change_history', 'client_view', 'roles', 'user_requests', 'user_roles', 'tcc_attachments', 'tcc_job_sales_persons', 'tcc_languages', 'tcc_master_data', 'tcc_projects', 'tcc_sync_details', 'tcc_task_attachments', 'tcc_translation_tasks', 'tcc_type_settings_tasks', 'tcc_users', 'task_types', 'sub_task_types',
    ];
    // Simple keyword-based detection (case-insensitive)
    const lowerPrompt = prompt.toLowerCase();
    return allTableNames.filter(table => lowerPrompt.includes(table.replace(/_/g, '')) || lowerPrompt.includes(table.replace(/_/g, ' ')) || lowerPrompt.includes(table));
  }

  private async sendPromptToLLM(
    prompt: string,
    tools: any[],
  ) {
    // Dynamic context selection: only send relevant table schemas
    const relevantTableNames = this.extractTableNamesFromPrompt(prompt);
    // Fallback: if none detected, send all
    const tableNamesToSend = relevantTableNames.length ? relevantTableNames : [
      'emails', 'jobs', 'email_files', 'email_replies', 'users', 'rule_details', 'rule_templates', 'plans', 'tasks', 'job_rules', 'cost_summary_rules', 'billable_items', 'job_activity', 'job_activity_logs', 'conditions', 'cost_summary_rule_tasks', 'cost_summary_rules_task_list_tasks', 'order_cost_summary_rules', 'package_cost_summary_rules', 'packages', 'pricing', 'additional_cost_summary_rules', 'external_cost_summaries', 'ai_models', 'ai_model_versions', 'ai_model_version_change_history', 'client_view', 'roles', 'user_requests', 'user_roles', 'tcc_attachments', 'tcc_job_sales_persons', 'tcc_languages', 'tcc_master_data', 'tcc_projects', 'tcc_sync_details', 'tcc_task_attachments', 'tcc_translation_tasks', 'tcc_type_settings_tasks', 'tcc_users', 'task_types', 'sub_task_types',
    ];
    return await firstValueFrom(
      this.httpService.post('http://192.168.68.150:11434/api/chat', {
        model: 'llama3.1',
        messages: [
          {
            role: 'system',
            content: this.getTableContexts(tableNamesToSend),
          },
          { role: 'user', content: prompt },
        ],
        tools,
        stream: false,
      }),
    );
  }


  private getTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'simple_reply',
          description: 'Provides simple text replies for basic interactions like greetings, farewells, and casual conversation',
          parameters: simpleReplyJSON,
        },
      },
      {
        type: 'function',
        function: {
          name: 'sum',
          description: 'Calculates the sum of two numbers',
          parameters: sumJSON,
        },
      },
      {
        type: 'function',
        function: {
          name: 'sub',
          description: 'Calculates the sub of two numbers',
          parameters: subJSON,
        },
      },
      {
        type: 'function',
        function: {
          name: 'executeRawQuery',
          description: 'Executes a raw SQL query with parameters',
          parameters: queryExecutorJSON,
        },
      },
    ];
  }

  async sendTextToLLM(prompt: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.post('http://192.168.68.150:11434/api/chat', {
          model: 'llama3',
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
      );

      return response.data?.message?.content;
    } catch (error) {
      console.error('LLM Error:', error.message, error.response?.data); // Debug log
      throw new BadRequestException(
        `Failed to communicate with LLM: ${error.message}`,
      );
    }
  }

  // Utility to get context for required tables
  private getTableContexts(tableNames: string[]): string {
    const contextMap: Record<string, string> = {
      emails: TableContext.emailsContext,
      jobs: TableContext.jobsContext,
      email_files: TableContext.emailFilesContext,
      email_replies: TableContext.emailRepliesContext,
      users: TableContext.usersContext,
      rule_details: TableContext.ruleDetailsContext,
      rule_templates: TableContext.ruleTemplatesContext,
      plans: TableContext.plansContext,
      tasks: TableContext.tasksContext,
      job_rules: TableContext.jobRulesContext,
      jobContext: TableContext.jobsContext,
      cost_summary_rules: TableContext.costSummaryRulesContext,
      billable_items: TableContext.billableItemsContext,
      job_activity: TableContext.jobActivityContext,
      job_activity_logs: TableContext.jobActivityLogsContext,
      conditions: TableContext.conditionsContext,
      cost_summary_rule_tasks: TableContext.costSummaryRuleTasksContext,
      cost_summary_rules_task_list_tasks: TableContext.costSummaryRulesTaskListTasksContext,
      order_cost_summary_rules: TableContext.orderCostSummaryRulesContext,
      package_cost_summary_rules: TableContext.packageCostSummaryRulesContext,
      packages: TableContext.packagesContext,
      pricing: TableContext.pricingContext,
      additional_cost_summary_rules: TableContext.additionalCostSummaryRulesContext,
      external_cost_summaries: TableContext.externalCostSummariesContext,
      ai_models: TableContext.aiModelsContext,
      ai_model_versions: TableContext.aiModelVersionsContext,
      ai_model_version_change_history: TableContext.aiModelVersionChangeHistoryContext,
      client_view: TableContext.clientViewContext,
      roles: TableContext.rolesContext,
      user_requests: TableContext.userRequestsContext,
      user_roles: TableContext.userRolesContext,
      tcc_attachments: TableContext.tccAttachmentsContext,
      tcc_job_sales_persons: TableContext.tccJobSalesPersonsContext,
      tcc_languages: TableContext.tccLanguagesContext,
      tcc_master_data: TableContext.tccMasterDataContext,
      tcc_projects: TableContext.tccProjectsContext,
      tcc_sync_details: TableContext.tccSyncDetailsContext,
      tcc_task_attachments: TableContext.tccTaskAttachmentsContext,
      tcc_translation_tasks: TableContext.tccTranslationTasksContext,
      tcc_type_settings_tasks: TableContext.tccTypeSettingsTasksContext,
      tcc_users: TableContext.tccUsersContext,
      task_types: TableContext.taskTypesContext,
      sub_task_types: TableContext.subTaskTypesContext,
    };
    return tableNames.map(t => contextMap[t]).filter(Boolean).join('\n');
  }
}
