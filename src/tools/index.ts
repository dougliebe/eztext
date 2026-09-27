/**
 * The tool registry.
 *
 * To add an extension: create `src/tools/my.tool.ts` exporting a `Tool`, import
 * it here, and add it to the array. Order determines the toolbar order and the
 * tie-breaker for overlapping highlight layers (earlier = lower layer).
 */
import type { Tool } from '../core/types';
import { commonWordsTool } from './common-words.tool';
import { gsdsTool } from './gsds.tool';
import { readabilityTool } from './readability.tool';
import { surprisalTool } from './surprisal.tool';

export const tools: Tool[] = [readabilityTool, surprisalTool, commonWordsTool, gsdsTool];

export function getTool(id: string): Tool | undefined {
  return tools.find((tool) => tool.id === id);
}

export { commonWordsTool, gsdsTool, readabilityTool, surprisalTool };
