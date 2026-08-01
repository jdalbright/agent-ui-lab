import { A2UI_VERSION, CATALOG_ID } from "./constants.js";
import { A2uiMessageSchema, type A2uiMessage, type SurfaceNode } from "./schemas.js";
import { validateSurfaceSpec } from "./surface-validation.js";

export type CompileSurfaceOptions = Readonly<{
  surfaceId: string;
  spec: unknown;
  sources: unknown;
}>;

export type CompiledSurfaceMessages = readonly [A2uiMessage, A2uiMessage, A2uiMessage];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) deepFreeze(nestedValue);
    Object.freeze(value);
  }
  return value;
}

function normalizedIds(rootId: string, components: readonly SurfaceNode[]): Map<string, string> {
  const ids = new Map(components.map(({ id }) => [id, id]));
  if (rootId === "root") return ids;

  ids.set(rootId, "root");
  if (!ids.has("root")) return ids;

  const occupied = new Set(ids.values());
  let suffix = 1;
  let replacement = "root-node";
  while (occupied.has(replacement)) {
    suffix += 1;
    replacement = `root-node-${suffix}`;
  }
  ids.set("root", replacement);
  return ids;
}

function normalizeComponents(rootId: string, components: readonly SurfaceNode[]): Record<string, unknown>[] {
  const ids = normalizedIds(rootId, components);

  return components.map((node) => {
    const normalizedNode: Record<string, unknown> = {
      ...node,
      id: ids.get(node.id) ?? node.id,
    };

    if ("children" in node) {
      normalizedNode.children = node.children.map((childId) => ids.get(childId) ?? childId);
    }

    return normalizedNode;
  });
}

export function compileSurfaceSpec(options: CompileSurfaceOptions): CompiledSurfaceMessages;
export function compileSurfaceSpec(
  surfaceId: string,
  spec: unknown,
  sources: unknown,
): CompiledSurfaceMessages;
export function compileSurfaceSpec(
  optionsOrSurfaceId: CompileSurfaceOptions | string,
  positionalSpec?: unknown,
  positionalSources?: unknown,
): CompiledSurfaceMessages {
  const { surfaceId, spec, sources } =
    typeof optionsOrSurfaceId === "string"
      ? { surfaceId: optionsOrSurfaceId, spec: positionalSpec, sources: positionalSources }
      : optionsOrSurfaceId;

  const validation = validateSurfaceSpec(spec, sources);
  if (!validation.success) {
    throw new Error(`Cannot compile invalid surface: ${validation.issues.join(" ")}`);
  }

  const messages = [
    {
      version: A2UI_VERSION,
      createSurface: {
        surfaceId,
        catalogId: CATALOG_ID,
        sendDataModel: false,
      },
    },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/",
        value: { sources: validation.sources },
      },
    },
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: normalizeComponents(validation.spec.rootId, validation.spec.components),
      },
    },
  ].map((message) => A2uiMessageSchema.parse(message)) as [A2uiMessage, A2uiMessage, A2uiMessage];

  return deepFreeze(messages);
}
