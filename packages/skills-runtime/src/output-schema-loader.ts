import { readFile } from 'node:fs/promises';

export async function loadOutputSchema(outputSchemaPath: string): Promise<Record<string, unknown>> {
  let rawSchema: string;
  try {
    rawSchema = await readFile(outputSchemaPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read output schema at ${outputSchemaPath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSchema);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in output schema ${outputSchemaPath}: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Output schema ${outputSchemaPath} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}
