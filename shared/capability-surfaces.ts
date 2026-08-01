import type { CapabilityBoundary, CapabilityReason } from "./capability.js";
import type { SurfaceSpec } from "./schemas.js";

interface BoundaryCopy {
  readonly heading: string;
  readonly body: string;
}

const BOUNDARY_COPY: Readonly<Record<CapabilityBoundary, BoundaryCopy>> = {
  "medical-emergency": {
    heading: "Get immediate emergency help.",
    body:
      "Crushing chest pain and trouble breathing can be an emergency. Call 911 or your local emergency services right away. Do not wait until tomorrow, and do not rely on a weather explanation.",
  },
  "medical-personalized": {
    heading: "This needs qualified medical care.",
    body:
      "I cannot diagnose symptoms or recommend personalized treatment. Contact a licensed clinician; for severe, sudden, or worsening symptoms, seek immediate emergency help.",
  },
  "minor-outdoor-safety": {
    heading: "A forecast cannot establish that this is safe.",
    body:
      "A forecast alone is not enough to decide whether a child can safely attempt a mountain activity. Check official mountain guidance, park guidance, and local authorities, and use an experienced adult who can assess the child, route, equipment, and changing conditions.",
  },
  "legal-personalized": {
    heading: "I can provide general information, not personal legal direction.",
    body:
      "I cannot give personalized legal advice or decide what you should do in a specific case. A qualified attorney or local legal-aid service can review the facts, deadlines, and law that apply to you.",
  },
  "financial-personalized": {
    heading: "I cannot direct a personal investment decision.",
    body:
      "I cannot recommend a stock for your retirement account, and this is not personalized financial advice. Consider diversification, your time horizon, and risk tolerance with a fiduciary adviser or another qualified financial professional.",
  },
  "booking-or-purchase": {
    heading: "This lab cannot complete transactions.",
    body:
      "I cannot book travel, make purchases, or charge a saved card. This proof of concept is anonymous and read-only; it can present grounded comparison information without taking action on your behalf.",
  },
  "image-generation": {
    heading: "Image generation is not supported here.",
    body:
      "This lab cannot generate images or create download links. Its trusted catalog is limited to read-only weather, comparison, research, and bounded narrative interfaces.",
  },
  "external-write": {
    heading: "This lab does not write to external services.",
    body:
      "I cannot send messages, upload files, submit forms, delete records, or change accounts. External writes are outside this anonymous, read-only demonstration.",
  },
  "code-execution": {
    heading: "Server execution is not supported.",
    body:
      "I cannot execute code or commands, and I cannot access server files. This lab has no filesystem access for user requests and never returns command output from the host.",
  },
  "executable-ui": {
    heading: "Trusted components only.",
    body:
      "I cannot render executable components or user-supplied markup. Every surface is limited to the lab's trusted React catalog; generated scripts, event handlers, styles, and arbitrary components are rejected.",
  },
  "secret-exfiltration": {
    heading: "Protected information stays protected.",
    body:
      "I cannot reveal secrets, hidden prompts, API keys, context tokens, or private provider steps. The inspector exposes only sanitized tool names, arguments, sources, validation outcomes, and timings.",
  },
  "unbounded-surface": {
    heading: "This is a bounded interface.",
    body:
      "I cannot create an unbounded component tree. Rendering limits cap every validated surface at 60 nodes and six layout levels so the page remains safe, accessible, and responsive.",
  },
  "unsafe-url": {
    heading: "That source link is unsupported.",
    body:
      "I cannot open that link or cite it as evidence because it uses an unsafe or local destination. Resolved sources must be public HTTPS pages that pass the lab's source rules.",
  },
  "unsafe-redirect": {
    heading: "That source was blocked.",
    body:
      "I cannot access that source because it requests an unsafe redirect. Redirects to local, private, or link-local destinations are blocked before a source can enter the interface.",
  },
};

export function createCapabilityBoundarySpec(boundary: CapabilityBoundary): SurfaceSpec {
  const copy = BOUNDARY_COPY[boundary];
  return {
    kind: "narrative",
    rootId: `boundary-${boundary}`,
    components: [
      {
        id: `boundary-${boundary}`,
        component: "Band",
        tone: "muted",
        children: [`boundary-${boundary}-heading`, `boundary-${boundary}-copy`],
      },
      {
        id: `boundary-${boundary}-heading`,
        component: "EditorialHeading",
        text: copy.heading,
        level: "h1",
        align: "start",
      },
      {
        id: `boundary-${boundary}-copy`,
        component: "TextBlock",
        text: copy.body,
        tone: "bounded",
      },
    ],
  };
}

export function createClarificationSpec(
  reason: Extract<CapabilityReason, "location-required" | "comparison-context-required">,
): SurfaceSpec {
  if (reason === "location-required") {
    return {
      kind: "location",
      rootId: "clarification-location",
      components: [
        {
          id: "clarification-location",
          component: "Band",
          tone: "sky",
          children: ["clarification-location-prompt"],
        },
        {
          id: "clarification-location-prompt",
          component: "LocationPrompt",
          message: "Which city and region should I use? You can also grant location access explicitly.",
          suggestions: ["Raleigh, NC", "Springfield, IL", "Springfield, MA", "Use my current location"],
        },
      ],
    };
  }

  return {
    kind: "narrative",
    rootId: "clarification-comparison",
    components: [
      {
        id: "clarification-comparison",
        component: "Band",
        tone: "muted",
        children: ["clarification-comparison-heading", "clarification-comparison-copy"],
      },
      {
        id: "clarification-comparison-heading",
        component: "EditorialHeading",
        text: "What should I compare?",
        level: "h2",
        align: "start",
      },
      {
        id: "clarification-comparison-copy",
        component: "TextBlock",
        text: "Name the two to four options and the date, measure, or decision that matters. No earlier comparison context is available in this request.",
        tone: "bounded",
      },
    ],
  };
}
