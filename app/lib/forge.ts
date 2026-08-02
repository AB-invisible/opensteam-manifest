import vm from 'node:vm';
import { prisma } from './prisma';
import { readForgeData, writeForgeData } from './storage';

/**
 * Forge Utility
 * Handles the sandboxed execution of user-contributed scripts for manifest metadata modification.
 */

export interface ForgeContext {
  manifest: any;
  user: {
    id: string;
    role: string;
    plan: string;
  };
  args: Record<string, any>;
}

export interface ForgeResult {
  modifiedManifest: any;
  logs: string[];
  executionTimeMs: number;
  error?: string;
}

/**
 * Executes a script in a secure sandbox.
 * @param scriptContent The JavaScript code to execute.
 * @param context The data available to the script.
 */
export async function executeForgeScript(
  scriptContent: string,
  context: ForgeContext
): Promise<ForgeResult> {
  const logs: string[] = [];
  const startTime = Date.now();

  try {
    // Deep copy to prevent outside mutation during execution
    const sandboxManifest = JSON.parse(JSON.stringify(context.manifest));
    
    const sandbox = {
      manifest: sandboxManifest,
      user: context.user,
      args: context.args,
      console: {
        log: (...args: any[]) => logs.push(args.map(a => String(a)).join(' ')),
        error: (...args: any[]) => logs.push(`[ERROR] ${args.map(a => String(a)).join(' ')}`),
      },
      storage: {
        read: (key: string) => readForgeData(context.user.id, key),
        write: (key: string, data: any) => writeForgeData(context.user.id, key, data),
      },
      utils: {
        formatSize: (bytes: number) => {
          if (bytes === 0) return '0 B';
          const k = 1024;
          const sizes = ['B', 'KB', 'MB', 'GB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }
      }
    };

    vm.createContext(sandbox);
    
    // Execute the script with a timeout
    const script = new vm.Script(scriptContent);
    script.runInContext(sandbox, { timeout: 1000 });

    return {
      modifiedManifest: sandbox.manifest,
      logs,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      modifiedManifest: context.manifest,
      logs,
      executionTimeMs: Date.now() - startTime,
      error: err.message || 'Unknown execution error',
    };
  }
}

/**
 * Applies a manifest profile's configuration to a manifest.
 * @param manifest The original manifest object.
 * @param profileConfig The configuration string from the profile.
 */
export function applyManifestProfile(manifest: any, profileConfig: string): any {
  try {
    const config = JSON.parse(profileConfig);
    const updated = { ...manifest };

    // Apply basic metadata overrides if provided in profile
    if (config.tags) {
      const existingTags = updated.tags || [];
      const newTags = config.tags || [];
      updated.tags = Array.from(new Set([...existingTags, ...newTags]));
    }
    if (config.description) updated.description = config.description;
    
    // Profiles can also contain simplified transformation rules
    if (config.rules) {
      // e.g., auto-tagging based on name
      config.rules.forEach((rule: any) => {
        if (rule.type === 'TAG_ON_MATCH' && updated.name.toLowerCase().includes(rule.match.toLowerCase())) {
          updated.tags = Array.from(new Set([...(updated.tags || []), rule.tag]));
        }
      });
    }

    return updated;
  } catch (e) {
    console.error('Failed to apply manifest profile:', e);
    return manifest;
  }
}
