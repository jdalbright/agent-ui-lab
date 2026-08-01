import {
  A2uiMessageSchema as ProtocolMessageSchema,
  type A2uiMessage as ProtocolMessage,
} from "@a2ui/web_core/v0_9";
import { LIMITS } from "@shared/constants";
import {
  A2uiMessageSchema as TrustedEnvelopeSchema,
  SourceRecordSchema,
} from "@shared/schemas";
import { trustedCatalog } from "./catalog";

const componentIdPattern = /^[a-z][a-z0-9-]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseComponent(componentInput: unknown): Record<string, unknown> {
  if (!isRecord(componentInput)) throw new Error("Invalid trusted component payload.");

  const { id, component, ...properties } = componentInput;
  if (typeof id !== "string" || !componentIdPattern.test(id)) {
    throw new Error("Invalid trusted component ID.");
  }
  if (typeof component !== "string") throw new Error("Invalid trusted component name.");

  const implementation = trustedCatalog.components.get(component);
  if (!implementation) throw new Error(`Unknown trusted component: ${component}.`);

  const parsedProperties = implementation.schema.safeParse(properties);
  if (!parsedProperties.success) {
    throw new Error(`Invalid component payload for ${component}.`);
  }
  const sanitizedProperties: unknown = parsedProperties.data;
  if (!isRecord(sanitizedProperties)) throw new Error(`Invalid component payload for ${component}.`);

  return { id, component, ...sanitizedProperties };
}

function parseDataModelValue(value: unknown): { sources: ReturnType<typeof SourceRecordSchema.parse>[] } {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "sources")) {
    throw new Error("The trusted data model may contain only source records.");
  }

  const result = SourceRecordSchema.array().max(LIMITS.sources).safeParse(value.sources);
  if (!result.success) throw new Error("Invalid trusted source records.");
  return { sources: result.data };
}

export function parseTrustedMessage(input: unknown): ProtocolMessage {
  const protocolMessage = ProtocolMessageSchema.parse(input);
  const trustedMessage = TrustedEnvelopeSchema.parse(protocolMessage);

  if ("createSurface" in trustedMessage) {
    return ProtocolMessageSchema.parse(trustedMessage);
  }

  if ("updateDataModel" in trustedMessage) {
    if ((trustedMessage.updateDataModel.path ?? "/") !== "/") {
      throw new Error("Trusted source data must replace the root data model.");
    }
    return ProtocolMessageSchema.parse({
      ...trustedMessage,
      updateDataModel: {
        ...trustedMessage.updateDataModel,
        path: "/",
        value: parseDataModelValue(trustedMessage.updateDataModel.value),
      },
    });
  }

  return ProtocolMessageSchema.parse({
    ...trustedMessage,
    updateComponents: {
      ...trustedMessage.updateComponents,
      components: trustedMessage.updateComponents.components.map(parseComponent),
    },
  });
}

export function parseTrustedMessages(input: readonly unknown[]): ProtocolMessage[] {
  return input.map(parseTrustedMessage);
}
