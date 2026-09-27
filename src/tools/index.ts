/**
 * The tool registry.
 *
 * To add an extension: create `src/tools/my.tool.ts` exporting a `Tool`, import
 * it here, and add it to the array. Order determines the toolbar order and the
 * tie-breaker for overlapping highlight layers (earlier = lower layer).
 */
import type { Tool } from '../core/types';
import { readabilityTool } from './readability.tool';
import { repeatedWordsTool } from './repeated-words.tool';
import { sentencesTool } from './sentences.tool';
import { verbsTool } from './verbs.tool';

export const tools: Tool[] = [sentencesTool, verbsTool, repeatedWordsTool, readabilityTool];

export function getTool(id: string): Tool | undefined {
  return tools.find((tool) => tool.id === id);
}

export { sentencesTool, verbsTool, repeatedWordsTool, readabilityTool };
