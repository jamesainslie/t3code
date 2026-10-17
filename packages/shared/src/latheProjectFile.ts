import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { LatheProjectFile, LATHE_PROJECT_FILE_SCHEMA_URL } from "@lathe/contracts";

import { fromLenientJson } from "./schemaJson.ts";

export const LatheProjectFileFromJson = fromLenientJson(LatheProjectFile);

const decodeLatheProjectFile = Schema.decodeExit(LatheProjectFileFromJson);

export function parseLatheProjectFile(contents: string): LatheProjectFile | null {
  const decoded = decodeLatheProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

export function buildLatheProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(LatheProjectFile, { onExcessProperty: "error" });
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: LATHE_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
